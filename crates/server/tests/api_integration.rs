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

fn fake_claude(dir: &Path) -> PathBuf {
    let path = dir.join("fake-claude-api.sh");
    fs::write(
        &path,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  text=$(python3 -c 'import json,sys; msg=json.loads(sys.argv[1]); print(msg["message"]["content"][0]["text"])' "$line")
  printf '{"type":"assistant","message":"ack:%s"}\n' "$text"
done
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

fn fake_claude_recording_args(dir: &Path, args_log: &Path) -> PathBuf {
    let path = dir.join("fake-claude-resume.sh");
    fs::write(
        &path,
        format!(
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> '{}'
printf '{{"type":"system","session_id":"resume-session"}}\n'
while IFS= read -r line; do
  text=$(python3 -c 'import json,sys; msg=json.loads(sys.argv[1]); print(msg["message"]["content"][0]["text"])' "$line")
  printf '{{"type":"assistant","message":"ack:%s"}}\n' "$text"
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

async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), launcher, "acceptEdits".to_string());
    let state = AppState { manager, store };
    let app: Router = build_router(state, None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

async fn spawn_app_with_store(store: EventStore) -> SocketAddr {
    let manager = SessionManager::new(
        store.clone(),
        vec!["claude".to_string()],
        "acceptEdits".to_string(),
    );
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

#[tokio::test]
async fn creates_session_accepts_input_and_streams_events() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
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

    let (mut ws, _) = connect_async(format!("ws://{addr}/api/sessions/{session_id}/events"))
        .await
        .unwrap();

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
    assert!(
        finished
            .iter()
            .any(|task| task["sessionId"] == first_session.to_string())
    );
    assert!(
        finished
            .iter()
            .any(|task| task["sessionId"] == second_session.to_string())
    );
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

#[tokio::test]
async fn restart_uses_persisted_claude_session_id() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("args.log");
    let bin = fake_claude_recording_args(temp.path(), &args_log);
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
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

#[tokio::test]
async fn wrapper_launcher_receives_native_args_after_prefix() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("wrapper-args.log");
    let wrapper = fake_claude_recording_args(temp.path(), &args_log);
    let addr = spawn_app(
        &temp,
        vec![
            wrapper.to_string_lossy().to_string(),
            "claude".to_string(),
            "-m".to_string(),
            "gpt-5.5".to_string(),
            "--skip-check".to_string(),
            "-a".to_string(),
        ],
    )
    .await;
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
    assert!(args.contains("claude -m gpt-5.5 --skip-check -a --input-format stream-json"));
    assert!(args.contains("--resume resume-session"));
}
