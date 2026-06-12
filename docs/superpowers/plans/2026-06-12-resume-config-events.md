# Resume Config Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config file loading, automatic Claude session-id resume, and readable event cards to Claude Remote Web.

**Architecture:** Configuration is loaded once at daemon startup from defaults, optional TOML, and CLI overrides, then passed into `SessionManager` as runtime defaults. Session resume is handled by extracting Claude session ids from stdout JSON and updating existing session metadata before restart. Event rendering remains frontend-owned via a focused `EventCard` component that preserves raw payload visibility.

**Tech Stack:** Rust 1.95, Tokio, Axum, Serde, TOML, UUID, Chrono; React 19, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

Modify these files under `/data00/home/fangpin.brave/repos/claude-remote-web`:

```text
crates/server/Cargo.toml                 # add toml dependency
crates/server/src/config.rs              # config file + CLI merge logic
crates/server/src/event.rs               # Claude session id extraction helper
crates/server/src/process.rs             # keep resume arg testable
crates/server/src/session.rs             # default permission mode + metadata updates + resume-aware restart
crates/server/src/main.rs                # use resolved config
crates/server/tests/api_integration.rs   # restart/resume integration coverage
web/src/App.tsx                          # use EventCard component
web/src/App.css                          # event card styling
web/src/App.test.tsx                     # updated UI expectations
web/src/EventCard.tsx                    # dedicated event renderer
web/src/EventCard.test.tsx               # rendering tests for event shapes
```

No new API endpoint is added. `POST /api/sessions/:id/restart` becomes resume-aware.

Commit steps in this plan are checkpoints for environments where commits are authorized. If the user has not explicitly authorized commits, do not run the `git commit` commands; stage nothing unless asked.

---

### Task 1: Config file loading and default permission mode

**Files:**
- Modify: `crates/server/Cargo.toml`
- Modify: `crates/server/src/config.rs`
- Modify: `crates/server/src/main.rs`
- Modify: `crates/server/src/session.rs`

- [ ] **Step 1: Add TOML dependency**

Modify `crates/server/Cargo.toml` dependencies to include:

```toml
toml = "0.9"
```

- [ ] **Step 2: Write failing config tests**

Replace `crates/server/src/config.rs` with this test-first version:

```rust
use crate::{AppError, AppResult};
use clap::Parser;
use serde::Deserialize;
use std::{net::SocketAddr, path::{Path, PathBuf}};

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

    #[arg(long, env = "CRW_WEB_DIR")]
    pub web_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_DEFAULT_PERMISSION_MODE")]
    pub default_permission_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub claude_bin: PathBuf,
    pub web_dir: Option<PathBuf>,
    pub default_permission_mode: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct FileConfig {
    bind: Option<SocketAddr>,
    data_dir: Option<PathBuf>,
    claude_bin: Option<PathBuf>,
    web_dir: Option<PathBuf>,
    default_permission_mode: Option<String>,
}

impl Config {
    pub async fn resolve(&self) -> AppResult<ResolvedConfig> {
        todo!("implemented after failing tests")
    }
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-remote-web")
}

fn default_config_path() -> PathBuf {
    default_data_dir().join("config.toml")
}

fn expand_home(path: PathBuf) -> PathBuf {
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn uses_built_in_defaults_when_default_config_is_missing() {
        let config = Config {
            config: None,
            bind: None,
            data_dir: None,
            claude_bin: None,
            web_dir: None,
            default_permission_mode: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(resolved.bind, "127.0.0.1:8787".parse::<SocketAddr>().unwrap());
        assert_eq!(resolved.claude_bin, PathBuf::from("claude"));
        assert_eq!(resolved.default_permission_mode, "acceptEdits");
        assert!(resolved.data_dir.ends_with(".claude-remote-web"));
        assert_eq!(resolved.web_dir, None);
    }

    #[tokio::test]
    async fn loads_explicit_config_file_and_expands_home_paths() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(&config_path, r#"
bind = "127.0.0.1:9999"
data_dir = "~/custom-data"
claude_bin = "~/bin/claude"
web_dir = "~/web-dist"
default_permission_mode = "auto"
"#).unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            web_dir: None,
            default_permission_mode: None,
        };

        let resolved = config.resolve().await.unwrap();
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

        assert_eq!(resolved.bind, "127.0.0.1:9999".parse::<SocketAddr>().unwrap());
        assert_eq!(resolved.data_dir, home.join("custom-data"));
        assert_eq!(resolved.claude_bin, home.join("bin/claude"));
        assert_eq!(resolved.web_dir, Some(home.join("web-dist")));
        assert_eq!(resolved.default_permission_mode, "auto");
    }

    #[tokio::test]
    async fn cli_values_override_file_values() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(&config_path, r#"
bind = "127.0.0.1:9999"
default_permission_mode = "auto"
"#).unwrap();

        let config = Config {
            config: Some(config_path),
            bind: Some("127.0.0.1:7777".parse().unwrap()),
            data_dir: Some(temp.path().join("data")),
            claude_bin: Some(PathBuf::from("custom-claude")),
            web_dir: Some(temp.path().join("web")),
            default_permission_mode: Some("default".to_string()),
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(resolved.bind, "127.0.0.1:7777".parse::<SocketAddr>().unwrap());
        assert_eq!(resolved.data_dir, temp.path().join("data"));
        assert_eq!(resolved.claude_bin, PathBuf::from("custom-claude"));
        assert_eq!(resolved.web_dir, Some(temp.path().join("web")));
        assert_eq!(resolved.default_permission_mode, "default");
    }

    #[tokio::test]
    async fn explicit_missing_config_path_is_an_error() {
        let temp = tempfile::tempdir().unwrap();
        let config = Config {
            config: Some(temp.path().join("missing.toml")),
            bind: None,
            data_dir: None,
            claude_bin: None,
            web_dir: None,
            default_permission_mode: None,
        };

        let err = config.resolve().await.unwrap_err();
        assert!(err.to_string().contains("config file does not exist"));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml config::tests -- --nocapture
```

Expected: FAIL because `resolve` contains `todo!`.

- [ ] **Step 4: Implement config resolution**

Replace the placeholder methods in `crates/server/src/config.rs` with:

```rust
impl Config {
    pub async fn resolve(&self) -> AppResult<ResolvedConfig> {
        let file_config = load_file_config(self.config.as_deref()).await?;

        Ok(ResolvedConfig {
            bind: self
                .bind
                .or(file_config.bind)
                .unwrap_or_else(|| "127.0.0.1:8787".parse().expect("valid default bind")),
            data_dir: self
                .data_dir
                .clone()
                .or(file_config.data_dir)
                .map(expand_home)
                .unwrap_or_else(default_data_dir),
            claude_bin: self
                .claude_bin
                .clone()
                .or(file_config.claude_bin)
                .map(expand_home)
                .unwrap_or_else(|| PathBuf::from("claude")),
            web_dir: self.web_dir.clone().or(file_config.web_dir).map(expand_home),
            default_permission_mode: self
                .default_permission_mode
                .clone()
                .or(file_config.default_permission_mode)
                .unwrap_or_else(|| "acceptEdits".to_string()),
        })
    }
}

async fn load_file_config(explicit_path: Option<&Path>) -> AppResult<FileConfig> {
    let path = explicit_path.map(PathBuf::from).unwrap_or_else(default_config_path);
    let exists = tokio::fs::try_exists(&path).await?;
    if !exists {
        if explicit_path.is_some() {
            return Err(AppError::InvalidRequest(format!(
                "config file does not exist: {}",
                path.display()
            )));
        }
        return Ok(FileConfig::default());
    }

    let content = tokio::fs::read_to_string(&path).await?;
    toml::from_str(&content).map_err(|err| {
        AppError::InvalidRequest(format!("failed to parse config {}: {err}", path.display()))
    })
}

fn expand_home(path: PathBuf) -> PathBuf {
    let Some(path_str) = path.to_str() else {
        return path;
    };
    if path_str == "~" {
        return std::env::var_os("HOME").map(PathBuf::from).unwrap_or(path);
    }
    if let Some(rest) = path_str.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    path
}
```

Keep `default_data_dir` and `default_config_path` as defined in Step 2.

- [ ] **Step 5: Update main to use resolved config**

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

    let config = Config::parse().resolve().await?;
    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.claude_bin.clone(),
        config.default_permission_mode.clone(),
    );
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}
```

- [ ] **Step 6: Update SessionManager constructor signature**

In `crates/server/src/session.rs`, change `SessionManager` to store `default_permission_mode`.

Replace the struct and constructor with:

```rust
#[derive(Clone)]
pub struct SessionManager {
    store: EventStore,
    claude_bin: PathBuf,
    default_permission_mode: String,
    running: Arc<Mutex<HashMap<Uuid, RunningSession>>>,
}

impl SessionManager {
    pub fn new(store: EventStore, claude_bin: PathBuf, default_permission_mode: String) -> Self {
        Self {
            store,
            claude_bin,
            default_permission_mode,
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }
```

Then in `create_session`, replace:

```rust
permission_mode: request
    .permission_mode
    .unwrap_or_else(|| "acceptEdits".to_string()),
```

with:

```rust
permission_mode: request
    .permission_mode
    .unwrap_or_else(|| self.default_permission_mode.clone()),
```

Update existing tests and integration setup calls from:

```rust
SessionManager::new(store, bin)
SessionManager::new(store.clone(), claude_bin)
```

to:

```rust
SessionManager::new(store, bin, "acceptEdits".to_string())
SessionManager::new(store.clone(), claude_bin, "acceptEdits".to_string())
```

Add this test to `session::tests`:

```rust
#[tokio::test]
async fn uses_configured_default_permission_mode() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store, bin, "auto".to_string());

    let created = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
        })
        .await
        .unwrap();

    assert_eq!(created.permission_mode, "auto");
}
```

- [ ] **Step 7: Run config and backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml config::tests session::tests -- --nocapture
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

- [ ] **Step 8: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/Cargo.toml Cargo.lock crates/server/src/config.rs crates/server/src/main.rs crates/server/src/session.rs crates/server/tests/api_integration.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: load daemon config from toml"
```

---

### Task 2: Persist Claude session ids and resume on restart

**Files:**
- Modify: `crates/server/src/event.rs`
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/process.rs`
- Modify: `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Write failing session-id extraction tests**

Add these tests to `crates/server/src/event.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_session_id_from_supported_shapes() {
        assert_eq!(extract_claude_session_id(&json!({ "session_id": "snake" })), Some("snake".to_string()));
        assert_eq!(extract_claude_session_id(&json!({ "sessionId": "camel" })), Some("camel".to_string()));
        assert_eq!(extract_claude_session_id(&json!({ "session": { "id": "nested" } })), Some("nested".to_string()));
    }

    #[test]
    fn ignores_missing_or_non_string_session_id() {
        assert_eq!(extract_claude_session_id(&json!({ "session_id": 123 })), None);
        assert_eq!(extract_claude_session_id(&json!({ "session": {} })), None);
        assert_eq!(extract_claude_session_id(&json!({ "message": "hello" })), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml event::tests -- --nocapture
```

Expected: FAIL because `extract_claude_session_id` is missing.

- [ ] **Step 3: Implement session-id extraction**

Add this function to `crates/server/src/event.rs`:

```rust
pub fn extract_claude_session_id(payload: &Value) -> Option<String> {
    payload
        .get("session_id")
        .and_then(Value::as_str)
        .or_else(|| payload.get("sessionId").and_then(Value::as_str))
        .or_else(|| {
            payload
                .get("session")
                .and_then(|session| session.get("id"))
                .and_then(Value::as_str)
        })
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}
```

Export it from `crates/server/src/lib.rs` by replacing:

```rust
pub use event::{EventKind, UiEvent, normalize_claude_stdout};
```

with:

```rust
pub use event::{EventKind, UiEvent, extract_claude_session_id, normalize_claude_stdout};
```

- [ ] **Step 4: Write failing SessionManager resume tests**

In `crates/server/src/session.rs`, add imports to include `extract_claude_session_id`:

```rust
use crate::{
    AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent,
    SessionMeta, SessionStatus, UiEvent, extract_claude_session_id,
};
```

Add this test to `session::tests`:

```rust
#[tokio::test]
async fn persists_claude_session_id_from_stdout_event() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), bin, "acceptEdits".to_string());

    let session = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
        })
        .await
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let loaded = store.load_meta(session.id).await.unwrap();
    assert_eq!(loaded.claude_session_id, Some("fake-session".to_string()));
}
```

- [ ] **Step 5: Run SessionManager test to verify it fails**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml session::tests::persists_claude_session_id_from_stdout_event -- --nocapture
```

Expected: FAIL because stdout events are not updating meta.

- [ ] **Step 6: Implement metadata update from stdout UI events**

In `crates/server/src/session.rs`, add this private helper inside `impl SessionManager`:

```rust
async fn update_claude_session_id(
    store: &EventStore,
    session_id: Uuid,
    claude_session_id: String,
) -> AppResult<()> {
    let mut meta = store.load_meta(session_id).await?;
    if meta.claude_session_id.as_deref() == Some(claude_session_id.as_str()) {
        return Ok(());
    }
    meta.claude_session_id = Some(claude_session_id);
    meta.updated_at = Utc::now();
    store.save_meta(&meta).await
}
```

Then in the `ProcessEvent::UiEvent(ui_event)` branch, replace:

```rust
let _ = store.append_event(&ui_event).await;
let _ = tx.send(ui_event);
```

with:

```rust
if let Some(claude_session_id) = extract_claude_session_id(&ui_event.payload) {
    let _ = Self::update_claude_session_id(&store, session_id, claude_session_id).await;
}
let _ = store.append_event(&ui_event).await;
let _ = tx.send(ui_event);
```

- [ ] **Step 7: Add restart-without-id system event behavior**

In `restart_session`, replace:

```rust
let resume = meta.claude_session_id.clone();
self.start_process(meta, resume).await
```

with:

```rust
let resume = meta.claude_session_id.clone();
if resume.is_none() {
    let event_id = self.store.next_event_id(session_id).await?;
    let event = UiEvent::new(
        event_id,
        session_id,
        EventKind::System,
        json!({ "message": "no claude session id found; started fresh" }),
    );
    self.store.append_event(&event).await?;
}
self.start_process(meta, resume).await
```

Add this test to `session::tests`:

```rust
#[tokio::test]
async fn restart_without_session_id_records_system_event() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), bin, "acceptEdits".to_string());

    let session = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
        })
        .await
        .unwrap();

    let mut meta = store.load_meta(session.id).await.unwrap();
    meta.claude_session_id = None;
    store.save_meta(&meta).await.unwrap();

    manager.restart_session(session.id).await.unwrap();

    let events = store.load_events_after(session.id, 0).await.unwrap();
    assert!(events.iter().any(|event| event.payload.to_string().contains("no claude session id found")));
}
```

- [ ] **Step 8: Add integration test proving --resume is passed**

In `crates/server/tests/api_integration.rs`, add this fake writer:

```rust
fn fake_claude_recording_args(dir: &Path, args_log: &Path) -> PathBuf {
    let path = dir.join("fake-claude-resume.sh");
    fs::write(
        &path,
        format!(
            r#"#!/usr/bin/env bash
printf '%s\n' "$*" >> '{}'
printf '{{"type":"system","session_id":"resume-session"}}\n'
while IFS= read -r line; do
  printf '{{"type":"assistant","message":"ack:%s"}}\n' "$line"
done
"#,
            args_log.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}
```

Add this test:

```rust
#[tokio::test]
async fn restart_uses_persisted_claude_session_id() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("args.log");
    let bin = fake_claude_recording_args(temp.path(), &args_log);
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

    let session_id = created["id"].as_str().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    client
        .post(format!("http://{addr}/api/sessions/{session_id}/restart"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let args = fs::read_to_string(args_log).unwrap();
    assert!(args.contains("--resume resume-session"));
}
```

- [ ] **Step 9: Run resume tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml event::tests session::tests -- --nocapture
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml --test api_integration -- --nocapture
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

- [ ] **Step 10: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add crates/server/src/event.rs crates/server/src/lib.rs crates/server/src/session.rs crates/server/tests/api_integration.rs
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: resume claude sessions automatically"
```

---

### Task 3: EventCard frontend renderer

**Files:**
- Create: `web/src/EventCard.tsx`
- Create: `web/src/EventCard.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: Write failing EventCard tests**

Create `web/src/EventCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EventCard from './EventCard';
import type { UiEvent } from './types';

function event(payload: unknown, kind: UiEvent['kind'] = 'raw'): UiEvent {
  return {
    id: 1,
    sessionId: 's1',
    time: '2026-06-12T00:00:00Z',
    kind,
    payload
  };
}

describe('EventCard', () => {
  it('renders assistant text from message field', () => {
    render(<EventCard event={event({ message: 'hello assistant' }, 'assistant')} />);
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('hello assistant')).toBeInTheDocument();
  });

  it('renders tool name and input summary', () => {
    render(<EventCard event={event({ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }, 'tool')} />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText(/git status/)).toBeInTheDocument();
  });

  it('renders error text', () => {
    render(<EventCard event={event({ error: 'failed to start' }, 'error')} />);
    expect(screen.getByText('failed to start')).toBeInTheDocument();
  });

  it('renders unknown payload as collapsible json', () => {
    render(<EventCard event={event({ unexpected: { nested: true } }, 'raw')} />);
    expect(screen.getByText('raw')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
    expect(screen.getByText(/unexpected/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test -- EventCard.test.tsx
```

Expected: FAIL because `EventCard.tsx` is missing.

- [ ] **Step 3: Implement EventCard**

Create `web/src/EventCard.tsx`:

```tsx
import type { UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null;
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function toolName(payload: ObjectPayload): string | null {
  return stringField(payload, ['name', 'tool_name', 'toolName']);
}

function textContent(payload: ObjectPayload): string | null {
  return stringField(payload, ['message', 'text', 'content', 'status', 'error']);
}

export default function EventCard({ event }: { event: UiEvent }) {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = typeof payload.type === 'string' ? payload.type : event.kind;
  const text = textContent(payload);
  const name = toolName(payload);
  const isTool = event.kind === 'tool' || type === 'tool_use' || type === 'tool_result';

  return (
    <article className={`event ${event.kind}`}>
      <header className="event-header">
        <span>{event.kind}</span>
        {type !== event.kind && <em>{type}</em>}
      </header>

      {isTool && (
        <div className="event-section">
          <strong>{name ?? 'tool'}</strong>
          {payload.input !== undefined && <pre>{summarize(payload.input)}</pre>}
          {payload.result !== undefined && <pre>{summarize(payload.result)}</pre>}
          {payload.content !== undefined && !text && <pre>{summarize(payload.content)}</pre>}
        </div>
      )}

      {!isTool && text && <pre>{text}</pre>}

      {(!text || event.kind === 'raw') && (
        <details className="event-json" open={event.kind === 'raw'}>
          <summary>JSON payload</summary>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Wire App to EventCard**

In `web/src/App.tsx`, add import:

```tsx
import EventCard from './EventCard';
```

Remove the `eventText` function.

Replace event rendering:

```tsx
{(events[activeSession.id] ?? []).map((event, index) => (
  <article key={`${event.id}-${index}`} className={`event ${event.kind}`}>
    <span>{event.kind}</span>
    <pre>{eventText(event)}</pre>
  </article>
))}
```

with:

```tsx
{(events[activeSession.id] ?? []).map((event, index) => (
  <EventCard key={`${event.id}-${index}`} event={event} />
))}
```

- [ ] **Step 5: Update styles**

In `web/src/App.css`, replace the event-specific block from `.event { ... }` through `.event.error { ... }` with:

```css
.event {
  border: 1px solid #334155;
  border-radius: 10px;
  background: #111827;
  padding: 12px;
}

.event-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.event-header span {
  color: #93c5fd;
  font-size: 12px;
  text-transform: uppercase;
}

.event-header em {
  color: #94a3b8;
  font-size: 12px;
}

.event-section {
  display: grid;
  gap: 8px;
}

.event pre {
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
}

.event-json {
  margin-top: 8px;
}

.event-json summary {
  cursor: pointer;
  color: #cbd5e1;
  font-size: 12px;
}

.event.error {
  border-color: #ef4444;
}
```

- [ ] **Step 6: Run frontend tests and build**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: all frontend tests pass and build succeeds.

- [ ] **Step 7: Commit checkpoint if commits are authorized**

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web add web/src/EventCard.tsx web/src/EventCard.test.tsx web/src/App.tsx web/src/App.css web/src/App.test.tsx
git -C /data00/home/fangpin.brave/repos/claude-remote-web commit -m "feat: render claude events with cards"
```

---

### Task 4: Final verification

**Files:**
- Modify only if verification reveals a bug in files touched by Tasks 1-3.

- [ ] **Step 1: Run full backend and frontend verification**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- --check
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: all commands pass.

- [ ] **Step 2: Verify explicit config file startup**

Create a temporary config and start the daemon:

```bash
cat > /tmp/claude-remote-web-test.toml <<'EOF'
bind = "127.0.0.1:8788"
data_dir = "/tmp/claude-remote-web-config-test"
claude_bin = "claude"
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "auto"
EOF
cargo run --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- --config /tmp/claude-remote-web-test.toml
```

Expected: server starts on `127.0.0.1:8788`.

In another shell:

```bash
curl -s http://127.0.0.1:8788/api/sessions
```

Expected:

```json
{"sessions":[]}
```

Stop the daemon after this check.

- [ ] **Step 3: Check git status**

Run:

```bash
git -C /data00/home/fangpin.brave/repos/claude-remote-web status --short
```

Expected: only intentional project files are modified/untracked.

---

## Self-Review

- Spec coverage: Task 1 covers config defaults, explicit config, CLI precedence, home expansion, default permission mode, and explicit missing config error. Task 2 covers session id extraction, metadata persistence, resume-aware restart, and missing-id system event. Task 3 covers dedicated event cards and JSON fallback. Task 4 covers final verification and explicit config startup.
- Placeholder scan: no incomplete placeholders or undefined future work remain in implementation steps.
- Type consistency: backend `ResolvedConfig`, `SessionManager::new`, `extract_claude_session_id`, and frontend `EventCard` names are introduced before use and remain consistent across tasks.
