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

#[derive(Clone)]
pub struct PermissionBridge {
    token: String,
    capability: PermissionCapability,
    requests: Arc<Mutex<HashMap<String, PendingPermissionRequest>>>,
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
            .filter(|request| request.session_id == session_id)
            .cloned()
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| left.id.cmp(&right.id));
        requests
    }

    pub async fn list_response(&self, session_id: Uuid) -> PendingPermissionsResponse {
        PendingPermissionsResponse {
            capability: self.capability.clone(),
            requests: self.pending_for_session(session_id).await,
        }
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
                PendingPermissionRequest::from_hook_request(
                    "req-2".to_string(),
                    HookPermissionRequest {
                        session_id,
                        ..hook_request(json!({ "command": "second" }))
                    },
                ),
            );
            requests.insert(
                "req-1".to_string(),
                PendingPermissionRequest::from_hook_request(
                    "req-1".to_string(),
                    HookPermissionRequest {
                        session_id,
                        ..hook_request(json!({ "command": "first" }))
                    },
                ),
            );
            requests.insert(
                "req-3".to_string(),
                PendingPermissionRequest::from_hook_request(
                    "req-3".to_string(),
                    HookPermissionRequest {
                        session_id: other_session_id,
                        ..hook_request(json!({ "command": "other" }))
                    },
                ),
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
                .map(|request| request.id.as_str())
                .collect::<Vec<_>>(),
            vec!["req-1", "req-2"]
        );

        let response = bridge.list_response(session_id).await;
        assert_eq!(
            response.capability,
            PermissionCapability::unavailable("waiting for hook transport")
        );
        assert_eq!(response.requests, pending);
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
