# Background and Finished Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude Code-style background and finished tool tasks across all sessions and inside the active session.

**Architecture:** Add a backend task projection layer that rebuilds task state from existing append-only session events. Expose read-only task endpoints, then render global and per-session task panels in the React UI. Events remain the source of truth; task state is a derived view.

**Tech Stack:** Rust 2024, Axum, Tokio, Serde/serde_json, React, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

Create these files:

```text
crates/server/src/task.rs        # task data model and event projection rules
web/src/TasksPanel.tsx           # reusable task list renderer
web/src/TasksPanel.test.tsx      # frontend task panel unit tests
```

Modify these files:

```text
crates/server/src/lib.rs                  # export task module/types
crates/server/src/session.rs              # add task-loading methods on SessionManager
crates/server/src/api.rs                  # add /api/tasks and /api/sessions/{id}/tasks
crates/server/tests/api_integration.rs    # endpoint tests for global/session task APIs
web/src/types.ts                          # add TaskInfo/TaskGroups types
web/src/api.ts                            # add task API client helpers
web/src/App.tsx                           # load, refresh, and render task panels
web/src/EventCard.tsx                     # add stable DOM id for event scrolling
web/src/App.css                           # task panel layout/status styles
web/src/App.test.tsx                      # app-level task interaction tests
```

Do not add persistent task storage. Do not commit during implementation unless the user explicitly asks for commits.

---

### Task 1: Add backend task projection model

**Files:**
- Create: `crates/server/src/task.rs`
- Modify: `crates/server/src/lib.rs`

- [ ] **Step 1: Create failing task projection tests**

Create `crates/server/src/task.rs` with the model declarations and tests below. The helper functions are intentionally referenced before implementation so this test-driven step fails first.

```rust
use crate::{EventKind, SessionMeta, SessionStatus, UiEvent};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Background,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: String,
    pub session_id: Uuid,
    pub session_name: Option<String>,
    pub session_cwd: PathBuf,
    pub tool_kind: String,
    pub title: String,
    pub status: TaskStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub start_event_id: u64,
    pub finish_event_id: Option<u64>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskGroups {
    pub background: Vec<TaskInfo>,
    pub finished: Vec<TaskInfo>,
}

impl TaskGroups {
    pub fn into_tasks(self) -> Vec<TaskInfo> {
        self.background.into_iter().chain(self.finished).collect()
    }
}

pub fn project_session_tasks(meta: &SessionMeta, events: &[UiEvent]) -> TaskGroups {
    let mut tasks: HashMap<String, TaskInfo> = HashMap::new();

    for event in events {
        if let Some(start) = task_start(meta, event) {
            tasks.entry(start.id.clone()).or_insert(start);
            continue;
        }

        if let Some(finish) = task_finish(meta, event) {
            if let Some(task) = tasks.get_mut(&finish.task_id) {
                task.status = finish.status;
                task.finished_at = Some(event.time);
                task.finish_event_id = Some(event.id);
                task.summary = finish.summary;
            }
            continue;
        }

        if is_session_exit_event(event) {
            interrupt_background_tasks(
                &mut tasks,
                event.time,
                Some(event.id),
                "session exited before task completed".to_string(),
            );
        }
    }

    if matches!(meta.status, SessionStatus::Exited | SessionStatus::Stopped | SessionStatus::Failed)
    {
        interrupt_background_tasks(
            &mut tasks,
            meta.updated_at,
            None,
            "session ended before task completed".to_string(),
        );
    }

    group_tasks(tasks.into_values().collect())
}

pub fn group_tasks(mut tasks: Vec<TaskInfo>) -> TaskGroups {
    tasks.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    let mut groups = TaskGroups::default();
    for task in tasks {
        if task.status == TaskStatus::Background {
            groups.background.push(task);
        } else {
            groups.finished.push(task);
        }
    }
    groups.finished.sort_by(|a, b| {
        b.finished_at
            .unwrap_or(b.started_at)
            .cmp(&a.finished_at.unwrap_or(a.started_at))
    });
    groups
}

struct TaskFinish {
    task_id: String,
    status: TaskStatus,
    summary: Option<String>,
}

fn task_start(_meta: &SessionMeta, _event: &UiEvent) -> Option<TaskInfo> {
    unimplemented!("implemented in Step 3")
}

fn task_finish(_meta: &SessionMeta, _event: &UiEvent) -> Option<TaskFinish> {
    unimplemented!("implemented in Step 3")
}

fn is_session_exit_event(_event: &UiEvent) -> bool {
    unimplemented!("implemented in Step 3")
}

fn interrupt_background_tasks(
    _tasks: &mut HashMap<String, TaskInfo>,
    _time: DateTime<Utc>,
    _event_id: Option<u64>,
    _summary: String,
) {
    unimplemented!("implemented in Step 3")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(id: Uuid, status: SessionStatus) -> SessionMeta {
        let now = Utc::now();
        SessionMeta {
            id,
            name: Some("Demo Session".to_string()),
            cwd: PathBuf::from("/repo/demo"),
            permission_mode: "acceptEdits".to_string(),
            status,
            claude_session_id: Some("claude-session".to_string()),
            created_at: now,
            updated_at: now,
        }
    }

    fn event(id: u64, session_id: Uuid, kind: EventKind, payload: Value) -> UiEvent {
        UiEvent::new(id, session_id, kind, payload)
    }

    #[test]
    fn tool_use_creates_background_task() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![event(
            1,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Bash",
                "input": { "command": "sleep 10" }
            }),
        )];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 1);
        assert_eq!(tasks.finished.len(), 0);
        assert_eq!(tasks.background[0].id, format!("{session_id}:toolu_1"));
        assert_eq!(tasks.background[0].tool_kind, "Bash");
        assert_eq!(tasks.background[0].title, "Bash: sleep 10");
        assert_eq!(tasks.background[0].status, TaskStatus::Background);
        assert_eq!(tasks.background[0].start_event_id, 1);
    }

    #[test]
    fn matching_tool_result_marks_task_completed() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "Bash",
                    "input": { "command": "pwd" }
                }),
            ),
            event(
                2,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "content": "/repo/demo"
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Completed);
        assert_eq!(tasks.finished[0].finish_event_id, Some(2));
        assert_eq!(tasks.finished[0].summary, Some("/repo/demo".to_string()));
    }

    #[test]
    fn explicit_tool_error_marks_task_failed() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "Bash",
                    "input": { "command": "false" }
                }),
            ),
            event(
                2,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "is_error": true,
                    "content": "exit status 1"
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Failed);
        assert_eq!(tasks.finished[0].summary, Some("exit status 1".to_string()));
    }

    #[test]
    fn session_exit_interrupts_unfinished_tasks() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Exited);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "Agent",
                    "input": { "prompt": "Review the branch" }
                }),
            ),
            event(
                2,
                session_id,
                EventKind::System,
                json!({ "status": "exited" }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Interrupted);
        assert_eq!(tasks.finished[0].finish_event_id, Some(2));
    }

    #[test]
    fn ambiguous_events_do_not_create_tasks() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![event(
            1,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_use",
                "name": "Bash",
                "input": { "command": "git status" }
            }),
        )];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 0);
    }
}
```

- [ ] **Step 2: Export the task module**

In `crates/server/src/lib.rs`, add the module and exports:

```rust
pub mod api;
pub mod config;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;
pub mod task;

pub use api::{AppState, build_router};
pub use config::Config;
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent, extract_claude_session_id, normalize_claude_stdout};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use session::{CreateSessionRequest, SessionInfo, SessionManager};
pub use store::{EventStore, SessionMeta, SessionStatus};
pub use task::{TaskGroups, TaskInfo, TaskStatus, group_tasks, project_session_tasks};
```

- [ ] **Step 3: Run task tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml task::tests -- --nocapture
```

Expected: FAIL with `not implemented: implemented in Step 3` from task projection helpers.

- [ ] **Step 4: Implement task projection helpers**

Replace the four `unimplemented!` helper functions in `crates/server/src/task.rs` with this implementation:

```rust
fn task_start(meta: &SessionMeta, event: &UiEvent) -> Option<TaskInfo> {
    if event.payload.get("type").and_then(Value::as_str) != Some("tool_use") {
        return None;
    }
    let raw_id = string_field(
        &event.payload,
        &["id", "tool_use_id", "toolUseId", "tool_call_id", "toolCallId"],
    )?;
    let tool_kind = string_field(&event.payload, &["name", "tool_name", "toolName"])
        .unwrap_or_else(|| "tool".to_string());
    let input = event.payload.get("input");
    let detail = input.and_then(summarize_value);
    let title = detail
        .map(|detail| format!("{tool_kind}: {detail}"))
        .unwrap_or_else(|| tool_kind.clone());

    Some(TaskInfo {
        id: scoped_task_id(meta.id, &raw_id),
        session_id: meta.id,
        session_name: meta.name.clone(),
        session_cwd: meta.cwd.clone(),
        tool_kind,
        title,
        status: TaskStatus::Background,
        started_at: event.time,
        finished_at: None,
        start_event_id: event.id,
        finish_event_id: None,
        summary: None,
    })
}

fn task_finish(meta: &SessionMeta, event: &UiEvent) -> Option<TaskFinish> {
    if event.payload.get("type").and_then(Value::as_str) != Some("tool_result") {
        return None;
    }
    let raw_id = string_field(
        &event.payload,
        &["tool_use_id", "toolUseId", "id", "tool_call_id", "toolCallId"],
    )?;
    let failed = event
        .payload
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || event.payload.get("error").is_some();
    let summary = event
        .payload
        .get("content")
        .or_else(|| event.payload.get("result"))
        .or_else(|| event.payload.get("error"))
        .and_then(summarize_value);

    Some(TaskFinish {
        task_id: scoped_task_id(meta.id, &raw_id),
        status: if failed {
            TaskStatus::Failed
        } else {
            TaskStatus::Completed
        },
        summary,
    })
}

fn is_session_exit_event(event: &UiEvent) -> bool {
    event.kind == EventKind::System
        && event.payload.get("status").and_then(Value::as_str) == Some("exited")
}

fn interrupt_background_tasks(
    tasks: &mut HashMap<String, TaskInfo>,
    time: DateTime<Utc>,
    event_id: Option<u64>,
    summary: String,
) {
    for task in tasks.values_mut() {
        if task.status == TaskStatus::Background {
            task.status = TaskStatus::Interrupted;
            task.finished_at = Some(time);
            if task.finish_event_id.is_none() {
                task.finish_event_id = event_id;
            }
            if task.summary.is_none() {
                task.summary = Some(summary.clone());
            }
        }
    }
}

fn scoped_task_id(session_id: Uuid, raw_id: &str) -> String {
    format!("{session_id}:{raw_id}")
}

fn string_field(payload: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = payload.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn summarize_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => non_empty_summary(text),
        Value::Array(items) => items.iter().find_map(|item| {
            if let Some(text) = item.as_str() {
                return non_empty_summary(text);
            }
            item.get("text")
                .and_then(Value::as_str)
                .and_then(non_empty_summary)
                .or_else(|| item.get("content").and_then(Value::as_str).and_then(non_empty_summary))
        }),
        Value::Object(object) => {
            for key in ["command", "prompt", "description", "text", "message", "content", "result", "error"] {
                if let Some(summary) = object.get(key).and_then(summarize_value) {
                    return Some(summary);
                }
            }
            serde_json::to_string(value).ok().and_then(|text| non_empty_summary(&text))
        }
        _ => serde_json::to_string(value).ok().and_then(|text| non_empty_summary(&text)),
    }
}

fn non_empty_summary(text: &str) -> Option<String> {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    Some(truncate(&compact, 160))
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}
```

- [ ] **Step 5: Run backend task tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml task::tests -- --nocapture
```

Expected: all `task::tests` pass.

---

### Task 2: Add backend task APIs

**Files:**
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/api.rs`
- Modify: `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Add failing API integration tests**

In `crates/server/tests/api_integration.rs`, update the imports:

```rust
use axum::Router;
use chrono::Utc;
use claude_remote_web_server::{
    AppState, EventKind, EventStore, SessionManager, SessionMeta, SessionStatus, UiEvent,
    build_router,
};
use futures::StreamExt;
use serde_json::{Value, json};
use std::{
    fs,
    net::SocketAddr,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use uuid::Uuid;
```

Add this helper below `spawn_app`:

```rust
async fn spawn_app_with_store(store: EventStore) -> SocketAddr {
    let manager = SessionManager::new(store.clone(), vec!["claude".to_string()], "acceptEdits".to_string());
    let state = AppState { manager, store };
    let app: Router = build_router(state, None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

async fn seed_task_session(store: &EventStore, name: &str) -> Uuid {
    let session_id = Uuid::new_v4();
    let now = Utc::now();
    let meta = SessionMeta {
        id: session_id,
        name: Some(name.to_string()),
        cwd: PathBuf::from(format!("/repo/{name}")),
        permission_mode: "acceptEdits".to_string(),
        status: SessionStatus::Running,
        claude_session_id: Some(format!("claude-{name}")),
        created_at: now,
        updated_at: now,
    };
    store.save_meta(&meta).await.unwrap();
    store
        .append_event(&UiEvent::new(
            1,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_use",
                "id": format!("toolu-{name}"),
                "name": "Bash",
                "input": { "command": format!("echo {name}") }
            }),
        ))
        .await
        .unwrap();
    store
        .append_event(&UiEvent::new(
            2,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_result",
                "tool_use_id": format!("toolu-{name}"),
                "content": format!("done {name}")
            }),
        ))
        .await
        .unwrap();
    session_id
}
```

Add these tests at the end of the file:

```rust
#[tokio::test]
async fn lists_tasks_across_sessions() {
    let temp = tempfile::tempdir().unwrap();
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let first_session = seed_task_session(&store, "one").await;
    let second_session = seed_task_session(&store, "two").await;
    let addr = spawn_app_with_store(store).await;
    let client = reqwest::Client::new();

    let tasks: Value = client
        .get(format!("http://{addr}/api/tasks"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(tasks["background"].as_array().unwrap().len(), 0);
    let finished = tasks["finished"].as_array().unwrap();
    assert_eq!(finished.len(), 2);
    assert!(finished.iter().any(|task| task["sessionId"] == first_session.to_string()));
    assert!(finished.iter().any(|task| task["sessionId"] == second_session.to_string()));
}

#[tokio::test]
async fn lists_tasks_for_one_session() {
    let temp = tempfile::tempdir().unwrap();
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let first_session = seed_task_session(&store, "one").await;
    let second_session = seed_task_session(&store, "two").await;
    let addr = spawn_app_with_store(store).await;
    let client = reqwest::Client::new();

    let tasks: Value = client
        .get(format!("http://{addr}/api/sessions/{first_session}/tasks"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let finished = tasks["finished"].as_array().unwrap();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0]["sessionId"], first_session.to_string());
    assert_ne!(finished[0]["sessionId"], second_session.to_string());
    assert_eq!(finished[0]["status"], "completed");
    assert_eq!(finished[0]["summary"], "done one");
}
```

- [ ] **Step 2: Run API integration tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml --test api_integration -- --nocapture
```

Expected: FAIL with 404 or missing methods for `/api/tasks` and `/api/sessions/{id}/tasks`.

- [ ] **Step 3: Add task methods to SessionManager**

In `crates/server/src/session.rs`, update the top-level import to include task helpers:

```rust
use crate::{
    AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent,
    SessionMeta, SessionStatus, TaskGroups, UiEvent, extract_claude_session_id,
    group_tasks, project_session_tasks,
};
```

Add these public methods inside `impl SessionManager`, after `events_after`:

```rust
    pub async fn list_tasks(&self) -> AppResult<TaskGroups> {
        let metas = self.store.list_meta().await?;
        let mut tasks = Vec::new();
        for meta in metas {
            let events = self.store.load_events_after(meta.id, 0).await?;
            tasks.extend(project_session_tasks(&meta, &events).into_tasks());
        }
        Ok(group_tasks(tasks))
    }

    pub async fn tasks_for_session(&self, session_id: Uuid) -> AppResult<TaskGroups> {
        let meta = self.store.load_meta(session_id).await?;
        let events = self.store.load_events_after(session_id, 0).await?;
        Ok(project_session_tasks(&meta, &events))
    }
```

- [ ] **Step 4: Add API routes and handlers**

In `crates/server/src/api.rs`, update `build_router` so the API router includes both task endpoints:

```rust
    let api = Router::new()
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/tasks", get(list_tasks))
        .route("/api/sessions/{id}", get(get_session))
        .route("/api/sessions/{id}/tasks", get(list_session_tasks))
        .route("/api/sessions/{id}/input", post(send_input))
        .route("/api/sessions/{id}/stop", post(stop_session))
        .route("/api/sessions/{id}/restart", post(restart_session))
        .route("/api/sessions/{id}/events", get(events_ws))
        .with_state(state)
        .layer(CorsLayer::permissive());
```

Add these handlers after `get_session`:

```rust
async fn list_tasks(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.list_tasks().await?)))
}

async fn list_session_tasks(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.tasks_for_session(id).await?)))
}
```

- [ ] **Step 5: Run backend API tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml --test api_integration -- --nocapture
```

Expected: all API integration tests pass.

---

### Task 3: Add reusable frontend task panel

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Create: `web/src/TasksPanel.tsx`
- Create: `web/src/TasksPanel.test.tsx`

- [ ] **Step 1: Add task types**

Append these types to `web/src/types.ts`:

```ts
export type TaskStatus = 'background' | 'completed' | 'failed' | 'interrupted';

export type TaskInfo = {
  id: string;
  sessionId: string;
  sessionName?: string | null;
  sessionCwd: string;
  toolKind: string;
  title: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string | null;
  startEventId: number;
  finishEventId?: number | null;
  summary?: string | null;
};

export type TaskGroups = {
  background: TaskInfo[];
  finished: TaskInfo[];
};
```

- [ ] **Step 2: Add task API helpers**

In `web/src/api.ts`, change the import to include task groups:

```ts
import type { CreateSessionInput, SessionInfo, TaskGroups } from './types';
```

Add these functions after `listSessions`:

```ts
export async function listTasks(): Promise<TaskGroups> {
  return request<TaskGroups>('/api/tasks');
}

export async function listSessionTasks(sessionId: string): Promise<TaskGroups> {
  return request<TaskGroups>(`/api/sessions/${sessionId}/tasks`);
}
```

- [ ] **Step 3: Write failing TasksPanel tests**

Create `web/src/TasksPanel.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TasksPanel from './TasksPanel';
import type { TaskGroups, TaskInfo } from './types';

function task(overrides: Partial<TaskInfo>): TaskInfo {
  return {
    id: 's1:toolu_1',
    sessionId: 's1',
    sessionName: 'Repo One',
    sessionCwd: '/repo/one',
    toolKind: 'Bash',
    title: 'Bash: sleep 10',
    status: 'background',
    startedAt: '2026-06-12T00:00:00Z',
    finishedAt: null,
    startEventId: 1,
    finishEventId: null,
    summary: null,
    ...overrides
  };
}

const groups: TaskGroups = {
  background: [task({ id: 's1:toolu_1', title: 'Bash: sleep 10' })],
  finished: [
    task({
      id: 's1:toolu_2',
      title: 'Agent: Review the branch',
      status: 'completed',
      finishedAt: '2026-06-12T00:01:00Z',
      finishEventId: 4,
      summary: 'No issues found'
    })
  ]
};

describe('TasksPanel', () => {
  beforeEach(() => cleanup());

  it('renders background and finished task groups', () => {
    render(<TasksPanel title="Tasks" tasks={groups} onSelectTask={() => undefined} />);

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Background tasks')).toBeInTheDocument();
    expect(screen.getByText('Finished tasks')).toBeInTheDocument();
    expect(screen.getByText('Bash: sleep 10')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review the branch')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('calls onSelectTask when a task is clicked', () => {
    const onSelectTask = vi.fn();
    render(<TasksPanel title="Tasks" tasks={groups} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByText('Bash: sleep 10'));

    expect(onSelectTask).toHaveBeenCalledWith(groups.background[0]);
  });

  it('renders an empty state and non-blocking error', () => {
    render(
      <TasksPanel
        title="Tasks"
        tasks={{ background: [], finished: [] }}
        error="failed to load tasks"
        onSelectTask={() => undefined}
      />
    );

    expect(screen.getByText('failed to load tasks')).toBeInTheDocument();
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run frontend tests to verify they fail**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web test -- TasksPanel
```

Expected: FAIL because `web/src/TasksPanel.tsx` does not exist.

- [ ] **Step 5: Implement TasksPanel**

Create `web/src/TasksPanel.tsx`:

```tsx
import type { TaskGroups, TaskInfo } from './types';

type Props = {
  title: string;
  tasks: TaskGroups;
  error?: string | null;
  compact?: boolean;
  onSelectTask: (task: TaskInfo) => void;
};

function formatTime(value?: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString();
}

function TaskSection({
  heading,
  tasks,
  onSelectTask
}: {
  heading: string;
  tasks: TaskInfo[];
  onSelectTask: (task: TaskInfo) => void;
}) {
  return (
    <section className="task-section">
      <h4>{heading}</h4>
      {tasks.length === 0 ? (
        <p className="task-empty">None.</p>
      ) : (
        <div className="task-list">
          {tasks.map((task) => {
            const time = formatTime(task.finishedAt ?? task.startedAt);
            return (
              <button key={task.id} className={`task-card ${task.status}`} onClick={() => onSelectTask(task)}>
                <span className="task-card-title">{task.title}</span>
                <span className="task-card-meta">
                  {task.toolKind} · {task.sessionName || task.sessionCwd}
                </span>
                <span className="task-card-meta">
                  {task.status}{time ? ` · ${time}` : ''}
                </span>
                {task.summary && <span className="task-card-summary">{task.summary}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function TasksPanel({ title, tasks, error, compact = false, onSelectTask }: Props) {
  const empty = tasks.background.length === 0 && tasks.finished.length === 0;

  return (
    <section className={compact ? 'tasks-panel compact' : 'tasks-panel'}>
      <h3>{title}</h3>
      {error && <p role="alert" className="task-error">{error}</p>}
      {empty ? (
        <p className="task-empty">No tasks yet.</p>
      ) : (
        <>
          <TaskSection heading="Background tasks" tasks={tasks.background} onSelectTask={onSelectTask} />
          <TaskSection heading="Finished tasks" tasks={tasks.finished} onSelectTask={onSelectTask} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run task panel tests**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web test -- TasksPanel
```

Expected: all `TasksPanel` tests pass.

---

### Task 4: Wire tasks into the app UI

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/EventCard.tsx`
- Modify: `web/src/App.css`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Add failing app-level task tests**

In `web/src/App.test.tsx`, replace the `sessions` constant with two sessions:

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
    updatedAt: '2026-06-11T00:00:00Z'
  },
  {
    id: 's2',
    name: 'Repo Two',
    cwd: '/repo/two',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z'
  }
];
```

Add task fixtures below `sessions`:

```ts
const taskGroups = {
  background: [
    {
      id: 's2:toolu_1',
      sessionId: 's2',
      sessionName: 'Repo Two',
      sessionCwd: '/repo/two',
      toolKind: 'Bash',
      title: 'Bash: sleep 10',
      status: 'background',
      startedAt: '2026-06-12T00:00:00Z',
      finishedAt: null,
      startEventId: 3,
      finishEventId: null,
      summary: null
    }
  ],
  finished: [
    {
      id: 's1:toolu_2',
      sessionId: 's1',
      sessionName: 'Repo One',
      sessionCwd: '/repo/one',
      toolKind: 'Agent',
      title: 'Agent: Review branch',
      status: 'completed',
      startedAt: '2026-06-12T00:00:00Z',
      finishedAt: '2026-06-12T00:01:00Z',
      startEventId: 5,
      finishEventId: 6,
      summary: 'No issues found'
    }
  ]
};

const emptyTaskGroups = { background: [], finished: [] };
```

Update the fetch mock in `beforeEach` so it handles task endpoints before the input/stop/restart checks:

```ts
    if (url === '/api/tasks') {
      return new Response(JSON.stringify(taskGroups), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s1/tasks') {
      return new Response(JSON.stringify({ background: [], finished: [taskGroups.finished[0]] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s2/tasks') {
      return new Response(JSON.stringify({ background: [taskGroups.background[0]], finished: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
```

Add these tests inside `describe('App', ...)`:

```ts
  it('renders global and active-session task panels', async () => {
    render(<App />);

    expect(await screen.findByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Bash: sleep 10')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review branch')).toBeInTheDocument();
    expect(await screen.findByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('selects the owning session when a task is clicked', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Bash: sleep 10'));

    await waitFor(() => expect(screen.getAllByText('Repo Two').length).toBeGreaterThan(0));
    await waitFor(() => expect(FakeWebSocket.instances.at(-1)?.url).toContain('/api/sessions/s2/events'));
  });
```

- [ ] **Step 2: Run app tests to verify they fail**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web test -- App
```

Expected: FAIL because `App` does not fetch or render tasks yet.

- [ ] **Step 3: Add event DOM anchors**

In `web/src/EventCard.tsx`, change the article opening tag from:

```tsx
<article className={`event ${event.kind}`}>
```

to:

```tsx
<article id={`event-${event.id}`} className={`event ${event.kind}`}>
```

- [ ] **Step 4: Wire task state and refresh in App**

In `web/src/App.tsx`, replace the imports at the top with:

```tsx
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createSession,
  eventsUrl,
  listSessionTasks,
  listSessions,
  listTasks,
  restartSession,
  sendInput,
  stopSession
} from './api';
import EventCard from './EventCard';
import TasksPanel from './TasksPanel';
import type { SessionInfo, TaskGroups, TaskInfo, UiEvent } from './types';
import './App.css';
```

Add this constant above `export default function App()`:

```tsx
const emptyTaskGroups: TaskGroups = { background: [], finished: [] };
```

Inside `App`, add task state after the existing `error` state:

```tsx
  const [tasks, setTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [sessionTasks, setSessionTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [sessionTaskError, setSessionTaskError] = useState<string | null>(null);
  const [pendingEventId, setPendingEventId] = useState<number | null>(null);
```

Add these helper functions before the first `useEffect`:

```tsx
  async function refreshTasks() {
    try {
      setTaskError(null);
      setTasks(await listTasks());
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshSessionTasks(sessionId: string) {
    try {
      setSessionTaskError(null);
      setSessionTasks(await listSessionTasks(sessionId));
    } catch (err: unknown) {
      setSessionTaskError(err instanceof Error ? err.message : String(err));
    }
  }

  function onSelectTask(task: TaskInfo) {
    setActiveId(task.sessionId);
    setPendingEventId(task.startEventId);
  }
```

In the initial load effect, after `setActiveId(loaded[0]?.id ?? null);`, call `refreshTasks()`:

```tsx
        void refreshTasks();
```

Add this effect after the initial load effect:

```tsx
  useEffect(() => {
    if (!activeId) {
      setSessionTasks(emptyTaskGroups);
      return;
    }
    void refreshSessionTasks(activeId);
  }, [activeId]);
```

In the WebSocket `onmessage` handler, after `setEvents(...)`, add task refresh calls:

```tsx
      void refreshTasks();
      void refreshSessionTasks(activeId);
```

Add this effect after the WebSocket effect:

```tsx
  useEffect(() => {
    if (pendingEventId === null) return;
    const element = document.getElementById(`event-${pendingEventId}`);
    if (!element) return;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
    element.classList.add('event-highlight');
    window.setTimeout(() => element.classList.remove('event-highlight'), 1600);
    setPendingEventId(null);
  }, [pendingEventId, activeId, events]);
```

After successful session create, stop, and restart, refresh tasks. Add `void refreshTasks();` and the active-session refresh where there is an active id:

```tsx
      void refreshTasks();
      void refreshSessionTasks(created.id);
```

for create, and:

```tsx
      void refreshTasks();
      void refreshSessionTasks(activeId);
```

for stop and restart.

In the returned JSX, render the global task panel inside the sidebar after the sessions section:

```tsx
        <TasksPanel title="Tasks" tasks={tasks} error={taskError} onSelectTask={onSelectTask} />
```

Render the active-session task panel between the conversation header and events:

```tsx
            <TasksPanel
              title="Session tasks"
              tasks={sessionTasks}
              error={sessionTaskError}
              compact
              onSelectTask={onSelectTask}
            />
```

- [ ] **Step 5: Add task styles**

In `web/src/App.css`, change `.conversation` rows from:

```css
.conversation {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
}
```

to:

```css
.conversation {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  min-width: 0;
}
```

Append these styles to the end of `web/src/App.css`:

```css
.tasks-panel {
  display: grid;
  gap: 12px;
  margin-top: 20px;
  border-top: 1px solid #273449;
  padding-top: 20px;
}

.tasks-panel.compact {
  margin: 0;
  border-top: 0;
  border-bottom: 1px solid #273449;
  padding: 12px 20px;
  background: #0f172a;
}

.tasks-panel h3,
.task-section h4,
.task-empty,
.task-error {
  margin: 0;
}

.tasks-panel h3 {
  font-size: 16px;
}

.task-section {
  display: grid;
  gap: 8px;
}

.task-section h4 {
  color: #93c5fd;
  font-size: 12px;
  text-transform: uppercase;
}

.task-list {
  display: grid;
  gap: 8px;
}

.task-card {
  display: grid;
  gap: 4px;
  width: 100%;
  border-color: #334155;
  text-align: left;
  color: #e5e7eb;
  background: #1e293b;
}

.task-card.background {
  border-color: #60a5fa;
}

.task-card.completed {
  border-color: #22c55e;
}

.task-card.failed {
  border-color: #ef4444;
}

.task-card.interrupted {
  border-color: #f59e0b;
}

.task-card-title {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card-meta,
.task-card-summary,
.task-empty {
  overflow: hidden;
  color: #cbd5e1;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-error {
  color: #fecaca;
  font-size: 12px;
}

.event-highlight {
  outline: 2px solid #facc15;
  outline-offset: 2px;
}
```

- [ ] **Step 6: Run app tests**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web test -- App
```

Expected: all `App` tests pass.

---

### Task 5: Full verification and manual UI check

**Files:**
- Modify only if verification exposes issues in files touched by Tasks 1-4.

- [ ] **Step 1: Run backend verification**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml -- --check
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/Cargo.toml
```

Expected: both commands pass.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web run build
```

Expected: both commands pass.

- [ ] **Step 3: Build frontend assets for manual verification**

Run:

```bash
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web run build
```

Expected: Vite writes production assets under `web/dist`.

- [ ] **Step 4: Start the daemon with a temporary config**

Run:

```bash
cat > /tmp/claude-remote-web-tasks-test.toml <<'EOF'
bind = "127.0.0.1:8789"
data_dir = "/tmp/claude-remote-web-tasks-test"
launcher = ["claude"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web_pin_backgroud_task/web/dist"
default_permission_mode = "acceptEdits"
EOF
scripts/start-server.sh --config /tmp/claude-remote-web-tasks-test.toml --skip-web-build
```

Expected: server starts on `127.0.0.1:8789`.

- [ ] **Step 5: Verify task APIs manually**

In another shell, run:

```bash
curl -s http://127.0.0.1:8789/api/tasks
```

Expected before creating sessions:

```json
{"background":[],"finished":[]}
```

- [ ] **Step 6: Verify the UI manually**

Open `http://127.0.0.1:8789` through the existing SSH/local-browser workflow. Create a session, ask Claude to run a long background-capable command or subagent task, and confirm:

```text
1. The global Tasks panel appears in the sidebar.
2. The active Session tasks panel appears above the event stream.
3. A running tool task appears under Background tasks.
4. The same task moves to Finished tasks after completion, failure, or session exit.
5. Clicking a task selects its owning session.
```

Stop the daemon after the check.

---

## Self-Review

- Spec coverage: Task 1 implements conservative task projection from append-only events, stable ids, statuses, timestamps, summaries, and session-exit interruption. Task 2 adds `/api/tasks` and `/api/sessions/{id}/tasks`. Tasks 3-4 add global and per-session frontend task panels, endpoint failure display, task click navigation, and event anchors. Task 5 covers backend, frontend, and manual UI verification.
- Placeholder scan: no `TBD`, `TODO`, or vague future implementation steps remain. Each code-changing step names the exact file and code to add or replace.
- Type consistency: Rust `TaskGroups`, `TaskInfo`, and `TaskStatus` serialize to the TypeScript `TaskGroups`, `TaskInfo`, and `TaskStatus` shapes with camelCase field names and statuses `background`, `completed`, `failed`, and `interrupted`.
