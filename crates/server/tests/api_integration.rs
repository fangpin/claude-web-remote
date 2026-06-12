use axum::Router;
use claude_remote_web_server::{
    AppState, ConfigStore, EventStore, ResolvedConfig, SessionManager, build_router,
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
    spawn_app_with_config(temp, launcher, temp.path().join("config.toml")).await
}

async fn spawn_app_with_config(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    config_path: PathBuf,
) -> SocketAddr {
    let data_dir = temp.path().join("data");
    let store = EventStore::new(&data_dir).await.unwrap();
    let manager = SessionManager::new(store.clone(), launcher.clone(), "acceptEdits".to_string());
    let resolved_config = ResolvedConfig {
        bind: "127.0.0.1:0".parse().unwrap(),
        data_dir,
        launcher,
        web_dir: None,
        default_permission_mode: "acceptEdits".to_string(),
    };
    let config = ConfigStore::new(config_path, resolved_config);
    let state = AppState {
        manager,
        store,
        config,
    };
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
async fn config_api_get_returns_current_values_for_missing_file() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("missing").join("config.toml");
    let addr = spawn_app_with_config(&temp, vec!["claude".to_string()], config_path.clone()).await;
    let client = reqwest::Client::new();

    let response: Value = client
        .get(format!("http://{addr}/api/config"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(response["path"], json!(config_path.to_string_lossy()));
    assert_eq!(response["exists"], false);
    assert_eq!(response["restartRequired"], false);
    assert_eq!(response["file"]["bind"], "127.0.0.1:0");
    assert_eq!(response["file"]["launcher"], json!(["claude"]));
}

#[tokio::test]
async fn config_api_put_writes_normalized_config() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("nested").join("config.toml");
    let addr = spawn_app_with_config(&temp, vec!["claude".to_string()], config_path.clone()).await;
    let client = reqwest::Client::new();

    let response: Value = client
        .put(format!("http://{addr}/api/config"))
        .json(&json!({
            "bind": "127.0.0.1:8789",
            "dataDir": "/tmp/claude-remote-web-test",
            "launcher": ["ttadk", "claude", "-a"],
            "webDir": "/tmp/claude-remote-web-dist",
            "defaultPermissionMode": "auto"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(response["restartRequired"], true);
    assert_eq!(
        response["file"]["launcher"],
        json!(["ttadk", "claude", "-a"])
    );
    let written = fs::read_to_string(config_path).unwrap();
    assert!(written.contains("bind = \"127.0.0.1:8789\""));
    assert!(written.contains("launcher = [\"ttadk\", \"claude\", \"-a\"]"));
    assert!(written.contains("default_permission_mode = \"auto\""));
}

#[tokio::test]
async fn config_api_put_rejects_invalid_values() {
    let temp = tempfile::tempdir().unwrap();
    let addr = spawn_app(&temp, vec!["claude".to_string()]).await;
    let client = reqwest::Client::new();

    let response = client
        .put(format!("http://{addr}/api/config"))
        .json(&json!({
            "bind": "bad-bind",
            "dataDir": "/tmp/claude-remote-web-test",
            "launcher": ["claude"],
            "webDir": null,
            "defaultPermissionMode": "acceptEdits"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
    let response: Value = response.json().await.unwrap();

    assert!(
        response["error"]
            .as_str()
            .unwrap()
            .contains("invalid bind address")
    );
}
