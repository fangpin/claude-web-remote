use crate::{AppError, AppResult, UiEvent};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Starting,
    Running,
    Exited,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub claude_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionListFilter {
    Active,
    Deleted,
    All,
}

impl SessionListFilter {
    fn includes(self, meta: &SessionMeta) -> bool {
        match self {
            SessionListFilter::Active => meta.deleted_at.is_none(),
            SessionListFilter::Deleted => meta.deleted_at.is_some(),
            SessionListFilter::All => true,
        }
    }
}

#[derive(Clone)]
pub struct EventStore {
    root: Arc<PathBuf>,
    write_lock: Arc<Mutex<()>>,
}

impl EventStore {
    pub async fn new(root: impl AsRef<Path>) -> AppResult<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("sessions")).await?;
        Ok(Self {
            root: Arc::new(root),
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn root(&self) -> &Path {
        self.root.as_path()
    }

    pub async fn ensure_session_dir(&self, session_id: Uuid) -> AppResult<PathBuf> {
        let dir = self.session_dir(session_id);
        fs::create_dir_all(&dir).await?;
        Ok(dir)
    }

    pub async fn save_meta(&self, meta: &SessionMeta) -> AppResult<()> {
        let _guard = self.write_lock.lock().await;
        let dir = self.ensure_session_dir(meta.id).await?;
        let content = serde_json::to_vec_pretty(meta)?;
        fs::write(dir.join("meta.json"), content).await?;
        Ok(())
    }

    pub async fn load_meta(&self, session_id: Uuid) -> AppResult<SessionMeta> {
        let content = fs::read(self.session_dir(session_id).join("meta.json")).await?;
        Ok(serde_json::from_slice(&content)?)
    }

    pub async fn list_meta(&self, filter: SessionListFilter) -> AppResult<Vec<SessionMeta>> {
        let mut entries = fs::read_dir(self.root.join("sessions")).await?;
        let mut sessions: Vec<SessionMeta> = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let meta_path = entry.path().join("meta.json");
            if fs::try_exists(&meta_path).await? {
                let content = fs::read(meta_path).await?;
                let meta: SessionMeta = serde_json::from_slice(&content)?;
                if filter.includes(&meta) {
                    sessions.push(meta);
                }
            }
        }

        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(sessions)
    }

    pub async fn remove_session_dir(&self, session_id: Uuid) -> AppResult<()> {
        let _guard = self.write_lock.lock().await;
        let dir = self.session_dir(session_id);
        if fs::try_exists(&dir).await? {
            fs::remove_dir_all(dir).await?;
        }
        Ok(())
    }

    pub async fn append_event(&self, event: &UiEvent) -> AppResult<()> {
        let line = serde_json::to_string(event)?;
        self.append_line(event.session_id, "events.jsonl", &line)
            .await
    }

    pub async fn next_event_id(&self, session_id: Uuid) -> AppResult<u64> {
        let events = self.load_events_after(session_id, 0).await?;
        Ok(events.iter().map(|event| event.id).max().unwrap_or(0) + 1)
    }

    pub async fn load_events_after(
        &self,
        session_id: Uuid,
        after_id: u64,
    ) -> AppResult<Vec<UiEvent>> {
        let path = self.session_dir(session_id).join("events.jsonl");
        if !fs::try_exists(&path).await? {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path).await?;
        let mut events = Vec::new();
        for line in content.lines().filter(|line| !line.trim().is_empty()) {
            let event: UiEvent = serde_json::from_str(line)?;
            if event.id > after_id {
                events.push(event);
            }
        }
        Ok(events)
    }

    pub async fn append_raw_stdout(&self, session_id: Uuid, line: &str) -> AppResult<()> {
        self.append_line(session_id, "raw-stdout.jsonl", line).await
    }

    pub async fn append_stderr(&self, session_id: Uuid, line: &str) -> AppResult<()> {
        self.append_line(session_id, "stderr.log", line).await
    }

    async fn append_line(&self, session_id: Uuid, file_name: &str, line: &str) -> AppResult<()> {
        let _guard = self.write_lock.lock().await;
        let dir = self.session_dir(session_id);
        if !fs::try_exists(&dir).await? {
            return Err(AppError::NotFound(format!("session {session_id}")));
        }
        let path = dir.join(file_name);
        let mut content = line.to_string();
        content.push('\n');
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;
        use tokio::io::AsyncWriteExt;
        file.write_all(content.as_bytes()).await?;
        file.flush().await?;
        Ok(())
    }

    fn session_dir(&self, session_id: Uuid) -> PathBuf {
        self.root.join("sessions").join(session_id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventKind;
    use serde_json::json;

    #[tokio::test]
    async fn saves_and_loads_session_meta() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let id = Uuid::new_v4();
        let meta = SessionMeta {
            id,
            name: Some("demo".to_string()),
            cwd: PathBuf::from("/tmp/demo"),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: Some("claude-session".to_string()),
            deleted_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        store.save_meta(&meta).await.unwrap();
        let loaded = store.load_meta(id).await.unwrap();

        assert_eq!(loaded.id, id);
        assert_eq!(loaded.name, Some("demo".to_string()));
        assert_eq!(loaded.cwd, PathBuf::from("/tmp/demo"));
        assert_eq!(loaded.permission_mode, "acceptEdits");
        assert_eq!(loaded.status, SessionStatus::Running);
        assert_eq!(loaded.claude_session_id, Some("claude-session".to_string()));
    }

    #[tokio::test]
    async fn loads_legacy_meta_without_deleted_at_as_active() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let id = Uuid::new_v4();
        let dir = temp.path().join("sessions").join(id.to_string());
        fs::create_dir_all(&dir).await.unwrap();
        fs::write(
            dir.join("meta.json"),
            serde_json::json!({
                "id": id,
                "name": "legacy",
                "cwd": "/tmp/legacy",
                "permissionMode": "acceptEdits",
                "status": "stopped",
                "claudeSessionId": null,
                "createdAt": "2026-06-11T00:00:00Z",
                "updatedAt": "2026-06-11T00:00:00Z"
            })
            .to_string(),
        )
        .await
        .unwrap();

        let loaded = store.load_meta(id).await.unwrap();

        assert_eq!(loaded.deleted_at, None);
    }

    #[tokio::test]
    async fn filters_session_meta_by_deleted_state() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let now = Utc::now();
        let active = SessionMeta {
            id: Uuid::new_v4(),
            name: Some("active".to_string()),
            cwd: PathBuf::from("/tmp/active"),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Stopped,
            claude_session_id: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        let deleted = SessionMeta {
            id: Uuid::new_v4(),
            name: Some("deleted".to_string()),
            cwd: PathBuf::from("/tmp/deleted"),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Stopped,
            claude_session_id: None,
            deleted_at: Some(now),
            created_at: now,
            updated_at: now + chrono::TimeDelta::seconds(1),
        };
        store.save_meta(&active).await.unwrap();
        store.save_meta(&deleted).await.unwrap();

        let active_only = store.list_meta(SessionListFilter::Active).await.unwrap();
        let deleted_only = store.list_meta(SessionListFilter::Deleted).await.unwrap();
        let all = store.list_meta(SessionListFilter::All).await.unwrap();

        assert_eq!(
            active_only.iter().map(|meta| meta.id).collect::<Vec<_>>(),
            vec![active.id]
        );
        assert_eq!(
            deleted_only.iter().map(|meta| meta.id).collect::<Vec<_>>(),
            vec![deleted.id]
        );
        assert_eq!(
            all.iter().map(|meta| meta.id).collect::<Vec<_>>(),
            vec![deleted.id, active.id]
        );
    }

    #[tokio::test]
    async fn removes_session_directory() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        let dir = store.ensure_session_dir(session_id).await.unwrap();
        fs::write(dir.join("events.jsonl"), "{}").await.unwrap();

        store.remove_session_dir(session_id).await.unwrap();

        assert!(
            !fs::try_exists(temp.path().join("sessions").join(session_id.to_string()))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn append_after_remove_session_dir_does_not_recreate_session_directory() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        store.ensure_session_dir(session_id).await.unwrap();

        store.remove_session_dir(session_id).await.unwrap();
        let append_result = store.append_stderr(session_id, "late stderr").await;

        assert!(append_result.is_err());
        assert!(
            !fs::try_exists(temp.path().join("sessions").join(session_id.to_string()))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn appends_and_replays_events_after_offset() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        store.ensure_session_dir(session_id).await.unwrap();

        store
            .append_event(&UiEvent::new(
                1,
                session_id,
                EventKind::User,
                json!({"text":"hello"}),
            ))
            .await
            .unwrap();
        store
            .append_event(&UiEvent::new(
                2,
                session_id,
                EventKind::Assistant,
                json!({"text":"world"}),
            ))
            .await
            .unwrap();

        let all = store.load_events_after(session_id, 0).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, 1);
        assert_eq!(all[1].id, 2);

        let replay = store.load_events_after(session_id, 1).await.unwrap();
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].id, 2);
    }

    #[tokio::test]
    async fn appends_raw_stdout_and_stderr() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let session_id = Uuid::new_v4();
        store.ensure_session_dir(session_id).await.unwrap();

        store
            .append_raw_stdout(session_id, "{\"type\":\"assistant\"}")
            .await
            .unwrap();
        store.append_stderr(session_id, "debug line").await.unwrap();

        let raw = fs::read_to_string(
            temp.path()
                .join("sessions")
                .join(session_id.to_string())
                .join("raw-stdout.jsonl"),
        )
        .await
        .unwrap();
        let stderr = fs::read_to_string(
            temp.path()
                .join("sessions")
                .join(session_id.to_string())
                .join("stderr.log"),
        )
        .await
        .unwrap();

        assert!(raw.contains("assistant"));
        assert!(stderr.contains("debug line"));
    }
}
