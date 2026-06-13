use crate::{AppError, AppResult, WorktreeBaseRef, WorktreeConfig};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMeta {
    pub source_cwd: PathBuf,
    pub worktree_cwd: PathBuf,
    pub branch: String,
    pub created_by_claude_remote_web: bool,
}

#[derive(Debug, Clone)]
pub struct WorktreeManager {
    config: WorktreeConfig,
}

impl WorktreeManager {
    pub fn new(config: WorktreeConfig) -> Self {
        Self { config }
    }

    pub async fn create(&self, source_cwd: &Path) -> AppResult<WorktreeMeta> {
        let source_repo = resolve_source_repo(source_cwd).await?;
        let base_ref = self.resolve_base_ref(&source_repo).await?;
        let slug = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let branch = format!("{}/{}", self.config.branch_prefix, slug);
        let worktrees_dir = self.resolve_worktrees_dir(&source_repo)?;
        tokio::fs::create_dir_all(&worktrees_dir).await?;
        let worktree_cwd = worktrees_dir.join(&slug);

        run_git(
            &source_repo,
            [
                OsStr::new("worktree"),
                OsStr::new("add"),
                OsStr::new("-b"),
                OsStr::new(&branch),
                worktree_cwd.as_os_str(),
                OsStr::new(&base_ref),
            ],
        )
        .await?;

        Ok(WorktreeMeta {
            source_cwd: source_repo,
            worktree_cwd,
            branch,
            created_by_claude_remote_web: true,
        })
    }

    pub async fn remove(&self, meta: &WorktreeMeta) -> AppResult<()> {
        if !meta.created_by_claude_remote_web {
            return Err(AppError::InvalidRequest(
                "refusing to remove worktree not created by claude remote web".to_string(),
            ));
        }

        run_git(
            &meta.source_cwd,
            [
                OsStr::new("worktree"),
                OsStr::new("remove"),
                meta.worktree_cwd.as_os_str(),
            ],
        )
        .await?;
        Ok(())
    }

    fn resolve_worktrees_dir(&self, source_repo: &Path) -> AppResult<PathBuf> {
        let worktrees_dir = self
            .config
            .worktrees_dir
            .clone()
            .unwrap_or_else(|| source_repo.join(".claude").join("worktrees"));
        if worktrees_dir.is_absolute() {
            Ok(worktrees_dir)
        } else {
            Ok(std::env::current_dir()?.join(worktrees_dir))
        }
    }

    async fn resolve_base_ref(&self, source_cwd: &Path) -> AppResult<String> {
        match self.config.base_ref {
            WorktreeBaseRef::Head => Ok("HEAD".to_string()),
            WorktreeBaseRef::Fresh => resolve_fresh_base_ref(source_cwd).await,
        }
    }
}

async fn resolve_source_repo(source_cwd: &Path) -> AppResult<PathBuf> {
    let repo = run_git(source_cwd, ["rev-parse", "--show-toplevel"]).await?;
    Ok(tokio::fs::canonicalize(repo).await?)
}

async fn resolve_fresh_base_ref(source_cwd: &Path) -> AppResult<String> {
    let remote_ref = run_git(
        source_cwd,
        ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    .map_err(|_| missing_remote_head_error())?;

    if remote_ref.is_empty() {
        return Err(missing_remote_head_error());
    }

    verify_remote_ref(source_cwd, &remote_ref).await?;
    Ok(remote_ref)
}

async fn verify_remote_ref(source_cwd: &Path, remote_ref: &str) -> AppResult<()> {
    if !has_commit_ref(source_cwd, remote_ref).await? {
        return Err(missing_remote_ref_error(remote_ref));
    }
    Ok(())
}

async fn has_commit_ref(source_cwd: &Path, remote_ref: &str) -> AppResult<bool> {
    let verify_ref = format!("{remote_ref}^{{commit}}");
    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .args(["rev-parse", "--verify", "--quiet", &verify_ref])
        .stdin(Stdio::null())
        .output()
        .await?;
    Ok(output.status.success())
}

fn missing_remote_ref_error(remote_ref: &str) -> AppError {
    AppError::InvalidRequest(format!(
        "remote ref {remote_ref} is not available; sync the repo or set worktree_base_ref = \"head\""
    ))
}

fn missing_remote_head_error() -> AppError {
    AppError::InvalidRequest(
        "remote default branch refs/remotes/origin/HEAD is not available; sync the repo or set worktree_base_ref = \"head\""
            .to_string(),
    )
}

async fn run_git<I, S>(source_cwd: &Path, args: I) -> AppResult<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::InvalidRequest(stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    async fn git(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    async fn init_repo(root: &Path) {
        fs::create_dir_all(root).unwrap();
        git(root, &["init", "-b", "master"]).await;
        git(root, &["config", "user.email", "test@example.com"]).await;
        git(root, &["config", "user.name", "Test User"]).await;
        fs::write(root.join("README.md"), "hello\n").unwrap();
        git(root, &["add", "README.md"]).await;
        git(root, &["commit", "-m", "initial"]).await;
    }

    #[tokio::test]
    async fn head_mode_creates_worktree_and_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });

        let meta = manager.create(&repo).await.unwrap();

        let expected_repo = repo.canonicalize().unwrap();
        assert_eq!(meta.source_cwd, expected_repo);
        assert!(meta.worktree_cwd.exists());
        assert!(
            meta.worktree_cwd
                .ends_with(meta.branch.strip_prefix("pin/").unwrap())
        );
        assert!(meta.branch.starts_with("pin/"));
        assert!(meta.created_by_claude_remote_web);
    }

    #[tokio::test]
    async fn custom_worktrees_dir_is_used() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        let worktrees = temp.path().join("custom-worktrees");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: Some(worktrees.clone()),
            branch_prefix: "crw".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });

        let meta = manager.create(&repo).await.unwrap();

        assert!(meta.worktree_cwd.starts_with(&worktrees));
        assert!(meta.branch.starts_with("crw/"));
    }

    #[tokio::test]
    async fn relative_custom_worktrees_dir_is_resolved_from_process_cwd() {
        let current_dir = std::env::current_dir().unwrap();
        let temp = tempfile::Builder::new()
            .prefix("crw-worktree-config-relative-")
            .tempdir_in(&current_dir)
            .unwrap();
        let repo_parent = tempfile::tempdir().unwrap();
        let repo = repo_parent.path().join("repo");
        let relative_worktrees = temp
            .path()
            .strip_prefix(&current_dir)
            .unwrap()
            .join("worktrees");
        let expected_worktrees = current_dir.join(&relative_worktrees);
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: Some(relative_worktrees),
            branch_prefix: "crw".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });

        let meta = manager.create(&repo).await.unwrap();

        assert!(meta.worktree_cwd.starts_with(expected_worktrees));
        assert!(meta.worktree_cwd.exists());
    }

    #[tokio::test]
    async fn rejects_non_git_directories() {
        let temp = tempfile::tempdir().unwrap();
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });

        let err = manager.create(temp.path()).await.unwrap_err();

        assert!(err.to_string().contains("not a git repository"));
    }

    #[tokio::test]
    async fn fresh_mode_requires_remote_default_ref() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Fresh,
        });

        let err = manager.create(&repo).await.unwrap_err();

        assert!(err.to_string().contains("refs/remotes/origin/HEAD"));
        assert!(
            err.to_string()
                .contains("sync the repo or set worktree_base_ref = \"head\"")
        );
    }

    #[tokio::test]
    async fn fresh_mode_does_not_use_current_feature_branch_without_remote_head() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        git(&repo, &["checkout", "-b", "feature"]).await;
        git(
            &repo,
            &["update-ref", "refs/remotes/origin/feature", "HEAD"],
        )
        .await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Fresh,
        });

        let err = manager.create(&repo).await.unwrap_err();

        assert!(err.to_string().contains("refs/remotes/origin/HEAD"));
        assert!(!err.to_string().contains("origin/feature"));
        assert!(
            err.to_string()
                .contains("sync the repo or set worktree_base_ref = \"head\"")
        );
    }

    #[tokio::test]
    async fn fresh_mode_rejects_ambiguous_remote_branches_without_remote_head() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        git(&repo, &["update-ref", "refs/remotes/origin/main", "HEAD"]).await;
        git(&repo, &["update-ref", "refs/remotes/origin/master", "HEAD"]).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Fresh,
        });

        let err = manager.create(&repo).await.unwrap_err();

        assert!(err.to_string().contains("refs/remotes/origin/HEAD"));
        assert!(
            err.to_string()
                .contains("sync the repo or set worktree_base_ref = \"head\"")
        );
    }

    #[tokio::test]
    async fn relative_source_cwd_records_resolved_paths() {
        let current_dir = std::env::current_dir().unwrap();
        let temp = tempfile::Builder::new()
            .prefix("crw-worktree-relative-")
            .tempdir_in(&current_dir)
            .unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let relative_repo = repo.strip_prefix(&current_dir).unwrap();
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });

        let meta = manager.create(relative_repo).await.unwrap();

        let expected_repo = repo.canonicalize().unwrap();
        assert_eq!(meta.source_cwd, expected_repo);
        assert!(
            meta.worktree_cwd
                .starts_with(expected_repo.join(".claude/worktrees"))
        );
        assert!(meta.worktree_cwd.exists());
    }

    #[tokio::test]
    async fn removes_app_created_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });
        let meta = manager.create(&repo).await.unwrap();
        let path = meta.worktree_cwd.clone();

        manager.remove(&meta).await.unwrap();

        assert!(!path.exists());
    }
}
