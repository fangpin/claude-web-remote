use crate::{
    AppError, AppResult, ClaudeProcess, ClaudeProcessConfig, EventKind, EventStore, ProcessEvent,
    SessionMeta, SessionStatus, TaskGroups, UiEvent, WorktreeConfig, WorktreeManager, WorktreeMeta,
    extract_claude_session_id, group_tasks, project_session_tasks, store::SessionListFilter,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    io::ErrorKind,
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub cwd: PathBuf,
    pub name: Option<String>,
    pub permission_mode: Option<String>,
    pub worktree: Option<WorktreeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionRuntimeStatus {
    Starting,
    Running,
    Waiting,
    Ended,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub status: SessionStatus,
    pub runtime_status: SessionRuntimeStatus,
    pub claude_session_id: Option<String>,
    pub worktree: Option<WorktreeMeta>,
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
    worktree_manager: WorktreeManager,
    running: Arc<Mutex<HashMap<Uuid, RunningSession>>>,
    starting: Arc<Mutex<HashSet<Uuid>>>,
}

impl SessionManager {
    pub fn new(
        store: EventStore,
        launcher: Vec<String>,
        default_permission_mode: String,
        worktree_config: WorktreeConfig,
    ) -> Self {
        Self {
            store,
            launcher,
            default_permission_mode,
            worktree_manager: WorktreeManager::new(worktree_config),
            running: Arc::new(Mutex::new(HashMap::new())),
            starting: Arc::new(Mutex::new(HashSet::new())),
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

        let worktree = if request
            .worktree
            .as_ref()
            .map(|worktree| worktree.enabled)
            .unwrap_or(false)
        {
            Some(self.worktree_manager.create(&cwd).await?)
        } else {
            None
        };
        let session_cwd = match worktree.as_ref() {
            Some(worktree) => match worktree_session_cwd(&cwd, worktree).await {
                Ok(session_cwd) => session_cwd,
                Err(err) => {
                    let _ = self.worktree_manager.remove(worktree).await;
                    return Err(err);
                }
            },
            None => cwd.clone(),
        };

        let now = Utc::now();
        let meta = SessionMeta {
            id: Uuid::new_v4(),
            name: request.name,
            cwd: session_cwd,
            permission_mode: request
                .permission_mode
                .unwrap_or_else(|| self.default_permission_mode.clone()),
            status: SessionStatus::Starting,
            claude_session_id: None,
            worktree,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        if let Err(err) = self.store.save_meta(&meta).await {
            if let Some(worktree) = meta.worktree.as_ref() {
                let _ = self.worktree_manager.remove(worktree).await;
            }
            return Err(err);
        }

        match self.start_process(meta.clone(), None).await {
            Ok(info) => Ok(info),
            Err(err) => {
                let removed_worktree_source_cwd = if let Some(worktree) = meta.worktree.as_ref() {
                    self.worktree_manager
                        .remove(worktree)
                        .await
                        .is_ok()
                        .then(|| worktree.source_cwd.clone())
                } else {
                    None
                };
                let _ = self
                    .store
                    .update_meta(meta.id, |failed_meta| {
                        if let Some(source_cwd) = removed_worktree_source_cwd {
                            failed_meta.cwd = source_cwd;
                            failed_meta.worktree = None;
                        }
                        failed_meta.status = SessionStatus::Failed;
                        failed_meta.updated_at = Utc::now();
                        Ok(())
                    })
                    .await;
                Err(err)
            }
        }
    }

    pub async fn list_sessions(&self, filter: SessionListFilter) -> AppResult<Vec<SessionInfo>> {
        let metas = self.store.list_meta(filter).await?;
        let mut sessions = Vec::with_capacity(metas.len());
        for meta in metas {
            sessions.push(self.session_info(meta).await?);
        }
        Ok(sessions)
    }

    pub async fn get_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let meta = self.store.load_meta(session_id).await?;
        self.session_info(meta).await
    }

    pub async fn list_tasks(&self) -> AppResult<TaskGroups> {
        let metas = self.store.list_meta(SessionListFilter::Active).await?;
        let mut tasks = Vec::new();
        for meta in metas {
            let events = self.store.load_events_after(meta.id, 0).await?;
            tasks.extend(project_session_tasks(&meta, &events).into_tasks());
        }
        Ok(group_tasks(tasks))
    }

    pub async fn tasks_for_session(&self, session_id: Uuid) -> AppResult<TaskGroups> {
        let meta = self.load_active_meta(session_id).await?;
        let events = self.store.load_events_after(session_id, 0).await?;
        Ok(project_session_tasks(&meta, &events))
    }

    async fn load_active_meta(&self, session_id: Uuid) -> AppResult<SessionMeta> {
        let meta = self.store.load_meta(session_id).await?;
        if meta.deleted_at.is_some() {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} is archived; unarchive it before continuing"
            )));
        }
        Ok(meta)
    }

    pub async fn send_input(&self, session_id: Uuid, text: String) -> AppResult<SessionInfo> {
        let meta = self.load_active_meta(session_id).await?;
        let mut event = UiEvent::new(0, session_id, EventKind::User, json!({ "text": text }));
        self.store.append_event_with_next_id(&mut event).await?;

        let (process, tx) = {
            let running = self.running.lock().await;
            let session = running
                .get(&session_id)
                .ok_or_else(|| AppError::NotFound(format!("running session {session_id}")))?;
            (session.process.clone(), session.tx.clone())
        };
        let _ = tx.send(event);
        process.send_input(&text).await?;

        let meta = if meta
            .name
            .as_ref()
            .is_some_and(|name| !name.trim().is_empty())
        {
            meta
        } else {
            self.store
                .update_meta(session_id, |meta| {
                    if meta
                        .name
                        .as_ref()
                        .is_some_and(|name| !name.trim().is_empty())
                    {
                        return Ok(());
                    }
                    meta.name = Some(generate_session_name(&text));
                    meta.updated_at = Utc::now();
                    Ok(())
                })
                .await?
        };
        self.session_info(meta).await
    }

    pub async fn stop_session(&self, session_id: Uuid) -> AppResult<()> {
        let _meta = self.load_active_meta(session_id).await?;
        self.stop_running_process(session_id).await?;
        self.update_status(session_id, SessionStatus::Stopped).await
    }

    pub async fn stop_and_remove_worktree(&self, session_id: Uuid) -> AppResult<()> {
        self.stop_session(session_id).await?;
        let meta = self.load_active_meta(session_id).await?;
        let worktree = meta.worktree.clone().ok_or_else(|| {
            AppError::InvalidRequest("session has no app-created worktree".to_string())
        })?;
        if !worktree.created_by_claude_remote_web {
            return Err(AppError::InvalidRequest(
                "session has no app-created worktree".to_string(),
            ));
        }
        self.worktree_manager.remove(&worktree).await?;
        self.store
            .update_meta(session_id, |meta| {
                meta.status = SessionStatus::Stopped;
                meta.cwd = worktree.source_cwd;
                meta.worktree = None;
                meta.updated_at = Utc::now();
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn restart_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let _meta = self.load_active_meta(session_id).await?;
        let _ = self.stop_running_process(session_id).await;
        self.update_status(session_id, SessionStatus::Stopped)
            .await?;
        self.resume_session(session_id).await
    }

    pub async fn resume_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let meta = self.load_active_meta(session_id).await?;
        self.reserve_starting(session_id).await?;
        let result = self.resume_reserved_session(meta).await;
        self.starting.lock().await.remove(&session_id);
        result
    }

    pub async fn archive_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let _meta = self.load_active_meta(session_id).await?;
        self.stop_running_process(session_id).await?;
        let meta = self
            .store
            .update_meta(session_id, |meta| {
                if meta.deleted_at.is_some() {
                    return Err(AppError::InvalidRequest(format!(
                        "session {session_id} is archived; unarchive it before continuing"
                    )));
                }
                let now = Utc::now();
                meta.deleted_at = Some(now);
                meta.status = SessionStatus::Stopped;
                meta.updated_at = now;
                Ok(())
            })
            .await?;
        self.session_info(meta).await
    }

    pub async fn delete_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let _meta = self.load_active_meta(session_id).await?;
        self.stop_running_process(session_id).await?;
        let meta = self
            .store
            .update_meta(session_id, |meta| {
                if meta.deleted_at.is_some() {
                    return Err(AppError::InvalidRequest(format!(
                        "session {session_id} is archived; unarchive it before continuing"
                    )));
                }
                let now = Utc::now();
                meta.deleted_at = Some(now);
                meta.status = SessionStatus::Stopped;
                meta.updated_at = now;
                Ok(())
            })
            .await?;
        self.session_info(meta).await
    }

    pub async fn unarchive_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let meta = self
            .store
            .update_meta(session_id, |meta| {
                if meta.deleted_at.is_none() {
                    return Err(AppError::InvalidRequest(format!(
                        "session {session_id} is not archived"
                    )));
                }
                meta.deleted_at = None;
                meta.updated_at = Utc::now();
                Ok(())
            })
            .await?;
        self.session_info(meta).await
    }

    pub async fn restore_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
        let meta = self
            .store
            .update_meta(session_id, |meta| {
                if meta.deleted_at.is_none() {
                    return Err(AppError::InvalidRequest(format!(
                        "session {session_id} is not archived"
                    )));
                }
                meta.deleted_at = None;
                meta.updated_at = Utc::now();
                Ok(())
            })
            .await?;
        self.session_info(meta).await
    }

    pub async fn permanently_delete_session(&self, session_id: Uuid) -> AppResult<()> {
        let meta = match self.store.load_meta(session_id).await {
            Ok(meta) => meta,
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if meta.deleted_at.is_none() {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} must be archived before deletion"
            )));
        }
        self.stop_running_process(session_id).await?;
        self.store.remove_archived_session_dir(session_id).await
    }

    pub async fn restore_active_sessions(&self) -> AppResult<()> {
        let sessions = self.store.list_meta(SessionListFilter::Active).await?;
        for meta in sessions {
            if !matches!(
                meta.status,
                SessionStatus::Running | SessionStatus::Starting
            ) {
                continue;
            }

            let session_id = meta.id;
            if let Err(err) = self.start_or_resume(meta).await {
                tracing::warn!(%session_id, error = %err, "failed to restore session");
                let _ = self.mark_restore_failed(session_id, err.to_string()).await;
            }
        }
        Ok(())
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
        let _meta = self.load_active_meta(session_id).await?;
        self.store.load_events_after(session_id, after_id).await
    }

    async fn stop_running_process(&self, session_id: Uuid) -> AppResult<()> {
        let running = self.running.lock().await.remove(&session_id);
        if let Some(session) = running {
            session.process.kill().await?;
        }
        Ok(())
    }

    async fn broadcast_event(&self, session_id: Uuid, event: UiEvent) -> AppResult<()> {
        let running = self.running.lock().await;
        if let Some(session) = running.get(&session_id) {
            let _ = session.tx.send(event);
        }
        Ok(())
    }

    async fn reserve_starting(&self, session_id: Uuid) -> AppResult<()> {
        let mut starting = self.starting.lock().await;
        let running = self.running.lock().await;
        if running.contains_key(&session_id) || starting.contains(&session_id) {
            return Err(AppError::InvalidRequest(format!(
                "session {session_id} is already running"
            )));
        }
        starting.insert(session_id);
        Ok(())
    }

    async fn resume_reserved_session(&self, meta: SessionMeta) -> AppResult<SessionInfo> {
        if matches!(
            meta.status,
            SessionStatus::Starting | SessionStatus::Running
        ) {
            return Err(AppError::InvalidRequest(format!(
                "session {} cannot be resumed from status {:?}",
                meta.id, meta.status
            )));
        }
        self.start_or_resume(meta).await
    }

    async fn start_or_resume(&self, mut meta: SessionMeta) -> AppResult<SessionInfo> {
        let resume = meta.claude_session_id.clone();
        meta = self
            .store
            .update_meta(meta.id, |latest| {
                if latest.deleted_at.is_some() {
                    return Err(AppError::InvalidRequest(format!(
                        "session {} is archived; unarchive it before continuing",
                        latest.id
                    )));
                }
                latest.status = SessionStatus::Starting;
                latest.updated_at = Utc::now();
                Ok(())
            })
            .await?;

        if resume.is_none() {
            let mut event = UiEvent::new(
                0,
                meta.id,
                EventKind::System,
                json!({ "message": "no claude session id found; started fresh" }),
            );
            self.store.append_event_with_next_id(&mut event).await?;
            let _ = self.broadcast_event(meta.id, event).await;
        }
        self.start_process(meta, resume).await
    }

    async fn mark_restore_failed(&self, session_id: Uuid, error: String) -> AppResult<()> {
        self.store
            .update_meta(session_id, |meta| {
                meta.status = SessionStatus::Failed;
                meta.updated_at = Utc::now();
                Ok(())
            })
            .await?;

        let mut event = UiEvent::new(
            0,
            session_id,
            EventKind::Error,
            json!({ "message": "failed to restore session", "error": error }),
        );
        self.store.append_event_with_next_id(&mut event).await
    }

    async fn start_process(
        &self,
        mut meta: SessionMeta,
        resume_session_id: Option<String>,
    ) -> AppResult<SessionInfo> {
        let starting_event_id = self.store.next_event_id(meta.id).await?;
        let (process, mut rx) = ClaudeProcess::spawn(
            meta.id,
            ClaudeProcessConfig {
                launcher: self.launcher.clone(),
                cwd: meta.cwd.clone(),
                permission_mode: meta.permission_mode.clone(),
                resume_session_id,
                starting_event_id,
            },
        )
        .await?;

        meta = match self
            .store
            .update_meta(meta.id, |latest| {
                if latest.deleted_at.is_some() || latest.status == SessionStatus::Stopped {
                    return Err(AppError::InvalidRequest(format!(
                        "session {} start was cancelled",
                        latest.id
                    )));
                }
                latest.status = SessionStatus::Running;
                latest.updated_at = Utc::now();
                Ok(())
            })
            .await
        {
            Ok(meta) => meta,
            Err(error) => {
                let _ = process.kill().await;
                return Err(error);
            }
        };

        let (tx, _) = broadcast::channel(256);
        {
            let mut running = self.running.lock().await;
            let latest = self.store.load_meta(meta.id).await?;
            if latest.deleted_at.is_some() || latest.status == SessionStatus::Stopped {
                process.kill().await?;
                return Err(AppError::InvalidRequest(format!(
                    "session {} start was cancelled",
                    latest.id
                )));
            }
            running.insert(
                meta.id,
                RunningSession {
                    process,
                    tx: tx.clone(),
                },
            );
        }

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
                        let mut ui_event =
                            UiEvent::new(0, session_id, EventKind::Error, json!({ "line": line }));
                        let _ = store.append_event_with_next_id(&mut ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::UiEvent(mut ui_event) => {
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
                        let _ = store.append_event_with_next_id(&mut ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                    ProcessEvent::Exited(_) => {
                        let _ = running.lock().await.remove(&session_id);
                        let _ = store
                            .update_meta(session_id, |meta| {
                                if meta.status != SessionStatus::Stopped {
                                    meta.status = SessionStatus::Exited;
                                    meta.updated_at = Utc::now();
                                }
                                Ok(())
                            })
                            .await;
                        let mut ui_event = UiEvent::new(
                            0,
                            session_id,
                            EventKind::System,
                            json!({ "status": "exited" }),
                        );
                        let _ = store.append_event_with_next_id(&mut ui_event).await;
                        let _ = tx.send(ui_event);
                    }
                }
            }
        });

        self.session_info(meta).await
    }

    async fn session_info(&self, meta: SessionMeta) -> AppResult<SessionInfo> {
        let events = self.store.load_events_after(meta.id, 0).await?;
        let runtime_status = runtime_status(&meta, &events);
        Ok(SessionInfo::new(meta, runtime_status))
    }

    async fn update_claude_session_id(
        store: &EventStore,
        session_id: Uuid,
        claude_session_id: String,
    ) -> AppResult<()> {
        store
            .update_claude_session_id(session_id, claude_session_id)
            .await
    }

    async fn update_status(&self, session_id: Uuid, status: SessionStatus) -> AppResult<()> {
        self.store
            .update_meta(session_id, |meta| {
                meta.status = status;
                meta.updated_at = Utc::now();
                Ok(())
            })
            .await?;
        Ok(())
    }
}

async fn worktree_session_cwd(
    requested_cwd: &std::path::Path,
    worktree: &WorktreeMeta,
) -> AppResult<PathBuf> {
    let requested_cwd = tokio::fs::canonicalize(requested_cwd).await?;
    let relative_cwd = requested_cwd
        .strip_prefix(&worktree.source_cwd)
        .map_err(|_| AppError::InvalidRequest("cwd is not inside source repository".to_string()))?;
    Ok(worktree.worktree_cwd.join(relative_cwd))
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

impl SessionInfo {
    fn new(meta: SessionMeta, runtime_status: SessionRuntimeStatus) -> Self {
        Self {
            id: meta.id,
            name: meta.name,
            cwd: meta.cwd,
            permission_mode: meta.permission_mode,
            status: meta.status,
            runtime_status,
            claude_session_id: meta.claude_session_id,
            worktree: meta.worktree,
            deleted_at: meta.deleted_at,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        }
    }
}

fn runtime_status(meta: &SessionMeta, events: &[UiEvent]) -> SessionRuntimeStatus {
    match meta.status {
        SessionStatus::Starting => SessionRuntimeStatus::Starting,
        SessionStatus::Exited => SessionRuntimeStatus::Ended,
        SessionStatus::Stopped => SessionRuntimeStatus::Stopped,
        SessionStatus::Failed => SessionRuntimeStatus::Failed,
        SessionStatus::Running => running_runtime_status(meta, events),
    }
}

fn running_runtime_status(meta: &SessionMeta, events: &[UiEvent]) -> SessionRuntimeStatus {
    let tasks = project_session_tasks(meta, events);
    if !tasks.background.is_empty() {
        return SessionRuntimeStatus::Running;
    }

    match events
        .iter()
        .rev()
        .find(|event| event.kind != EventKind::Raw && event.kind != EventKind::Error)
        .map(|event| &event.kind)
    {
        Some(EventKind::User) => SessionRuntimeStatus::Running,
        _ => SessionRuntimeStatus::Waiting,
    }
}

fn generate_session_name(text: &str) -> String {
    let normalized = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(is_title_boundary_punctuation)
        .to_string();
    if normalized.is_empty() {
        return "New chat".to_string();
    }

    let mut title = String::new();
    let mut has_cjk = false;
    let max_chars = if normalized.chars().any(is_cjk) {
        24
    } else {
        32
    };
    let mut word_count = 0;
    for character in normalized.chars() {
        has_cjk |= is_cjk(character);
        if character.is_whitespace() {
            word_count += 1;
            if word_count >= 5 {
                break;
            }
        }
        if title.chars().count() >= max_chars {
            break;
        }
        title.push(character);
    }

    let title = title
        .trim()
        .trim_matches(is_title_boundary_punctuation)
        .to_string();

    if title.is_empty() {
        "New chat".to_string()
    } else if !has_cjk && normalized.chars().count() > title.chars().count() {
        format!("{title}...")
    } else {
        title
    }
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

fn is_title_boundary_punctuation(character: char) -> bool {
    character.is_ascii_punctuation()
        || matches!(
            character as u32,
            0x3001
                | 0x3002
                | 0xFF0C
                | 0xFF1A
                | 0xFF1B
                | 0xFF01
                | 0xFF1F
                | 0x2018
                | 0x2019
                | 0x201C
                | 0x201D
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn worktree_config() -> crate::WorktreeConfig {
        crate::WorktreeConfig {
            worktrees_dir: None,
            branch_prefix: "pin".to_string(),
            base_ref: crate::WorktreeBaseRef::Head,
        }
    }

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join(format!("fake-claude-{}.sh", Uuid::new_v4()));
        fs::write(
            &path,
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  printf '{"type":"assistant","message":"ack"}\n'
  if [[ "$line" == *'"text":"exit"'* || "$line" == *'"text": "exit"'* ]]; then
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

    fn fake_claude_logging_args(dir: &std::path::Path, args_log: &std::path::Path) -> PathBuf {
        let path = dir.join(format!("fake-claude-logging-args-{}.sh", Uuid::new_v4()));
        fs::write(
            &path,
            format!(
                r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> '{}'
printf '{{"type":"system","session_id":"fake-session"}}\n'
while IFS= read -r line; do
  printf '{{"type":"assistant","message":"ack"}}\n'
  if [[ "$line" == *'"text":"exit"'* || "$line" == *'"text": "exit"'* ]]; then
    exit 0
  fi
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

    fn fake_claude_pid_loop(dir: &std::path::Path, pid_file: &std::path::Path) -> PathBuf {
        let path = dir.join(format!("fake-claude-pid-loop-{}.sh", Uuid::new_v4()));
        fs::write(
            &path,
            format!(
                r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$$" > '{}'
printf '{{"type":"system","session_id":"fake-session"}}\n'
while true; do
  sleep 60
done
"#,
                pid_file.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    async fn save_meta_with_status(
        store: &EventStore,
        cwd: PathBuf,
        status: SessionStatus,
        claude_session_id: Option<&str>,
    ) -> Uuid {
        let now = Utc::now();
        let id = Uuid::new_v4();
        store
            .save_meta(&SessionMeta {
                id,
                name: None,
                cwd,
                permission_mode: "acceptEdits".to_string(),
                status,
                claude_session_id: claude_session_id.map(str::to_string),
                worktree: None,
                deleted_at: None,
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        id
    }

    async fn wait_for_event_kind(
        store: &EventStore,
        session_id: Uuid,
        kind: EventKind,
    ) -> Vec<UiEvent> {
        wait_for_events(store, session_id, |events| {
            events.iter().any(|event| event.kind == kind)
        })
        .await
    }

    async fn wait_for_events<F>(store: &EventStore, session_id: Uuid, predicate: F) -> Vec<UiEvent>
    where
        F: Fn(&[UiEvent]) -> bool,
    {
        for _ in 0..250 {
            let events = store.load_events_after(session_id, 0).await.unwrap();
            if predicate(&events) {
                return events;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        store.load_events_after(session_id, 0).await.unwrap()
    }

    async fn wait_for_events_after<F>(
        store: &EventStore,
        session_id: Uuid,
        after_id: u64,
        predicate: F,
    ) -> Vec<UiEvent>
    where
        F: Fn(&[UiEvent]) -> bool,
    {
        for _ in 0..250 {
            let events = store.load_events_after(session_id, after_id).await.unwrap();
            if predicate(&events) {
                return events;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        store.load_events_after(session_id, after_id).await.unwrap()
    }

    async fn wait_for_claude_session_id(
        store: &EventStore,
        session_id: Uuid,
        expected: &str,
    ) -> SessionMeta {
        for _ in 0..250 {
            let meta = store.load_meta(session_id).await.unwrap();
            if meta.claude_session_id.as_deref() == Some(expected) {
                return meta;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        store.load_meta(session_id).await.unwrap()
    }

    async fn wait_for_file_contents<F>(path: &std::path::Path, predicate: F) -> Option<String>
    where
        F: Fn(&str) -> bool,
    {
        for _ in 0..250 {
            if let Ok(contents) = fs::read_to_string(path)
                && predicate(&contents)
            {
                return Some(contents);
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        fs::read_to_string(path).ok()
    }

    async fn read_pid_file(path: &std::path::Path) -> Option<u32> {
        for _ in 0..100 {
            if let Ok(content) = fs::read_to_string(path)
                && let Ok(pid) = content.trim().parse()
            {
                return Some(pid);
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        None
    }

    fn process_is_alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    async fn wait_until_process_exits(pid: u32) -> bool {
        for _ in 0..100 {
            if !process_is_alive(pid) {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        false
    }

    fn git(root: &std::path::Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    async fn init_repo(root: &std::path::Path) {
        fs::create_dir_all(root).unwrap();
        git(root, &["init", "-b", "master"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test User"]);
        fs::write(root.join("README.md"), "hello\n").unwrap();
        git(root, &["add", "README.md"]);
        git(root, &["commit", "-m", "initial"]);
    }

    fn test_event(
        id: u64,
        session_id: Uuid,
        kind: EventKind,
        payload: serde_json::Value,
    ) -> UiEvent {
        UiEvent::new(id, session_id, kind, payload)
    }

    #[test]
    fn runtime_status_maps_ended_lifecycle() {
        let temp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let meta = SessionMeta {
            id: Uuid::new_v4(),
            name: None,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Exited,
            claude_session_id: None,
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };

        assert_eq!(runtime_status(&meta, &[]), SessionRuntimeStatus::Ended);
    }

    #[test]
    fn runtime_status_waits_when_running_without_pending_work() {
        let session_id = Uuid::new_v4();
        let temp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let meta = SessionMeta {
            id: session_id,
            name: None,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: None,
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        let events = vec![test_event(
            1,
            session_id,
            EventKind::Assistant,
            json!({ "type": "assistant", "message": "done" }),
        )];

        assert_eq!(
            runtime_status(&meta, &events),
            SessionRuntimeStatus::Waiting
        );
    }

    #[test]
    fn runtime_status_runs_after_latest_user_event() {
        let session_id = Uuid::new_v4();
        let temp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let meta = SessionMeta {
            id: session_id,
            name: None,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: None,
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        let events = vec![test_event(
            1,
            session_id,
            EventKind::User,
            json!({ "text": "please work" }),
        )];

        assert_eq!(
            runtime_status(&meta, &events),
            SessionRuntimeStatus::Running
        );
    }

    #[test]
    fn runtime_status_runs_with_background_task() {
        let session_id = Uuid::new_v4();
        let temp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let meta = SessionMeta {
            id: session_id,
            name: None,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Running,
            claude_session_id: None,
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        let events = vec![test_event(
            1,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Bash",
                "input": { "command": "sleep 10", "run_in_background": true }
            }),
        )];

        assert_eq!(
            runtime_status(&meta, &events),
            SessionRuntimeStatus::Running
        );
    }

    #[tokio::test]
    async fn creates_worktree_session_and_uses_worktree_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: repo.clone(),
                name: None,
                permission_mode: None,
                worktree: Some(WorktreeRequest { enabled: true }),
            })
            .await
            .unwrap();

        let worktree = created.worktree.unwrap();
        assert_eq!(worktree.source_cwd, repo.canonicalize().unwrap());
        assert_eq!(created.cwd, worktree.worktree_cwd);
        assert!(created.cwd.exists());
        assert!(worktree.branch.starts_with("pin/"));
    }

    #[tokio::test]
    async fn worktree_session_preserves_requested_repo_subdirectory_as_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        fs::create_dir_all(repo.join("packages/api")).unwrap();
        fs::write(repo.join("packages/api/lib.rs"), "pub fn api() {}\n").unwrap();
        git(&repo, &["add", "packages/api/lib.rs"]);
        git(&repo, &["commit", "-m", "add api package"]);
        let requested_cwd = repo.join("packages/api");
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: requested_cwd,
                name: None,
                permission_mode: None,
                worktree: Some(WorktreeRequest { enabled: true }),
            })
            .await
            .unwrap();

        let worktree = created.worktree.as_ref().unwrap();
        assert_eq!(worktree.source_cwd, repo.canonicalize().unwrap());
        assert_eq!(created.cwd, worktree.worktree_cwd.join("packages/api"));
        assert!(created.cwd.exists());
    }

    #[tokio::test]
    async fn failed_worktree_session_start_removes_worktree_and_marks_failed() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![
                temp.path()
                    .join("missing-claude")
                    .to_string_lossy()
                    .to_string(),
            ],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let result = manager
            .create_session(CreateSessionRequest {
                cwd: repo.clone(),
                name: None,
                permission_mode: None,
                worktree: Some(WorktreeRequest { enabled: true }),
            })
            .await;

        assert!(result.is_err());
        let sessions = store.list_meta(SessionListFilter::All).await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, SessionStatus::Failed);
        assert_eq!(sessions[0].cwd, repo.canonicalize().unwrap());
        assert_eq!(sessions[0].worktree, None);
        let output = std::process::Command::new("git")
            .current_dir(&repo)
            .args(["worktree", "list", "--porcelain"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let worktrees = String::from_utf8_lossy(&output.stdout);
        assert!(!worktrees.contains(".claude/worktrees"));
    }

    #[tokio::test]
    async fn stop_and_remove_deletes_clean_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        init_repo(&repo).await;
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: repo.clone(),
                name: None,
                permission_mode: None,
                worktree: Some(WorktreeRequest { enabled: true }),
            })
            .await
            .unwrap();
        let worktree_path = session.worktree.as_ref().unwrap().worktree_cwd.clone();

        manager.stop_and_remove_worktree(session.id).await.unwrap();

        assert!(!worktree_path.exists());
        let loaded = store.load_meta(session.id).await.unwrap();
        assert_eq!(loaded.status, SessionStatus::Stopped);
        assert_eq!(loaded.cwd, repo.canonicalize().unwrap());
        assert_eq!(loaded.worktree, None);
    }

    #[tokio::test]
    async fn start_process_kills_spawned_process_when_running_meta_save_fails() {
        let temp = tempfile::tempdir().unwrap();
        let pid_file = temp.path().join("fake-claude.pid");
        let bin = fake_claude_pid_loop(temp.path(), &pid_file);
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let now = Utc::now();
        let meta = SessionMeta {
            id: Uuid::new_v4(),
            name: None,
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Starting,
            claude_session_id: None,
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store.save_meta(&meta).await.unwrap();
        let meta_path = store
            .root()
            .join("sessions")
            .join(meta.id.to_string())
            .join("meta.json");
        fs::remove_file(&meta_path).unwrap();
        fs::create_dir(&meta_path).unwrap();

        let result = manager.start_process(meta, None).await;

        assert!(result.is_err());
        if let Some(pid) = read_pid_file(&pid_file).await {
            let exited = wait_until_process_exits(pid).await;
            if !exited {
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
            assert!(
                exited,
                "spawned process should be killed after save_meta failure"
            );
        }
    }

    #[tokio::test]
    async fn disabled_worktree_request_keeps_original_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: Some(WorktreeRequest { enabled: false }),
            })
            .await
            .unwrap();

        assert_eq!(created.cwd, temp.path());
        assert_eq!(created.worktree, None);
    }

    #[tokio::test]
    async fn rejects_missing_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
            vec!["claude".to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let result = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().join("missing"),
                name: None,
                permission_mode: None,
                worktree: None,
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
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: PathBuf::from("~"),
                name: Some("home".to_string()),
                permission_mode: None,
                worktree: None,
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
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("demo".to_string()),
                permission_mode: None,
                worktree: None,
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
        wait_for_event_kind(&store, created.id, EventKind::System).await;
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
            worktree_config(),
        );

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
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
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();

        let loaded = wait_for_claude_session_id(&store, session.id, "fake-session").await;
        assert_eq!(loaded.claude_session_id, Some("fake-session".to_string()));
    }

    #[tokio::test]
    async fn restart_process_events_continue_after_existing_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        wait_for_claude_session_id(&store, session.id, "fake-session").await;
        manager.stop_session(session.id).await.unwrap();
        let before_resume_max_id = store
            .load_events_after(session.id, 0)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .max()
            .unwrap();

        manager.resume_session(session.id).await.unwrap();
        let events = wait_for_events_after(&store, session.id, before_resume_max_id, |events| {
            events.iter().any(|event| event.kind == EventKind::System)
        })
        .await;
        assert!(events.iter().any(|event| event.kind == EventKind::System));
        assert!(events.iter().all(|event| event.id > before_resume_max_id));
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
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        wait_for_claude_session_id(&store, session.id, "fake-session").await;

        let mut meta = store.load_meta(session.id).await.unwrap();
        meta.claude_session_id = None;
        store.save_meta(&meta).await.unwrap();

        manager.restart_session(session.id).await.unwrap();

        let events = wait_for_events(&store, session.id, |events| {
            events.iter().any(|event| {
                event
                    .payload
                    .to_string()
                    .contains("no claude session id found")
            })
        })
        .await;
        assert!(events.iter().any(|event| {
            event
                .payload
                .to_string()
                .contains("no claude session id found")
        }));
    }

    #[tokio::test]
    async fn restore_active_sessions_restarts_only_starting_and_running_active_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let args_log = temp.path().join("args.log");
        let bin = fake_claude_logging_args(temp.path(), &args_log);
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let running_id = save_meta_with_status(
            &store,
            temp.path().to_path_buf(),
            SessionStatus::Running,
            Some("running-resume"),
        )
        .await;
        let starting_id = save_meta_with_status(
            &store,
            temp.path().to_path_buf(),
            SessionStatus::Starting,
            None,
        )
        .await;
        let stopped_id = save_meta_with_status(
            &store,
            temp.path().to_path_buf(),
            SessionStatus::Stopped,
            Some("stopped-resume"),
        )
        .await;
        let deleted_id = save_meta_with_status(
            &store,
            temp.path().to_path_buf(),
            SessionStatus::Running,
            Some("deleted-resume"),
        )
        .await;
        store
            .update_meta(deleted_id, |meta| {
                meta.deleted_at = Some(Utc::now());
                Ok(())
            })
            .await
            .unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        manager.restore_active_sessions().await.unwrap();

        let running = manager.running.lock().await;
        assert!(running.contains_key(&running_id));
        assert!(running.contains_key(&starting_id));
        assert!(!running.contains_key(&stopped_id));
        assert!(!running.contains_key(&deleted_id));
        drop(running);

        let args = wait_for_file_contents(&args_log, |args| {
            args.lines()
                .any(|line| line.contains("--resume running-resume"))
        })
        .await
        .unwrap();
        assert!(args.contains("--resume running-resume"));
        assert!(!args.contains("stopped-resume"));
        assert!(!args.contains("deleted-resume"));

        manager.stop_session(running_id).await.unwrap();
        manager.stop_session(starting_id).await.unwrap();
    }

    #[tokio::test]
    async fn restore_active_sessions_marks_failed_session_and_continues() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let good_id = save_meta_with_status(
            &store,
            temp.path().to_path_buf(),
            SessionStatus::Running,
            Some("good-resume"),
        )
        .await;
        let failed_id = save_meta_with_status(
            &store,
            temp.path().join("missing"),
            SessionStatus::Running,
            Some("failed-resume"),
        )
        .await;
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        manager.restore_active_sessions().await.unwrap();

        let running = manager.running.lock().await;
        assert!(running.contains_key(&good_id));
        assert!(!running.contains_key(&failed_id));
        drop(running);
        assert_eq!(
            store.load_meta(failed_id).await.unwrap().status,
            SessionStatus::Failed
        );
        let events = store.load_events_after(failed_id, 0).await.unwrap();
        assert!(events.iter().any(|event| {
            event
                .payload
                .to_string()
                .contains("failed to restore session")
        }));

        manager.stop_session(good_id).await.unwrap();
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
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();

        manager
            .send_input(session.id, "hello".to_string())
            .await
            .unwrap();

        assert_eq!(
            store.load_meta(session.id).await.unwrap().name,
            Some("hello".to_string())
        );
        let events = wait_for_event_kind(&store, session.id, EventKind::Assistant).await;
        assert!(events.iter().any(|event| event.kind == EventKind::User));
        assert!(
            events
                .iter()
                .any(|event| event.kind == EventKind::Assistant)
        );
    }

    #[tokio::test]
    async fn first_input_generates_short_session_name() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();

        let updated = manager
            .send_input(
                session.id,
                "Now refactor the startup flow so new chats receive automatic names".to_string(),
            )
            .await
            .unwrap();

        assert_eq!(
            updated.name,
            Some("Now refactor the startup flow...".to_string())
        );
        assert_eq!(
            store.load_meta(session.id).await.unwrap().name,
            Some("Now refactor the startup flow...".to_string())
        );

        manager
            .send_input(session.id, "do not rename this".to_string())
            .await
            .unwrap();
        assert_eq!(
            store.load_meta(session.id).await.unwrap().name,
            Some("Now refactor the startup flow...".to_string())
        );
    }

    #[test]
    fn generated_session_names_handle_cjk_text() {
        assert_eq!(
            generate_session_name("现在new chat都是让用户手动输入一个名字。改成不需要用户输入名字"),
            "现在new chat都是让用户手动输入一个名字"
        );
    }

    #[tokio::test]
    async fn runtime_user_and_process_event_ids_do_not_collide() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );

        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        wait_for_claude_session_id(&store, session.id, "fake-session").await;

        manager
            .send_input(session.id, "hello".to_string())
            .await
            .unwrap();

        let events = wait_for_event_kind(&store, session.id, EventKind::Assistant).await;
        let mut ids = HashSet::new();
        for event in events {
            assert!(ids.insert(event.id), "duplicate event id {}", event.id);
        }
    }

    #[tokio::test]
    async fn archive_hides_session_and_unarchive_shows_it_again() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: Some("archive me".to_string()),
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();

        let archived = manager.archive_session(session.id).await.unwrap();
        assert!(archived.deleted_at.is_some());
        assert_eq!(archived.status, SessionStatus::Stopped);
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

        let unarchived = manager.unarchive_session(session.id).await.unwrap();
        assert_eq!(unarchived.deleted_at, None);
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
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
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
        manager
            .permanently_delete_session(session.id)
            .await
            .unwrap();
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
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
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
        assert!(matches!(
            manager.stop_session(session.id).await,
            Err(AppError::InvalidRequest(_))
        ));
        assert!(matches!(
            manager.events_after(session.id, 0).await,
            Err(AppError::InvalidRequest(_))
        ));
        assert!(matches!(
            manager.tasks_for_session(session.id).await,
            Err(AppError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn concurrent_resume_allows_only_one_starter() {
        let temp = tempfile::tempdir().unwrap();
        let starts_log = temp.path().join("starts.log");
        let wrapper = temp.path().join("slow-wrapper.sh");
        fs::write(
            &wrapper,
            format!(
                "#!/usr/bin/env bash\nprintf 'start\\n' >> '{}'\nsleep 0.2\nprintf '{{\"type\":\"system\",\"session_id\":\"slow-session\"}}\\n'\nwhile IFS= read -r line; do sleep 10; done\n",
                starts_log.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store,
            vec![wrapper.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        manager.stop_session(session.id).await.unwrap();

        let (first, second) = tokio::join!(
            manager.resume_session(session.id),
            manager.resume_session(session.id)
        );
        let successes = [&first, &second]
            .iter()
            .filter(|result| result.is_ok())
            .count();
        let invalid_requests = [&first, &second]
            .iter()
            .filter(|result| matches!(result, Err(AppError::InvalidRequest(_))))
            .count();

        assert_eq!(successes, 1);
        assert_eq!(invalid_requests, 1);
        manager.stop_session(session.id).await.unwrap();
    }

    #[tokio::test]
    async fn archive_during_starting_reservation_prevents_late_running_resurrection() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let session_id = Uuid::new_v4();
        let now = Utc::now();
        let starting_meta = SessionMeta {
            id: session_id,
            name: Some("slow".to_string()),
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Starting,
            claude_session_id: Some("resume-me".to_string()),
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store.save_meta(&starting_meta).await.unwrap();

        let archived = manager.archive_session(session_id).await.unwrap();
        let resume_result = manager
            .start_process(starting_meta, Some("resume-me".to_string()))
            .await;
        let final_meta = store.load_meta(session_id).await.unwrap();

        assert!(archived.deleted_at.is_some());
        assert!(matches!(resume_result, Err(AppError::InvalidRequest(_))));
        assert!(final_meta.deleted_at.is_some());
        assert_eq!(final_meta.status, SessionStatus::Stopped);
        assert!(manager.subscribe(session_id).await.is_err());
    }

    #[tokio::test]
    async fn stop_during_starting_reservation_prevents_late_running_resurrection() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let store = EventStore::new(temp.path().join("data")).await.unwrap();
        let manager = SessionManager::new(
            store.clone(),
            vec![bin.to_string_lossy().to_string()],
            "acceptEdits".to_string(),
            worktree_config(),
        );
        let session_id = Uuid::new_v4();
        let now = Utc::now();
        let starting_meta = SessionMeta {
            id: session_id,
            name: Some("slow".to_string()),
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            status: SessionStatus::Starting,
            claude_session_id: Some("resume-me".to_string()),
            worktree: None,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store.save_meta(&starting_meta).await.unwrap();

        manager.stop_session(session_id).await.unwrap();
        let resume_result = manager
            .start_process(starting_meta, Some("resume-me".to_string()))
            .await;
        let final_meta = store.load_meta(session_id).await.unwrap();

        assert!(matches!(resume_result, Err(AppError::InvalidRequest(_))));
        assert_eq!(final_meta.status, SessionStatus::Stopped);
        assert!(manager.subscribe(session_id).await.is_err());
    }

    #[tokio::test]
    async fn resume_uses_persisted_claude_session_id() {
        let temp = tempfile::tempdir().unwrap();
        let args_log = temp.path().join("args.log");
        let wrapper = temp.path().join("fake-wrapper.sh");
        fs::write(
            &wrapper,
            format!(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{}'\nprintf '{{\"type\":\"system\",\"session_id\":\"resumed\"}}\\n'\nwhile IFS= read -r line; do exit 0; done\n",
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
            worktree_config(),
        );
        let session = manager
            .create_session(CreateSessionRequest {
                cwd: temp.path().to_path_buf(),
                name: None,
                permission_mode: None,
                worktree: None,
            })
            .await
            .unwrap();
        manager.stop_session(session.id).await.unwrap();
        let mut meta = store.load_meta(session.id).await.unwrap();
        meta.claude_session_id = Some("resume-me".to_string());
        store.save_meta(&meta).await.unwrap();

        manager.resume_session(session.id).await.unwrap();
        let args = wait_for_file_contents(&args_log, |contents| {
            contents
                .lines()
                .any(|line| line.contains("--resume resume-me"))
        })
        .await
        .unwrap_or_default();

        assert!(args.contains("--resume resume-me"));
    }
}
