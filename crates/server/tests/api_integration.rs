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
    spawn_app_with_web_dir(temp, launcher, None).await
}

async fn spawn_app_with_web_dir(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    web_dir: Option<PathBuf>,
) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), launcher, "acceptEdits".to_string());
    let state = AppState { manager, store };
    let app: Router = build_router(state, web_dir);
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

#[tokio::test]
async fn unknown_api_routes_return_404_instead_of_frontend() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("http://{addr}/api/does-not-exist"))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
    assert!(!response.text().await.unwrap().contains("Claude Remote Web"));
}

#[tokio::test]
async fn serves_embedded_web_assets_without_web_dir() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("http://{addr}/"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let body = response.text().await.unwrap();

    assert!(content_type.starts_with("text/html"));
    assert!(body.contains("Claude Remote Web"));
}

#[tokio::test]
async fn configured_web_dir_takes_priority_over_embedded_assets() {
    let temp = tempfile::tempdir().unwrap();
    let web_dir = temp.path().join("web-dist");
    fs::create_dir(&web_dir).unwrap();
    fs::write(
        web_dir.join("index.html"),
        "<!doctype html><html><body>external web dir wins</body></html>",
    )
    .unwrap();

    let bin = fake_claude(temp.path());
    let addr = spawn_app_with_web_dir(
        &temp,
        vec![bin.to_string_lossy().to_string()],
        Some(web_dir),
    )
    .await;
    let client = reqwest::Client::new();

    let body = client
        .get(format!("http://{addr}/"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();

    assert!(body.contains("external web dir wins"));
}

#[tokio::test]
async fn frontend_paths_still_use_embedded_assets() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("http://{addr}/client-side-route"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let body = response.text().await.unwrap();

    assert!(content_type.starts_with("text/html"));
    assert!(body.contains("Claude Remote Web"));
}
