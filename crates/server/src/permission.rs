use crate::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionRequest {
    pub id: String,
    pub session_id: Uuid,
    pub hook_session_id: Option<String>,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    pub summary: String,
    pub editable: Option<PermissionEditable>,
    pub status: PermissionStatus,
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
            id: request_id,
            session_id: request.session_id,
            hook_session_id: request.hook_session_id,
            cwd: request.cwd,
            permission_mode: request.permission_mode,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            summary,
            editable,
            status: PermissionStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionsResponse {
    pub capability: PermissionCapability,
    pub requests: Vec<PendingPermissionRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AllowPermissionRequest {
    pub updated_input: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DenyPermissionRequest {
    pub message: String,
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

#[derive(Clone, Default)]
pub struct PermissionBridge {
    requests: Arc<Mutex<HashMap<String, PendingPermissionRequest>>>,
}

impl PermissionBridge {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn add_request(
        &self,
        request_id: String,
        request: HookPermissionRequest,
    ) -> PendingPermissionRequest {
        let request = PendingPermissionRequest::from_hook_request(request_id.clone(), request);
        self.requests
            .lock()
            .await
            .insert(request_id, request.clone());
        request
    }

    pub async fn list_pending(&self) -> PendingPermissionsResponse {
        let requests = self.requests.lock().await;
        let mut requests = requests.values().cloned().collect::<Vec<_>>();
        requests.sort_by(|left, right| left.id.cmp(&right.id));
        PendingPermissionsResponse {
            capability: PermissionCapability::available(),
            requests,
        }
    }

    pub async fn allow(
        &self,
        request_id: &str,
        request: AllowPermissionRequest,
    ) -> AppResult<PermissionDecision> {
        self.resolve(
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
        request_id: &str,
        request: DenyPermissionRequest,
    ) -> AppResult<PermissionDecision> {
        self.resolve(
            request_id,
            PermissionStatus::Denied,
            PermissionDecision::Deny {
                message: request.message,
            },
        )
        .await
    }

    async fn resolve(
        &self,
        request_id: &str,
        status: PermissionStatus,
        decision: PermissionDecision,
    ) -> AppResult<PermissionDecision> {
        let mut requests = self.requests.lock().await;
        let request = requests
            .get_mut(request_id)
            .ok_or_else(|| AppError::NotFound(format!("permission request {request_id}")))?;
        if request.status != PermissionStatus::Pending {
            return Err(AppError::Conflict(format!(
                "permission request {request_id} is already resolved"
            )));
        }
        request.status = status;
        Ok(decision)
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
