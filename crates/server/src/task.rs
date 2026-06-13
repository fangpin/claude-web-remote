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
        let starts = task_starts(meta, event);
        let has_starts = !starts.is_empty();
        for start in starts {
            tasks.entry(start.id.clone()).or_insert(start);
        }
        if has_starts {
            continue;
        }

        let finishes = task_finishes(meta, event);
        let has_finishes = !finishes.is_empty();
        for finish in finishes {
            if tasks
                .get(&finish.task_id)
                .is_some_and(|task| is_read_only_inspection_tool(&task.tool_kind))
                && finish.status == TaskStatus::Completed
            {
                tasks.remove(&finish.task_id);
                continue;
            }

            if let Some(task) = tasks.get_mut(&finish.task_id) {
                task.status = finish.status;
                task.finished_at = Some(event.time);
                task.finish_event_id = Some(event.id);
                task.summary = finish.summary;
            }
        }
        if has_finishes {
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

    if matches!(
        meta.status,
        SessionStatus::Exited | SessionStatus::Stopped | SessionStatus::Failed
    ) {
        interrupt_background_tasks(
            &mut tasks,
            meta.updated_at,
            None,
            "session ended before task completed".to_string(),
        );
    }

    tasks.retain(|_, task| {
        !is_read_only_inspection_tool(&task.tool_kind) || task.status == TaskStatus::Failed
    });

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

fn task_starts(meta: &SessionMeta, event: &UiEvent) -> Vec<TaskInfo> {
    tool_blocks(event, "tool_use")
        .filter_map(|tool_block| task_start_from_block(meta, event, tool_block))
        .collect()
}

fn task_start_from_block(
    meta: &SessionMeta,
    event: &UiEvent,
    tool_block: &Value,
) -> Option<TaskInfo> {
    let raw_id = string_field(
        tool_block,
        &[
            "id",
            "tool_use_id",
            "toolUseId",
            "tool_call_id",
            "toolCallId",
        ],
    )?;
    let tool_kind = string_field(tool_block, &["name", "tool_name", "toolName"])
        .unwrap_or_else(|| "tool".to_string());
    let input = tool_block.get("input");
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

fn task_finishes(meta: &SessionMeta, event: &UiEvent) -> Vec<TaskFinish> {
    tool_blocks(event, "tool_result")
        .filter_map(|tool_block| task_finish_from_block(meta, tool_block))
        .collect()
}

fn task_finish_from_block(meta: &SessionMeta, tool_block: &Value) -> Option<TaskFinish> {
    let raw_id = string_field(
        tool_block,
        &[
            "tool_use_id",
            "toolUseId",
            "id",
            "tool_call_id",
            "toolCallId",
        ],
    )?;
    let failed = tool_block
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || tool_block.get("error").is_some_and(non_empty_error_value);
    let summary = tool_block
        .get("content")
        .or_else(|| tool_block.get("result"))
        .or_else(|| tool_block.get("error"))
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

fn tool_blocks<'a>(
    event: &'a UiEvent,
    block_type: &'static str,
) -> Box<dyn Iterator<Item = &'a Value> + 'a> {
    if event.kind == EventKind::Tool
        && event.payload.get("type").and_then(Value::as_str) == Some(block_type)
    {
        return Box::new(std::iter::once(&event.payload));
    }

    if !matches!(event.kind, EventKind::Assistant | EventKind::User) {
        return Box::new(std::iter::empty());
    }

    Box::new(
        content_blocks(event)
            .filter(move |block| block.get("type").and_then(Value::as_str) == Some(block_type)),
    )
}

fn content_blocks(event: &UiEvent) -> impl Iterator<Item = &Value> {
    [
        event
            .payload
            .get("message")
            .and_then(|message| message.get("content")),
        event.payload.get("content"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_array)
    .flatten()
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

// Keep this list in sync with web/src/presentationPolicy.ts.
fn is_read_only_inspection_tool(tool_kind: &str) -> bool {
    matches!(tool_kind, "Read" | "Glob" | "Grep")
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

fn non_empty_error_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(object) => !object.is_empty(),
        _ => true,
    }
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
                .or_else(|| {
                    item.get("content")
                        .and_then(Value::as_str)
                        .and_then(non_empty_summary)
                })
        }),
        Value::Object(object) => {
            for key in [
                "command",
                "prompt",
                "description",
                "text",
                "message",
                "content",
                "result",
                "error",
            ] {
                if let Some(summary) = object.get(key).and_then(summarize_value) {
                    return Some(summary);
                }
            }
            serde_json::to_string(value)
                .ok()
                .and_then(|text| non_empty_summary(&text))
        }
        _ => serde_json::to_string(value)
            .ok()
            .and_then(|text| non_empty_summary(&text)),
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
            worktree: None,
            deleted_at: None,
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
    fn read_only_inspection_tools_do_not_create_tasks() {
        for (tool_kind, input) in [
            ("Read", json!({ "file_path": "/repo/demo/src/main.rs" })),
            ("Glob", json!({ "pattern": "**/*.rs" })),
            (
                "Grep",
                json!({ "pattern": "fn main", "path": "/repo/demo" }),
            ),
        ] {
            let session_id = Uuid::new_v4();
            let meta = meta(session_id, SessionStatus::Running);
            let tool_use_id = format!("toolu_{}", tool_kind.to_lowercase());
            let events = vec![
                event(
                    1,
                    session_id,
                    EventKind::Tool,
                    json!({
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": tool_kind,
                        "input": input
                    }),
                ),
                event(
                    2,
                    session_id,
                    EventKind::Tool,
                    json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": "inspection result"
                    }),
                ),
            ];

            let tasks = project_session_tasks(&meta, &events);

            assert_eq!(
                tasks.background.len(),
                0,
                "{tool_kind} should not create a background task"
            );
            assert_eq!(
                tasks.finished.len(),
                0,
                "{tool_kind} should not create a finished task"
            );
        }
    }

    #[test]
    fn unfinished_read_only_inspection_tool_is_dropped_when_session_exits() {
        for (status, exit_event) in [
            (SessionStatus::Exited, None),
            (
                SessionStatus::Running,
                Some(event(
                    2,
                    Uuid::nil(),
                    EventKind::System,
                    json!({ "status": "exited" }),
                )),
            ),
        ] {
            let session_id = Uuid::new_v4();
            let meta = meta(session_id, status);
            let mut events = vec![event(
                1,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_use",
                    "id": "toolu_read",
                    "name": "Read",
                    "input": { "file_path": "/repo/demo/src/main.rs" }
                }),
            )];
            if let Some(mut exit_event) = exit_event {
                exit_event.session_id = session_id;
                events.push(exit_event);
            }

            let tasks = project_session_tasks(&meta, &events);

            assert_eq!(tasks.background.len(), 0);
            assert_eq!(tasks.finished.len(), 0);
        }
    }

    #[test]
    fn failed_read_only_inspection_tool_creates_failed_finished_task() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_use",
                    "id": "toolu_read",
                    "name": "Read",
                    "input": { "file_path": "/repo/demo/missing.rs" }
                }),
            ),
            event(
                2,
                session_id,
                EventKind::Tool,
                json!({
                    "type": "tool_result",
                    "tool_use_id": "toolu_read",
                    "is_error": true,
                    "content": "file not found"
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].id, format!("{session_id}:toolu_read"));
        assert_eq!(tasks.finished[0].tool_kind, "Read");
        assert_eq!(tasks.finished[0].status, TaskStatus::Failed);
        assert_eq!(tasks.finished[0].finish_event_id, Some(2));
        assert_eq!(
            tasks.finished[0].summary,
            Some("file not found".to_string())
        );
    }

    #[test]
    fn nested_assistant_tool_use_creates_background_task() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![event(
            1,
            session_id,
            EventKind::Assistant,
            json!({
                "type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "text",
                            "text": "I will check the directory."
                        },
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "Bash",
                            "input": { "command": "pwd" }
                        }
                    ]
                }
            }),
        )];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 1);
        assert_eq!(tasks.finished.len(), 0);
        assert_eq!(tasks.background[0].id, format!("{session_id}:toolu_1"));
        assert_eq!(tasks.background[0].tool_kind, "Bash");
        assert_eq!(tasks.background[0].title, "Bash: pwd");
        assert_eq!(tasks.background[0].status, TaskStatus::Background);
        assert_eq!(tasks.background[0].start_event_id, 1);
    }

    #[test]
    fn nested_user_tool_result_marks_task_completed() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Assistant,
                json!({
                    "type": "assistant",
                    "message": {
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "toolu_1",
                                "name": "Bash",
                                "input": { "command": "pwd" }
                            }
                        ]
                    }
                }),
            ),
            event(
                2,
                session_id,
                EventKind::User,
                json!({
                    "type": "user",
                    "message": {
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "toolu_1",
                                "content": "/repo/demo"
                            }
                        ]
                    }
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
    fn payload_content_tool_blocks_are_projected() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![
            event(
                1,
                session_id,
                EventKind::Assistant,
                json!({
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "Bash",
                            "input": { "command": "git status" }
                        }
                    ]
                }),
            ),
            event(
                2,
                session_id,
                EventKind::User,
                json!({
                    "type": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_1",
                            "content": "clean"
                        }
                    ]
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Completed);
        assert_eq!(tasks.finished[0].summary, Some("clean".to_string()));
    }

    #[test]
    fn non_tool_payloads_do_not_create_tasks() {
        let session_id = Uuid::new_v4();
        let meta = meta(session_id, SessionStatus::Running);
        let events = vec![event(
            1,
            session_id,
            EventKind::Assistant,
            json!({
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Bash",
                "input": { "command": "pwd" }
            }),
        )];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 0);
        assert_eq!(tasks.finished.len(), 0);
    }

    #[test]
    fn non_tool_payloads_do_not_finish_tasks() {
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
                EventKind::Assistant,
                json!({
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "content": "/repo/demo"
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.background.len(), 1);
        assert_eq!(tasks.finished.len(), 0);
        assert_eq!(tasks.background[0].status, TaskStatus::Background);
        assert_eq!(tasks.background[0].finish_event_id, None);
    }

    #[test]
    fn null_error_field_does_not_mark_task_failed() {
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
                    "content": "/repo/demo",
                    "error": null
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Completed);
    }

    #[test]
    fn empty_error_field_does_not_mark_task_failed() {
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
                    "content": "/repo/demo",
                    "error": ""
                }),
            ),
        ];

        let tasks = project_session_tasks(&meta, &events);

        assert_eq!(tasks.finished.len(), 1);
        assert_eq!(tasks.finished[0].status, TaskStatus::Completed);
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
