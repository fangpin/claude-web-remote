# Permission Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real Claude Code permission waiting flow with backend hook bridge APIs and frontend action cards, while never sending undocumented approval frames to Claude stdin.

**Architecture:** Add a focused Rust `permission` module that owns pending permission request state, hook request/decision serialization, safe summaries, and timeout behavior. Wire it into `SessionManager`, process startup, and `api.rs`; then add frontend types/API helpers, a `PermissionActionCard`, and Activity drawer integration. Hook support is capability-gated: if the installed Claude Code settings/hook contract cannot be verified, the UI shows waiting/review state without fake controls.

**Tech Stack:** Rust 2024, Axum, Tokio, Serde/serde_json, UUID, React, TypeScript, Vite, Vitest, Testing Library.

---

## Source spec

Approved design: `docs/superpowers/specs/2026-06-14-permission-bridge-design.md`

## File structure

### Backend

- Create `crates/server/src/permission.rs`
  - Owns permission bridge domain types.
  - Owns `PermissionBridge` in-memory pending request state.
  - Owns hook request parsing, decision JSON serialization, safe summaries, and resolve APIs.
- Modify `crates/server/src/lib.rs`
  - Export `permission` module and public types needed by API/session/process.
- Modify `crates/server/src/error.rs`
  - Add `Conflict` response so duplicate permission resolve returns HTTP 409.
- Modify `crates/server/src/process.rs`
  - Add optional `permission_bridge` process config.
  - Write a temporary settings file and hook helper script when bridge is enabled.
  - Launch Claude with `--settings <temp-settings-path>` only when capability is verified.
- Modify `crates/server/src/session.rs`
  - Add `permission_bridge` field to `SessionManager`.
  - Include permission capability in `SessionInfo`.
  - Attach bridge config to new/resumed processes.
  - Resolve pending permissions safely when a session stops/exits/fails.
- Modify `crates/server/src/api.rs`
  - Add public permission APIs.
  - Add localhost/token-protected internal hook API.
  - Keep route handlers thin and delegate to `PermissionBridge` / `SessionManager`.
- Modify `crates/server/src/main.rs`
  - Construct a shared `PermissionBridge` using `config.bind` and `config.data_dir`.

### Frontend

- Modify `web/src/types.ts`
  - Add permission capability, pending request, decision, and response types.
- Modify `web/src/api.ts`
  - Add `listPendingPermissions`, `allowPermission`, and `denyPermission` helpers.
- Create `web/src/permissionEvents.ts`
  - Extract pending/resolved permission state from transcript events and API responses.
- Create `web/src/PermissionActionCard.tsx`
  - Render the main conversation action card and compact Activity variant.
  - Own deny/edit/details local UI state.
- Modify `web/src/ConversationWorkspace.tsx`
  - Render `PermissionActionCard` above conversation blocks.
  - Pass permission action callbacks from `App`.
- Modify `web/src/ActivityPanel.tsx`
  - Show compact pending permission cards above generic tool activities.
  - Remove “decision controls are not exposed” copy when real controls are available.
- Modify `web/src/InspectorPanel.tsx`
  - Pass pending permissions and callbacks into `ActivityPanel`.
- Modify `web/src/App.tsx`
  - Load pending permissions when active session changes.
  - Merge permission events from WebSocket transcript.
  - Wire allow/deny/edit handlers and attention toast state.
- Modify `web/src/App.css`
  - Style action cards, details, status chips, and compact Activity cards.

### Docs

- Modify `CLAUDE.md`
  - Keep the “no fake controls” warning, and add that permission controls are only allowed through the hook bridge.
- Modify `README.md`
  - Add a short note only if implementation introduces a user-visible Claude Code version or hook capability requirement.

---

## Task 1: Backend permission domain and hook decision serialization

**Files:**
- Create: `crates/server/src/permission.rs`
- Modify: `crates/server/src/lib.rs`
- Modify: `crates/server/src/error.rs`

- [ ] **Step 1: Write failing unit tests for summaries and decision JSON**

Add this test module at the bottom of the new `crates/server/src/permission.rs` while creating the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn hook_request(tool_input: serde_json::Value) -> HookPermissionRequest {
        HookPermissionRequest {
            token: "bridge-token".to_string(),
            session_id: Uuid::new_v4(),
            hook_session_id: Some("claude-hook-session".to_string()),
            cwd: Some("/repo".to_string()),
            permission_mode: Some("default".to_string()),
            tool_name: "Bash".to_string(),
            tool_input,
        }
    }

    #[test]
    fn summarizes_bash_commands_without_description() {
        let summary = permission_summary("Bash", &json!({ "command": "npm --prefix web test" }));
        assert_eq!(summary, "Run: npm --prefix web test");
    }

    #[test]
    fn summarizes_bash_commands_with_description() {
        let summary = permission_summary("Bash", &json!({
            "description": "Run frontend tests",
            "command": "npm --prefix web test"
        }));
        assert_eq!(summary, "Run frontend tests: npm --prefix web test");
    }

    #[test]
    fn detects_editable_bash_command() {
        let request = PendingPermissionRequest::from_hook_request("req-1".to_string(), hook_request(json!({
            "command": "cargo test --manifest-path Cargo.toml"
        })));
        assert_eq!(request.editable, Some(PermissionEditable::BashCommand));
    }

    #[test]
    fn serializes_allow_decision_for_hook_stdout() {
        let decision = PermissionDecision::Allow { updated_input: None };
        assert_eq!(
            hook_stdout_for_decision(&decision),
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": { "behavior": "allow" }
                }
            })
        );
    }

    #[test]
    fn serializes_allow_with_updated_input_for_hook_stdout() {
        let decision = PermissionDecision::Allow {
            updated_input: Some(json!({ "command": "npm --prefix web run build" })),
        };
        assert_eq!(
            hook_stdout_for_decision(&decision),
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {
                        "behavior": "allow",
                        "updatedInput": { "command": "npm --prefix web run build" }
                    }
                }
            })
        );
    }

    #[test]
    fn serializes_deny_decision_for_hook_stdout() {
        let decision = PermissionDecision::Deny {
            message: "Please run the cheaper test first".to_string(),
        };
        assert_eq!(
            hook_stdout_for_decision(&decision),
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {
                        "behavior": "deny",
                        "message": "Please run the cheaper test first"
                    }
                }
            })
        );
    }
}
```

- [ ] **Step 2: Run the targeted backend tests and verify they fail**

Run:

```bash
cargo test --manifest-path Cargo.toml permission::tests -- --nocapture
```

Expected: compile failure because `HookPermissionRequest`, `PendingPermissionRequest`, `PermissionDecision`, `PermissionEditable`, `permission_summary`, and `hook_stdout_for_decision` do not exist yet.

- [ ] **Step 3: Implement the minimal permission domain types**

Create `crates/server/src/permission.rs` with this complete initial implementation above the test module:

```rust
use crate::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionCapabilityStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCapability {
    pub status: PermissionCapabilityStatus,
    pub reason: Option<String>,
}

impl PermissionCapability {
    pub fn available() -> Self {
        Self {
            status: PermissionCapabilityStatus::Available,
            reason: None,
        }
    }

    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            status: PermissionCapabilityStatus::Unavailable,
            reason: Some(reason.into()),
        }
    }

    pub fn can_act(&self) -> bool {
        self.status == PermissionCapabilityStatus::Available
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPermissionRequest {
    pub token: String,
    pub session_id: Uuid,
    pub hook_session_id: Option<String>,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    Pending,
    Allowed,
    Denied,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionEditable {
    BashCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionRequest {
    pub request_id: String,
    pub session_id: Uuid,
    pub hook_session_id: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    pub summary: String,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub status: PermissionStatus,
    pub editable: Option<PermissionEditable>,
    pub decision: Option<PermissionDecision>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

impl PendingPermissionRequest {
    pub fn from_hook_request(request_id: String, request: HookPermissionRequest) -> Self {
        let editable = if request.tool_name == "Bash"
            && request
                .tool_input
                .get("command")
                .and_then(Value::as_str)
                .is_some()
        {
            Some(PermissionEditable::BashCommand)
        } else {
            None
        };

        Self {
            request_id,
            session_id: request.session_id,
            hook_session_id: request.hook_session_id,
            tool_name: request.tool_name.clone(),
            summary: permission_summary(&request.tool_name, &request.tool_input),
            tool_input: request.tool_input,
            cwd: request.cwd,
            permission_mode: request.permission_mode,
            status: PermissionStatus::Pending,
            editable,
            decision: None,
            created_at: Utc::now(),
            resolved_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "behavior")]
pub enum PermissionDecision {
    #[serde(rename_all = "camelCase")]
    Allow { updated_input: Option<Value> },
    Deny { message: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowPermissionRequest {
    pub updated_input: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenyPermissionRequest {
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionsResponse {
    pub capability: PermissionCapability,
    pub pending: Vec<PendingPermissionRequest>,
}

pub fn hook_stdout_for_decision(decision: &PermissionDecision) -> Value {
    match decision {
        PermissionDecision::Allow { updated_input } => {
            let mut decision = json!({ "behavior": "allow" });
            if let Some(updated_input) = updated_input {
                decision["updatedInput"] = updated_input.clone();
            }
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": decision
                }
            })
        }
        PermissionDecision::Deny { message } => json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {
                    "behavior": "deny",
                    "message": message
                }
            }
        }),
    }
}

pub fn permission_summary(tool_name: &str, tool_input: &Value) -> String {
    if tool_name == "Bash" {
        let command = tool_input
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let description = tool_input
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if !command.is_empty() && !description.is_empty() {
            return format!("{description}: {command}");
        }
        if !command.is_empty() {
            return format!("Run: {command}");
        }
    }

    let compact = tool_input.to_string();
    if compact.len() > 160 {
        format!("{tool_name}: {}...", &compact[..157])
    } else {
        format!("{tool_name}: {compact}")
    }
}

struct PendingWaiter {
    request: PendingPermissionRequest,
    sender: Option<oneshot::Sender<PermissionDecision>>,
}

#[derive(Clone)]
pub struct PermissionBridge {
    token: String,
    capability: PermissionCapability,
    timeout: Duration,
    pending: Arc<Mutex<HashMap<String, PendingWaiter>>>,
}

impl PermissionBridge {
    pub fn new(token: String, capability: PermissionCapability) -> Self {
        Self {
            token,
            capability,
            timeout: Duration::from_secs(300),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn capability(&self) -> PermissionCapability {
        self.capability.clone()
    }

    pub async fn pending_for_session(&self, session_id: Uuid) -> Vec<PendingPermissionRequest> {
        self.pending
            .lock()
            .await
            .values()
            .filter(|waiter| waiter.request.session_id == session_id && waiter.request.status == PermissionStatus::Pending)
            .map(|waiter| waiter.request.clone())
            .collect()
    }

    pub async fn list_response(&self, session_id: Uuid) -> PendingPermissionsResponse {
        PendingPermissionsResponse {
            capability: self.capability(),
            pending: self.pending_for_session(session_id).await,
        }
    }

    pub async fn register_and_wait(&self, request: HookPermissionRequest) -> AppResult<PermissionDecision> {
        if request.token != self.token {
            return Err(AppError::InvalidRequest("invalid permission hook token".to_string()));
        }
        if !self.capability.can_act() {
            return Ok(PermissionDecision::Deny {
                message: "permission bridge is unavailable".to_string(),
            });
        }

        let request_id = Uuid::new_v4().to_string();
        let pending_request = PendingPermissionRequest::from_hook_request(request_id.clone(), request);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(
            request_id.clone(),
            PendingWaiter {
                request: pending_request,
                sender: Some(tx),
            },
        );

        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(decision)) => Ok(decision),
            Ok(Err(_)) => Ok(PermissionDecision::Deny {
                message: "permission request was cancelled".to_string(),
            }),
            Err(_) => {
                let _ = self.expire(&request_id, "permission request timed out").await;
                Ok(PermissionDecision::Deny {
                    message: "permission request timed out".to_string(),
                })
            }
        }
    }

    pub async fn allow(
        &self,
        session_id: Uuid,
        request_id: &str,
        updated_input: Option<Value>,
    ) -> AppResult<PendingPermissionRequest> {
        let decision = PermissionDecision::Allow { updated_input };
        self.resolve(session_id, request_id, decision, PermissionStatus::Allowed).await
    }

    pub async fn deny(
        &self,
        session_id: Uuid,
        request_id: &str,
        message: Option<String>,
    ) -> AppResult<PendingPermissionRequest> {
        let message = message
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Denied by user".to_string());
        let decision = PermissionDecision::Deny { message };
        self.resolve(session_id, request_id, decision, PermissionStatus::Denied).await
    }

    pub async fn fail_session_permissions(&self, session_id: Uuid, message: &str) -> Vec<PendingPermissionRequest> {
        let request_ids = {
            self.pending
                .lock()
                .await
                .iter()
                .filter(|(_, waiter)| waiter.request.session_id == session_id)
                .map(|(request_id, _)| request_id.clone())
                .collect::<Vec<_>>()
        };
        let mut resolved = Vec::new();
        for request_id in request_ids {
            if let Ok(request) = self
                .resolve(
                    session_id,
                    &request_id,
                    PermissionDecision::Deny {
                        message: message.to_string(),
                    },
                    PermissionStatus::Failed,
                )
                .await
            {
                resolved.push(request);
            }
        }
        resolved
    }

    async fn expire(&self, request_id: &str, message: &str) -> AppResult<PendingPermissionRequest> {
        let mut pending = self.pending.lock().await;
        let waiter = pending
            .get_mut(request_id)
            .ok_or_else(|| AppError::NotFound(format!("permission request {request_id}")))?;
        waiter.request.status = PermissionStatus::Expired;
        waiter.request.resolved_at = Some(Utc::now());
        waiter.request.decision = Some(PermissionDecision::Deny {
            message: message.to_string(),
        });
        let request = waiter.request.clone();
        pending.remove(request_id);
        Ok(request)
    }

    async fn resolve(
        &self,
        session_id: Uuid,
        request_id: &str,
        decision: PermissionDecision,
        status: PermissionStatus,
    ) -> AppResult<PendingPermissionRequest> {
        let mut pending = self.pending.lock().await;
        let waiter = pending
            .get_mut(request_id)
            .ok_or_else(|| AppError::NotFound(format!("permission request {request_id}")))?;
        if waiter.request.session_id != session_id {
            return Err(AppError::NotFound(format!("permission request {request_id}")));
        }
        if waiter.request.status != PermissionStatus::Pending {
            return Err(AppError::Conflict(format!("permission request {request_id} is already resolved")));
        }
        waiter.request.status = status;
        waiter.request.resolved_at = Some(Utc::now());
        waiter.request.decision = Some(decision.clone());
        if let Some(sender) = waiter.sender.take() {
            let _ = sender.send(decision);
        }
        let request = waiter.request.clone();
        pending.remove(request_id);
        Ok(request)
    }
}
```

- [ ] **Step 4: Export the new module and conflict error**

In `crates/server/src/lib.rs`, add:

```rust
pub mod permission;
```

and change the existing public exports to include:

```rust
pub use permission::{
    AllowPermissionRequest, DenyPermissionRequest, HookPermissionRequest, PendingPermissionRequest,
    PendingPermissionsResponse, PermissionBridge, PermissionCapability, PermissionCapabilityStatus,
    PermissionDecision, PermissionEditable, PermissionStatus, hook_stdout_for_decision,
};
```

In `crates/server/src/error.rs`, add an enum variant:

```rust
#[error("conflict: {0}")]
Conflict(String),
```

and update `IntoResponse` status mapping so the `match` includes:

```rust
AppError::Conflict(_) => StatusCode::CONFLICT,
```

- [ ] **Step 5: Run tests and verify the domain passes**

Run:

```bash
cargo test --manifest-path Cargo.toml permission::tests -- --nocapture
```

Expected: all permission domain tests pass.

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/permission.rs crates/server/src/lib.rs crates/server/src/error.rs
git commit -m "Add permission bridge domain model"
```

---

## Task 2: Backend permission APIs and event persistence

**Files:**
- Modify: `crates/server/src/api.rs`
- Modify: `crates/server/src/session.rs`
- Test: `crates/server/src/permission.rs`

- [ ] **Step 1: Write failing bridge lifecycle tests**

Add these tests to `crates/server/src/permission.rs` test module:

```rust
#[tokio::test]
async fn register_waits_until_allowed() {
    let bridge = PermissionBridge::new("token".to_string(), PermissionCapability::available());
    let session_id = Uuid::new_v4();
    let hook_request = HookPermissionRequest {
        token: "token".to_string(),
        session_id,
        hook_session_id: Some("hook".to_string()),
        cwd: Some("/repo".to_string()),
        permission_mode: Some("default".to_string()),
        tool_name: "Bash".to_string(),
        tool_input: json!({ "command": "npm test" }),
    };
    let waiter_bridge = bridge.clone();
    let waiter = tokio::spawn(async move { waiter_bridge.register_and_wait(hook_request).await.unwrap() });

    for _ in 0..50 {
        if !bridge.pending_for_session(session_id).await.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let pending = bridge.pending_for_session(session_id).await;
    assert_eq!(pending.len(), 1);

    let resolved = bridge.allow(session_id, &pending[0].request_id, None).await.unwrap();
    assert_eq!(resolved.status, PermissionStatus::Allowed);
    assert_eq!(waiter.await.unwrap(), PermissionDecision::Allow { updated_input: None });
}

#[tokio::test]
async fn duplicate_resolve_is_not_found_after_first_resolve() {
    let bridge = PermissionBridge::new("token".to_string(), PermissionCapability::available());
    let session_id = Uuid::new_v4();
    let hook_request = HookPermissionRequest {
        token: "token".to_string(),
        session_id,
        hook_session_id: None,
        cwd: None,
        permission_mode: None,
        tool_name: "Bash".to_string(),
        tool_input: json!({ "command": "npm test" }),
    };
    let waiter_bridge = bridge.clone();
    let waiter = tokio::spawn(async move { waiter_bridge.register_and_wait(hook_request).await.unwrap() });

    for _ in 0..50 {
        if !bridge.pending_for_session(session_id).await.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let request_id = bridge.pending_for_session(session_id).await[0].request_id.clone();
    bridge.deny(session_id, &request_id, Some("no".to_string())).await.unwrap();
    let duplicate = bridge.deny(session_id, &request_id, None).await;

    assert!(matches!(duplicate, Err(AppError::NotFound(_))));
    assert_eq!(
        waiter.await.unwrap(),
        PermissionDecision::Deny { message: "no".to_string() }
    );
}
```

- [ ] **Step 2: Run the lifecycle tests and verify current behavior**

Run:

```bash
cargo test --manifest-path Cargo.toml permission::tests::register_waits_until_allowed permission::tests::duplicate_resolve_is_not_found_after_first_resolve -- --nocapture
```

Expected: tests pass if Task 1 implemented `PermissionBridge` exactly. If they fail because the bridge has no lifecycle methods, implement the Task 1 bridge before continuing.

- [ ] **Step 3: Add permission bridge to `SessionManager`**

Change the imports at the top of `crates/server/src/session.rs` to include permission types:

```rust
PermissionBridge, PermissionCapability,
```

Add a field to `SessionInfo`:

```rust
pub permission_capability: PermissionCapability,
```

Add a field to `SessionManager`:

```rust
permission_bridge: PermissionBridge,
```

Change `SessionManager::new` signature to:

```rust
pub fn new(
    store: EventStore,
    launcher: Vec<String>,
    default_permission_mode: String,
    worktree_config: WorktreeConfig,
    permission_bridge: PermissionBridge,
) -> Self
```

Set the field in `Self { ... }`.

Update every test call to `SessionManager::new` by adding:

```rust
PermissionBridge::new(
    "test-token".to_string(),
    PermissionCapability::unavailable("permission bridge is disabled in tests"),
)
```

Update `SessionInfo::new` to accept a `PermissionCapability` parameter and set `permission_capability`. Update `session_info` to call:

```rust
Ok(SessionInfo::new(meta, runtime_status, self.permission_bridge.capability()))
```

- [ ] **Step 4: Add session manager methods for permission API handlers**

Add these methods inside `impl SessionManager` in `crates/server/src/session.rs`:

```rust
pub async fn pending_permissions(&self, session_id: Uuid) -> AppResult<PendingPermissionsResponse> {
    let _meta = self.load_active_meta(session_id).await?;
    Ok(self.permission_bridge.list_response(session_id).await)
}

pub async fn allow_permission(
    &self,
    session_id: Uuid,
    request_id: String,
    updated_input: Option<serde_json::Value>,
) -> AppResult<PendingPermissionRequest> {
    let _meta = self.load_active_meta(session_id).await?;
    let resolved = self
        .permission_bridge
        .allow(session_id, &request_id, updated_input)
        .await?;
    self.record_permission_event(session_id, "permission_resolved", &resolved)
        .await?;
    Ok(resolved)
}

pub async fn deny_permission(
    &self,
    session_id: Uuid,
    request_id: String,
    message: Option<String>,
) -> AppResult<PendingPermissionRequest> {
    let _meta = self.load_active_meta(session_id).await?;
    let resolved = self
        .permission_bridge
        .deny(session_id, &request_id, message)
        .await?;
    self.record_permission_event(session_id, "permission_resolved", &resolved)
        .await?;
    Ok(resolved)
}

pub async fn permission_hook_request(
    &self,
    request: HookPermissionRequest,
) -> AppResult<serde_json::Value> {
    let session_id = request.session_id;
    let decision = self.permission_bridge.register_and_wait(request).await?;
    let event_payload = serde_json::json!({
        "type": "permission_hook_decision",
        "decision": decision,
    });
    let mut event = UiEvent::new(0, session_id, EventKind::System, event_payload);
    self.store.append_event_with_next_id(&mut event).await?;
    let _ = self.broadcast_event(session_id, event).await;
    Ok(crate::hook_stdout_for_decision(&decision))
}

async fn record_permission_event(
    &self,
    session_id: Uuid,
    event_type: &str,
    request: &PendingPermissionRequest,
) -> AppResult<()> {
    let mut event = UiEvent::new(
        0,
        session_id,
        EventKind::System,
        serde_json::json!({
            "type": event_type,
            "permission": request,
        }),
    );
    self.store.append_event_with_next_id(&mut event).await?;
    let _ = self.broadcast_event(session_id, event).await;
    Ok(())
}
```

- [ ] **Step 5: Add API routes and handlers**

In `crates/server/src/api.rs`, add imports:

```rust
AllowPermissionRequest, DenyPermissionRequest, HookPermissionRequest,
```

Add routes inside `build_router` before `.fallback(api_not_found)`:

```rust
.route("/sessions/{id}/permissions/pending", get(get_pending_permissions))
.route("/sessions/{id}/permissions/{request_id}/allow", post(allow_permission))
.route("/sessions/{id}/permissions/{request_id}/deny", post(deny_permission))
.route("/internal/permission-hooks/request", post(permission_hook_request))
```

Add handlers near the other session handlers:

```rust
async fn get_pending_permissions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.pending_permissions(id).await?)))
}

async fn allow_permission(
    State(state): State<AppState>,
    Path((id, request_id)): Path<(Uuid, String)>,
    Json(request): Json<AllowPermissionRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state
        .manager
        .allow_permission(id, request_id, request.updated_input)
        .await?)))
}

async fn deny_permission(
    State(state): State<AppState>,
    Path((id, request_id)): Path<(Uuid, String)>,
    Json(request): Json<DenyPermissionRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state
        .manager
        .deny_permission(id, request_id, request.message)
        .await?)))
}

async fn permission_hook_request(
    State(state): State<AppState>,
    Json(request): Json<HookPermissionRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(state.manager.permission_hook_request(request).await?))
}
```

- [ ] **Step 6: Update main construction**

In `crates/server/src/main.rs`, add `PermissionBridge` and `PermissionCapability` to the `use claude_remote_web_server::{...}` list.

Before `SessionManager::new`, create:

```rust
let permission_bridge = PermissionBridge::new(
    uuid::Uuid::new_v4().to_string(),
    PermissionCapability::unavailable("permission hook injection has not been verified for this Claude Code version"),
);
```

Pass `permission_bridge` as the fifth argument to `SessionManager::new`.

- [ ] **Step 7: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: all backend tests pass. The permission capability is still unavailable by default, so this task adds APIs and data flow without enabling fake controls.

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/api.rs crates/server/src/main.rs crates/server/src/session.rs crates/server/src/permission.rs
git commit -m "Add permission bridge APIs"
```

---

## Task 3: Process hook injection capability gate

**Files:**
- Modify: `crates/server/src/permission.rs`
- Modify: `crates/server/src/process.rs`
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/main.rs`
- Test: `crates/server/src/process.rs`

- [ ] **Step 1: Write failing process spawn test for settings injection**

Add this test to `crates/server/src/process.rs` test module:

```rust
#[tokio::test]
async fn passes_settings_file_when_permission_bridge_configured() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("args.log");
    let bin = temp.path().join("fake-claude-args.sh");
    fs::write(
        &bin,
        format!(
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > '{}'
printf '{{"type":"system","session_id":"fake-session"}}\n'
while IFS= read -r line; do exit 0; done
"#,
            args_log.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&bin).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&bin, permissions).unwrap();

    let bridge_dir = temp.path().join("bridge");
    let config = PermissionProcessConfig {
        settings_path: bridge_dir.join("settings.json"),
        helper_path: bridge_dir.join("permission-hook-helper.sh"),
        daemon_url: "http://127.0.0.1:8787".to_string(),
        token: "token".to_string(),
    };

    let (_process, _rx) = ClaudeProcess::spawn(
        Uuid::new_v4(),
        ClaudeProcessConfig {
            launcher: vec![bin.to_string_lossy().to_string()],
            cwd: temp.path().to_path_buf(),
            permission_mode: "default".to_string(),
            resume_session_id: None,
            starting_event_id: 1,
            permission_process: Some(config.clone()),
        },
    )
    .await
    .unwrap();

    let args = fs::read_to_string(&args_log).unwrap();
    assert!(args.contains("--settings"));
    assert!(args.contains(&config.settings_path.to_string_lossy().to_string()));
    let settings = fs::read_to_string(config.settings_path).unwrap();
    assert!(settings.contains("PermissionRequest"));
    assert!(settings.contains(&config.helper_path.to_string_lossy().to_string()));
    let helper = fs::read_to_string(config.helper_path).unwrap();
    assert!(helper.contains("/api/internal/permission-hooks/request"));
}
```

- [ ] **Step 2: Run the process test and verify it fails**

Run:

```bash
cargo test --manifest-path Cargo.toml process::tests::passes_settings_file_when_permission_bridge_configured -- --nocapture
```

Expected: compile failure because `PermissionProcessConfig` and `permission_process` do not exist.

- [ ] **Step 3: Add permission process config type**

In `crates/server/src/process.rs`, add imports:

```rust
use serde_json::json;
```

Add this type above `ClaudeProcessConfig`:

```rust
#[derive(Debug, Clone)]
pub struct PermissionProcessConfig {
    pub settings_path: PathBuf,
    pub helper_path: PathBuf,
    pub daemon_url: String,
    pub token: String,
}
```

Add this field to `ClaudeProcessConfig`:

```rust
pub permission_process: Option<PermissionProcessConfig>,
```

Update every existing test construction of `ClaudeProcessConfig` to include:

```rust
permission_process: None,
```

- [ ] **Step 4: Write temporary settings and helper files before spawning**

In `ClaudeProcess::spawn`, after the native Claude args and before `resume_session_id`, add:

```rust
if let Some(permission_process) = &config.permission_process {
    prepare_permission_hook_files(permission_process).await?;
    command.arg("--settings").arg(&permission_process.settings_path);
}
```

Add these helper functions below `spawn_with_retry`:

```rust
async fn prepare_permission_hook_files(config: &PermissionProcessConfig) -> AppResult<()> {
    if let Some(parent) = config.settings_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if let Some(parent) = config.helper_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let helper_command = config.helper_path.to_string_lossy().to_string();
    let settings = json!({
        "hooks": {
            "PermissionRequest": [
                {
                    "matcher": "",
                    "hooks": [
                        { "command": helper_command }
                    ]
                }
            ]
        }
    });
    tokio::fs::write(&config.settings_path, serde_json::to_vec_pretty(&settings)?).await?;

    let helper = format!(
        r#"#!/usr/bin/env bash
set -euo pipefail
payload=$(python3 -c 'import json,os,sys; p=json.load(sys.stdin); p["token"]=os.environ["CRW_PERMISSION_TOKEN"]; p["sessionId"]=os.environ["CRW_SESSION_ID"]; print(json.dumps(p))')
curl -fsS -X POST '{daemon_url}/api/internal/permission-hooks/request' \
  -H 'content-type: application/json' \
  --data-binary "$payload"
"#,
        daemon_url = config.daemon_url
    );
    tokio::fs::write(&config.helper_path, helper).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = tokio::fs::metadata(&config.helper_path).await?.permissions();
        permissions.set_mode(0o700);
        tokio::fs::set_permissions(&config.helper_path, permissions).await?;
    }

    Ok(())
}
```

- [ ] **Step 5: Pass environment to helper**

In `ClaudeProcess::spawn`, when `permission_process` exists, add env vars to the child command:

```rust
if let Some(permission_process) = &config.permission_process {
    command.env("CRW_PERMISSION_TOKEN", &permission_process.token);
    command.env("CRW_SESSION_ID", session_id.to_string());
}
```

Place this after `command.stdin(...).stdout(...).stderr(...)` so it is always applied before spawn.

- [ ] **Step 6: Build process config from session manager only when capability is available**

In `crates/server/src/session.rs`, update the `ClaudeProcessConfig` construction in `start_process`:

```rust
permission_process: self.permission_process_config(meta.id),
```

Add this helper method inside `impl SessionManager`:

```rust
fn permission_process_config(&self, session_id: Uuid) -> Option<crate::process::PermissionProcessConfig> {
    if !self.permission_bridge.capability().can_act() {
        return None;
    }
    let root = self.store.root().join("permission-bridge").join(session_id.to_string());
    Some(crate::process::PermissionProcessConfig {
        settings_path: root.join("settings.json"),
        helper_path: root.join("permission-hook-helper.sh"),
        daemon_url: "http://127.0.0.1:8787".to_string(),
        token: self.permission_bridge.token().to_string(),
    })
}
```

Also add `permission_process: None` to every `ClaudeProcessConfig` construction in tests.

- [ ] **Step 7: Make daemon URL configurable from main**

Replace the hard-coded helper in Step 6 with a field on `SessionManager` only if tests need it. Use this minimal signature change:

```rust
permission_daemon_url: String,
```

Add a sixth parameter to `SessionManager::new`:

```rust
permission_daemon_url: String,
```

Set it in the struct and use it in `permission_process_config`.

In `main.rs`, compute:

```rust
let permission_daemon_url = format!("http://{}", config.bind);
```

Pass it to `SessionManager::new`.

In tests, pass:

```rust
"http://127.0.0.1:8787".to_string()
```

- [ ] **Step 8: Run process tests**

Run:

```bash
cargo test --manifest-path Cargo.toml process::tests::passes_settings_file_when_permission_bridge_configured -- --nocapture
```

Expected: pass.

- [ ] **Step 9: Run all backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: pass. If the installed Claude Code later ignores `PermissionRequest` hooks, the runtime capability remains controlled by `PermissionCapability`; do not show frontend controls until capability is marked available.

- [ ] **Step 10: Commit**

```bash
git add crates/server/src/process.rs crates/server/src/session.rs crates/server/src/main.rs
git commit -m "Inject permission hook settings for Claude processes"
```

---

## Task 4: Frontend types, API helpers, and event extraction

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Create: `web/src/permissionEvents.ts`
- Test: `web/src/permissionEvents.test.ts`

- [ ] **Step 1: Write failing permission event extraction tests**

Create `web/src/permissionEvents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { permissionsFromEvents } from './permissionEvents';
import type { UiEvent } from './types';

function event(id: number, payload: unknown): UiEvent {
  return {
    id,
    sessionId: 'session-1',
    time: '2026-06-14T00:00:00Z',
    kind: 'system',
    payload
  };
}

describe('permissionsFromEvents', () => {
  it('extracts pending permission requests from permission_request events', () => {
    const permissions = permissionsFromEvents([
      event(1, {
        type: 'permission_request',
        permission: {
          requestId: 'req-1',
          sessionId: 'session-1',
          hookSessionId: 'hook-1',
          toolName: 'Bash',
          toolInput: { command: 'npm --prefix web test' },
          summary: 'Run: npm --prefix web test',
          cwd: '/repo',
          permissionMode: 'default',
          status: 'pending',
          editable: 'bashCommand',
          decision: null,
          createdAt: '2026-06-14T00:00:00Z',
          resolvedAt: null
        }
      })
    ]);

    expect(permissions).toHaveLength(1);
    expect(permissions[0].requestId).toBe('req-1');
    expect(permissions[0].summary).toBe('Run: npm --prefix web test');
  });

  it('removes resolved permissions from the active pending list', () => {
    const pending = {
      requestId: 'req-1',
      sessionId: 'session-1',
      hookSessionId: null,
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      summary: 'Run: npm test',
      cwd: '/repo',
      permissionMode: 'default',
      status: 'pending',
      editable: 'bashCommand',
      decision: null,
      createdAt: '2026-06-14T00:00:00Z',
      resolvedAt: null
    };

    const permissions = permissionsFromEvents([
      event(1, { type: 'permission_request', permission: pending }),
      event(2, { type: 'permission_resolved', permission: { ...pending, status: 'allowed', resolvedAt: '2026-06-14T00:00:01Z' } })
    ]);

    expect(permissions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the frontend test and verify it fails**

Run:

```bash
npm --prefix web test -- permissionEvents.test.ts
```

Expected: FAIL because `permissionEvents.ts` does not exist.

- [ ] **Step 3: Add frontend permission types**

In `web/src/types.ts`, add after `SessionRuntimeStatus`:

```ts
export type PermissionCapabilityStatus = 'available' | 'unavailable';

export type PermissionCapability = {
  status: PermissionCapabilityStatus;
  reason?: string | null;
};

export type PermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired' | 'failed';
export type PermissionEditable = 'bashCommand';

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown | null }
  | { behavior: 'deny'; message: string };

export type PendingPermissionRequest = {
  requestId: string;
  sessionId: string;
  hookSessionId?: string | null;
  toolName: string;
  toolInput: unknown;
  summary: string;
  cwd?: string | null;
  permissionMode?: string | null;
  status: PermissionStatus;
  editable?: PermissionEditable | null;
  decision?: PermissionDecision | null;
  createdAt: string;
  resolvedAt?: string | null;
};

export type PendingPermissionsResponse = {
  capability: PermissionCapability;
  pending: PendingPermissionRequest[];
};
```

Add to `SessionInfo`:

```ts
permissionCapability?: PermissionCapability;
```

- [ ] **Step 4: Add API helpers**

In `web/src/api.ts`, import the new types:

```ts
PendingPermissionRequest,
PendingPermissionsResponse,
```

Add these functions before `eventsUrl`:

```ts
export async function listPendingPermissions(sessionId: string): Promise<PendingPermissionsResponse> {
  return request<PendingPermissionsResponse>(`/api/sessions/${sessionId}/permissions/pending`);
}

export async function allowPermission(sessionId: string, requestId: string, updatedInput?: unknown): Promise<PendingPermissionRequest> {
  return request<PendingPermissionRequest>(`/api/sessions/${sessionId}/permissions/${requestId}/allow`, {
    method: 'POST',
    body: JSON.stringify(updatedInput === undefined ? {} : { updatedInput })
  });
}

export async function denyPermission(sessionId: string, requestId: string, message: string): Promise<PendingPermissionRequest> {
  return request<PendingPermissionRequest>(`/api/sessions/${sessionId}/permissions/${requestId}/deny`, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
}
```

- [ ] **Step 5: Implement event extraction**

Create `web/src/permissionEvents.ts`:

```ts
import type { PendingPermissionRequest, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function permissionFromPayload(payload: unknown): PendingPermissionRequest | null {
  if (!isObject(payload) || !isObject(payload.permission)) return null;
  const permission = payload.permission as Partial<PendingPermissionRequest>;
  if (typeof permission.requestId !== 'string') return null;
  if (typeof permission.sessionId !== 'string') return null;
  if (typeof permission.toolName !== 'string') return null;
  if (typeof permission.summary !== 'string') return null;
  if (typeof permission.status !== 'string') return null;
  if (typeof permission.createdAt !== 'string') return null;
  return permission as PendingPermissionRequest;
}

export function permissionsFromEvents(events: UiEvent[]): PendingPermissionRequest[] {
  const pending = new Map<string, PendingPermissionRequest>();
  for (const event of events) {
    if (!isObject(event.payload)) continue;
    const type = event.payload.type;
    const permission = permissionFromPayload(event.payload);
    if (!permission) continue;
    if (type === 'permission_request' && permission.status === 'pending') {
      pending.set(permission.requestId, permission);
      continue;
    }
    if (type === 'permission_resolved' || type === 'permission_expired') {
      pending.delete(permission.requestId);
    }
  }
  return Array.from(pending.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergePendingPermissions(
  fromEvents: PendingPermissionRequest[],
  fromApi: PendingPermissionRequest[]
): PendingPermissionRequest[] {
  const byId = new Map<string, PendingPermissionRequest>();
  for (const permission of fromEvents) byId.set(permission.requestId, permission);
  for (const permission of fromApi) byId.set(permission.requestId, permission);
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm --prefix web test -- permissionEvents.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/src/permissionEvents.ts web/src/permissionEvents.test.ts
git commit -m "Add frontend permission event model"
```

---

## Task 5: Frontend permission action card

**Files:**
- Create: `web/src/PermissionActionCard.tsx`
- Test: `web/src/PermissionActionCard.test.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: Write failing component tests**

Create `web/src/PermissionActionCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PermissionActionCard from './PermissionActionCard';
import type { PendingPermissionRequest, PermissionCapability } from './types';

const capability: PermissionCapability = { status: 'available' };
const permission: PendingPermissionRequest = {
  requestId: 'req-1',
  sessionId: 'session-1',
  hookSessionId: 'hook-1',
  toolName: 'Bash',
  toolInput: { command: 'npm --prefix web test' },
  summary: 'Run: npm --prefix web test',
  cwd: '/repo',
  permissionMode: 'default',
  status: 'pending',
  editable: 'bashCommand',
  decision: null,
  createdAt: '2026-06-14T00:00:00Z',
  resolvedAt: null
};

describe('PermissionActionCard', () => {
  it('renders allow deny edit and details controls when capability is available', () => {
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={vi.fn()} onDeny={vi.fn()} />);

    expect(screen.getByText('Claude needs your permission')).toBeInTheDocument();
    expect(screen.getByText('Run: npm --prefix web test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit command' })).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('does not render action buttons when capability is unavailable', () => {
    render(
      <PermissionActionCard
        permission={permission}
        capability={{ status: 'unavailable', reason: 'hook unsupported' }}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.getByText(/hook unsupported/)).toBeInTheDocument();
  });

  it('allows an edited bash command', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={onAllow} onDeny={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit command' }));
    const input = screen.getByLabelText('Command to allow');
    await user.clear(input);
    await user.type(input, 'npm --prefix web run build');
    await user.click(screen.getByRole('button', { name: 'Allow edited command' }));

    expect(onAllow).toHaveBeenCalledWith(permission, { command: 'npm --prefix web run build' });
  });

  it('denies with a message', async () => {
    const user = userEvent.setup();
    const onDeny = vi.fn();
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={vi.fn()} onDeny={onDeny} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await user.type(screen.getByLabelText('Denial message'), 'Run unit tests first');
    await user.click(screen.getByRole('button', { name: 'Send denial' }));

    expect(onDeny).toHaveBeenCalledWith(permission, 'Run unit tests first');
  });
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
npm --prefix web test -- PermissionActionCard.test.tsx
```

Expected: FAIL because `PermissionActionCard.tsx` does not exist.

- [ ] **Step 3: Implement the action card component**

Create `web/src/PermissionActionCard.tsx`:

```tsx
import { useState } from 'react';
import type { PendingPermissionRequest, PermissionCapability } from './types';

type Props = {
  permission: PendingPermissionRequest;
  capability: PermissionCapability;
  compact?: boolean;
  onAllow: (permission: PendingPermissionRequest, updatedInput?: unknown) => void;
  onDeny: (permission: PendingPermissionRequest, message: string) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bashCommand(permission: PendingPermissionRequest): string {
  if (!isObject(permission.toolInput)) return '';
  const command = permission.toolInput.command;
  return typeof command === 'string' ? command : '';
}

export default function PermissionActionCard({ permission, capability, compact = false, onAllow, onDeny }: Props) {
  const [isDenyOpen, setIsDenyOpen] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommand, setEditedCommand] = useState(() => bashCommand(permission));
  const canAct = capability.status === 'available';
  const canEditCommand = canAct && permission.editable === 'bashCommand';

  if (compact) {
    return (
      <section className="permission-card compact" aria-label="Pending permission">
        <span className="permission-kicker">Pending permission</span>
        <strong>{permission.toolName}</strong>
        <p>{permission.summary}</p>
        {canAct ? (
          <div className="permission-actions">
            <button type="button" onClick={() => onAllow(permission)}>Allow</button>
            <button type="button" onClick={() => setIsDenyOpen(true)}>Deny</button>
          </div>
        ) : (
          <p className="permission-unavailable">{capability.reason ?? 'Permission controls are unavailable.'}</p>
        )}
        {isDenyOpen && (
          <form
            className="permission-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              onDeny(permission, denyMessage);
            }}
          >
            <label>
              <span>Denial message</span>
              <input value={denyMessage} onChange={(event) => setDenyMessage(event.target.value)} />
            </label>
            <button type="submit">Send denial</button>
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="permission-card" aria-label="Claude permission request">
      <div className="permission-card-heading">
        <span className="permission-kicker">Permission request</span>
        <h3>Claude needs your permission</h3>
      </div>
      <div className="permission-command-block">
        <span>{permission.toolName === 'Bash' ? 'Run:' : `${permission.toolName}:`}</span>
        <code>{permission.summary}</code>
      </div>
      {canAct ? (
        <div className="permission-actions">
          <button type="button" className="primary-action" onClick={() => onAllow(permission)}>Allow</button>
          <button type="button" onClick={() => setIsDenyOpen((open) => !open)}>Deny</button>
          {canEditCommand && <button type="button" onClick={() => setIsEditing((open) => !open)}>Edit command</button>}
        </div>
      ) : (
        <p className="permission-unavailable">{capability.reason ?? 'Permission controls are unavailable for this session.'}</p>
      )}
      {isDenyOpen && (
        <form
          className="permission-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onDeny(permission, denyMessage);
          }}
        >
          <label>
            <span>Denial message</span>
            <input value={denyMessage} onChange={(event) => setDenyMessage(event.target.value)} placeholder="Optional reason for Claude" />
          </label>
          <button type="submit">Send denial</button>
        </form>
      )}
      {isEditing && canEditCommand && (
        <form
          className="permission-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAllow(permission, { command: editedCommand });
          }}
        >
          <label>
            <span>Command to allow</span>
            <textarea value={editedCommand} onChange={(event) => setEditedCommand(event.target.value)} rows={3} />
          </label>
          <button type="submit">Allow edited command</button>
        </form>
      )}
      <details className="permission-details">
        <summary>Details</summary>
        <dl>
          <div><dt>Tool</dt><dd>{permission.toolName}</dd></div>
          {permission.cwd && <div><dt>CWD</dt><dd>{permission.cwd}</dd></div>}
          {permission.permissionMode && <div><dt>Permission mode</dt><dd>{permission.permissionMode}</dd></div>}
          <div><dt>Request</dt><dd>{permission.requestId}</dd></div>
        </dl>
        <pre>{JSON.stringify(permission.toolInput, null, 2)}</pre>
      </details>
    </section>
  );
}
```

- [ ] **Step 4: Add styles**

Add to `web/src/App.css` near the other conversation surface styles:

```css
.permission-card {
  display: grid;
  gap: 12px;
  border: 1px solid #edc8bd;
  border-radius: 18px;
  background: linear-gradient(145deg, rgb(255 253 250 / 0.98), rgb(255 242 237 / 0.92));
  padding: 16px;
  box-shadow: var(--shadow-soft);
}

.permission-card.compact {
  gap: 8px;
  border-radius: 14px;
  padding: 12px;
}

.permission-card-heading {
  display: grid;
  gap: 3px;
}

.permission-card-heading h3,
.permission-card p {
  margin: 0;
}

.permission-kicker {
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.permission-command-block {
  display: grid;
  gap: 6px;
}

.permission-command-block span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.permission-command-block code,
.permission-details pre {
  display: block;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgb(255 253 250 / 0.78);
  padding: 10px;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.permission-inline-form {
  display: grid;
  gap: 9px;
}

.permission-inline-form button {
  justify-self: start;
}

.permission-unavailable {
  color: var(--muted);
  font-size: 13px;
}

.permission-details dl {
  display: grid;
  gap: 6px;
  margin: 10px 0;
}

.permission-details dl > div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 8px;
}

.permission-details dt {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.permission-details dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-soft);
  font-size: 12px;
}
```

- [ ] **Step 5: Run component tests**

Run:

```bash
npm --prefix web test -- PermissionActionCard.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/PermissionActionCard.tsx web/src/PermissionActionCard.test.tsx web/src/App.css
git commit -m "Add permission action card"
```

---

## Task 6: Wire permission cards into the app and Activity drawer

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/ConversationWorkspace.tsx`
- Modify: `web/src/InspectorPanel.tsx`
- Modify: `web/src/ActivityPanel.tsx`
- Test: `web/src/ActivityPanel.test.tsx`

- [ ] **Step 1: Update `ConversationWorkspace` props and render main card**

In `web/src/ConversationWorkspace.tsx`, add imports:

```ts
import PermissionActionCard from './PermissionActionCard';
import type { PendingPermissionRequest, PermissionCapability } from './types';
```

Add props:

```ts
pendingPermissions: PendingPermissionRequest[];
permissionCapability: PermissionCapability | null;
onAllowPermission: (permission: PendingPermissionRequest, updatedInput?: unknown) => void;
onDenyPermission: (permission: PendingPermissionRequest, message: string) => void;
```

Destructure them in the component parameter list.

Before `<ConversationBlockList blocks={activeBlocks} />`, add:

```tsx
{pendingPermissions[0] && permissionCapability && (
  <PermissionActionCard
    permission={pendingPermissions[0]}
    capability={permissionCapability}
    onAllow={onAllowPermission}
    onDeny={onDenyPermission}
  />
)}
```

- [ ] **Step 2: Update `ActivityPanel` props and compact rendering**

In `web/src/ActivityPanel.tsx`, import:

```ts
import PermissionActionCard from './PermissionActionCard';
import type { PendingPermissionRequest, PermissionCapability } from './types';
```

Add props:

```ts
pendingPermissions?: PendingPermissionRequest[];
permissionCapability: PermissionCapability | null;
onAllowPermission: (permission: PendingPermissionRequest, updatedInput?: unknown) => void;
onDenyPermission: (permission: PendingPermissionRequest, message: string) => void;
```

Render compact cards after the waiting surface and before the empty-state logic:

```tsx
{permissionCapability && pendingPermissions.length > 0 && (
  <div className="activity-permission-list" aria-label="Pending permissions">
    {pendingPermissions.map((permission) => (
      <PermissionActionCard
        key={permission.requestId}
        compact
        permission={permission}
        capability={permissionCapability}
        onAllow={onAllowPermission}
        onDeny={onDenyPermission}
      />
    ))}
  </div>
)}
```

Change the existing `activity.isPermissionLike` note to only show when there are no real pending permission controls:

```tsx
{activity.isPermissionLike && (
  <span className="activity-review-note">Review payload available for this permission-style event.</span>
)}
```

- [ ] **Step 3: Update `InspectorPanel` props passthrough**

In `web/src/InspectorPanel.tsx`, import pending permission types from `types.ts`.

Add props:

```ts
pendingPermissions: PendingPermissionRequest[];
permissionCapability: PermissionCapability | null;
onAllowPermission: (permission: PendingPermissionRequest, updatedInput?: unknown) => void;
onDenyPermission: (permission: PendingPermissionRequest, message: string) => void;
```

Pass them into `ActivityPanel`:

```tsx
<ActivityPanel
  activities={activities}
  activeSession={activeSession}
  waitingMessage={waitingMessage}
  pendingPermissions={pendingPermissions}
  permissionCapability={permissionCapability}
  onAllowPermission={onAllowPermission}
  onDenyPermission={onDenyPermission}
  onSelectActivity={onSelectActivity}
/>
```

- [ ] **Step 4: Wire app state and actions**

In `web/src/App.tsx`, update imports:

```ts
import { allowPermission, denyPermission, listPendingPermissions } from './api';
import { mergePendingPermissions, permissionsFromEvents } from './permissionEvents';
import type { PendingPermissionRequest, PermissionCapability } from './types';
```

Add state near the other `useState` calls:

```ts
const [apiPendingPermissions, setApiPendingPermissions] = useState<PendingPermissionRequest[]>([]);
const [permissionCapability, setPermissionCapability] = useState<PermissionCapability | null>(null);
```

Compute event-derived and merged pending after `activities`:

```ts
const eventPendingPermissions = permissionsFromEvents(eventState.activeEvents);
const pendingPermissions = mergePendingPermissions(eventPendingPermissions, apiPendingPermissions);
const effectivePermissionCapability = permissionCapability ?? sessionState.activeSession?.permissionCapability ?? null;
```

Add effect after diagnostics state:

```ts
useEffect(() => {
  const sessionId = sessionState.activeSession?.id;
  if (!sessionId) {
    setApiPendingPermissions([]);
    setPermissionCapability(null);
    return;
  }
  let cancelled = false;
  async function loadPendingPermissions() {
    try {
      const result = await listPendingPermissions(sessionId);
      if (cancelled) return;
      setApiPendingPermissions(result.pending);
      setPermissionCapability(result.capability);
    } catch (error) {
      if (cancelled) return;
      setApiPendingPermissions([]);
      setPermissionCapability({ status: 'unavailable', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  void loadPendingPermissions();
  return () => {
    cancelled = true;
  };
}, [sessionState.activeSession?.id, sessionState.activeSession?.updatedAt]);
```

Add callbacks:

```ts
async function onAllowPermission(permission: PendingPermissionRequest, updatedInput?: unknown) {
  try {
    const resolved = await allowPermission(permission.sessionId, permission.requestId, updatedInput);
    setApiPendingPermissions((current) => current.filter((item) => item.requestId !== resolved.requestId));
  } catch (error) {
    reportApiError(error instanceof Error ? error.message : String(error));
  }
}

async function onDenyPermission(permission: PendingPermissionRequest, message: string) {
  try {
    const resolved = await denyPermission(permission.sessionId, permission.requestId, message);
    setApiPendingPermissions((current) => current.filter((item) => item.requestId !== resolved.requestId));
  } catch (error) {
    reportApiError(error instanceof Error ? error.message : String(error));
  }
}
```

Update attention state:

```ts
const permissionReviewSurface = pendingPermissions[0]
  ? {
      title: 'Claude needs your permission',
      message: pendingPermissions[0].summary,
      activity: undefined
    }
  : null;
const attentionState = pendingPermissions.length > 0 ? 'review' : currentReviewSurface ? 'review' : eventState.isAwaitingClaude ? 'working' : 'idle';
const attentionLabel = pendingPermissions.length > 0 ? 'Claude needs permission' : currentReviewSurface?.title ?? (eventState.isAwaitingClaude ? 'Claude is working' : null);
```

Use `pendingPermissions` in `attentionKey` and toast content. If this conflicts with existing `currentReviewSurface` types, keep `currentReviewSurface` for `onOpenReviewActivity` and render the toast with direct strings:

```tsx
{shouldShowAttentionToast && attentionKey && (
  <AttentionToast
    title={pendingPermissions[0]?.summary ? 'Claude needs your permission' : currentReviewSurface!.title}
    message={pendingPermissions[0]?.summary ?? currentReviewSurface!.message}
    ...
  />
)}
```

Pass props into `ConversationWorkspace` and `InspectorPanel`:

```tsx
pendingPermissions={pendingPermissions}
permissionCapability={effectivePermissionCapability}
onAllowPermission={onAllowPermission}
onDenyPermission={onDenyPermission}
```

- [ ] **Step 5: Update ActivityPanel tests**

Open `web/src/ActivityPanel.test.tsx` and update every render call to include new required props:

```tsx
pendingPermissions={[]}
permissionCapability={null}
onAllowPermission={vi.fn()}
onDenyPermission={vi.fn()}
```

Add one test:

```tsx
it('renders compact pending permission controls', () => {
  render(
    <ActivityPanel
      activities={[]}
      activeSession={{
        id: 'session-1',
        cwd: '/repo',
        permissionMode: 'default',
        status: 'running',
        runtimeStatus: 'waiting',
        createdAt: '2026-06-14T00:00:00Z',
        updatedAt: '2026-06-14T00:00:00Z'
      }}
      waitingMessage={null}
      pendingPermissions={[{
        requestId: 'req-1',
        sessionId: 'session-1',
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        summary: 'Run: npm test',
        status: 'pending',
        editable: 'bashCommand',
        createdAt: '2026-06-14T00:00:00Z'
      }]}
      permissionCapability={{ status: 'available' }}
      onAllowPermission={vi.fn()}
      onDenyPermission={vi.fn()}
      onSelectActivity={vi.fn()}
    />
  );

  expect(screen.getByLabelText('Pending permissions')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm --prefix web test -- ActivityPanel.test.tsx PermissionActionCard.test.tsx permissionEvents.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/InspectorPanel.tsx web/src/ActivityPanel.tsx web/src/ActivityPanel.test.tsx
git commit -m "Wire pending permission cards into the UI"
```

---

## Task 7: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` if needed after checking current README content

- [ ] **Step 1: Update project instructions with the real-control rule**

In `CLAUDE.md`, update the existing implementation rule:

Current rule:

```md
- Do not add fake browser-side Stop Generating or permission approve/deny controls while driving raw Claude Code CLI stream-json; those control frames are not documented as supported.
```

Replace with:

```md
- Do not add fake browser-side Stop Generating or permission approve/deny controls while driving raw Claude Code CLI stream-json; those control frames are not documented as supported. Permission approve/deny UI is allowed only when backed by the server-side PermissionRequest hook bridge and must be hidden when that bridge reports unavailable capability.
```

- [ ] **Step 2: Review README for user-visible setup impact**

Read `README.md`. If it has a configuration/runtime section, add this short note near the daemon/config section:

```md
### Permission controls

The web UI only shows Allow/Deny/Edit permission controls when the daemon has enabled a real Claude Code hook-backed permission bridge for the session. If the installed Claude Code version or launcher cannot support that bridge, Claude Remote Web still shows waiting/review context but does not render fake approval buttons.
```

If README has no appropriate runtime/config section, do not force a new section; mention in the final summary that README did not need an update.

- [ ] **Step 3: Run backend formatting check**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
```

Expected: pass. If it fails, run `cargo fmt --manifest-path Cargo.toml`, review the formatting-only diff, then rerun the check.

- [ ] **Step 4: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: pass.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: pass.

- [ ] **Step 6: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 7: Manual UI verification with capability unavailable**

Start the app using the project script:

```bash
scripts/start-server.sh --skip-web-build
```

Open the app in the browser. Select or start a session. Confirm:

- Waiting/review surfaces still render.
- No Allow/Deny/Edit buttons appear if `permissionCapability.status` is `unavailable`.
- Existing conversation rendering and Activity cards still work.

Stop the daemon after verification.

- [ ] **Step 8: Manual hook bridge verification when capability is available**

Only run this if the implementation has verified `PermissionRequest` hook support and marks capability available. Start a session that triggers a `Bash` permission request. Confirm:

- Main conversation shows `Claude needs your permission`.
- Activity drawer shows `Pending permission`.
- `Allow` releases the hook and Claude continues.
- `Deny` returns the denial message to Claude.
- `Edit command` approves the edited command for `Bash.command`.
- Refreshing the browser while pending restores the card.

If local Claude Code does not support the hook bridge, record that capability remains unavailable; do not treat this as a failure of the UI fallback.

- [ ] **Step 9: Commit docs and verification fixes**

```bash
git add CLAUDE.md README.md
git commit -m "Document hook-backed permission controls"
```

If README was not changed, use:

```bash
git add CLAUDE.md
git commit -m "Document hook-backed permission controls"
```

---

## Self-review

### Spec coverage

- Main conversation action card: Task 5 and Task 6.
- Activity drawer pending state: Task 6.
- Backend pending model and APIs: Task 1 and Task 2.
- Hook bridge without stdin control frames: Task 3.
- Capability unavailable fallback: Task 2, Task 3, Task 6, Task 7.
- Bash.command edit only: Task 1 and Task 5.
- Session stop/end safe failure: Task 2 adds `fail_session_permissions`; implementation worker must call it from stop/exited paths during Task 2 if pending requests are active.
- README/CLAUDE review: Task 7.

### Placeholder scan

No `TBD`, `TODO`, or “similar to” placeholders. Every task has concrete file paths, code snippets, commands, and expected outcomes.

### Type consistency

Backend uses `request_id`/`session_id` in Rust serialized as `requestId`/`sessionId` for TypeScript. Frontend types use `updatedInput`, matching serde camelCase. Permission editable value serializes as `bashCommand`, matching TypeScript union.
