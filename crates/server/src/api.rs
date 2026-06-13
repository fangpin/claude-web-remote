use crate::{
    AppError, AppResult, ConfigStore, ConfigValues, CreateSessionRequest, EventStore,
    SessionListFilter, SessionManager, embedded_assets,
};
use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, put},
};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub manager: SessionManager,
    pub store: EventStore,
    pub config: ConfigStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsQuery {
    pub include_deleted: Option<bool>,
    pub deleted_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionQuery {
    pub permanent: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsQuery {
    pub after_id: Option<u64>,
}

pub fn build_router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/tasks", get(list_tasks))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/{id}", get(get_session).delete(delete_session))
        .route("/sessions/{id}/tasks", get(list_session_tasks))
        .route("/sessions/{id}/input", post(send_input))
        .route("/sessions/{id}/stop", post(stop_session))
        .route(
            "/sessions/{id}/stop-and-remove-worktree",
            post(stop_and_remove_worktree),
        )
        .route("/sessions/{id}/restart", post(restart_session))
        .route("/sessions/{id}/resume", post(resume_session))
        .route("/sessions/{id}/archive", post(archive_session))
        .route("/sessions/{id}/unarchive", post(unarchive_session))
        .route("/sessions/{id}/restore", post(restore_session))
        .route("/sessions/{id}/events", get(events_ws))
        .route("/config", get(get_config).merge(put(update_config)))
        .fallback(api_not_found)
        .with_state(state);

    let app = Router::new().nest("/api", api);

    if let Some(web_dir) = web_dir {
        app.fallback_service(ServeDir::new(web_dir))
    } else {
        app.fallback(get(embedded_assets::serve))
    }
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<SessionsQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let filter = if query.deleted_only.unwrap_or(false) {
        SessionListFilter::Deleted
    } else if query.include_deleted.unwrap_or(false) {
        SessionListFilter::All
    } else {
        SessionListFilter::Active
    };

    Ok(Json(
        json!({ "sessions": state.manager.list_sessions(filter).await? }),
    ))
}

async fn create_session(
    State(state): State<AppState>,
    Json(request): Json<CreateSessionRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.create_session(request).await?)))
}

async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.get_session(id).await?)))
}

async fn list_tasks(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.list_tasks().await?)))
}

async fn list_session_tasks(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.tasks_for_session(id).await?)))
}

async fn send_input(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<InputRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if request.text.trim().is_empty() {
        return Err(AppError::InvalidRequest("input text is empty".to_string()));
    }
    state.manager.send_input(id, request.text).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn stop_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    state.manager.stop_session(id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn stop_and_remove_worktree(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    state.manager.stop_and_remove_worktree(id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn restart_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.restart_session(id).await?)))
}

async fn resume_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.resume_session(id).await?)))
}

async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.archive_session(id).await?)))
}

async fn unarchive_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.unarchive_session(id).await?)))
}

async fn restore_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.restore_session(id).await?)))
}

async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<DeleteSessionQuery>,
) -> AppResult<Json<serde_json::Value>> {
    if query.permanent.unwrap_or(false) {
        state.manager.permanently_delete_session(id).await?;
        Ok(Json(json!({ "ok": true })))
    } else {
        Ok(Json(json!(state.manager.delete_session(id).await?)))
    }
}

async fn events_ws(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        handle_events_socket(state, id, query.after_id.unwrap_or(0), socket).await;
    })
}

async fn get_config(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.config.get().await?)))
}

async fn update_config(
    State(state): State<AppState>,
    Json(request): Json<ConfigValues>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.config.save(request).await?)))
}

async fn handle_events_socket(
    state: AppState,
    session_id: Uuid,
    after_id: u64,
    mut socket: WebSocket,
) {
    match state.manager.events_after(session_id, after_id).await {
        Ok(events) => {
            for event in events {
                if let Ok(text) = serde_json::to_string(&event)
                    && socket.send(Message::Text(text.into())).await.is_err()
                {
                    return;
                }
            }
        }
        Err(err) => {
            let _ = socket
                .send(Message::Text(
                    json!({"kind":"error","payload":{"message":err.to_string()}})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    }

    let mut rx = match state.manager.subscribe(session_id).await {
        Ok(rx) => rx,
        Err(err) => {
            let _ = socket
                .send(Message::Text(
                    json!({"kind":"error","payload":{"message":err.to_string()}})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    while let Ok(event) = rx.recv().await {
        if let Ok(text) = serde_json::to_string(&event)
            && socket.send(Message::Text(text.into())).await.is_err()
        {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use futures::StreamExt;
    use serde_json::Value;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, time::Duration};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{connect_async, tungstenite::Message as TungsteniteMessage};
    use tower::ServiceExt;

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join(format!("fake-api-claude-{}.sh", Uuid::new_v4()));
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

    async fn test_state(temp: &tempfile::TempDir) -> AppState {
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            crate::WorktreeConfig {
                worktrees_dir: None,
                branch_prefix: "pin".to_string(),
                base_ref: crate::WorktreeBaseRef::Head,
            },
        );
        let config = ConfigStore::new(
            temp.path().join("config.toml"),
            crate::ResolvedConfig {
                bind: "127.0.0.1:0".parse().unwrap(),
                data_dir: temp.path().join("data"),
                launcher: vec![bin.to_string_lossy().to_string()],
                web_dir: None,
                default_permission_mode: "acceptEdits".to_string(),
                worktree: crate::WorktreeConfig {
                    worktrees_dir: None,
                    branch_prefix: "pin".to_string(),
                    base_ref: crate::WorktreeBaseRef::Head,
                },
            },
        );
        AppState {
            manager,
            store,
            config,
        }
    }

    async fn read_websocket_json_message(uri: &str) -> Value {
        let (mut websocket, _) = connect_async(uri).await.unwrap();
        let message = tokio::time::timeout(Duration::from_secs(2), websocket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        match message {
            TungsteniteMessage::Text(text) => serde_json::from_str(&text).unwrap(),
            other => panic!("expected websocket text message, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn sessions_query_filters_deleted_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(&temp).await;
        let active = state
            .manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("active".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        let deleted = state
            .manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("deleted".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        state.manager.delete_session(deleted.id).await.unwrap();
        let app = build_router(state, None);

        let active_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(active_response.status(), StatusCode::OK);
        let active_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(active_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(active_body["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(active_body["sessions"][0]["id"], active.id.to_string());

        let deleted_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/sessions?deletedOnly=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(deleted_response.status(), StatusCode::OK);
        let deleted_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(deleted_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(deleted_body["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(deleted_body["sessions"][0]["id"], deleted.id.to_string());

        let all_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/sessions?includeDeleted=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(all_response.status(), StatusCode::OK);
        let all_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(all_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(all_body["sessions"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn websocket_archived_session_sends_archived_error_text() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(&temp).await;
        let session = state
            .manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("deleted-websocket".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        state.manager.delete_session(session.id).await.unwrap();
        let app = build_router(state, None);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let message =
            read_websocket_json_message(&format!("ws://{addr}/api/sessions/{}/events", session.id))
                .await;

        server.abort();
        assert_eq!(message["kind"], "error");
        assert!(
            message["payload"]["message"]
                .as_str()
                .unwrap()
                .contains("is archived; unarchive it before continuing")
        );
    }

    #[tokio::test]
    async fn websocket_stopped_session_sends_subscribe_error_text() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(&temp).await;
        let session = state
            .manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("stopped-websocket".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        state.manager.stop_session(session.id).await.unwrap();
        let app = build_router(state, None);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let message = read_websocket_json_message(&format!(
            "ws://{addr}/api/sessions/{}/events?afterId=999",
            session.id
        ))
        .await;

        server.abort();
        assert_eq!(message["kind"], "error");
        assert!(
            message["payload"]["message"]
                .as_str()
                .unwrap()
                .contains("not found: running session")
        );
    }

    #[tokio::test]
    async fn delete_restore_permanent_delete_and_resume_routes_work() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(&temp).await;
        let session = state
            .manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("route".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        state.manager.stop_session(session.id).await.unwrap();
        let app = build_router(state, None);

        let resume_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/sessions/{}/resume", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resume_response.status(), StatusCode::OK);

        let archive_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/sessions/{}/archive", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(archive_response.status(), StatusCode::OK);
        let archive_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(archive_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(archive_body["deletedAt"].as_str().is_some());

        let unarchive_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/sessions/{}/unarchive", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unarchive_response.status(), StatusCode::OK);
        let unarchive_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(unarchive_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(unarchive_body["deletedAt"].is_null());

        let delete_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/sessions/{}", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::OK);

        let restore_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/sessions/{}/restore", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(restore_response.status(), StatusCode::OK);

        let delete_again_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/sessions/{}", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete_again_response.status(), StatusCode::OK);

        let permanent_response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/sessions/{}?permanent=true", session.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(permanent_response.status(), StatusCode::OK);
    }
}
