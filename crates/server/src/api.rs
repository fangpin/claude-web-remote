use crate::{
    AppError, AppResult, CreateSessionRequest, EventStore, SessionManager, embedded_assets,
};
use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use tower_http::{cors::CorsLayer, services::ServeDir};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub manager: SessionManager,
    pub store: EventStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    pub text: String,
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
        .route("/sessions/{id}", get(get_session))
        .route("/sessions/{id}/tasks", get(list_session_tasks))
        .route("/sessions/{id}/input", post(send_input))
        .route("/sessions/{id}/stop", post(stop_session))
        .route("/sessions/{id}/restart", post(restart_session))
        .route("/sessions/{id}/events", get(events_ws))
        .fallback(api_not_found)
        .with_state(state)
        .layer(CorsLayer::permissive());

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

async fn list_sessions(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        json!({ "sessions": state.manager.list_sessions().await? }),
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

async fn restart_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.restart_session(id).await?)))
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

async fn handle_events_socket(
    state: AppState,
    session_id: Uuid,
    after_id: u64,
    mut socket: WebSocket,
) {
    if let Ok(events) = state.manager.events_after(session_id, after_id).await {
        for event in events {
            if let Ok(text) = serde_json::to_string(&event)
                && socket.send(Message::Text(text.into())).await.is_err()
            {
                return;
            }
        }
    }

    let Ok(mut rx) = state.manager.subscribe(session_id).await else {
        let _ = socket
            .send(Message::Text(
                json!({"kind":"error","payload":{"message":"session is not running"}})
                    .to_string()
                    .into(),
            ))
            .await;
        return;
    };

    while let Ok(event) = rx.recv().await {
        if let Ok(text) = serde_json::to_string(&event)
            && socket.send(Message::Text(text.into())).await.is_err()
        {
            return;
        }
    }
}
