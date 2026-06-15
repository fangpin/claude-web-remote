use crate::{AppError, AppResult, WorktreeBaseRef, WorktreeConfig};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    pub created_by_claude_remote_web: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub source_cwd: PathBuf,
    pub worktree_cwd: PathBuf,
    pub branch: String,
    pub base_ref: Option<String>,
    pub dirty: bool,
    pub changed_file_count: usize,
    pub files: Vec<WorktreeFileStatus>,
    pub short_status: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeFileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub original_path: Option<String>,
}

pub const WORKTREE_DIFF_LIMIT_BYTES: usize = 200_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiff {
    pub diff: String,
    pub files: Vec<WorktreeDiffFile>,
    pub truncated: bool,
    pub limit_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiffFile {
    pub path: String,
    pub status: String,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
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
            base_ref: Some(base_ref),
            created_by_claude_remote_web: true,
        })
    }

    pub async fn status(&self, meta: &WorktreeMeta) -> AppResult<WorktreeStatus> {
        let short_status = run_git(
            &meta.worktree_cwd,
            ["status", "--short", "--untracked-files=all"],
        )
        .await?;
        let branch = run_git(&meta.worktree_cwd, ["branch", "--show-current"])
            .await
            .ok()
            .filter(|branch| !branch.is_empty())
            .unwrap_or_else(|| meta.branch.clone());
        let short_status: Vec<String> = short_status
            .lines()
            .map(str::trim_end)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        let files = short_status
            .iter()
            .map(|line| parse_short_status_line(line))
            .collect();

        Ok(WorktreeStatus {
            source_cwd: meta.source_cwd.clone(),
            worktree_cwd: meta.worktree_cwd.clone(),
            branch,
            base_ref: meta.base_ref.clone(),
            dirty: !short_status.is_empty(),
            changed_file_count: short_status.len(),
            files,
            short_status,
        })
    }

    pub async fn diff(&self, meta: &WorktreeMeta) -> AppResult<WorktreeDiff> {
        let base_ref = meta.base_ref.as_deref().unwrap_or("HEAD");
        let diff = run_git(
            &meta.worktree_cwd,
            [
                "diff",
                "--no-ext-diff",
                "--find-renames",
                base_ref,
                "--",
                ".",
            ],
        )
        .await?;
        let numstat = run_git(
            &meta.worktree_cwd,
            ["diff", "--numstat", "--find-renames", base_ref, "--", "."],
        )
        .await?;
        let name_status = run_git(
            &meta.worktree_cwd,
            [
                "diff",
                "--name-status",
                "--find-renames",
                base_ref,
                "--",
                ".",
            ],
        )
        .await?;
        let (diff, truncated) = truncate_diff(diff);

        Ok(WorktreeDiff {
            diff,
            files: parse_diff_files(&numstat, &name_status),
            truncated,
            limit_bytes: WORKTREE_DIFF_LIMIT_BYTES,
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

fn truncate_diff(diff: String) -> (String, bool) {
    if diff.len() <= WORKTREE_DIFF_LIMIT_BYTES {
        return (diff, false);
    }

    let mut limit = WORKTREE_DIFF_LIMIT_BYTES;
    while !diff.is_char_boundary(limit) {
        limit -= 1;
    }

    (diff[..limit].to_string(), true)
}

fn parse_diff_files(numstat: &str, name_status: &str) -> Vec<WorktreeDiffFile> {
    let stats: HashMap<String, (Option<usize>, Option<usize>)> = numstat
        .lines()
        .filter_map(parse_numstat)
        .map(|(path, additions, deletions)| (path, (additions, deletions)))
        .collect();

    name_status
        .lines()
        .filter_map(parse_name_status_line)
        .map(|(path, status)| {
            let (additions, deletions) = stats.get(&path).copied().unwrap_or((None, None));
            WorktreeDiffFile {
                path,
                status,
                additions,
                deletions,
            }
        })
        .collect()
}

fn parse_numstat(line: &str) -> Option<(String, Option<usize>, Option<usize>)> {
    let mut parts = line.split('\t');
    let additions = parse_optional_count(parts.next()?)?;
    let deletions = parse_optional_count(parts.next()?)?;
    let path = parts.next_back().or_else(|| parts.next())?.to_string();

    Some((path, additions, deletions))
}

fn parse_optional_count(value: &str) -> Option<Option<usize>> {
    if value == "-" {
        Some(None)
    } else {
        value.parse().ok().map(Some)
    }
}

fn parse_name_status_line(line: &str) -> Option<(String, String)> {
    let mut parts = line.split('\t');
    let status = parts.next()?;
    let path = parts.next_back().or_else(|| parts.next())?.to_string();

    Some((path, diff_status_label(status)))
}

fn diff_status_label(status: &str) -> String {
    match status.chars().next().unwrap_or(' ') {
        'A' => "added",
        'C' => "copied",
        'D' => "deleted",
        'M' => "modified",
        'R' => "renamed",
        'T' => "type_changed",
        'U' => "unmerged",
        'X' => "unknown",
        _ => "unknown",
    }
    .to_string()
}

fn parse_short_status_line(line: &str) -> WorktreeFileStatus {
    let bytes = line.as_bytes();
    let index_status = bytes.first().copied().map(char::from).unwrap_or(' ');
    let (worktree_status, path_start) = if bytes.get(2) == Some(&b' ') {
        (bytes.get(1).copied().map(char::from).unwrap_or(' '), 3)
    } else {
        (' ', 2)
    };
    let path = line
        .get(path_start..)
        .unwrap_or_default()
        .trim()
        .to_string();
    let (original_path, path) = path
        .split_once(" -> ")
        .map(|(original, renamed)| (Some(original.to_string()), renamed.to_string()))
        .unwrap_or((None, path));

    WorktreeFileStatus {
        path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        original_path,
    }
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

        assert!(matches!(err, AppError::InvalidRequest(_)));
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
    async fn reports_clean_worktree_status() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });
        let meta = manager.create(&repo).await.unwrap();

        let status = manager.status(&meta).await.unwrap();

        assert_eq!(status.source_cwd, meta.source_cwd);
        assert_eq!(status.worktree_cwd, meta.worktree_cwd);
        assert_eq!(status.branch, meta.branch);
        assert_eq!(status.base_ref, Some("HEAD".to_string()));
        assert!(!status.dirty);
        assert_eq!(status.changed_file_count, 0);
        assert!(status.files.is_empty());
        assert!(status.short_status.is_empty());
    }

    #[tokio::test]
    async fn reports_dirty_worktree_status_files() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });
        let meta = manager.create(&repo).await.unwrap();
        fs::write(meta.worktree_cwd.join("README.md"), "changed\n").unwrap();
        fs::write(meta.worktree_cwd.join("new.txt"), "new\n").unwrap();

        let status = manager.status(&meta).await.unwrap();

        assert!(status.dirty);
        assert_eq!(status.changed_file_count, 2);
        assert!(
            status
                .short_status
                .iter()
                .any(|line| line.ends_with("README.md"))
        );
        assert!(
            status
                .short_status
                .iter()
                .any(|line| line.ends_with("new.txt"))
        );
        assert!(status.files.iter().any(|file| {
            file.path == "README.md" && (file.index_status == "M" || file.worktree_status == "M")
        }));
        assert!(status.files.iter().any(|file| {
            file.path == "new.txt" && file.index_status == "?" && file.worktree_status == "?"
        }));
    }

    #[tokio::test]
    async fn reports_worktree_diff_with_file_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });
        let meta = manager.create(&repo).await.unwrap();
        fs::write(meta.worktree_cwd.join("README.md"), "hello\nchanged\n").unwrap();

        let diff = manager.diff(&meta).await.unwrap();

        assert!(diff.diff.contains("diff --git a/README.md b/README.md"));
        assert!(diff.diff.contains("+changed"));
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "README.md");
        assert_eq!(diff.files[0].status, "modified");
        assert_eq!(diff.files[0].additions, Some(1));
        assert_eq!(diff.files[0].deletions, Some(0));
        assert!(!diff.truncated);
        assert_eq!(diff.limit_bytes, WORKTREE_DIFF_LIMIT_BYTES);
    }

    #[tokio::test]
    async fn reports_clean_worktree_diff() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let manager = WorktreeManager::new(WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: WorktreeBaseRef::Head,
        });
        let meta = manager.create(&repo).await.unwrap();

        let diff = manager.diff(&meta).await.unwrap();

        assert_eq!(diff.diff, "");
        assert!(diff.files.is_empty());
        assert!(!diff.truncated);
    }

    #[test]
    fn truncates_diff_on_utf8_boundary() {
        let source = format!("{}é", "a".repeat(WORKTREE_DIFF_LIMIT_BYTES));

        let (truncated, did_truncate) = truncate_diff(source.clone());

        assert!(did_truncate);
        assert!(truncated.len() <= WORKTREE_DIFF_LIMIT_BYTES);
        assert!(source.starts_with(&truncated));
    }

    #[test]
    fn parses_diff_file_metadata() {
        let numstat = "12\t4\tweb/src/App.tsx\n-\t-\tassets/logo.png";
        let name_status = "M\tweb/src/App.tsx\nA\tassets/logo.png";

        let files = parse_diff_files(numstat, name_status);

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "web/src/App.tsx");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].additions, Some(12));
        assert_eq!(files[0].deletions, Some(4));
        assert_eq!(files[1].path, "assets/logo.png");
        assert_eq!(files[1].status, "added");
        assert_eq!(files[1].additions, None);
        assert_eq!(files[1].deletions, None);
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
