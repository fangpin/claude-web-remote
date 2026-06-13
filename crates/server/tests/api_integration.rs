use axum::Router;
use chrono::Utc;
use claude_remote_web_server::{
    AppState, ConfigStore, EventKind, EventStore, ResolvedConfig, SessionManager, SessionMeta,
    SessionStatus, UiEvent, WorktreeBaseRef, WorktreeConfig, build_router,
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

async fn git(dir: &Path, args: &[&str]) {
    let output = tokio::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn init_repo(root: &Path) {
    fs::create_dir_all(root).unwrap();
    git(root, &["init", "-b", "master"]).await;
    git(root, &["config", "user.email", "test@example.com"]).await;
    git(root, &["config", "user.name", "Test User"]).await;
    fs::write(root.join("README.md"), "hello\n").unwrap();
    git(root, &["add", "README.md"]).await;
    git(root, &["commit", "-m", "initial"]).await;
}

async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr {
    spawn_app_with_web_dir(temp, launcher, None).await
}

async fn spawn_app_with_web_dir(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    web_dir: Option<PathBuf>,
) -> SocketAddr {
    spawn_app_with_config_and_web_dir(temp, launcher, temp.path().join("config.toml"), web_dir)
        .await
}

async fn spawn_app_with_config(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    config_path: PathBuf,
) -> SocketAddr {
    spawn_app_with_config_and_web_dir(temp, launcher, config_path, None).await
}

async fn spawn_app_with_config_and_web_dir(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    config_path: PathBuf,
    web_dir: Option<PathBuf>,
) -> SocketAddr {
    let data_dir = temp.path().join("data");
    let store = EventStore::new(&data_dir).await.unwrap();
    let worktree = WorktreeConfig {
        worktrees_dir: None,
        branch_prefix: "pin".to_string(),
        base_ref: WorktreeBaseRef::Head,
    };
    let manager = SessionManager::new(
        store.clone(),
        launcher.clone(),
        "bypassPermissions".to_string(),
        worktree.clone(),
    );
    let config = ConfigStore::new(
        config_path,
        ResolvedConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            data_dir,
            launcher,
            web_dir: web_dir.clone(),
            default_permission_mode: "bypassPermissions".to_string(),
            worktree,
        },
    );
    let state = AppState {
        manager,
        store,
        config,
    };
    let app: Router = build_router(state, web_dir);
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
        "bypassPermissions".to_string(),
        claude_remote_web_server::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: claude_remote_web_server::WorktreeBaseRef::Head,
        },
    );
    let config = ConfigStore::new(
        PathBuf::from("config.toml"),
        ResolvedConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            data_dir: PathBuf::from("data"),
            launcher: vec!["claude".to_string()],
            web_dir: None,
            default_permission_mode: "bypassPermissions".to_string(),
            worktree: WorktreeConfig {
                worktrees_dir: None,
                branch_prefix: "pin".to_string(),
                base_ref: WorktreeBaseRef::Head,
            },
        },
    );
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
        worktree: None,
        deleted_at: None,
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
async fn stop_and_remove_worktree_endpoint_removes_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let created: Value = client
        .post(format!("http://{addr}/api/sessions"))
        .json(&json!({ "cwd": repo, "worktree": { "enabled": true } }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let session_id = created["id"].as_str().unwrap();
    let worktree_cwd = PathBuf::from(created["worktree"]["worktreeCwd"].as_str().unwrap());
    assert!(worktree_cwd.exists());

    client
        .post(format!(
            "http://{addr}/api/sessions/{session_id}/stop-and-remove-worktree"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    assert!(!worktree_cwd.exists());
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
async fn config_api_get_requires_restart_when_file_differs_from_current() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(&config_path, r#"launcher = ["ttadk", "claude"]"#).unwrap();
    let addr = spawn_app_with_config(&temp, vec!["claude".to_string()], config_path).await;
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

    assert_eq!(response["current"]["launcher"], json!(["claude"]));
    assert_eq!(response["file"]["launcher"], json!(["ttadk", "claude"]));
    assert_eq!(response["restartRequired"], true);
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
