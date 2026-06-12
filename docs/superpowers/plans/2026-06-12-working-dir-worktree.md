# Working Directory Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recent working-directory suggestions and optional Claude Code-style git worktree sessions to Claude Remote Web.

**Architecture:** Keep recent directory suggestions frontend-only by deriving them from existing session metadata. Add focused backend worktree support in a new `worktree` module, wire it into `SessionManager`, and expose one new stop-and-remove endpoint. Persist worktree metadata on sessions so restarts use the created worktree and deletion is limited to app-owned worktrees.

**Tech Stack:** Rust 2024, Axum, Tokio, serde, clap, toml, React, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

- Modify `crates/server/src/config.rs`
  - Add `WorktreeBaseRef` enum and `WorktreeConfig` struct.
  - Parse `worktrees_dir`, `worktree_branch_prefix`, and `worktree_base_ref` from CLI/config/defaults.
- Create `crates/server/src/worktree.rs`
  - Own git worktree creation/removal logic.
  - Resolve base refs without shell parsing or network fetch.
  - Generate branch/path metadata.
- Modify `crates/server/src/store.rs`
  - Add persisted `WorktreeMeta` to `SessionMeta`.
- Modify `crates/server/src/session.rs`
  - Add request/response worktree types.
  - Create worktrees before launching Claude.
  - Add `stop_and_remove_worktree`.
- Modify `crates/server/src/api.rs`
  - Add `POST /api/sessions/{id}/stop-and-remove-worktree`.
- Modify `crates/server/src/main.rs`
  - Pass resolved worktree config into `SessionManager`.
- Modify `crates/server/src/lib.rs`
  - Export worktree types used by tests and other modules.
- Modify `crates/server/tests/api_integration.rs`
  - Update `SessionManager::new` calls and add endpoint coverage.
- Modify `web/src/types.ts`
  - Add frontend worktree metadata and request types.
- Modify `web/src/api.ts`
  - Add `stopAndRemoveWorktree`.
- Modify `web/src/App.tsx`
  - Add recent directory suggestions, worktree toggle, metadata display, and stop/remove actions.
- Modify `web/src/App.css`
  - Add compact styles for suggestions, worktree metadata, and stop/remove actions.
- Modify `web/src/App.test.tsx`
  - Cover recent suggestions, worktree request body, metadata rendering, and stop/remove API calls.

---

### Task 1: Backend Config Types

**Files:**
- Modify: `crates/server/src/config.rs`
- Test: `crates/server/src/config.rs`

- [ ] **Step 1: Write failing config tests**

Add these tests inside `#[cfg(test)] mod tests` in `crates/server/src/config.rs`:

```rust
#[tokio::test]
async fn uses_default_worktree_config() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(&config_path, "").unwrap();
    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: Vec::new(),
        web_dir: None,
        default_permission_mode: None,
        worktrees_dir: None,
        worktree_branch_prefix: None,
        worktree_base_ref: None,
    };

    let resolved = config.resolve().await.unwrap();

    assert_eq!(resolved.worktree.branch_prefix, "pin");
    assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Fresh);
    assert_eq!(resolved.worktree.worktrees_dir, None);
}

#[tokio::test]
async fn loads_worktree_config_and_expands_home() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(
        &config_path,
        r#"
worktrees_dir = "~/worktrees"
worktree_branch_prefix = "crw"
worktree_base_ref = "head"
"#,
    )
    .unwrap();

    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: Vec::new(),
        web_dir: None,
        default_permission_mode: None,
        worktrees_dir: None,
        worktree_branch_prefix: None,
        worktree_base_ref: None,
    };

    let resolved = config.resolve().await.unwrap();
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

    assert_eq!(resolved.worktree.worktrees_dir, Some(home.join("worktrees")));
    assert_eq!(resolved.worktree.branch_prefix, "crw");
    assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Head);
}

#[tokio::test]
async fn cli_worktree_values_override_file_values() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(
        &config_path,
        r#"
worktrees_dir = "/from-file"
worktree_branch_prefix = "file"
worktree_base_ref = "fresh"
"#,
    )
    .unwrap();

    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: Vec::new(),
        web_dir: None,
        default_permission_mode: None,
        worktrees_dir: Some(temp.path().join("from-cli")),
        worktree_branch_prefix: Some("cli".to_string()),
        worktree_base_ref: Some(WorktreeBaseRef::Head),
    };

    let resolved = config.resolve().await.unwrap();

    assert_eq!(resolved.worktree.worktrees_dir, Some(temp.path().join("from-cli")));
    assert_eq!(resolved.worktree.branch_prefix, "cli");
    assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Head);
}
```

Update existing `Config { ... }` literals in the same test module to include:

```rust
worktrees_dir: None,
worktree_branch_prefix: None,
worktree_base_ref: None,
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
cargo test --manifest-path Cargo.toml config::tests::uses_default_worktree_config config::tests::loads_worktree_config_and_expands_home config::tests::cli_worktree_values_override_file_values
```

Expected: FAIL with missing `worktrees_dir`, `worktree_branch_prefix`, `worktree_base_ref`, `WorktreeBaseRef`, or `ResolvedConfig::worktree` errors.

- [ ] **Step 3: Implement config types and resolution**

In `crates/server/src/config.rs`, update imports:

```rust
use serde::Deserialize;
```

Add these types after `ResolvedConfig`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeBaseRef {
    Fresh,
    Head,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeConfig {
    pub worktrees_dir: Option<PathBuf>,
    pub branch_prefix: String,
    pub base_ref: WorktreeBaseRef,
}
```

Update `Config`:

```rust
#[derive(Debug, Clone, Parser)]
#[command(name = "claude-remote-web")]
pub struct Config {
    #[arg(long, env = "CRW_CONFIG")]
    pub config: Option<PathBuf>,

    #[arg(long, env = "CRW_BIND")]
    pub bind: Option<SocketAddr>,

    #[arg(long, env = "CRW_DATA_DIR")]
    pub data_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_CLAUDE_BIN")]
    pub claude_bin: Option<PathBuf>,

    #[arg(long = "launcher", env = "CRW_LAUNCHER", allow_hyphen_values = true)]
    pub launcher: Vec<String>,

    #[arg(long, env = "CRW_WEB_DIR")]
    pub web_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_DEFAULT_PERMISSION_MODE")]
    pub default_permission_mode: Option<String>,

    #[arg(long, env = "CRW_WORKTREES_DIR")]
    pub worktrees_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_WORKTREE_BRANCH_PREFIX")]
    pub worktree_branch_prefix: Option<String>,

    #[arg(long, env = "CRW_WORKTREE_BASE_REF")]
    pub worktree_base_ref: Option<WorktreeBaseRef>,
}
```

Update `ResolvedConfig`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub launcher: Vec<String>,
    pub web_dir: Option<PathBuf>,
    pub default_permission_mode: String,
    pub worktree: WorktreeConfig,
}
```

Update `FileConfig`:

```rust
#[derive(Debug, Clone, Deserialize, Default)]
struct FileConfig {
    bind: Option<SocketAddr>,
    data_dir: Option<PathBuf>,
    claude_bin: Option<PathBuf>,
    launcher: Option<Vec<String>>,
    web_dir: Option<PathBuf>,
    default_permission_mode: Option<String>,
    worktrees_dir: Option<PathBuf>,
    worktree_branch_prefix: Option<String>,
    worktree_base_ref: Option<WorktreeBaseRef>,
}
```

Update `Config::resolve` to include the worktree config field:

```rust
Ok(ResolvedConfig {
    bind: self
        .bind
        .or(file_config.bind)
        .unwrap_or_else(|| "127.0.0.1:8787".parse().expect("valid default bind")),
    data_dir: self
        .data_dir
        .clone()
        .or(file_config.data_dir.clone())
        .map(expand_home)
        .unwrap_or_else(default_data_dir),
    launcher: resolve_launcher(&self.launcher, self.claude_bin.clone(), &file_config),
    web_dir: self
        .web_dir
        .clone()
        .or(file_config.web_dir)
        .map(expand_home),
    default_permission_mode: self
        .default_permission_mode
        .clone()
        .or(file_config.default_permission_mode)
        .unwrap_or_else(|| "acceptEdits".to_string()),
    worktree: WorktreeConfig {
        worktrees_dir: self
            .worktrees_dir
            .clone()
            .or(file_config.worktrees_dir)
            .map(expand_home),
        branch_prefix: self
            .worktree_branch_prefix
            .clone()
            .or(file_config.worktree_branch_prefix)
            .unwrap_or_else(|| "pin".to_string()),
        base_ref: self
            .worktree_base_ref
            .clone()
            .or(file_config.worktree_base_ref)
            .unwrap_or(WorktreeBaseRef::Fresh),
    },
})
```

- [ ] **Step 4: Run config tests and verify pass**

Run:

```bash
cargo test --manifest-path Cargo.toml config::tests
```

Expected: PASS for all config tests.

- [ ] **Step 5: Commit config work**

Run:

```bash
git add crates/server/src/config.rs
git commit -m "$(cat <<'EOF'
feat: add worktree configuration

Add configurable worktree directory, branch prefix, and base-ref mode so session creation can match Claude Code worktree behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Worktree Git Module

**Files:**
- Create: `crates/server/src/worktree.rs`
- Modify: `crates/server/src/lib.rs`
- Test: `crates/server/src/worktree.rs`

- [ ] **Step 1: Create worktree module tests**

Create `crates/server/src/worktree.rs` with this test scaffold first:

```rust
use crate::{AppError, AppResult, WorktreeBaseRef, WorktreeConfig};
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, process::Stdio};
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
        assert!(meta.worktree_cwd.ends_with(meta.branch.strip_prefix("pin/").unwrap()));
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
        assert!(err.to_string().contains("sync the repo or set worktree_base_ref = \"head\""));
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
```

- [ ] **Step 2: Export module and run tests to verify failure**

In `crates/server/src/lib.rs`, add:

```rust
pub mod worktree;
```

and update exports:

```rust
pub use config::{Config, WorktreeBaseRef, WorktreeConfig};
pub use worktree::{WorktreeManager, WorktreeMeta};
```

Run:

```bash
cargo test --manifest-path Cargo.toml worktree::tests
```

Expected: FAIL because `WorktreeManager::new`, `create`, and `remove` are not implemented.

- [ ] **Step 3: Implement worktree manager**

Replace the non-test portion of `crates/server/src/worktree.rs` with this implementation while keeping the tests from Step 1:

```rust
use crate::{AppError, AppResult, WorktreeBaseRef, WorktreeConfig};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::process::Command;
use uuid::Uuid;

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
        ensure_git_repo(source_cwd).await?;
        let base_ref = self.resolve_base_ref(source_cwd).await?;
        let slug = Uuid::new_v4().simple().to_string()[..12].to_string();
        let branch = format!("{}/{}", self.config.branch_prefix, slug);
        let worktrees_dir = self
            .config
            .worktrees_dir
            .clone()
            .unwrap_or_else(|| source_cwd.join(".claude").join("worktrees"));
        let worktree_cwd = worktrees_dir.join(&slug);
        tokio::fs::create_dir_all(&worktrees_dir).await?;

        let output = Command::new("git")
            .arg("-C")
            .arg(source_cwd)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg(&branch)
            .arg(&worktree_cwd)
            .arg(&base_ref)
            .stdin(Stdio::null())
            .output()
            .await?;

        if !output.status.success() {
            return Err(AppError::InvalidRequest(format!(
                "git worktree create failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

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
                "worktree was not created by Claude Remote Web".to_string(),
            ));
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(&meta.source_cwd)
            .arg("worktree")
            .arg("remove")
            .arg(&meta.worktree_cwd)
            .stdin(Stdio::null())
            .output()
            .await?;

        if !output.status.success() {
            return Err(AppError::InvalidRequest(format!(
                "git worktree remove failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        Ok(())
    }

    async fn resolve_base_ref(&self, source_cwd: &Path) -> AppResult<String> {
        match self.config.base_ref {
            WorktreeBaseRef::Head => Ok("HEAD".to_string()),
            WorktreeBaseRef::Fresh => {
                let branch = default_branch(source_cwd).await?;
                let remote_ref = format!("origin/{branch}");
                ensure_ref_exists(source_cwd, &remote_ref).await?;
                Ok(remote_ref)
            }
        }
    }
}

async fn ensure_git_repo(source_cwd: &Path) -> AppResult<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .stdin(Stdio::null())
        .output()
        .await?;

    if output.status.success() {
        return Ok(());
    }

    Err(AppError::InvalidRequest(format!(
        "source cwd is not a git repository: {}",
        source_cwd.display()
    )))
}

async fn default_branch(source_cwd: &Path) -> AppResult<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .arg("symbolic-ref")
        .arg("--short")
        .arg("refs/remotes/origin/HEAD")
        .stdin(Stdio::null())
        .output()
        .await?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(branch) = text.trim().strip_prefix("origin/") {
            return Ok(branch.to_string());
        }
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .arg("branch")
        .arg("--show-current")
        .stdin(Stdio::null())
        .output()
        .await?;

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        return Err(AppError::InvalidRequest(
            "cannot resolve default branch for fresh worktree".to_string(),
        ));
    }
    Ok(branch)
}

async fn ensure_ref_exists(source_cwd: &Path, remote_ref: &str) -> AppResult<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(source_cwd)
        .arg("rev-parse")
        .arg("--verify")
        .arg(remote_ref)
        .stdin(Stdio::null())
        .output()
        .await?;

    if output.status.success() {
        return Ok(());
    }

    Err(AppError::InvalidRequest(format!(
        "fresh worktree base ref {remote_ref} is missing; sync the repo or set worktree_base_ref = \"head\""
    )))
}
```

- [ ] **Step 4: Run worktree tests and verify pass**

Run:

```bash
cargo test --manifest-path Cargo.toml worktree::tests
```

Expected: PASS.

- [ ] **Step 5: Commit worktree module**

Run:

```bash
git add crates/server/src/worktree.rs crates/server/src/lib.rs
git commit -m "$(cat <<'EOF'
feat: add git worktree manager

Create and remove app-owned git worktrees without shell parsing so sessions can run in isolated directories.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Persist Worktree Metadata in Sessions

**Files:**
- Modify: `crates/server/src/store.rs`
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/main.rs`
- Test: `crates/server/src/store.rs`, `crates/server/src/session.rs`

- [ ] **Step 1: Write failing metadata and session tests**

In `crates/server/src/store.rs`, update the `saves_and_loads_session_meta` test's `SessionMeta` literal to include:

```rust
worktree: Some(crate::WorktreeMeta {
    source_cwd: PathBuf::from("/tmp/source"),
    worktree_cwd: PathBuf::from("/tmp/source/.claude/worktrees/abc123"),
    branch: "pin/abc123".to_string(),
    created_by_claude_remote_web: true,
}),
```

Add this assertion to the same test:

```rust
assert_eq!(
    loaded.worktree.as_ref().unwrap().branch,
    "pin/abc123"
);
```

In `crates/server/src/session.rs`, add these tests inside `#[cfg(test)] mod tests`:

```rust
async fn init_repo(root: &std::path::Path) {
    fs::create_dir_all(root).unwrap();
    let run = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init", "-b", "master"]);
    run(&["config", "user.email", "test@example.com"]);
    run(&["config", "user.name", "Test User"]);
    fs::write(root.join("README.md"), "hello\n").unwrap();
    run(&["add", "README.md"]);
    run(&["commit", "-m", "initial"]);
}

#[tokio::test]
async fn creates_worktree_session_and_uses_worktree_cwd() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store.clone(),
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        crate::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: crate::WorktreeBaseRef::Head,
        },
    );

    let created = manager
        .create_session(CreateSessionRequest {
            cwd: repo.clone(),
            name: None,
            permission_mode: None,
            worktree: Some(WorktreeRequest { enabled: true }),
        })
        .await
        .unwrap();

    let worktree = created.worktree.unwrap();
    assert_eq!(worktree.source_cwd, repo);
    assert_eq!(created.cwd, worktree.worktree_cwd);
    assert!(created.cwd.exists());
    assert!(worktree.branch.starts_with("pin/"));
}

#[tokio::test]
async fn disabled_worktree_request_keeps_original_cwd() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store,
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        crate::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: crate::WorktreeBaseRef::Head,
        },
    );

    let created = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
            worktree: Some(WorktreeRequest { enabled: false }),
        })
        .await
        .unwrap();

    assert_eq!(created.cwd, temp.path());
    assert_eq!(created.worktree, None);
}
```

Update existing `CreateSessionRequest` literals in `session.rs` tests to include:

```rust
worktree: None,
```

Update existing `SessionManager::new` calls in `session.rs` tests to include:

```rust
crate::WorktreeConfig {
    worktrees_dir: None,
    branch_prefix: "pin".to_string(),
    base_ref: crate::WorktreeBaseRef::Head,
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test --manifest-path Cargo.toml store::tests::saves_and_loads_session_meta session::tests::creates_worktree_session_and_uses_worktree_cwd session::tests::disabled_worktree_request_keeps_original_cwd
```

Expected: FAIL because `SessionMeta::worktree`, `CreateSessionRequest::worktree`, `WorktreeRequest`, and updated `SessionManager::new` are not implemented.

- [ ] **Step 3: Add persisted metadata field**

In `crates/server/src/store.rs`, update imports:

```rust
use crate::{AppResult, UiEvent, WorktreeMeta};
```

Update `SessionMeta`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    pub worktree: Option<WorktreeMeta>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

Update all `SessionMeta { ... }` literals to include `worktree: None` unless the test intentionally sets metadata.

- [ ] **Step 4: Wire worktree creation into session manager**

In `crates/server/src/session.rs`, update imports:

```rust
use crate::{
    AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent,
    SessionMeta, SessionStatus, UiEvent, WorktreeConfig, WorktreeManager, WorktreeMeta,
    extract_claude_session_id,
};
```

Update request/response types near `CreateSessionRequest`:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub cwd: PathBuf,
    pub name: Option<String>,
    pub permission_mode: Option<String>,
    pub worktree: Option<WorktreeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    pub worktree: Option<WorktreeMeta>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}
```

Update `SessionManager`:

```rust
#[derive(Clone)]
pub struct SessionManager {
    store: EventStore,
    launcher: Vec<String>,
    default_permission_mode: String,
    worktree_manager: WorktreeManager,
    running: Arc<Mutex<HashMap<Uuid, RunningSession>>>,
}

impl SessionManager {
    pub fn new(
        store: EventStore,
        launcher: Vec<String>,
        default_permission_mode: String,
        worktree_config: WorktreeConfig,
    ) -> Self {
        Self {
            store,
            launcher,
            default_permission_mode,
            worktree_manager: WorktreeManager::new(worktree_config),
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }
```

Update `create_session` after cwd validation and before `SessionMeta` construction:

```rust
let worktree = if request
    .worktree
    .as_ref()
    .map(|worktree| worktree.enabled)
    .unwrap_or(false)
{
    Some(self.worktree_manager.create(&cwd).await?)
} else {
    None
};
let session_cwd = worktree
    .as_ref()
    .map(|worktree| worktree.worktree_cwd.clone())
    .unwrap_or_else(|| cwd.clone());
```

Update the `SessionMeta` literal in `create_session`:

```rust
let meta = SessionMeta {
    id: Uuid::new_v4(),
    name: request.name,
    cwd: session_cwd,
    permission_mode: request
        .permission_mode
        .unwrap_or_else(|| self.default_permission_mode.clone()),
    status: SessionStatus::Starting,
    claude_session_id: None,
    worktree,
    created_at: now,
    updated_at: now,
};
```

Update `From<SessionMeta> for SessionInfo`:

```rust
impl From<SessionMeta> for SessionInfo {
    fn from(meta: SessionMeta) -> Self {
        Self {
            id: meta.id,
            name: meta.name,
            cwd: meta.cwd,
            permission_mode: meta.permission_mode,
            status: meta.status,
            claude_session_id: meta.claude_session_id,
            worktree: meta.worktree,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        }
    }
}
```

- [ ] **Step 5: Update main manager construction**

In `crates/server/src/main.rs`, update the manager construction:

```rust
let manager = SessionManager::new(
    store.clone(),
    config.launcher.clone(),
    config.default_permission_mode.clone(),
    config.worktree.clone(),
);
```

- [ ] **Step 6: Run session and store tests**

Run:

```bash
cargo test --manifest-path Cargo.toml store::tests session::tests
```

Expected: PASS.

- [ ] **Step 7: Commit session metadata work**

Run:

```bash
git add crates/server/src/store.rs crates/server/src/session.rs crates/server/src/main.rs
git commit -m "$(cat <<'EOF'
feat: create worktree sessions

Persist app-owned worktree metadata and launch Claude from generated worktree directories when requested.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Stop and Remove Worktree API

**Files:**
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/api.rs`
- Modify: `crates/server/tests/api_integration.rs`
- Test: `crates/server/src/session.rs`, `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Write failing session tests for stop-and-remove**

In `crates/server/src/session.rs`, add these tests inside `#[cfg(test)] mod tests`:

```rust
#[tokio::test]
async fn stop_and_remove_rejects_sessions_without_app_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store,
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        crate::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: crate::WorktreeBaseRef::Head,
        },
    );
    let session = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
            worktree: None,
        })
        .await
        .unwrap();

    let err = manager.stop_and_remove_worktree(session.id).await.unwrap_err();

    assert!(err.to_string().contains("session has no app-created worktree"));
}

#[tokio::test]
async fn stop_and_remove_deletes_clean_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store.clone(),
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        crate::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: crate::WorktreeBaseRef::Head,
        },
    );
    let session = manager
        .create_session(CreateSessionRequest {
            cwd: repo,
            name: None,
            permission_mode: None,
            worktree: Some(WorktreeRequest { enabled: true }),
        })
        .await
        .unwrap();
    let worktree_path = session.worktree.as_ref().unwrap().worktree_cwd.clone();

    manager.stop_and_remove_worktree(session.id).await.unwrap();

    assert!(!worktree_path.exists());
    let loaded = store.load_meta(session.id).await.unwrap();
    assert_eq!(loaded.status, SessionStatus::Stopped);
}
```

- [ ] **Step 2: Write failing integration test for endpoint**

Update `spawn_app` in `crates/server/tests/api_integration.rs`:

```rust
async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store.clone(),
        launcher,
        "acceptEdits".to_string(),
        claude_remote_web_server::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: claude_remote_web_server::WorktreeBaseRef::Head,
        },
    );
    let state = AppState { manager, store };
    let app: Router = build_router(state, None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}
```

Add helpers to `api_integration.rs`:

```rust
async fn git(dir: &Path, args: &[&str]) {
    let output = tokio::process::Command::new("git")
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
```

Add endpoint test:

```rust
#[tokio::test]
async fn stop_and_remove_worktree_endpoint_removes_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let created: Value = client
        .post(format!("http://{addr}/api/sessions"))
        .json(&json!({ "cwd": repo, "worktree": { "enabled": true } }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let session_id = created["id"].as_str().unwrap();
    let worktree_cwd = PathBuf::from(created["worktree"]["worktreeCwd"].as_str().unwrap());
    assert!(worktree_cwd.exists());

    client
        .post(format!(
            "http://{addr}/api/sessions/{session_id}/stop-and-remove-worktree"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    assert!(!worktree_cwd.exists());
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cargo test --manifest-path Cargo.toml stop_and_remove
```

Expected: FAIL because `stop_and_remove_worktree` and the route do not exist.

- [ ] **Step 4: Implement session stop-and-remove**

Add this method to `impl SessionManager` in `crates/server/src/session.rs` near `stop_session`:

```rust
pub async fn stop_and_remove_worktree(&self, session_id: Uuid) -> AppResult<()> {
    let _ = self.stop_session(session_id).await;
    let meta = self.store.load_meta(session_id).await?;
    let worktree = meta.worktree.as_ref().ok_or_else(|| {
        AppError::InvalidRequest("session has no app-created worktree".to_string())
    })?;
    if !worktree.created_by_claude_remote_web {
        return Err(AppError::InvalidRequest(
            "session has no app-created worktree".to_string(),
        ));
    }
    self.worktree_manager.remove(worktree).await
}
```

- [ ] **Step 5: Add API route and handler**

In `crates/server/src/api.rs`, add route:

```rust
.route(
    "/api/sessions/{id}/stop-and-remove-worktree",
    post(stop_and_remove_worktree),
)
```

Place it next to the existing stop route.

Add handler below `stop_session`:

```rust
async fn stop_and_remove_worktree(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    state.manager.stop_and_remove_worktree(id).await?;
    Ok(Json(json!({ "ok": true })))
}
```

- [ ] **Step 6: Run stop-and-remove tests**

Run:

```bash
cargo test --manifest-path Cargo.toml stop_and_remove
```

Expected: PASS.

- [ ] **Step 7: Commit stop-and-remove API**

Run:

```bash
git add crates/server/src/session.rs crates/server/src/api.rs crates/server/tests/api_integration.rs
git commit -m "$(cat <<'EOF'
feat: add stop and remove worktree API

Allow users to stop a worktree-backed session and remove only the app-created git worktree.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend Types and API Client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Test: TypeScript build in later frontend tasks

- [ ] **Step 1: Update frontend types**

Replace `web/src/types.ts` with:

```ts
export type SessionStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';

export type WorktreeInfo = {
  sourceCwd: string;
  worktreeCwd: string;
  branch: string;
  createdByClaudeRemoteWeb: boolean;
};

export type SessionInfo = {
  id: string;
  name?: string | null;
  cwd: string;
  permissionMode: string;
  status: SessionStatus;
  claudeSessionId?: string | null;
  worktree?: WorktreeInfo | null;
  createdAt: string;
  updatedAt: string;
};

export type EventKind = 'assistant' | 'user' | 'tool' | 'system' | 'error' | 'raw';

export type UiEvent = {
  id: number;
  sessionId: string;
  time: string;
  kind: EventKind;
  payload: unknown;
};

export type CreateSessionInput = {
  cwd: string;
  name?: string;
  permissionMode?: string;
  worktree?: {
    enabled: boolean;
  };
};
```

- [ ] **Step 2: Add API client function**

In `web/src/api.ts`, add after `stopSession`:

```ts
export async function stopAndRemoveWorktree(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/stop-and-remove-worktree`, { method: 'POST' });
}
```

- [ ] **Step 3: Run frontend type check through build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 4: Commit frontend API types**

Run:

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "$(cat <<'EOF'
feat: add frontend worktree API types

Expose worktree session metadata and the stop-and-remove API to the web client.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend Working Directory Suggestions and Worktree Toggle

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing frontend tests for suggestions and request body**

In `web/src/App.test.tsx`, replace the `sessions` constant with:

```ts
const sessions = [
  {
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T02:00:00Z'
  },
  {
    id: 's2',
    name: 'Repo Two',
    cwd: '/repo/two',
    permissionMode: 'acceptEdits',
    status: 'stopped',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T01:00:00Z'
  },
  {
    id: 's3',
    name: 'Repo One Old',
    cwd: '/repo/one',
    permissionMode: 'acceptEdits',
    status: 'stopped',
    claudeSessionId: null,
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-06-10T00:00:00Z'
  }
];
```

In the fetch mock's create-session branch, capture the request body:

```ts
if (url === '/api/sessions' && init?.method === 'POST') {
  const body = JSON.parse(String(init.body));
  if (body.cwd === '~') {
    return new Response(JSON.stringify({ error: 'invalid request: cwd does not exist: ~' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ...sessions[0], id: 's4', name: body.name ?? 'New Repo', cwd: body.cwd }), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

Add these tests:

```ts
it('shows recent working directory suggestions and fills the input', async () => {
  render(<App />);

  expect(await screen.findByText('/repo/one')).toBeInTheDocument();
  expect(screen.getByText('/repo/two')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Use /repo/two' }));

  expect(screen.getByLabelText('Working directory')).toHaveValue('/repo/two');
});

it('sends worktree enabled when the switch is selected', async () => {
  render(<App />);

  fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
  fireEvent.click(screen.getByLabelText('Use git worktree'));
  fireEvent.click(screen.getByText('Create session'));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' })));
  const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
    cwd: '/repo/two',
    worktree: { enabled: true }
  });
});

it('omits worktree when the switch is not selected', async () => {
  render(<App />);

  fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
  fireEvent.click(screen.getByText('Create session'));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' })));
  const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
  expect(JSON.parse(String(createCall?.[1]?.body)).worktree).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because suggestions and worktree switch are not implemented.

- [ ] **Step 3: Implement frontend suggestions and toggle**

In `web/src/App.tsx`, update import:

```ts
import { FormEvent, useEffect, useMemo, useState } from 'react';
```

Keep existing import from `./api` for now.

Add state near existing form state:

```ts
const [useWorktree, setUseWorktree] = useState(false);
```

Add derived recent directories after `activeSession`:

```ts
const recentDirectories = useMemo(() => {
  const seen = new Set<string>();
  return [...sessions]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .filter((session) => {
      if (seen.has(session.cwd)) return false;
      seen.add(session.cwd);
      return true;
    })
    .slice(0, 5)
    .map((session) => session.cwd);
}, [sessions]);
```

Update `onCreateSession` body:

```ts
const created = await createSession({
  cwd,
  name: name.trim() || undefined,
  permissionMode,
  worktree: useWorktree ? { enabled: true } : undefined
});
setSessions((current) => [created, ...current]);
setActiveId(created.id);
setCwd('');
setName('');
setUseWorktree(false);
```

Replace the working directory label block in the form with:

```tsx
<label>
  Working directory
  <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
</label>
{recentDirectories.length > 0 && (
  <div className="directory-suggestions" aria-label="Recent working directories">
    <span>Recent</span>
    {recentDirectories.map((directory) => (
      <button key={directory} type="button" onClick={() => setCwd(directory)} aria-label={`Use ${directory}`}>
        {directory}
      </button>
    ))}
  </div>
)}
<label className="checkbox-label">
  <input type="checkbox" checked={useWorktree} onChange={(event) => setUseWorktree(event.target.checked)} />
  Use git worktree
</label>
```

- [ ] **Step 4: Add styles**

In `web/src/App.css`, add after the `label` rule:

```css
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-label input {
  width: auto;
}

.directory-suggestions {
  display: grid;
  gap: 6px;
}

.directory-suggestions span {
  color: #94a3b8;
  font-size: 12px;
}

.directory-suggestions button {
  overflow: hidden;
  border-color: #334155;
  color: #cbd5e1;
  background: #0f172a;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit frontend create-session UX**

Run:

```bash
git add web/src/App.tsx web/src/App.css web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
feat: add worktree session form controls

Show recent working directory suggestions and let users request git worktree sessions from the new-session form.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Frontend Worktree Display and Stop Actions

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing frontend tests for metadata display and stop/remove**

In `web/src/App.test.tsx`, add a worktree session to the `sessions` array:

```ts
{
  id: 's4',
  name: 'Worktree Repo',
  cwd: '/repo/one/.claude/worktrees/abc123',
  permissionMode: 'acceptEdits',
  status: 'running',
  claudeSessionId: null,
  worktree: {
    sourceCwd: '/repo/one',
    worktreeCwd: '/repo/one/.claude/worktrees/abc123',
    branch: 'pin/abc123',
    createdByClaudeRemoteWeb: true
  },
  createdAt: '2026-06-11T03:00:00Z',
  updatedAt: '2026-06-11T03:00:00Z'
}
```

Update fetch mock stop branch:

```ts
if (url.endsWith('/stop-and-remove-worktree')) {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
if (url.endsWith('/stop') || url.endsWith('/restart')) {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

Add tests:

```ts
it('renders worktree source and branch metadata', async () => {
  render(<App />);

  fireEvent.click(await screen.findByText('Worktree Repo'));

  expect(screen.getByText('Source: /repo/one')).toBeInTheDocument();
  expect(screen.getByText('Branch: pin/abc123')).toBeInTheDocument();
});

it('offers stop and remove for worktree sessions', async () => {
  render(<App />);

  fireEvent.click(await screen.findByText('Worktree Repo'));
  fireEvent.click(screen.getByText('Stop and remove worktree'));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop-and-remove-worktree', expect.objectContaining({ method: 'POST' })));
});

it('keeps stop-only behavior for worktree sessions', async () => {
  render(<App />);

  fireEvent.click(await screen.findByText('Worktree Repo'));
  fireEvent.click(screen.getByText('Stop only'));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop', expect.objectContaining({ method: 'POST' })));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because worktree metadata and stop/remove actions are not rendered.

- [ ] **Step 3: Implement stop/remove API use and display**

In `web/src/App.tsx`, update API import:

```ts
import { createSession, eventsUrl, listSessions, restartSession, sendInput, stopAndRemoveWorktree, stopSession } from './api';
```

Replace `onStop` with:

```ts
async function onStop(removeWorktree = false) {
  if (!activeId) return;
  setError(null);
  try {
    if (removeWorktree) {
      await stopAndRemoveWorktree(activeId);
    } else {
      await stopSession(activeId);
    }
    setSessions((current) => current.map((session) => session.id === activeId ? { ...session, status: 'stopped' } : session));
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

Replace the conversation header cwd paragraph:

```tsx
<p>{activeSession.cwd}</p>
{activeSession.worktree && (
  <div className="worktree-meta">
    <span>Source: {activeSession.worktree.sourceCwd}</span>
    <span>Branch: {activeSession.worktree.branch}</span>
  </div>
)}
```

Replace the actions block:

```tsx
<div className="actions">
  {activeSession.worktree ? (
    <>
      <button onClick={() => onStop(false)}>Stop only</button>
      <button onClick={() => onStop(true)}>Stop and remove worktree</button>
    </>
  ) : (
    <button onClick={() => onStop(false)}>Stop</button>
  )}
  <button onClick={onRestart}>Restart</button>
</div>
```

Update session list button body to show branch for worktree sessions:

```tsx
<strong>{session.name || session.cwd}</strong>
<span>{session.cwd}</span>
{session.worktree && <span>{session.worktree.branch}</span>}
<em>{session.status}</em>
```

- [ ] **Step 4: Add display styles**

In `web/src/App.css`, add after `.conversation-header p`:

```css
.worktree-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.worktree-meta span {
  border: 1px solid #334155;
  border-radius: 999px;
  color: #cbd5e1;
  background: #0f172a;
  padding: 4px 8px;
  font-size: 12px;
}
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit frontend worktree display**

Run:

```bash
git add web/src/App.tsx web/src/App.css web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
feat: show and remove worktree sessions

Display worktree source and branch metadata and expose stop-only or stop-and-remove actions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final Verification and Startup Config Docs

**Files:**
- Modify: `CLAUDE.md`
- Test: Full backend and frontend checks

- [ ] **Step 1: Update project config documentation**

In `CLAUDE.md`, update the supported config block to include the new fields:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["claude"]
web_dir = "/absolute/path/to/web/dist"
default_permission_mode = "acceptEdits"
worktrees_dir = "/absolute/path/to/worktrees"
worktree_branch_prefix = "pin"
worktree_base_ref = "fresh"
```

Add this paragraph under the config block:

```markdown
`worktrees_dir` is optional; when omitted, worktrees are created under the selected repo's `.claude/worktrees`. `worktree_base_ref = "fresh"` creates from `origin/<default-branch>` without fetching, while `"head"` creates from the repo's current local `HEAD`.
```

- [ ] **Step 2: Run Rust formatting**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
```

Expected: PASS. If it fails, run:

```bash
cargo fmt --manifest-path Cargo.toml
```

Then rerun the check and expect PASS.

- [ ] **Step 3: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 5: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 6: Manual startup check**

Run:

```bash
cat > /tmp/claude-remote-web-test.toml <<'EOF'
bind = "127.0.0.1:8789"
data_dir = "/tmp/claude-remote-web-test"
launcher = ["claude"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "acceptEdits"
worktree_branch_prefix = "pin"
worktree_base_ref = "head"
EOF
scripts/start-server.sh --config /tmp/claude-remote-web-test.toml --skip-web-build
```

In another terminal, run:

```bash
curl -s http://127.0.0.1:8789/api/sessions
```

Expected response:

```json
{"sessions":[]}
```

Stop the daemon after the check.

- [ ] **Step 7: Commit docs and verification fixes**

Run:

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document worktree configuration

Record the new worktree settings and base-ref behavior in the project instructions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Report verification evidence**

Include the exact commands and PASS results in the final handoff:

```text
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
npm --prefix web test
npm --prefix web run build
curl -s http://127.0.0.1:8789/api/sessions -> {"sessions":[]}
```

---

## Self-Review

- Spec coverage: Recent directory suggestions are covered in Task 6. Optional worktree creation, config fields, base-ref modes, metadata persistence, and restart cwd behavior are covered in Tasks 1-3. Stop-and-remove is covered in Task 4 and frontend actions in Task 7. Error visibility is covered through backend `InvalidRequest` strings and existing frontend error rendering. Full verification is covered in Task 8.
- Placeholder scan: The plan contains concrete file paths, snippets, commands, and expected results. It avoids deferred requirements and avoids shell parsing for launcher or git behavior.
- Type consistency: `WorktreeBaseRef`, `WorktreeConfig`, `WorktreeMeta`, `WorktreeRequest`, `SessionInfo.worktree`, `CreateSessionInput.worktree`, and `stopAndRemoveWorktree` use consistent names across backend and frontend tasks.
