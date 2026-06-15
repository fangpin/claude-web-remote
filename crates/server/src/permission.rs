use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionEditable {
    BashCommand,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    Pending,
    Allowed,
    Denied,
    Expired,
    Failed,
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
        let summary = permission_summary(&request.tool_name, &request.tool_input);

        Self {
            request_id,
            session_id: request.session_id,
            hook_session_id: request.hook_session_id,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            summary,
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
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionsResponse {
    pub capability: PermissionCapability,
    pub pending: Vec<PendingPermissionRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AllowPermissionRequest {
    pub updated_input: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DenyPermissionRequest {
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "behavior", rename_all = "camelCase")]
pub enum PermissionDecision {
    Allow {
        #[serde(rename = "updatedInput", skip_serializing_if = "Option::is_none")]
        updated_input: Option<Value>,
    },
    Deny {
        message: String,
    },
}

type PendingWaiter = oneshot::Sender<PermissionDecision>;

struct PendingPermissionEntry {
    request: PendingPermissionRequest,
    waiter: Option<PendingWaiter>,
}

#[derive(Clone)]
pub struct PermissionBridge {
    token: String,
    capability: PermissionCapability,
    requests: Arc<Mutex<HashMap<String, PendingPermissionEntry>>>,
}

impl PermissionBridge {
    pub fn new(token: impl Into<String>, capability: PermissionCapability) -> Self {
        Self {
            token: token.into(),
            capability,
            requests: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn capability(&self) -> &PermissionCapability {
        &self.capability
    }

    pub async fn pending_for_session(&self, session_id: Uuid) -> Vec<PendingPermissionRequest> {
        let requests = self.requests.lock().await;
        let mut requests = requests
            .values()
            .filter(|entry| {
                entry.request.session_id == session_id
                    && entry.request.status == PermissionStatus::Pending
            })
            .map(|entry| entry.request.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| left.request_id.cmp(&right.request_id));
        requests
    }

    pub async fn list_response(&self, session_id: Uuid) -> PendingPermissionsResponse {
        PendingPermissionsResponse {
            capability: self.capability.clone(),
            pending: self.pending_for_session(session_id).await,
        }
    }

    pub async fn register_and_wait(
        &self,
        request: HookPermissionRequest,
    ) -> AppResult<PermissionDecision> {
        if request.token != self.token {
            return Err(AppError::InvalidRequest(
                "invalid permission token".to_string(),
            ));
        }

        if !self.capability.can_act() {
            return Ok(PermissionDecision::Deny {
                message: self
                    .capability
                    .reason
                    .clone()
                    .unwrap_or_else(|| "permission bridge unavailable".to_string()),
            });
        }

        let request_id = Uuid::new_v4().to_string();
        let pending = PendingPermissionRequest::from_hook_request(request_id.clone(), request);
        let (sender, receiver) = oneshot::channel();

        {
            let mut requests = self.requests.lock().await;
            requests.insert(
                request_id,
                PendingPermissionEntry {
                    request: pending,
                    waiter: Some(sender),
                },
            );
        }

        receiver
            .await
            .map_err(|_| AppError::Process("permission request was dropped".to_string()))
    }

    pub async fn allow(
        &self,
        session_id: Uuid,
        request_id: &str,
        request: AllowPermissionRequest,
    ) -> AppResult<PendingPermissionRequest> {
        self.resolve(
            session_id,
            request_id,
            PermissionStatus::Allowed,
            PermissionDecision::Allow {
                updated_input: request.updated_input,
            },
        )
        .await
    }

    pub async fn deny(
        &self,
        session_id: Uuid,
        request_id: &str,
        request: DenyPermissionRequest,
    ) -> AppResult<PendingPermissionRequest> {
        self.resolve(
            session_id,
            request_id,
            PermissionStatus::Denied,
            PermissionDecision::Deny {
                message: request
                    .message
                    .unwrap_or_else(|| "Permission denied by user".to_string()),
            },
        )
        .await
    }

    #[allow(dead_code)]
    async fn expire(
        &self,
        session_id: Uuid,
        request_id: &str,
    ) -> AppResult<PendingPermissionRequest> {
        self.resolve(
            session_id,
            request_id,
            PermissionStatus::Expired,
            PermissionDecision::Deny {
                message: "Permission request expired".to_string(),
            },
        )
        .await
    }

    async fn resolve(
        &self,
        session_id: Uuid,
        request_id: &str,
        status: PermissionStatus,
        decision: PermissionDecision,
    ) -> AppResult<PendingPermissionRequest> {
        let mut requests = self.requests.lock().await;
        let entry = requests
            .get_mut(request_id)
            .ok_or_else(|| AppError::NotFound(format!("permission request {request_id}")))?;

        if entry.request.session_id != session_id {
            return Err(AppError::NotFound(format!(
                "permission request {request_id}"
            )));
        }

        let waiter = entry.waiter.take().ok_or_else(|| {
            AppError::Process(format!(
                "permission request {request_id} has no waiting receiver"
            ))
        })?;
        if waiter.send(decision.clone()).is_err() {
            requests.remove(request_id);
            return Err(AppError::Process(format!(
                "permission request {request_id} could not deliver decision"
            )));
        }

        let mut entry = requests
            .remove(request_id)
            .expect("permission request should exist after decision delivery");
        entry.request.status = status;
        entry.request.decision = Some(decision);
        entry.request.resolved_at = Some(Utc::now());

        Ok(entry.request)
    }

    pub async fn fail_session_permissions(
        &self,
        session_id: Uuid,
        message: impl Into<String>,
    ) -> Vec<PendingPermissionRequest> {
        let message = message.into();
        let request_ids = {
            let requests = self.requests.lock().await;
            requests
                .iter()
                .filter(|(_, entry)| {
                    entry.request.session_id == session_id
                        && entry.request.status == PermissionStatus::Pending
                })
                .map(|(request_id, _)| request_id.clone())
                .collect::<Vec<_>>()
        };

        let mut resolved = Vec::with_capacity(request_ids.len());
        for request_id in request_ids {
            if let Ok(request) = self
                .resolve(
                    session_id,
                    &request_id,
                    PermissionStatus::Failed,
                    PermissionDecision::Deny {
                        message: message.clone(),
                    },
                )
                .await
            {
                resolved.push(request);
            }
        }
        resolved.sort_by(|left, right| left.request_id.cmp(&right.request_id));
        resolved
    }
}

pub fn hook_stdout_for_decision(decision: &PermissionDecision) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": decision,
        }
    })
}

pub fn permission_summary(tool_name: &str, tool_input: &Value) -> String {
    if tool_name == "Bash" {
        if let Some(command) = tool_input.get("command").and_then(Value::as_str) {
            if let Some(description) = tool_input.get("description").and_then(Value::as_str)
                && !description.is_empty()
            {
                return format!("{description}: {command}");
            }
            return format!("Run: {command}");
        }
    }

    let compact_json = serde_json::to_string(tool_input).unwrap_or_else(|_| "null".to_string());
    let compact_json = if compact_json.chars().count() > 160 {
        format!("{}...", compact_json.chars().take(157).collect::<String>())
    } else {
        compact_json
    };
    format!("{tool_name}: {compact_json}")
}

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

    async fn wait_for_pending(
        bridge: &PermissionBridge,
        session_id: Uuid,
        expected_count: usize,
    ) -> Vec<PendingPermissionRequest> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let pending = bridge.pending_for_session(session_id).await;
            if pending.len() == expected_count {
                return pending;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "timed out waiting for {expected_count} pending permission requests; saw {}",
                pending.len()
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    #[test]
    fn summarizes_bash_commands_without_description() {
        let summary = permission_summary("Bash", &json!({ "command": "npm --prefix web test" }));
        assert_eq!(summary, "Run: npm --prefix web test");
    }

    #[test]
    fn summarizes_bash_commands_with_description() {
        let summary = permission_summary(
            "Bash",
            &json!({
                "description": "Run frontend tests",
                "command": "npm --prefix web test"
            }),
        );
        assert_eq!(summary, "Run frontend tests: npm --prefix web test");
    }

    #[test]
    fn summarizes_non_bash_requests_with_compact_json_fallback() {
        let summary = permission_summary(
            "Read",
            &json!({
                "file_path": "/tmp/example.txt",
                "offset": 12
            }),
        );
        assert_eq!(
            summary,
            "Read: {\"file_path\":\"/tmp/example.txt\",\"offset\":12}"
        );
    }

    #[test]
    fn truncates_non_bash_compact_json_fallback_after_160_characters() {
        let long_text = "x".repeat(180);
        let tool_input = json!({ "command": long_text });

        let compact_json = serde_json::to_string(&tool_input).unwrap();
        assert!(compact_json.chars().count() > 160);

        let summary = permission_summary("Read", &tool_input);
        let expected = format!(
            "Read: {}...",
            compact_json.chars().take(157).collect::<String>()
        );
        assert_eq!(summary, expected);
    }

    #[test]
    fn detects_editable_bash_command() {
        let request = PendingPermissionRequest::from_hook_request(
            "req-1".to_string(),
            hook_request(json!({
                "command": "cargo test --manifest-path Cargo.toml"
            })),
        );
        assert_eq!(request.editable, Some(PermissionEditable::BashCommand));
    }

    #[test]
    fn does_not_mark_non_bash_requests_editable_when_command_is_string() {
        let mut request = hook_request(json!({
            "command": "cargo test --manifest-path Cargo.toml"
        }));
        request.tool_name = "Read".to_string();

        let request = PendingPermissionRequest::from_hook_request("req-2".to_string(), request);
        assert_eq!(request.editable, None);
    }

    #[test]
    fn does_not_mark_bash_requests_editable_when_command_is_not_string() {
        let request = PendingPermissionRequest::from_hook_request(
            "req-3".to_string(),
            hook_request(json!({
                "command": ["cargo", "test"]
            })),
        );
        assert_eq!(request.editable, None);
    }

    #[tokio::test]
    async fn lists_pending_requests_for_a_session_with_bridge_capability() {
        let session_id = Uuid::new_v4();
        let other_session_id = Uuid::new_v4();
        let bridge = PermissionBridge::new(
            "bridge-token",
            PermissionCapability::unavailable("waiting for hook transport"),
        );

        {
            let mut requests = bridge.requests.lock().await;
            requests.insert(
                "req-2".to_string(),
                PendingPermissionEntry {
                    request: PendingPermissionRequest::from_hook_request(
                        "req-2".to_string(),
                        HookPermissionRequest {
                            session_id,
                            ..hook_request(json!({ "command": "second" }))
                        },
                    ),
                    waiter: None,
                },
            );
            requests.insert(
                "req-1".to_string(),
                PendingPermissionEntry {
                    request: PendingPermissionRequest::from_hook_request(
                        "req-1".to_string(),
                        HookPermissionRequest {
                            session_id,
                            ..hook_request(json!({ "command": "first" }))
                        },
                    ),
                    waiter: None,
                },
            );
            requests.insert(
                "req-3".to_string(),
                PendingPermissionEntry {
                    request: PendingPermissionRequest::from_hook_request(
                        "req-3".to_string(),
                        HookPermissionRequest {
                            session_id: other_session_id,
                            ..hook_request(json!({ "command": "other" }))
                        },
                    ),
                    waiter: None,
                },
            );
            let mut resolved = PendingPermissionRequest::from_hook_request(
                "req-4".to_string(),
                HookPermissionRequest {
                    session_id,
                    ..hook_request(json!({ "command": "resolved" }))
                },
            );
            resolved.status = PermissionStatus::Allowed;
            requests.insert(
                "req-4".to_string(),
                PendingPermissionEntry {
                    request: resolved,
                    waiter: None,
                },
            );
        }

        assert_eq!(bridge.token(), "bridge-token");
        assert_eq!(
            bridge.capability(),
            &PermissionCapability::unavailable("waiting for hook transport")
        );

        let pending = bridge.pending_for_session(session_id).await;
        assert_eq!(
            pending
                .iter()
                .map(|request| request.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["req-1", "req-2"]
        );

        let response = bridge.list_response(session_id).await;
        assert_eq!(
            response.capability,
            PermissionCapability::unavailable("waiting for hook transport")
        );
        assert_eq!(response.pending, pending);
    }

    #[tokio::test]
    async fn register_and_wait_resolves_through_allow() {
        let bridge = PermissionBridge::new("bridge-token", PermissionCapability::available());
        let request = hook_request(json!({ "command": "cargo test --manifest-path Cargo.toml" }));
        let session_id = request.session_id;

        let bridge_for_task = bridge.clone();
        let request_for_task = request.clone();
        let handle =
            tokio::spawn(async move { bridge_for_task.register_and_wait(request_for_task).await });

        let pending = wait_for_pending(&bridge, session_id, 1).await;
        let request_id = pending[0].request_id.clone();
        assert_eq!(pending[0].status, PermissionStatus::Pending);

        let resolved = bridge
            .allow(
                session_id,
                &request_id,
                AllowPermissionRequest {
                    updated_input: Some(json!({ "command": "cargo test permission::tests" })),
                },
            )
            .await
            .expect("allow should resolve pending request");
        assert_eq!(resolved.status, PermissionStatus::Allowed);
        assert!(resolved.resolved_at.is_some());
        assert_eq!(
            resolved.decision,
            Some(PermissionDecision::Allow {
                updated_input: Some(json!({ "command": "cargo test permission::tests" })),
            })
        );

        let decision = handle
            .await
            .expect("join should succeed")
            .expect("request should resolve");
        assert_eq!(
            decision,
            PermissionDecision::Allow {
                updated_input: Some(json!({ "command": "cargo test permission::tests" })),
            }
        );
        assert!(bridge.pending_for_session(session_id).await.is_empty());

        let err = bridge
            .allow(
                session_id,
                &request_id,
                AllowPermissionRequest {
                    updated_input: None,
                },
            )
            .await
            .expect_err("second resolve should fail");
        assert!(matches!(err, crate::error::AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn resolve_errors_when_waiter_has_dropped() {
        let bridge = PermissionBridge::new("bridge-token", PermissionCapability::available());
        let request = hook_request(json!({ "command": "pwd" }));
        let session_id = request.session_id;
        let pending = PendingPermissionRequest::from_hook_request("req-1".to_string(), request);
        let (sender, receiver) = oneshot::channel();
        drop(receiver);

        {
            let mut requests = bridge.requests.lock().await;
            requests.insert(
                "req-1".to_string(),
                PendingPermissionEntry {
                    request: pending,
                    waiter: Some(sender),
                },
            );
        }

        let err = bridge
            .allow(
                session_id,
                "req-1",
                AllowPermissionRequest {
                    updated_input: None,
                },
            )
            .await
            .expect_err("resolve should fail when decision cannot be delivered");
        assert!(matches!(err, crate::error::AppError::Process(_)));
        assert!(bridge.pending_for_session(session_id).await.is_empty());
    }

    #[tokio::test]
    async fn register_and_wait_denies_when_capability_is_unavailable() {
        let bridge = PermissionBridge::new(
            "bridge-token",
            PermissionCapability::unavailable("hook transport offline"),
        );

        let decision = bridge
            .register_and_wait(hook_request(json!({ "command": "pwd" })))
            .await
            .expect("unavailable capability should deny cleanly");

        assert_eq!(
            decision,
            PermissionDecision::Deny {
                message: "hook transport offline".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn register_and_wait_rejects_invalid_token() {
        let bridge = PermissionBridge::new("bridge-token", PermissionCapability::available());
        let mut request = hook_request(json!({ "command": "pwd" }));
        request.token = "wrong-token".to_string();

        let err = bridge
            .register_and_wait(request)
            .await
            .expect_err("invalid token should be rejected");

        assert!(matches!(err, crate::error::AppError::InvalidRequest(_)));
    }

    #[tokio::test]
    async fn fail_session_permissions_marks_pending_requests_failed() {
        let bridge = PermissionBridge::new("bridge-token", PermissionCapability::available());
        let request = hook_request(json!({ "command": "pwd" }));
        let session_id = request.session_id;

        let bridge_for_task = bridge.clone();
        let request_for_task = request.clone();
        let handle =
            tokio::spawn(async move { bridge_for_task.register_and_wait(request_for_task).await });

        let _pending = wait_for_pending(&bridge, session_id, 1).await;

        let failed = bridge
            .fail_session_permissions(session_id, "session ended")
            .await;
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].status, PermissionStatus::Failed);
        assert_eq!(
            failed[0].decision,
            Some(PermissionDecision::Deny {
                message: "session ended".to_string(),
            })
        );

        let decision = handle
            .await
            .expect("join should succeed")
            .expect("request should resolve");
        assert_eq!(
            decision,
            PermissionDecision::Deny {
                message: "session ended".to_string(),
            }
        );
    }

    #[test]
    fn serializes_allow_decision_for_hook_stdout() {
        let decision = PermissionDecision::Allow {
            updated_input: None,
        };
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
