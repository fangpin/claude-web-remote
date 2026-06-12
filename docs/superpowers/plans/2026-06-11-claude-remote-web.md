# Claude Remote Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust daemon and React Web UI that controls multiple remote `claude` CLI sessions over a loopback-only Web service accessed through SSH port forwarding.

**Architecture:** The Rust daemon owns session metadata, child-process IO, event persistence, REST APIs, and WebSocket streaming. The React UI consumes those APIs to create, switch, stop, restart, and interact with sessions. The daemon never implements model routing; it runs the already configured `claude` binary from each session working directory.

**Tech Stack:** Rust 1.95, Tokio, Axum, Serde, UUID, Chrono, Tower HTTP, Tempfile; React 19, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

Create this repository structure under `/data00/home/fangpin.brave/repos/claude-remote-web`:

```text
.
├── .gitignore
├── Cargo.toml
├── crates/
│   └── server/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── api.rs              # REST and WebSocket handlers
│       │   ├── config.rs           # CLI/env config and default data dir
│       │   ├── error.rs            # AppError and API error conversion
│       │   ├── event.rs            # UI event types and normalization helpers
│       │   ├── lib.rs              # module exports for tests
│       │   ├── main.rs             # daemon entrypoint
│       │   ├── process.rs          # claude child process wrapper
│       │   ├── session.rs          # session manager and state transitions
│       │   └── store.rs            # meta/events/stderr/raw stdout persistence
│       └── tests/
│           ├── api_integration.rs  # daemon integration tests with fake claude
│           └── fake_claude.rs      # helper that creates executable fake claude script
├── docs/
│   └── superpowers/
│       ├── plans/
│       │   └── 2026-06-11-claude-remote-web.md
│       └── specs/
│           └── 2026-06-11-claude-remote-web-design.md
└── web/
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts
    └── src/
        ├── App.css
        ├── App.test.tsx
        ├── App.tsx
        ├── api.ts                 # REST client and WebSocket URL helpers
        ├── main.tsx
        ├── types.ts               # shared frontend DTOs
        └── test/
            └── setup.ts
```

Task boundaries:

1. Bootstrap workspace and backend type layer.
2. Implement persistence with tests.
3. Implement fake Claude process wrapper with tests.
4. Implement session manager with tests.
5. Implement REST/WebSocket API with integration tests.
6. Implement frontend API client and UI tests.
7. Implement React app UI.
8. Wire static serving, build, and manual verification.

Commit steps in this plan are checkpoints for environments where commits are authorized. If the user has not explicitly authorized commits, do not run the `git commit` commands; stage nothing unless asked.

---

### Task 1: Bootstrap Rust workspace and shared backend types

**Files:**
- Create: `.gitignore`
- Create: `Cargo.toml`
- Create: `crates/server/Cargo.toml`
- Create: `crates/server/src/lib.rs`
- Create: `crates/server/src/event.rs`
- Create: `crates/server/src/error.rs`
- Create: `crates/server/src/config.rs`
- Create: `crates/server/src/main.rs`

- [ ] **Step 1: Write workspace metadata**

Create `.gitignore`:

```gitignore
/target
/crates/server/target
/web/node_modules
/web/dist
/.claude-remote-web
*.log
.DS_Store
```

Create root `Cargo.toml`:

```toml
[workspace]
members = ["crates/server"]
resolver = "3"

[workspace.package]
edition = "2024"
license = "UNLICENSED"
version = "0.1.0"
```

Create `crates/server/Cargo.toml`:

```toml
[package]
name = "claude-remote-web-server"
edition.workspace = true
version.workspace = true
license.workspace = true

[dependencies]
anyhow = "1"
axum = { version = "0.8", features = ["ws"] }
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4", features = ["derive", "env"] }
futures = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["full"] }
tokio-stream = { version = "0.1", features = ["sync"] }
tower-http = { version = "0.6", features = ["cors", "fs", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid = { version = "1", features = ["v4", "serde"] }

[dev-dependencies]
reqwest = { version = "0.12", features = ["json"] }
tempfile = "3"
tokio-tungstenite = "0.26"
```

- [ ] **Step 2: Add module exports**

Create `crates/server/src/lib.rs`:

```rust
pub mod config;
pub mod error;
pub mod event;

pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent};
```

- [ ] **Step 3: Add event types**

Create `crates/server/src/event.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Assistant,
    User,
    Tool,
    System,
    Error,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiEvent {
    pub id: u64,
    pub session_id: Uuid,
    pub time: DateTime<Utc>,
    pub kind: EventKind,
    pub payload: Value,
}

impl UiEvent {
    pub fn new(id: u64, session_id: Uuid, kind: EventKind, payload: Value) -> Self {
        Self {
            id,
            session_id,
            time: Utc::now(),
            kind,
            payload,
        }
    }
}

pub fn normalize_claude_stdout(id: u64, session_id: Uuid, line: &str) -> UiEvent {
    let parsed = serde_json::from_str::<Value>(line).unwrap_or_else(|_| {
        serde_json::json!({
            "line": line
        })
    });

    let kind = parsed
        .get("type")
        .and_then(Value::as_str)
        .map(|message_type| match message_type {
            "assistant" => EventKind::Assistant,
            "user" => EventKind::User,
            "tool_use" | "tool_result" => EventKind::Tool,
            "system" => EventKind::System,
            "error" => EventKind::Error,
            _ => EventKind::Raw,
        })
        .unwrap_or(EventKind::Raw);

    UiEvent::new(id, session_id, kind, parsed)
}
```

- [ ] **Step 4: Add error type**

Create `crates/server/src/error.rs`:

```rust
use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use serde_json::json;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("process error: {0}")]
    Process(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Io(_) | AppError::Json(_) | AppError::Process(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let body = Json(json!({
            "error": self.to_string()
        }));

        (status, body).into_response()
    }
}
```

- [ ] **Step 5: Add config type and entrypoint**

Create `crates/server/src/config.rs`:

```rust
use clap::Parser;
use std::{net::SocketAddr, path::PathBuf};

#[derive(Debug, Clone, Parser)]
#[command(name = "claude-remote-web")]
pub struct Config {
    #[arg(long, env = "CRW_BIND", default_value = "127.0.0.1:8787")]
    pub bind: SocketAddr,

    #[arg(long, env = "CRW_DATA_DIR")]
    pub data_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_CLAUDE_BIN", default_value = "claude")]
    pub claude_bin: PathBuf,

    #[arg(long, env = "CRW_WEB_DIR")]
    pub web_dir: Option<PathBuf>,
}

impl Config {
    pub fn data_dir(&self) -> PathBuf {
        self.data_dir.clone().unwrap_or_else(default_data_dir)
    }
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-remote-web")
}
```

Create `crates/server/src/main.rs`:

```rust
use anyhow::Context;
use clap::Parser;
use claude_remote_web_server::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::parse();
    tracing::info!(bind = %config.bind, data_dir = %config.data_dir().display(), "starting claude remote web");

    Err(anyhow::anyhow!("API server is implemented in Task 5"))
        .context("server startup failed")
}
```

- [ ] **Step 6: Run formatting and backend check**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo check --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: `cargo check` succeeds. It may download dependencies on first run.

- [ ] **Step 7: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add .gitignore Cargo.toml crates/server/Cargo.toml crates/server/src/lib.rs crates/server/src/event.rs crates/server/src/error.rs crates/server/src/config.rs crates/server/src/main.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "chore: bootstrap claude remote web server"
```

---

### Task 2: Implement EventStore persistence

**Files:**
- Modify: `crates/server/src/lib.rs`
- Create: `crates/server/src/store.rs`

- [ ] **Step 1: Add store module export**

Modify `crates/server/src/lib.rs` to include:

```rust
pub mod config;
pub mod error;
pub mod event;
pub mod store;

pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent};
pub use store::{EventStore, SessionMeta, SessionStatus};
```

- [ ] **Step 2: Write failing store tests**

Create `crates/server/src/store.rs` with tests first:

```rust
use crate::{AppResult, UiEvent, EventKind};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::{Path, PathBuf}, sync::Arc};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Starting,
    Running,
    Exited,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct EventStore {
    root: Arc<PathBuf>,
    write_lock: Arc<Mutex<()>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn saves_and_loads_session_meta() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let id = Uuid::new_v4();
        let meta = SessionMeta {
            id,
            name: Some("demo".to_string()),
            cwd: PathBuf::from("/tmp/demo"),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: Some("claude-session".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        store.save_meta(&meta).await.unwrap();
        let loaded = store.load_meta(id).await.unwrap();

        assert_eq!(loaded.id, id);
        assert_eq!(loaded.name, Some("demo".to_string()));
        assert_eq!(loaded.cwd, PathBuf::from("/tmp/demo"));
        assert_eq!(loaded.permission_mode, "acceptEdits");
        assert_eq!(loaded.status, SessionStatus::Running);
        assert_eq!(loaded.claude_session_id, Some("claude-session".to_string()));
    }

    #[tokio::test]
    async fn appends_and_replays_events_after_offset() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        store.ensure_session_dir(session_id).await.unwrap();

        store.append_event(&UiEvent::new(1, session_id, EventKind::User, json!({"text":"hello"}))).await.unwrap();
        store.append_event(&UiEvent::new(2, session_id, EventKind::Assistant, json!({"text":"world"}))).await.unwrap();

        let all = store.load_events_after(session_id, 0).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, 1);
        assert_eq!(all[1].id, 2);

        let replay = store.load_events_after(session_id, 1).await.unwrap();
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].id, 2);
    }

    #[tokio::test]
    async fn appends_raw_stdout_and_stderr() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        store.ensure_session_dir(session_id).await.unwrap();

        store.append_raw_stdout(session_id, "{\"type\":\"assistant\"}").await.unwrap();
        store.append_stderr(session_id, "debug line").await.unwrap();

        let raw = fs::read_to_string(temp.path().join("sessions").join(session_id.to_string()).join("raw-stdout.jsonl")).await.unwrap();
        let stderr = fs::read_to_string(temp.path().join("sessions").join(session_id.to_string()).join("stderr.log")).await.unwrap();

        assert!(raw.contains("assistant"));
        assert!(stderr.contains("debug line"));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml store::tests -- --nocapture
```

Expected: FAIL with missing methods on `EventStore`.

- [ ] **Step 4: Implement EventStore methods**

Append this implementation to `crates/server/src/store.rs` above the test module:

```rust
impl EventStore {
    pub async fn new(root: impl AsRef<Path>) -> AppResult<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("sessions")).await?;
        Ok(Self {
            root: Arc::new(root),
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn root(&self) -> &Path {
        self.root.as_path()
    }

    pub async fn ensure_session_dir(&self, session_id: Uuid) -> AppResult<PathBuf> {
        let dir = self.session_dir(session_id);
        fs::create_dir_all(&dir).await?;
        Ok(dir)
    }

    pub async fn save_meta(&self, meta: &SessionMeta) -> AppResult<()> {
        let _guard = self.write_lock.lock().await;
        let dir = self.ensure_session_dir(meta.id).await?;
        let content = serde_json::to_vec_pretty(meta)?;
        fs::write(dir.join("meta.json"), content).await?;
        Ok(())
    }

    pub async fn load_meta(&self, session_id: Uuid) -> AppResult<SessionMeta> {
        let content = fs::read(self.session_dir(session_id).join("meta.json")).await?;
        Ok(serde_json::from_slice(&content)?)
    }

    pub async fn list_meta(&self) -> AppResult<Vec<SessionMeta>> {
        let mut entries = fs::read_dir(self.root.join("sessions")).await?;
        let mut sessions = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let meta_path = entry.path().join("meta.json");
            if fs::try_exists(&meta_path).await? {
                let content = fs::read(meta_path).await?;
                sessions.push(serde_json::from_slice(&content)?);
            }
        }

        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(sessions)
    }

    pub async fn append_event(&self, event: &UiEvent) -> AppResult<()> {
        let line = serde_json::to_string(event)?;
        self.append_line(event.session_id, "events.jsonl", &line).await
    }

    pub async fn load_events_after(&self, session_id: Uuid, after_id: u64) -> AppResult<Vec<UiEvent>> {
        let path = self.session_dir(session_id).join("events.jsonl");
        if !fs::try_exists(&path).await? {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path).await?;
        let mut events = Vec::new();
        for line in content.lines().filter(|line| !line.trim().is_empty()) {
            let event: UiEvent = serde_json::from_str(line)?;
            if event.id > after_id {
                events.push(event);
            }
        }
        Ok(events)
    }

    pub async fn append_raw_stdout(&self, session_id: Uuid, line: &str) -> AppResult<()> {
        self.append_line(session_id, "raw-stdout.jsonl", line).await
    }

    pub async fn append_stderr(&self, session_id: Uuid, line: &str) -> AppResult<()> {
        self.append_line(session_id, "stderr.log", line).await
    }

    async fn append_line(&self, session_id: Uuid, file_name: &str, line: &str) -> AppResult<()> {
        let _guard = self.write_lock.lock().await;
        let dir = self.ensure_session_dir(session_id).await?;
        let path = dir.join(file_name);
        let mut content = line.to_string();
        content.push('\n');
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;
        use tokio::io::AsyncWriteExt;
        file.write_all(content.as_bytes()).await?;
        file.flush().await?;
        Ok(())
    }

    fn session_dir(&self, session_id: Uuid) -> PathBuf {
        self.root.join("sessions").join(session_id.to_string())
    }
}
```

- [ ] **Step 5: Run store tests**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml store::tests -- --nocapture
```

Expected: PASS for all store tests.

- [ ] **Step 6: Run formatting and backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 7: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/src/lib.rs crates/server/src/store.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: persist remote web session events"
```

---

### Task 3: Implement ClaudeProcess with fake claude tests

**Files:**
- Modify: `crates/server/src/lib.rs`
- Create: `crates/server/src/process.rs`
- Create: `crates/server/tests/fake_claude.rs`

- [ ] **Step 1: Export process module**

Modify `crates/server/src/lib.rs`:

```rust
pub mod config;
pub mod error;
pub mod event;
pub mod process;
pub mod store;

pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use store::{EventStore, SessionMeta, SessionStatus};
```

- [ ] **Step 2: Add fake claude test helper**

Create `crates/server/tests/fake_claude.rs`:

```rust
use std::{fs, os::unix::fs::PermissionsExt, path::{Path, PathBuf}};

pub fn write_fake_claude(dir: &Path) -> PathBuf {
    let path = dir.join("fake-claude.sh");
    fs::write(
        &path,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session","message":"started"}\n'
while IFS= read -r line; do
  printf '{"type":"user","message":%s}\n' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$line")"
  printf '{"type":"assistant","message":"ack:%s"}\n' "$line"
  if [[ "$line" == "exit" ]]; then
    printf 'fake stderr line\n' >&2
    exit 0
  fi
done
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}
```

- [ ] **Step 3: Write failing process tests**

Create `crates/server/src/process.rs`:

```rust
use crate::{AppResult, EventKind, UiEvent, normalize_claude_stdout};
use serde_json::json;
use std::{path::PathBuf, process::Stdio, sync::{Arc, atomic::{AtomicU64, Ordering}}};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, Command}, sync::{Mutex, mpsc}};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ClaudeProcessConfig {
    pub claude_bin: PathBuf,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ProcessEvent {
    StdoutLine(String),
    StderrLine(String),
    UiEvent(UiEvent),
    Exited(Option<i32>),
}

pub struct ClaudeProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join("fake-claude.sh");
        fs::write(&path, r#"#!/usr/bin/env bash
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  printf '{"type":"assistant","message":"ack:%s"}\n' "$line"
  if [[ "$line" == "exit" ]]; then
    printf 'bye\n' >&2
    exit 0
  fi
done
"#).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[tokio::test]
    async fn starts_process_writes_input_and_streams_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let (process, mut rx) = ClaudeProcess::spawn(Uuid::new_v4(), ClaudeProcessConfig {
            claude_bin: bin,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            resume_session_id: None,
        }).await.unwrap();

        process.send_input("hello").await.unwrap();

        let mut saw_ack = false;
        for _ in 0..4 {
            if let Some(ProcessEvent::UiEvent(event)) = rx.recv().await {
                if event.kind == EventKind::Assistant && event.payload.to_string().contains("ack:hello") {
                    saw_ack = true;
                    break;
                }
            }
        }

        assert!(saw_ack);
        process.kill().await.unwrap();
    }

    #[tokio::test]
    async fn emits_exit_event() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let (process, mut rx) = ClaudeProcess::spawn(Uuid::new_v4(), ClaudeProcessConfig {
            claude_bin: bin,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            resume_session_id: None,
        }).await.unwrap();

        process.send_input("exit").await.unwrap();

        let mut saw_exit = false;
        for _ in 0..8 {
            if let Some(ProcessEvent::Exited(Some(0))) = rx.recv().await {
                saw_exit = true;
                break;
            }
        }

        assert!(saw_exit);
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml process::tests -- --nocapture
```

Expected: FAIL with missing `spawn`, `send_input`, and `kill` methods.

- [ ] **Step 5: Implement ClaudeProcess methods**

Append this implementation above the test module in `crates/server/src/process.rs`:

```rust
impl ClaudeProcess {
    pub async fn spawn(
        session_id: Uuid,
        config: ClaudeProcessConfig,
    ) -> AppResult<(Self, mpsc::Receiver<ProcessEvent>)> {
        let mut command = Command::new(&config.claude_bin);
        command
            .current_dir(&config.cwd)
            .arg("--input-format")
            .arg("stream-json")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--permission-mode")
            .arg(&config.permission_mode)
            .arg("--verbose")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(resume_session_id) = &config.resume_session_id {
            command.arg("--resume").arg(resume_session_id);
        }

        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| crate::AppError::Process("missing child stdin".to_string()))?;
        let stdout = child.stdout.take().ok_or_else(|| crate::AppError::Process("missing child stdout".to_string()))?;
        let stderr = child.stderr.take().ok_or_else(|| crate::AppError::Process("missing child stderr".to_string()))?;

        let (tx, rx) = mpsc::channel(256);
        let event_id = Arc::new(AtomicU64::new(1));

        spawn_stdout_reader(session_id, stdout, tx.clone(), event_id.clone());
        spawn_stderr_reader(stderr, tx.clone());

        let child = Arc::new(Mutex::new(child));
        spawn_waiter(child.clone(), tx);

        Ok((
            Self {
                child,
                stdin: Arc::new(Mutex::new(stdin)),
            },
            rx,
        ))
    }

    pub async fn send_input(&self, text: &str) -> AppResult<()> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(text.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn kill(&self) -> AppResult<()> {
        let mut child = self.child.lock().await;
        child.kill().await?;
        Ok(())
    }
}

fn spawn_stdout_reader(
    session_id: Uuid,
    stdout: tokio::process::ChildStdout,
    tx: mpsc::Sender<ProcessEvent>,
    event_id: Arc<AtomicU64>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let id = event_id.fetch_add(1, Ordering::SeqCst);
            let event = normalize_claude_stdout(id, session_id, &line);
            let _ = tx.send(ProcessEvent::StdoutLine(line)).await;
            let _ = tx.send(ProcessEvent::UiEvent(event)).await;
        }
    });
}

fn spawn_stderr_reader(stderr: tokio::process::ChildStderr, tx: mpsc::Sender<ProcessEvent>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = tx.send(ProcessEvent::StderrLine(line)).await;
        }
    });
}

fn spawn_waiter(child: Arc<Mutex<Child>>, tx: mpsc::Sender<ProcessEvent>) {
    tokio::spawn(async move {
        let status = {
            let mut child = child.lock().await;
            child.wait().await
        };
        let code = status.ok().and_then(|status| status.code());
        let _ = tx.send(ProcessEvent::Exited(code)).await;
    });
}
```

Also update imports at the top to remove unused `json` if needed:

```rust
use crate::{AppResult, EventKind, UiEvent, normalize_claude_stdout};
use std::{path::PathBuf, process::Stdio, sync::{Arc, atomic::{AtomicU64, Ordering}}};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, Command}, sync::{Mutex, mpsc}};
use uuid::Uuid;
```

- [ ] **Step 6: Run process tests**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml process::tests -- --nocapture
```

Expected: process tests pass.

- [ ] **Step 7: Run backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

- [ ] **Step 8: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/src/lib.rs crates/server/src/process.rs crates/server/tests/fake_claude.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: manage claude child processes"
```

---

### Task 4: Implement SessionManager

**Files:**
- Modify: `crates/server/src/lib.rs`
- Create: `crates/server/src/session.rs`

- [ ] **Step 1: Export session module**

Modify `crates/server/src/lib.rs`:

```rust
pub mod config;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;

pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use session::{CreateSessionRequest, SessionInfo, SessionManager};
pub use store::{EventStore, SessionMeta, SessionStatus};
```

- [ ] **Step 2: Write failing SessionManager tests**

Create `crates/server/src/session.rs`:

```rust
use crate::{AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent, SessionMeta, SessionStatus, UiEvent};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub cwd: PathBuf,
    pub name: Option<String>,
    pub permission_mode: Option<String>,
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
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

struct RunningSession {
    process: ClaudeProcess,
    tx: broadcast::Sender<UiEvent>,
}

#[derive(Clone)]
pub struct SessionManager {
    store: EventStore,
    claude_bin: PathBuf,
    running: Arc<Mutex<HashMap<Uuid, RunningSession>>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join("fake-claude.sh");
        fs::write(&path, r#"#!/usr/bin/env bash
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  printf '{"type":"assistant","message":"ack:%s"}\n' "$line"
done
"#).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[tokio::test]
    async fn rejects_missing_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(store, PathBuf::from("claude"));

        let result = manager.create_session(CreateSessionRequest {
            cwd: temp.path().join("missing"),
            name: None,
            permission_mode: None,
        }).await;

        assert!(matches!(result, Err(AppError::InvalidRequest(_))));
    }

    #[tokio::test]
    async fn creates_lists_and_stops_session() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(store, bin);

        let created = manager.create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: Some("demo".to_string()),
            permission_mode: None,
        }).await.unwrap();

        assert_eq!(created.name, Some("demo".to_string()));
        assert_eq!(created.permission_mode, "acceptEdits");
        assert_eq!(created.status, SessionStatus::Running);

        let sessions = manager.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, created.id);

        manager.stop_session(created.id).await.unwrap();
        let stopped = manager.get_session(created.id).await.unwrap();
        assert_eq!(stopped.status, SessionStatus::Stopped);
    }

    #[tokio::test]
    async fn sends_input_and_persists_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(store.clone(), bin);

        let session = manager.create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
        }).await.unwrap();

        manager.send_input(session.id, "hello".to_string()).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let events = store.load_events_after(session.id, 0).await.unwrap();
        assert!(events.iter().any(|event| event.kind == EventKind::User));
        assert!(events.iter().any(|event| event.kind == EventKind::Assistant));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml session::tests -- --nocapture
```

Expected: FAIL with missing `SessionManager` methods.

- [ ] **Step 4: Implement SessionManager methods**

Append this implementation above the test module in `crates/server/src/session.rs`:

```rust
impl SessionManager {
    pub fn new(store: EventStore, claude_bin: PathBuf) -> Self {
        Self {
            store,
            claude_bin,
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_session(&self, request: CreateSessionRequest) -> AppResult<SessionInfo> {
        if !tokio::fs::try_exists(&request.cwd).await? {
            return Err(AppError::InvalidRequest(format!("cwd does not exist: {}", request.cwd.display())));
        }
        if !tokio::fs::metadata(&request.cwd).await?.is_dir() {
            return Err(AppError::InvalidRequest(format!("cwd is not a directory: {}", request.cwd.display())));
        }

        let now = Utc::now();
        let meta = SessionMeta {
            id: Uuid::new_v4(),
            name: request.name,
            cwd: request.cwd,
            permission_mode: request.permission_mode.unwrap_or_else(|| "acceptEdits".to_string()),
            status: SessionStatus::Starting,
            claude_session_id: None,
            created_at: now,
            updated_at: now,
        };
        self.store.save_meta(&meta).await?;
        self.start_process(meta, None).await
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionInfo>> {
        Ok(self.store.list_meta().await?.into_iter().map(SessionInfo::from).collect())
    }

    pub async fn get_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        Ok(SessionInfo::from(self.store.load_meta(session_id).await?))
    }

    pub async fn send_input(&self, session_id: Uuid, text: String) -> AppResult<()> {
        let event = UiEvent::new(0, session_id, EventKind::User, json!({ "text": text }));
        self.store.append_event(&event).await?;

        let running = self.running.lock().await;
        let session = running.get(&session_id).ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
        let _ = session.tx.send(event);
        session.process.send_input(&text).await
    }

    pub async fn stop_session(&self, session_id: Uuid) -> AppResult<()> {
        let running = self.running.lock().await.remove(&session_id);
        if let Some(session) = running {
            session.process.kill().await?;
        }
        self.update_status(session_id, SessionStatus::Stopped).await
    }

    pub async fn restart_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let _ = self.stop_session(session_id).await;
        let meta = self.store.load_meta(session_id).await?;
        let resume = meta.claude_session_id.clone();
        self.start_process(meta, resume).await
    }

    pub async fn subscribe(&self, session_id: Uuid) -> AppResult<broadcast::Receiver<UiEvent>> {
        let running = self.running.lock().await;
        let session = running.get(&session_id).ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
        Ok(session.tx.subscribe())
    }

    pub async fn events_after(&self, session_id: Uuid, after_id: u64) -> AppResult<Vec<UiEvent>> {
        self.store.load_events_after(session_id, after_id).await
    }

    async fn start_process(&self, mut meta: SessionMeta, resume_session_id: Option<String>) -> AppResult<SessionInfo> {
        let (process, mut rx) = ClaudeProcess::spawn(meta.id, ClaudeProcessConfig {
            claude_bin: self.claude_bin.clone(),
            cwd: meta.cwd.clone(),
            permission_mode: meta.permission_mode.clone(),
            resume_session_id,
        }).await?;

        meta.status = SessionStatus::Running;
        meta.updated_at = Utc::now();
        self.store.save_meta(&meta).await?;

        let (tx, _) = broadcast::channel(256);
        self.running.lock().await.insert(meta.id, RunningSession { process, tx: tx.clone() });

        let store = self.store.clone();
        let running = self.running.clone();
        let session_id = meta.id;
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    ProcessEvent::StdoutLine(line) => {
                        let _ = store.append_raw_stdout(session_id, &line).await;
                    }
                    ProcessEvent::StderrLine(line) => {
                        let _ = store.append_stderr(session_id, &line).await;
                        let ui_event = UiEvent::new(0, session_id, EventKind::Error, json!({ "line": line }));
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::UiEvent(ui_event) => {
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::Exited(_) => {
                        let _ = running.lock().await.remove(&session_id);
                        if let Ok(mut meta) = store.load_meta(session_id).await {
                            if meta.status != SessionStatus::Stopped {
                                meta.status = SessionStatus::Exited;
                                meta.updated_at = Utc::now();
                                let _ = store.save_meta(&meta).await;
                            }
                        }
                        let ui_event = UiEvent::new(0, session_id, EventKind::System, json!({ "status": "exited" }));
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                }
            }
        });

        Ok(SessionInfo::from(meta))
    }

    async fn update_status(&self, session_id: Uuid, status: SessionStatus) -> AppResult<()> {
        let mut meta = self.store.load_meta(session_id).await?;
        meta.status = status;
        meta.updated_at = Utc::now();
        self.store.save_meta(&meta).await
    }
}

impl From<SessionMeta> for SessionInfo {
    fn from(meta: SessionMeta) -> Self {
        Self {
            id: meta.id,
            name: meta.name,
            cwd: meta.cwd,
            permission_mode: meta.permission_mode,
            status: meta.status,
            claude_session_id: meta.claude_session_id,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        }
    }
}
```

- [ ] **Step 5: Run session tests**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml session::tests -- --nocapture
```

Expected: session tests pass.

- [ ] **Step 6: Run backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

- [ ] **Step 7: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/src/lib.rs crates/server/src/session.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: manage remote claude sessions"
```

---

### Task 5: Implement REST and WebSocket API

**Files:**
- Modify: `crates/server/src/lib.rs`
- Create: `crates/server/src/api.rs`
- Modify: `crates/server/src/main.rs`
- Create: `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Export API module**

Modify `crates/server/src/lib.rs`:

```rust
pub mod api;
pub mod config;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;

pub use api::{AppState, build_router};
pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use session::{CreateSessionRequest, SessionInfo, SessionManager};
pub use store::{EventStore, SessionMeta, SessionStatus};
```

- [ ] **Step 2: Write integration test skeleton**

Create `crates/server/tests/api_integration.rs`:

```rust
use axum::Router;
use claude_remote_web_server::{AppState, Config, EventStore, SessionManager, build_router};
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{fs, net::SocketAddr, os::unix::fs::PermissionsExt, path::{Path, PathBuf}};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;

fn fake_claude(dir: &Path) -> PathBuf {
    let path = dir.join("fake-claude.sh");
    fs::write(&path, r#"#!/usr/bin/env bash
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  printf '{"type":"assistant","message":"ack:%s"}\n' "$line"
done
"#).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

async fn spawn_app(temp: &tempfile::TempDir, claude_bin: PathBuf) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), claude_bin);
    let state = AppState { manager, store };
    let app: Router = build_router(state, None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

#[tokio::test]
async fn creates_session_accepts_input_and_streams_events() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, bin).await;
    let client = reqwest::Client::new();

    let created: Value = client
        .post(format!("http://{addr}/api/sessions"))
        .json(&json!({ "cwd": temp.path(), "name": "demo" }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let session_id = created["id"].as_str().unwrap().to_string();

    let (mut ws, _) = connect_async(format!("ws://{addr}/api/sessions/{session_id}/events")).await.unwrap();

    client
        .post(format!("http://{addr}/api/sessions/{session_id}/input"))
        .json(&json!({ "text": "hello" }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let mut saw_ack = false;
    for _ in 0..5 {
        if let Some(Ok(message)) = ws.next().await {
            let text = message.into_text().unwrap();
            if text.contains("ack:hello") {
                saw_ack = true;
                break;
            }
        }
    }

    assert!(saw_ack);
}
```

- [ ] **Step 3: Run integration test to verify it fails**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml --test api_integration -- --nocapture
```

Expected: FAIL because `api` module and router are missing.

- [ ] **Step 4: Implement API router**

Create `crates/server/src/api.rs`:

```rust
use crate::{AppError, AppResult, CreateSessionRequest, EventStore, SessionManager};
use axum::{Json, Router, extract::{Path, Query, State, ws::{Message, WebSocket, WebSocketUpgrade}}, response::IntoResponse, routing::{get, post}};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use tower_http::{cors::CorsLayer, services::ServeDir};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub manager: SessionManager,
    pub store: EventStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsQuery {
    pub after_id: Option<u64>,
}

pub fn build_router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{id}", get(get_session))
        .route("/api/sessions/{id}/input", post(send_input))
        .route("/api/sessions/{id}/stop", post(stop_session))
        .route("/api/sessions/{id}/restart", post(restart_session))
        .route("/api/sessions/{id}/events", get(events_ws))
        .with_state(state)
        .layer(CorsLayer::permissive());

    if let Some(web_dir) = web_dir {
        api.fallback_service(ServeDir::new(web_dir))
    } else {
        api
    }
}

async fn list_sessions(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!({ "sessions": state.manager.list_sessions().await? })))
}

async fn create_session(
    State(state): State<AppState>,
    Json(request): Json<CreateSessionRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.create_session(request).await?)))
}

async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.get_session(id).await?)))
}

async fn send_input(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<InputRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if request.text.trim().is_empty() {
        return Err(AppError::InvalidRequest("input text is empty".to_string()));
    }
    state.manager.send_input(id, request.text).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn stop_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    state.manager.stop_session(id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn restart_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.restart_session(id).await?)))
}

async fn events_ws(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        handle_events_socket(state, id, query.after_id.unwrap_or(0), socket).await;
    })
}

async fn handle_events_socket(state: AppState, session_id: Uuid, after_id: u64, mut socket: WebSocket) {
    if let Ok(events) = state.manager.events_after(session_id, after_id).await {
        for event in events {
            if let Ok(text) = serde_json::to_string(&event) {
                if socket.send(Message::Text(text.into())).await.is_err() {
                    return;
                }
            }
        }
    }

    let Ok(mut rx) = state.manager.subscribe(session_id).await else {
        let _ = socket.send(Message::Text(json!({"kind":"error","payload":{"message":"session is not running"}}).to_string().into())).await;
        return;
    };

    while let Ok(event) = rx.recv().await {
        if let Ok(text) = serde_json::to_string(&event) {
            if socket.send(Message::Text(text.into())).await.is_err() {
                return;
            }
        }
    }
}
```

- [ ] **Step 5: Wire main server startup**

Replace `crates/server/src/main.rs` with:

```rust
use anyhow::Context;
use axum::serve;
use clap::Parser;
use claude_remote_web_server::{AppState, Config, EventStore, SessionManager, build_router};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::parse();
    let store = EventStore::new(config.data_dir()).await?;
    let manager = SessionManager::new(store.clone(), config.claude_bin.clone());
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir().display(), "serving claude remote web");
    serve(listener, app)
        .await
        .context("server failed")
}
```

- [ ] **Step 6: Run API integration test**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml --test api_integration -- --nocapture
```

Expected: integration test passes.

- [ ] **Step 7: Run full backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

- [ ] **Step 8: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/src/lib.rs crates/server/src/api.rs crates/server/src/main.rs crates/server/tests/api_integration.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: expose remote session api"
```

---

### Task 6: Bootstrap React app and API client tests

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/src/test/setup.ts`
- Create: `web/src/types.ts`
- Create: `web/src/api.ts`
- Create: `web/src/App.test.tsx`

- [ ] **Step 1: Create frontend package files**

Create `web/package.json`:

```json
{
  "name": "claude-remote-web-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest --run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "typescript": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@testing-library/user-event": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "jsdom": "latest",
    "vitest": "latest"
  }
}
```

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Remote Web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

Create `web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  }
});
```

Create `web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Create frontend types and API client**

Create `web/src/types.ts`:

```ts
export type SessionStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';

export type SessionInfo = {
  id: string;
  name?: string | null;
  cwd: string;
  permissionMode: string;
  status: SessionStatus;
  claudeSessionId?: string | null;
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
};
```

Create `web/src/api.ts`:

```ts
import type { CreateSessionInput, SessionInfo } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(String(body.error ?? response.statusText));
  }

  return response.json() as Promise<T>;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const result = await request<{ sessions: SessionInfo[] }>('/api/sessions');
  return result.sessions;
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  return request<SessionInfo>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function sendInput(sessionId: string, text: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/input`, {
    method: 'POST',
    body: JSON.stringify({ text })
  });
}

export async function stopSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
}

export async function restartSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/restart`, { method: 'POST' });
}

export function eventsUrl(sessionId: string, afterId = 0): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/events?afterId=${afterId}`;
}
```

- [ ] **Step 3: Write initial failing UI test**

Create `web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), {
  status: 200,
  headers: { 'content-type': 'application/json' }
})));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);

describe('App', () => {
  it('renders empty session state', async () => {
    render(<App />);
    expect(await screen.findByText('Claude Remote Web')).toBeInTheDocument();
    expect(await screen.findByText('No sessions yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run frontend test to verify it fails**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web install
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
```

Expected: FAIL because `src/App.tsx` does not exist.

- [ ] **Step 5: Create minimal App and main files**

Create `web/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listSessions } from './api';
import type { SessionInfo } from './types';
import './App.css';

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="app-shell">
      <h1>Claude Remote Web</h1>
      {loading && <p>Loading sessions...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && sessions.length === 0 && <p>No sessions yet.</p>}
    </main>
  );
}
```

Create `web/src/App.css`:

```css
:root {
  color: #f4f4f5;
  background: #111827;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
}
```

Create `web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Run frontend tests and build**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add web/package.json web/package-lock.json web/index.html web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/src
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: bootstrap remote web ui"
```

---

### Task 7: Implement React multi-session UI

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Replace UI tests with multi-session behavior tests**

Replace `web/src/App.test.tsx` with:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const sessions = [
  {
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z'
  }
];

let fetchMock: ReturnType<typeof vi.fn>;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/sessions' && !init) {
      return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ...sessions[0], id: 's2', name: 'New Repo', cwd: '/repo/two' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/input')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/stop') || url.endsWith('/restart')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

describe('App', () => {
  it('loads sessions and renders active event stream', async () => {
    render(<App />);

    expect(await screen.findByText('Repo One')).toBeInTheDocument();
    expect(screen.getByText('/repo/one')).toBeInTheDocument();

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'assistant',
      payload: { message: 'hello from claude' }
    });

    expect(await screen.findByText(/hello from claude/)).toBeInTheDocument();
  });

  it('creates a session from the form', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByText('New Repo')).toBeInTheDocument();
  });

  it('sends user input to the active session', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
  });
});
```

- [ ] **Step 2: Run frontend tests to verify they fail**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
```

Expected: FAIL because UI controls and WebSocket logic are missing.

- [ ] **Step 3: Implement React app**

Replace `web/src/App.tsx` with:

```tsx
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createSession, eventsUrl, listSessions, restartSession, sendInput, stopSession } from './api';
import type { SessionInfo, UiEvent } from './types';
import './App.css';

function eventText(event: UiEvent): string {
  if (typeof event.payload === 'object' && event.payload !== null) {
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.line === 'string') return payload.line;
  }
  return JSON.stringify(event.payload);
}

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [permissionMode, setPermissionMode] = useState('acceptEdits');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  useEffect(() => {
    listSessions()
      .then((loaded) => {
        setSessions(loaded);
        setActiveId(loaded[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const afterId = events[activeId]?.at(-1)?.id ?? 0;
    const socket = new WebSocket(eventsUrl(activeId, afterId));
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as UiEvent;
      setEvents((current) => ({
        ...current,
        [activeId]: [...(current[activeId] ?? []), event]
      }));
    };
    socket.onclose = () => undefined;
    return () => socket.close();
  }, [activeId]);

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const created = await createSession({
      cwd,
      name: name.trim() || undefined,
      permissionMode
    });
    setSessions((current) => [created, ...current]);
    setActiveId(created.id);
    setCwd('');
    setName('');
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !message.trim()) return;
    const text = message;
    setMessage('');
    await sendInput(activeId, text);
  }

  async function onStop() {
    if (!activeId) return;
    await stopSession(activeId);
    setSessions((current) => current.map((session) => session.id === activeId ? { ...session, status: 'stopped' } : session));
  }

  async function onRestart() {
    if (!activeId) return;
    const restarted = await restartSession(activeId);
    setSessions((current) => current.map((session) => session.id === activeId ? restarted : session));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>Claude Remote Web</h1>
        <form className="new-session" onSubmit={onCreateSession}>
          <label>
            Working directory
            <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
          </label>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Permission mode
            <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
              <option value="acceptEdits">acceptEdits</option>
              <option value="auto">auto</option>
              <option value="default">default</option>
            </select>
          </label>
          <button type="submit">Create session</button>
        </form>
        <section className="sessions">
          {sessions.length === 0 && <p>No sessions yet.</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.name || session.cwd}</strong>
              <span>{session.cwd}</span>
              <em>{session.status}</em>
            </button>
          ))}
        </section>
      </aside>
      <section className="conversation">
        {error && <p role="alert" className="error">{error}</p>}
        {activeSession ? (
          <>
            <header className="conversation-header">
              <div>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p>{activeSession.cwd}</p>
              </div>
              <div className="actions">
                <button onClick={onStop}>Stop</button>
                <button onClick={onRestart}>Restart</button>
              </div>
            </header>
            <div className="events">
              {(events[activeSession.id] ?? []).map((event, index) => (
                <article key={`${event.id}-${index}`} className={`event ${event.kind}`}>
                  <span>{event.kind}</span>
                  <pre>{eventText(event)}</pre>
                </article>
              ))}
            </div>
            <form className="composer" onSubmit={onSend}>
              <label>
                Message
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
              </label>
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <div className="empty-state">Create or select a session.</div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Implement styles**

Replace `web/src/App.css` with:

```css
:root {
  color: #e5e7eb;
  background: #0f172a;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

.app-shell {
  display: grid;
  grid-template-columns: 360px 1fr;
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid #273449;
  padding: 20px;
  background: #111827;
}

.sidebar h1 {
  margin: 0 0 20px;
  font-size: 24px;
}

.new-session {
  display: grid;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid #273449;
}

label {
  display: grid;
  gap: 6px;
  color: #cbd5e1;
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #e5e7eb;
  background: #0f172a;
  padding: 10px;
}

button {
  border: 1px solid #3b82f6;
  border-radius: 8px;
  color: #dbeafe;
  background: #1d4ed8;
  padding: 10px 12px;
}

.sessions {
  display: grid;
  gap: 10px;
  margin-top: 20px;
}

.session {
  display: grid;
  gap: 4px;
  width: 100%;
  border-color: #334155;
  text-align: left;
  color: #e5e7eb;
  background: #1e293b;
}

.session.active {
  border-color: #93c5fd;
  background: #1d4ed8;
}

.session span,
.session em {
  overflow: hidden;
  color: #cbd5e1;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
}

.conversation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #273449;
  padding: 20px;
}

.conversation-header h2,
.conversation-header p {
  margin: 0;
}

.conversation-header p {
  color: #94a3b8;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 8px;
}

.events {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 20px;
}

.event {
  border: 1px solid #334155;
  border-radius: 10px;
  background: #111827;
  padding: 12px;
}

.event span {
  display: inline-block;
  margin-bottom: 8px;
  color: #93c5fd;
  font-size: 12px;
  text-transform: uppercase;
}

.event pre {
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
}

.event.error {
  border-color: #ef4444;
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 12px;
  border-top: 1px solid #273449;
  padding: 20px;
}

.error,
.empty-state {
  margin: 20px;
}

.error {
  color: #fecaca;
}
```

- [ ] **Step 5: Run frontend tests and build**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add web/src/App.tsx web/src/App.css web/src/App.test.tsx
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: add multi-session web console"
```

---

### Task 8: Wire static serving and final verification

**Files:**
- Modify: `crates/server/src/api.rs`
- Modify: `crates/server/src/main.rs`
- Create: `README.md` only if the user explicitly requests docs. Otherwise skip README creation.

- [ ] **Step 1: Build frontend assets**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: `web/dist` is created.

- [ ] **Step 2: Run backend tests and frontend tests**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
```

Expected: all tests pass.

- [ ] **Step 3: Start daemon against built UI**

Run:

```bash
cargo run --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- \
  --bind 127.0.0.1:8787 \
  --data-dir /tmp/claude-remote-web-data \
  --web-dir /data00/home/fangpin.brave/repos/claude-remote-web/web/dist
```

Expected: server logs `serving claude remote web` and binds to `127.0.0.1:8787`.

- [ ] **Step 4: Verify HTTP locally on devbox**

In another shell, run:

```bash
curl -s http://127.0.0.1:8787/api/sessions
```

Expected JSON:

```json
{"sessions":[]}
```

- [ ] **Step 5: Verify browser UI through SSH tunnel**

From the local machine that can SSH to the devbox, run:

```bash
ssh -N -L 8787:127.0.0.1:8787 devbox
```

Open:

```text
http://127.0.0.1:8787
```

Expected: React UI loads and shows `Claude Remote Web`.

- [ ] **Step 6: Manually create and use two sessions**

In the browser:

1. Create a session with cwd `/data00/home/fangpin.brave/repos/claude-remote-web`.
2. Send `pwd` as a prompt.
3. Create a second session with a different existing cwd.
4. Switch between sessions.
5. Refresh the browser.
6. Verify prior events still display.
7. Click Stop on one session.
8. Click Restart on that session.

Expected: sessions create, stream, persist after refresh, stop, and restart.

- [ ] **Step 7: Final full verification**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- --check
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: all commands pass.

- [ ] **Step 8: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add Cargo.toml crates web docs .gitignore
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: build ssh-only claude remote web console"
```

---

## Self-Review

- Spec coverage: The plan covers Rust daemon, React Web UI, multi-session create/switch, fixed permission mode, stop/restart, event persistence, WebSocket reconnect replay, loopback binding, SSH tunnel deployment, fake `claude` tests, and manual verification.
- Intentional non-goals preserved: no official Claude app protocol, no gateway adapter, no file sync, no multi-user auth, no permission approval UI, no public HTTP binding.
- Placeholder scan: no incomplete placeholders or undefined future work remain in implementation steps.
- Type consistency: backend DTOs use camelCase via Serde and match frontend `SessionInfo`, `CreateSessionInput`, and `UiEvent` names. Session status values match frontend union values.
