use crate::{AppResult, UiEvent, WorktreeMeta};
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
    pub worktree: Option<WorktreeMeta>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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

    pub async fn update_meta<F>(&self, session_id: Uuid, update: F) -> AppResult<SessionMeta>
    where
        F: FnOnce(&mut SessionMeta),
    {
        let _guard = self.write_lock.lock().await;
        let path = self.session_dir(session_id).join("meta.json");
        let content = fs::read(&path).await?;
        let mut meta: SessionMeta = serde_json::from_slice(&content)?;
        update(&mut meta);
        let content = serde_json::to_vec_pretty(&meta)?;
        fs::write(path, content).await?;
        Ok(meta)
    }

    pub async fn list_meta(&self) -> AppResult<Vec<SessionMeta>> {
        let mut entries = fs::read_dir(self.root.join("sessions")).await?;
        let mut sessions: Vec<SessionMeta> = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let meta_path = entry.path().join("meta.json");
            if fs::try_exists(&meta_path).await? {
                let content = fs::read(meta_path).await?;
                sessions.push(serde_json::from_slice(&content)?);
            }
        }

        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(sessions)
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
        let dir = self.ensure_session_dir(session_id).await?;
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
            worktree: Some(crate::WorktreeMeta {
                source_cwd: PathBuf::from("/tmp/source"),
                worktree_cwd: PathBuf::from("/tmp/source/.claude/worktrees/abc123"),
                branch: "pin/abc123".to_string(),
                created_by_claude_remote_web: true,
            }),
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
        assert_eq!(loaded.worktree.as_ref().unwrap().branch, "pin/abc123");
    }

    #[tokio::test]
    async fn field_update_preserves_concurrent_worktree_removal() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path()).await.unwrap();
        let id = Uuid::new_v4();
        let now = Utc::now();
        let worktree = crate::WorktreeMeta {
            source_cwd: PathBuf::from("/tmp/source"),
            worktree_cwd: PathBuf::from("/tmp/source/.claude/worktrees/abc123"),
            branch: "pin/abc123".to_string(),
            created_by_claude_remote_web: true,
        };
        let meta = SessionMeta {
            id,
            name: Some("demo".to_string()),
            cwd: worktree.worktree_cwd.clone(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: None,
            worktree: Some(worktree.clone()),
            created_at: now,
            updated_at: now,
        };
        store.save_meta(&meta).await.unwrap();

        store
            .update_meta(id, |meta| {
                meta.cwd = worktree.source_cwd.clone();
                meta.worktree = None;
                meta.updated_at = Utc::now();
            })
            .await
            .unwrap();
        store
            .update_meta(id, |meta| {
                meta.claude_session_id = Some("late-session".to_string());
                meta.updated_at = Utc::now();
            })
            .await
            .unwrap();

        let loaded = store.load_meta(id).await.unwrap();
        assert_eq!(loaded.worktree, None);
        assert_eq!(loaded.cwd, PathBuf::from("/tmp/source"));
        assert_eq!(loaded.claude_session_id, Some("late-session".to_string()));
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
