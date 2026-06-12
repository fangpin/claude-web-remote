use crate::{AppError, AppResult, WorktreeBaseRef, WorktreeConfig};
use serde::{Deserialize, Serialize};
use std::{
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
        run_git(source_cwd, &["rev-parse", "--show-toplevel"]).await?;
        let base_ref = self.resolve_base_ref(source_cwd).await?;
        let slug = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let branch = format!("{}/{}", self.config.branch_prefix, slug);
        let worktrees_dir = self
            .config
            .worktrees_dir
            .clone()
            .unwrap_or_else(|| source_cwd.join(".claude").join("worktrees"));
        tokio::fs::create_dir_all(&worktrees_dir).await?;
        let worktree_cwd = worktrees_dir.join(&slug);

        let worktree_cwd_arg = worktree_cwd.to_string_lossy().to_string();
        run_git(
            source_cwd,
            &[
                "worktree",
                "add",
                "-b",
                &branch,
                &worktree_cwd_arg,
                &base_ref,
            ],
        )
        .await?;

        Ok(WorktreeMeta {
            source_cwd: source_cwd.to_path_buf(),
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

        let worktree_cwd_arg = meta.worktree_cwd.to_string_lossy().to_string();
        run_git(&meta.source_cwd, &["worktree", "remove", &worktree_cwd_arg]).await?;
        Ok(())
    }

    async fn resolve_base_ref(&self, source_cwd: &Path) -> AppResult<String> {
        match self.config.base_ref {
            WorktreeBaseRef::Head => Ok("HEAD".to_string()),
            WorktreeBaseRef::Fresh => resolve_fresh_base_ref(source_cwd).await,
        }
    }
}

async fn resolve_fresh_base_ref(source_cwd: &Path) -> AppResult<String> {
    let remote_head = run_git(
        source_cwd,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    .ok()
    .and_then(|output| output.strip_prefix("origin/").map(str::to_string));
    let branch = match remote_head {
        Some(branch) => branch,
        None => run_git(source_cwd, &["branch", "--show-current"])
            .await?
            .trim()
            .to_string(),
    };
    let remote_ref = format!("origin/{branch}");
    let verify_ref = format!("{remote_ref}^{{commit}}");

    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .args(["rev-parse", "--verify", "--quiet", &verify_ref])
        .stdin(Stdio::null())
        .output()
        .await?;
    if !output.status.success() {
        return Err(AppError::InvalidRequest(format!(
            "remote ref {remote_ref} is not available; sync the repo or set worktree_base_ref = \"head\""
        )));
    }

    Ok(remote_ref)
}

async fn run_git(source_cwd: &Path, args: &[&str]) -> AppResult<String> {
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

        assert_eq!(meta.source_cwd, repo);
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

        assert!(err.to_string().contains("origin/master"));
        assert!(
            err.to_string()
                .contains("sync the repo or set worktree_base_ref = \"head\"")
        );
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
