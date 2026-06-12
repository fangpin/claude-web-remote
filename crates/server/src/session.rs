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
    pub deleted_at: Option<chrono::DateTime<Utc>>,
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

    pub async fn list_sessions(&self, filter: SessionListFilter) -> AppResult<Vec<SessionInfo>> {
        Ok(self
            .store
            .list_meta(filter)
            .await?
            .into_iter()
            .map(SessionInfo::from)
            .collect())
    }

    pub async fn get_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        Ok(SessionInfo::from(self.store.load_meta(session_id).await?))
    }

    async fn load_active_meta(&self, session_id: Uuid) -> AppResult<SessionMeta> {
        let meta = self.store.load_meta(session_id).await?;
        if meta.deleted_at.is_some() {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} is deleted; restore it before continuing"
            )));
        }
        Ok(meta)
    }

    pub async fn send_input(&self, session_id: Uuid, text: String) -> AppResult<()> {
        let _meta = self.load_active_meta(session_id).await?;
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
        let _meta = self.load_active_meta(session_id).await?;
        let _ = self.stop_session(session_id).await;
        self.resume_session(session_id).await
    }

    pub async fn resume_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let meta = self.load_active_meta(session_id).await?;
        if self.running.lock().await.contains_key(&session_id) {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} is already running"
            )));
        }
        if matches!(
            meta.status,
            SessionStatus::Starting | SessionStatus::Running
        ) {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} cannot be resumed from status {:?}",
                meta.status
            )));
        }
        self.start_or_resume(meta).await
    }

    pub async fn delete_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let mut meta = self.load_active_meta(session_id).await?;
        if self.running.lock().await.contains_key(&session_id) {
            self.stop_session(session_id).await?;
            meta = self.store.load_meta(session_id).await?;
        }
        let now = Utc::now();
        meta.deleted_at = Some(now);
        meta.status = SessionStatus::Stopped;
        meta.updated_at = now;
        self.store.save_meta(&meta).await?;
        Ok(SessionInfo::from(meta))
    }

    pub async fn restore_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let mut meta = self.store.load_meta(session_id).await?;
        if meta.deleted_at.is_none() {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} is not deleted"
            )));
        }
        meta.deleted_at = None;
        meta.updated_at = Utc::now();
        self.store.save_meta(&meta).await?;
        Ok(SessionInfo::from(meta))
    }

    pub async fn permanently_delete_session(&self, session_id: Uuid) -> AppResult<()> {
        let meta = self.store.load_meta(session_id).await?;
        if meta.deleted_at.is_none() {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} must be deleted before permanent removal"
            )));
        }
        if self.running.lock().await.contains_key(&session_id) {
            let running = self.running.lock().await.remove(&session_id);
            if let Some(session) = running {
                session.process.kill().await?;
            }
        }
        self.store.remove_session_dir(session_id).await
    }

    pub async fn subscribe(&self, session_id: Uuid) -> AppResult<broadcast::Receiver<UiEvent>> {
        let _meta = self.load_active_meta(session_id).await?;
        let running = self.running.lock().await;
        let session = running
            .get(&session_id)
            .ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
        Ok(session.tx.subscribe())
    }

    pub async fn events_after(&self, session_id: Uuid, after_id: u64) -> AppResult<Vec<UiEvent>> {
        self.store.load_events_after(session_id, after_id).await
    }

    async fn start_or_resume(&self, meta: SessionMeta) -> AppResult<SessionInfo> {
        let resume = meta.claude_session_id.clone();
        if resume.is_none() {
            let event_id = self.store.next_event_id(meta.id).await?;
            let event = UiEvent::new(
                event_id,
                meta.id,
                EventKind::System,
                json!({ "message": "no claude session id found; started fresh" }),
            );
            self.store.append_event(&event).await?;
        }
        self.start_process(meta, resume).await
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
            deleted_at: meta.deleted_at,
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

        let sessions = manager
            .list_sessions(SessionListFilter::Active)
            .await
            .unwrap();
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

    #[tokio::test]
    async fn soft_delete_hides_session_and_restore_shows_it_again() {
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
                name: Some("delete me".to_string()),
                permission_mode: None,
            })
            .await
            .unwrap();

        let deleted = manager.delete_session(session.id).await.unwrap();
        assert!(deleted.deleted_at.is_some());
        assert_eq!(deleted.status, SessionStatus::Stopped);
        assert!(
            manager
                .list_sessions(SessionListFilter::Active)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            manager
                .list_sessions(SessionListFilter::Deleted)
                .await
                .unwrap()[0]
                .id,
            session.id
        );

        let restored = manager.restore_session(session.id).await.unwrap();
        assert_eq!(restored.deleted_at, None);
        assert_eq!(
            manager
                .list_sessions(SessionListFilter::Active)
                .await
                .unwrap()[0]
                .id,
            session.id
        );
    }

    #[tokio::test]
    async fn permanently_delete_requires_soft_deleted_session_and_removes_files() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let data_dir = temp.path().join("data");
        let store = EventStore::new(&data_dir).await.unwrap();
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

        let active_result = manager.permanently_delete_session(session.id).await;
        assert!(matches!(active_result, Err(AppError::InvalidRequest(_))));

        manager.delete_session(session.id).await.unwrap();
        manager
            .permanently_delete_session(session.id)
            .await
            .unwrap();

        assert!(
            !tokio::fs::try_exists(data_dir.join("sessions").join(session.id.to_string()))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn deleted_sessions_reject_input_resume_restart_and_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
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

        manager.delete_session(session.id).await.unwrap();

        assert!(matches!(
            manager.send_input(session.id, "hello".to_string()).await,
            Err(AppError::InvalidRequest(_))
        ));
        assert!(matches!(
            manager.resume_session(session.id).await,
            Err(AppError::InvalidRequest(_))
        ));
        assert!(matches!(
            manager.restart_session(session.id).await,
            Err(AppError::InvalidRequest(_))
        ));
        assert!(matches!(
            manager.subscribe(session.id).await,
            Err(AppError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn resume_uses_persisted_claude_session_id() {
        let temp = tempfile::tempdir().unwrap();
        let args_log = temp.path().join("args.log");
        let wrapper = temp.path().join("fake-wrapper.sh");
        fs::write(
            &wrapper,
            format!(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > '{}'\nprintf '{{\"type\":\"system\",\"session_id\":\"resumed\"}}\\n'\nwhile IFS= read -r line; do exit 0; done\n",
                args_log.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![wrapper.to_string_lossy().to_string()],
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
        manager.stop_session(session.id).await.unwrap();
        let mut meta = store.load_meta(session.id).await.unwrap();
        meta.claude_session_id = Some("resume-me".to_string());
        store.save_meta(&meta).await.unwrap();

        manager.resume_session(session.id).await.unwrap();
        for _ in 0..10 {
            if args_log.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let args = fs::read_to_string(args_log).unwrap();
        assert!(args.contains("--resume resume-me"));
    }
}
