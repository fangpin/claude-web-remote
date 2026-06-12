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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_session_id_from_supported_shapes() {
        assert_eq!(
            extract_claude_session_id(&json!({ "session_id": "snake" })),
            Some("snake".to_string())
        );
        assert_eq!(
            extract_claude_session_id(&json!({ "sessionId": "camel" })),
            Some("camel".to_string())
        );
        assert_eq!(
            extract_claude_session_id(&json!({ "session": { "id": "nested" } })),
            Some("nested".to_string())
        );
    }

    #[test]
    fn ignores_missing_or_non_string_session_id() {
        assert_eq!(
            extract_claude_session_id(&json!({ "session_id": 123 })),
            None
        );
        assert_eq!(extract_claude_session_id(&json!({ "session": {} })), None);
        assert_eq!(
            extract_claude_session_id(&json!({ "message": "hello" })),
            None
        );
    }
}
