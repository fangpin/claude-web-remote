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

fn classify_streaming_event(payload: &Value) -> EventKind {
    match payload.get("type").and_then(Value::as_str) {
        Some("message_start") => payload
            .get("message")
            .and_then(|message| message.get("role"))
            .and_then(Value::as_str)
            .filter(|role| *role == "assistant")
            .map(|_| EventKind::Assistant)
            .unwrap_or(EventKind::Raw),
        Some("content_block_start") => match payload
            .get("content_block")
            .and_then(|block| block.get("type"))
            .and_then(Value::as_str)
        {
            Some("text") => EventKind::Assistant,
            Some("tool_use") => EventKind::Tool,
            _ => EventKind::Raw,
        },
        Some("content_block_delta") => match payload
            .get("delta")
            .and_then(|delta| delta.get("type"))
            .and_then(Value::as_str)
        {
            Some("text_delta") => EventKind::Assistant,
            Some("input_json_delta") => EventKind::Tool,
            _ => EventKind::Raw,
        },
        Some("content_block_stop" | "message_delta" | "message_stop") => EventKind::Assistant,
        _ => EventKind::Raw,
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
            "message_start"
            | "content_block_start"
            | "content_block_delta"
            | "content_block_stop"
            | "message_delta"
            | "message_stop" => classify_streaming_event(&parsed),
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

    #[test]
    fn classifies_streaming_assistant_events() {
        let session_id = Uuid::new_v4();
        let message_start = normalize_claude_stdout(
            1,
            session_id,
            r#"{"type":"message_start","message":{"role":"assistant"}}"#,
        );
        assert_eq!(message_start.kind, EventKind::Assistant);
        assert_eq!(message_start.payload["message"]["role"], "assistant");

        let text_delta = normalize_claude_stdout(
            2,
            session_id,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}"#,
        );
        assert_eq!(text_delta.kind, EventKind::Assistant);
        assert_eq!(text_delta.payload["delta"]["text"], "hello");

        let message_stop = normalize_claude_stdout(3, session_id, r#"{"type":"message_stop"}"#);
        assert_eq!(message_stop.kind, EventKind::Assistant);
    }

    #[test]
    fn classifies_streaming_tool_events() {
        let session_id = Uuid::new_v4();
        let tool_start = normalize_claude_stdout(
            1,
            session_id,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}"#,
        );
        assert_eq!(tool_start.kind, EventKind::Tool);
        assert_eq!(tool_start.payload["content_block"]["id"], "toolu_1");

        let input_delta = normalize_claude_stdout(
            2,
            session_id,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":"}}"#,
        );
        assert_eq!(input_delta.kind, EventKind::Tool);
        assert_eq!(
            input_delta.payload["delta"]["partial_json"],
            "{\"file_path\":"
        );
    }

    #[test]
    fn leaves_unknown_streaming_events_raw() {
        let session_id = Uuid::new_v4();
        let event = normalize_claude_stdout(
            1,
            session_id,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"future_delta","value":"x"}}"#,
        );
        assert_eq!(event.kind, EventKind::Raw);
        assert_eq!(event.payload["delta"]["type"], "future_delta");
    }
}
