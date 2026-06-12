use axum::Router;
use claude_remote_web_server::{AppState, EventStore, SessionManager, build_router};
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

fn fake_claude(dir: &Path) -> PathBuf {
    let path = dir.join("fake-claude-api.sh");
    fs::write(
        &path,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  python3 -c 'import json,sys; msg=json.loads(sys.argv[1]); text=msg["message"]["content"][0]["text"]; print(json.dumps({"type":"assistant","message":f"ack:{text}"}))' "$line"
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

async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store.clone(),
        launcher,
        "acceptEdits".to_string(),
        claude_remote_web_server::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: claude_remote_web_server::WorktreeBaseRef::Head,
        },
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

    let saw_ack = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        for _ in 0..5 {
            if let Some(Ok(message)) = ws.next().await {
                let text = message.into_text().unwrap();
                if text.contains("ack:hello") {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false);

    assert!(saw_ack);
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
