use crate::{
    AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent,
    SessionMeta, SessionStatus, UiEvent, extract_claude_session_id, store::SessionListFilter,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub cwd: PathBuf,
    pub name: Option<String>,
    pub permission_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

struct RunningSession {
    process: ClaudeProcess,
    tx: broadcast::Sender<UiEvent>,
}

#[derive(Clone)]
pub struct SessionManager {
    store: EventStore,
    launcher: Vec<String>,
    default_permission_mode: String,
    running: Arc<Mutex<HashMap<Uuid, RunningSession>>>,
}

impl SessionManager {
    pub fn new(store: EventStore, launcher: Vec<String>, default_permission_mode: String) -> Self {
        Self {
            store,
            launcher,
            default_permission_mode,
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_session(&self, request: CreateSessionRequest) -> AppResult<SessionInfo> {
        let cwd = expand_home(request.cwd);
        if !tokio::fs::try_exists(&cwd).await? {
            return Err(AppError::InvalidRequest(format!(
                "cwd does not exist: {}",
                cwd.display()
            )));
        }
        if !tokio::fs::metadata(&cwd).await?.is_dir() {
            return Err(AppError::InvalidRequest(format!(
                "cwd is not a directory: {}",
                cwd.display()
            )));
        }

        let now = Utc::now();
        let meta = SessionMeta {
            id: Uuid::new_v4(),
            name: request.name,
            cwd,
            permission_mode: request
                .permission_mode
                .unwrap_or_else(|| self.default_permission_mode.clone()),
            status: SessionStatus::Starting,
            claude_session_id: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        self.store.save_meta(&meta).await?;
        self.start_process(meta, None).await
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionInfo>> {
        Ok(self
            .store
            .list_meta(SessionListFilter::Active)
            .await?
            .into_iter()
            .map(SessionInfo::from)
            .collect())
    }

    pub async fn get_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        Ok(SessionInfo::from(self.store.load_meta(session_id).await?))
    }

    pub async fn send_input(&self, session_id: Uuid, text: String) -> AppResult<()> {
        let event_id = self.store.next_event_id(session_id).await?;
        let event = UiEvent::new(
            event_id,
            session_id,
            EventKind::User,
            json!({ "text": text }),
        );
        self.store.append_event(&event).await?;

        let running = self.running.lock().await;
        let session = running
            .get(&session_id)
            .ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
        let _ = session.tx.send(event);
        session.process.send_input(&text).await
    }

    pub async fn stop_session(&self, session_id: Uuid) -> AppResult<()> {
        let running = self.running.lock().await.remove(&session_id);
        if let Some(session) = running {
            session.process.kill().await?;
        }
        self.update_status(session_id, SessionStatus::Stopped).await
    }

    pub async fn restart_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let _ = self.stop_session(session_id).await;
        let meta = self.store.load_meta(session_id).await?;
        let resume = meta.claude_session_id.clone();
        if resume.is_none() {
            let event_id = self.store.next_event_id(session_id).await?;
            let event = UiEvent::new(
                event_id,
                session_id,
                EventKind::System,
                json!({ "message": "no claude session id found; started fresh" }),
            );
            self.store.append_event(&event).await?;
        }
        self.start_process(meta, resume).await
    }

    pub async fn subscribe(&self, session_id: Uuid) -> AppResult<broadcast::Receiver<UiEvent>> {
        let running = self.running.lock().await;
        let session = running
            .get(&session_id)
            .ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
        Ok(session.tx.subscribe())
    }

    pub async fn events_after(&self, session_id: Uuid, after_id: u64) -> AppResult<Vec<UiEvent>> {
        self.store.load_events_after(session_id, after_id).await
    }

    async fn start_process(
        &self,
        mut meta: SessionMeta,
        resume_session_id: Option<String>,
    ) -> AppResult<SessionInfo> {
        let (process, mut rx) = ClaudeProcess::spawn(
            meta.id,
            ClaudeProcessConfig {
                launcher: self.launcher.clone(),
                cwd: meta.cwd.clone(),
                permission_mode: meta.permission_mode.clone(),
                resume_session_id,
            },
        )
        .await?;

        meta.status = SessionStatus::Running;
        meta.updated_at = Utc::now();
        self.store.save_meta(&meta).await?;

        let (tx, _) = broadcast::channel(256);
        self.running.lock().await.insert(
            meta.id,
            RunningSession {
                process,
                tx: tx.clone(),
            },
        );

        let store = self.store.clone();
        let running = self.running.clone();
        let session_id = meta.id;
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    ProcessEvent::StdoutLine(line) => {
                        let _ = store.append_raw_stdout(session_id, &line).await;
                    }
                    ProcessEvent::StderrLine(line) => {
                        let _ = store.append_stderr(session_id, &line).await;
                        let event_id = store.next_event_id(session_id).await.unwrap_or(1);
                        let ui_event = UiEvent::new(
                            event_id,
                            session_id,
                            EventKind::Error,
                            json!({ "line": line }),
                        );
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::UiEvent(ui_event) => {
                        if let Some(claude_session_id) =
                            extract_claude_session_id(&ui_event.payload)
                        {
                            let _ = Self::update_claude_session_id(
                                &store,
                                session_id,
                                claude_session_id,
                            )
                            .await;
                        }
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::Exited(_) => {
                        let _ = running.lock().await.remove(&session_id);
                        if let Ok(mut meta) = store.load_meta(session_id).await
                            && meta.status != SessionStatus::Stopped
                        {
                            meta.status = SessionStatus::Exited;
                            meta.updated_at = Utc::now();
                            let _ = store.save_meta(&meta).await;
                        }
                        let event_id = store.next_event_id(session_id).await.unwrap_or(1);
                        let ui_event = UiEvent::new(
                            event_id,
                            session_id,
                            EventKind::System,
                            json!({ "status": "exited" }),
                        );
                        let _ = store.append_event(&ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                }
            }
        });

        Ok(SessionInfo::from(meta))
    }

    async fn update_claude_session_id(
        store: &EventStore,
        session_id: Uuid,
        claude_session_id: String,
    ) -> AppResult<()> {
        let mut meta = store.load_meta(session_id).await?;
        if meta.claude_session_id.as_deref() == Some(claude_session_id.as_str()) {
            return Ok(());
        }
        meta.claude_session_id = Some(claude_session_id);
        meta.updated_at = Utc::now();
        store.save_meta(&meta).await
    }

    async fn update_status(&self, session_id: Uuid, status: SessionStatus) -> AppResult<()> {
        let mut meta = self.store.load_meta(session_id).await?;
        meta.status = status;
        meta.updated_at = Utc::now();
        self.store.save_meta(&meta).await
    }
}

fn expand_home(path: PathBuf) -> PathBuf {
    let Some(path_str) = path.to_str() else {
        return path;
    };
    if path_str == "~" {
        return std::env::var_os("HOME").map(PathBuf::from).unwrap_or(path);
    }
    if let Some(rest) = path_str.strip_prefix("~/")
        && let Some(home) = std::env::var_os("HOME")
    {
        return PathBuf::from(home).join(rest);
    }
    path
}

impl From<SessionMeta> for SessionInfo {
    fn from(meta: SessionMeta) -> Self {
        Self {
            id: meta.id,
            name: meta.name,
            cwd: meta.cwd,
            permission_mode: meta.permission_mode,
            status: meta.status,
            claude_session_id: meta.claude_session_id,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join("fake-claude.sh");
        fs::write(
            &path,
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  text=$(python3 -c 'import json,sys; msg=json.loads(sys.argv[1]); print(msg["message"]["content"][0]["text"])' "$line")
  printf '{"type":"assistant","message":"ack:%s"}\n' "$text"
  if [[ "$text" == "exit" ]]; then
    exit 0
  fi
done
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[tokio::test]
    async fn rejects_missing_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager =
            SessionManager::new(store, vec!["claude".to_string()], "acceptEdits".to_string());

        let result = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().join("missing"),
                name: None,
                permission_mode: None,
            })
            .await;

        assert!(matches!(result, Err(AppError::InvalidRequest(_))));
    }

    #[tokio::test]
    async fn expands_home_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: PathBuf::from("~"),
                name: Some("home".to_string()),
                permission_mode: None,
            })
            .await
            .unwrap();

        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        assert_eq!(created.cwd, home);
    }

    #[tokio::test]
    async fn creates_lists_and_stops_session() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("demo".to_string()),
                permission_mode: None,
            })
            .await
            .unwrap();

        assert_eq!(created.name, Some("demo".to_string()));
        assert_eq!(created.permission_mode, "acceptEdits");
        assert_eq!(created.status, SessionStatus::Running);

        let sessions = manager.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, created.id);

        manager
            .send_input(created.id, "exit".to_string())
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        manager.stop_session(created.id).await.unwrap();
        let stopped = manager.get_session(created.id).await.unwrap();
        assert_eq!(stopped.status, SessionStatus::Stopped);
    }

    #[tokio::test]
    async fn uses_configured_default_permission_mode() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
            vec![bin.to_string_lossy().to_string()],
            "auto".to_string(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
            })
            .await
            .unwrap();

        assert_eq!(created.permission_mode, "auto");
    }

    #[tokio::test]
    async fn persists_claude_session_id_from_stdout_event() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
            })
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let loaded = store.load_meta(session.id).await.unwrap();
        assert_eq!(loaded.claude_session_id, Some("fake-session".to_string()));
    }

    #[tokio::test]
    async fn restart_without_session_id_records_system_event() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
            })
            .await
            .unwrap();

        let mut meta = store.load_meta(session.id).await.unwrap();
        meta.claude_session_id = None;
        store.save_meta(&meta).await.unwrap();

        manager.restart_session(session.id).await.unwrap();

        let events = store.load_events_after(session.id, 0).await.unwrap();
        assert!(events.iter().any(|event| {
            event
                .payload
                .to_string()
                .contains("no claude session id found")
        }));
    }

    #[tokio::test]
    async fn sends_input_and_persists_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
            })
            .await
            .unwrap();

        manager
            .send_input(session.id, "hello".to_string())
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let events = store.load_events_after(session.id, 0).await.unwrap();
        assert!(events.iter().any(|event| event.kind == EventKind::User));
        assert!(
            events
                .iter()
                .any(|event| event.kind == EventKind::Assistant)
        );
    }
}
