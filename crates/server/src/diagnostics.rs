use crate::{AppResult, ConfigStore, EventKind, EventStore, SessionMeta, SessionStatus, UiEvent};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

const RECENT_FAILURE_LIMIT: usize = 8;
const RECENT_EVENT_LIMIT: usize = 6;
const RECENT_STDERR_LIMIT: usize = 8;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticStatus {
    Healthy,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResponse {
    pub status: DiagnosticStatus,
    pub config: ConfigDiagnostics,
    pub launcher: LauncherDiagnostics,
    pub web_dir: PathDiagnostics,
    pub data_dir: PathDiagnostics,
    pub recent_session_failures: Vec<SessionFailureSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiagnostics {
    pub config_path: PathBuf,
    pub config_file_exists: bool,
    pub restart_required: bool,
    pub bind: String,
    pub default_permission_mode: String,
    pub worktrees_dir: Option<String>,
    pub worktree_branch_prefix: String,
    pub worktree_base_ref: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherDiagnostics {
    pub argv: Vec<String>,
    pub native_args_preview: Vec<String>,
    pub full_argv_preview: Vec<String>,
    pub status: DiagnosticStatus,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathDiagnostics {
    pub status: DiagnosticStatus,
    pub path: Option<PathBuf>,
    pub mode: Option<String>,
    pub exists: bool,
    pub is_directory: bool,
    pub writable: Option<bool>,
    pub has_index_html: Option<bool>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFailureSummary {
    pub session_id: Uuid,
    pub session_name: Option<String>,
    pub cwd: PathBuf,
    pub status: SessionStatus,
    pub updated_at: DateTime<Utc>,
    pub message: String,
    pub stderr: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiagnosticsResponse {
    pub session: SessionDiagnosticMeta,
    pub status: DiagnosticStatus,
    pub summary: String,
    pub recent_stderr: Vec<String>,
    pub recent_errors: Vec<DiagnosticEventSummary>,
    pub recent_system_events: Vec<DiagnosticEventSummary>,
    pub guidance: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiagnosticMeta {
    pub id: Uuid,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub status: SessionStatus,
    pub permission_mode: String,
    pub claude_session_id_present: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEventSummary {
    pub id: u64,
    pub time: DateTime<Utc>,
    pub kind: EventKind,
    pub message: String,
}

pub async fn diagnostics(
    config_store: &ConfigStore,
    event_store: &EventStore,
) -> AppResult<DiagnosticsResponse> {
    let managed_config = config_store.get().await?;
    let current = &managed_config.current;
    let launcher = launcher_diagnostics(&current.launcher, &current.default_permission_mode);
    let web_dir = web_dir_diagnostics(current.web_dir.as_deref()).await?;
    let data_dir = data_dir_diagnostics(Path::new(&current.data_dir)).await?;
    let recent_session_failures = recent_session_failures(event_store).await?;

    let status = combine_status([
        launcher.status.clone(),
        web_dir.status.clone(),
        data_dir.status.clone(),
        if recent_session_failures.is_empty() {
            DiagnosticStatus::Healthy
        } else {
            DiagnosticStatus::Warning
        },
    ]);

    Ok(DiagnosticsResponse {
        status,
        config: ConfigDiagnostics {
            config_path: managed_config.path,
            config_file_exists: managed_config.exists,
            restart_required: managed_config.restart_required,
            bind: current.bind.clone(),
            default_permission_mode: current.default_permission_mode.clone(),
            worktrees_dir: current.worktrees_dir.clone(),
            worktree_branch_prefix: current.worktree_branch_prefix.clone(),
            worktree_base_ref: match current.worktree_base_ref {
                crate::WorktreeBaseRef::Fresh => "fresh".to_string(),
                crate::WorktreeBaseRef::Head => "head".to_string(),
            },
        },
        launcher,
        web_dir,
        data_dir,
        recent_session_failures,
    })
}

pub async fn session_diagnostics(
    event_store: &EventStore,
    session_id: Uuid,
) -> AppResult<SessionDiagnosticsResponse> {
    let meta = event_store.load_meta(session_id).await?;
    let events = event_store.load_events_after(session_id, 0).await?;
    let stderr = sanitized_lines(
        event_store
            .load_stderr_tail(session_id, RECENT_STDERR_LIMIT)
            .await?,
    );
    let recent_errors = recent_events(&events, EventKind::Error);
    let recent_system_events = recent_events(&events, EventKind::System);

    let status = if meta.status == SessionStatus::Failed {
        DiagnosticStatus::Error
    } else if !stderr.is_empty() || !recent_errors.is_empty() {
        DiagnosticStatus::Warning
    } else {
        DiagnosticStatus::Healthy
    };
    let summary = session_summary(&meta, &stderr, &recent_errors, &recent_system_events);
    let guidance = session_guidance(&meta, &stderr, &recent_errors, &recent_system_events);

    Ok(SessionDiagnosticsResponse {
        session: SessionDiagnosticMeta {
            id: meta.id,
            name: meta.name,
            cwd: meta.cwd,
            status: meta.status,
            permission_mode: meta.permission_mode,
            claude_session_id_present: meta.claude_session_id.is_some(),
            updated_at: meta.updated_at,
        },
        status,
        summary,
        recent_stderr: stderr,
        recent_errors,
        recent_system_events,
        guidance,
    })
}

pub fn sanitize_diagnostic_text(value: &str) -> String {
    let mut redacted = Vec::new();
    let mut redact_next = false;

    for token in value.split_whitespace() {
        if redact_next {
            redacted.push("<redacted>".to_string());
            redact_next = false;
            continue;
        }
        if token.eq_ignore_ascii_case("bearer") {
            redacted.push("Bearer".to_string());
            redact_next = true;
            continue;
        }
        if is_sensitive_flag(token) {
            redacted.push(token.to_string());
            redact_next = true;
            continue;
        }
        redacted.push(redact_assignment(token));
    }

    truncate_for_display(&redacted.join(" "), 600)
}

pub fn sanitize_argv(argv: &[String]) -> Vec<String> {
    let mut result = Vec::with_capacity(argv.len());
    let mut redact_next = false;
    for arg in argv {
        if redact_next {
            result.push("<redacted>".to_string());
            redact_next = false;
            continue;
        }
        if is_sensitive_flag(arg) {
            result.push(arg.clone());
            redact_next = true;
            continue;
        }
        result.push(redact_assignment(arg));
    }
    result
}

pub fn native_args_preview(permission_mode: &str) -> Vec<String> {
    vec![
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--permission-mode".to_string(),
        permission_mode.to_string(),
        "--verbose".to_string(),
    ]
}

fn launcher_diagnostics(launcher: &[String], permission_mode: &str) -> LauncherDiagnostics {
    let argv = sanitize_argv(launcher);
    let native_args_preview = native_args_preview(permission_mode);
    let mut full_argv_preview = argv.clone();
    full_argv_preview.extend(native_args_preview.clone());

    let mut issues = Vec::new();
    if launcher.is_empty() {
        issues.push("Launcher is empty; configure at least one argv value.".to_string());
    } else if launcher.iter().any(|value| value.trim().is_empty()) {
        issues.push("Launcher contains an empty argv value.".to_string());
    }

    let status = if issues.is_empty() {
        DiagnosticStatus::Healthy
    } else {
        DiagnosticStatus::Error
    };

    LauncherDiagnostics {
        argv,
        native_args_preview,
        full_argv_preview,
        status,
        issues,
    }
}

async fn web_dir_diagnostics(web_dir: Option<&str>) -> AppResult<PathDiagnostics> {
    let Some(web_dir) = web_dir.filter(|value| !value.trim().is_empty()) else {
        return Ok(PathDiagnostics {
            status: DiagnosticStatus::Healthy,
            path: None,
            mode: Some("embedded".to_string()),
            exists: true,
            is_directory: true,
            writable: None,
            has_index_html: Some(true),
            message: "Using embedded web assets.".to_string(),
        });
    };

    let path = PathBuf::from(web_dir);
    let exists = fs::try_exists(&path).await?;
    let metadata = if exists {
        Some(fs::metadata(&path).await?)
    } else {
        None
    };
    let is_directory = metadata.as_ref().is_some_and(|metadata| metadata.is_dir());
    let index_path = path.join("index.html");
    let has_index_html = if is_directory {
        fs::try_exists(index_path).await?
    } else {
        false
    };
    let status = if exists && is_directory && has_index_html {
        DiagnosticStatus::Healthy
    } else {
        DiagnosticStatus::Error
    };
    let message = if !exists {
        "Configured web_dir does not exist.".to_string()
    } else if !is_directory {
        "Configured web_dir is not a directory.".to_string()
    } else if !has_index_html {
        "Configured web_dir exists but does not look built; index.html is missing.".to_string()
    } else {
        "Configured web_dir exists and contains index.html.".to_string()
    };

    Ok(PathDiagnostics {
        status,
        path: Some(path),
        mode: Some("external".to_string()),
        exists,
        is_directory,
        writable: None,
        has_index_html: Some(has_index_html),
        message,
    })
}

async fn data_dir_diagnostics(path: &Path) -> AppResult<PathDiagnostics> {
    let exists = fs::try_exists(path).await?;
    let metadata = if exists {
        Some(fs::metadata(path).await?)
    } else {
        None
    };
    let is_directory = metadata.as_ref().is_some_and(|metadata| metadata.is_dir());
    let writable = if is_directory {
        Some(check_writable(path).await)
    } else {
        Some(false)
    };
    let status = if exists && is_directory && writable == Some(true) {
        DiagnosticStatus::Healthy
    } else {
        DiagnosticStatus::Error
    };
    let message = if !exists {
        "Data directory does not exist.".to_string()
    } else if !is_directory {
        "Data directory path is not a directory.".to_string()
    } else if writable != Some(true) {
        "Data directory is not writable by the daemon process.".to_string()
    } else {
        "Data directory exists and is writable.".to_string()
    };

    Ok(PathDiagnostics {
        status,
        path: Some(path.to_path_buf()),
        mode: Some("data".to_string()),
        exists,
        is_directory,
        writable,
        has_index_html: None,
        message,
    })
}

async fn check_writable(path: &Path) -> bool {
    let probe = path.join(format!(".diagnostics-write-{}", Uuid::new_v4()));
    match fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .await
    {
        Ok(_) => {
            let _ = fs::remove_file(probe).await;
            true
        }
        Err(_) => false,
    }
}

async fn recent_session_failures(
    event_store: &EventStore,
) -> AppResult<Vec<SessionFailureSummary>> {
    let mut metas = event_store.list_meta(crate::SessionListFilter::All).await?;
    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut failures = Vec::new();

    for meta in metas {
        if failures.len() >= RECENT_FAILURE_LIMIT {
            break;
        }
        let events = event_store.load_events_after(meta.id, 0).await?;
        let stderr = sanitized_lines(event_store.load_stderr_tail(meta.id, 3).await?);
        let error_event = events
            .iter()
            .rev()
            .find(|event| event.kind == EventKind::Error);
        let is_failure = meta.status == SessionStatus::Failed
            || error_event.is_some()
            || (!stderr.is_empty()
                && matches!(meta.status, SessionStatus::Exited | SessionStatus::Stopped));

        if !is_failure {
            continue;
        }

        failures.push(SessionFailureSummary {
            session_id: meta.id,
            session_name: meta.name,
            cwd: meta.cwd,
            status: meta.status,
            updated_at: meta.updated_at,
            message: error_event.map(event_message).unwrap_or_else(|| {
                "Session has recent stderr or failed startup state.".to_string()
            }),
            stderr,
        });
    }

    Ok(failures)
}

fn recent_events(events: &[UiEvent], kind: EventKind) -> Vec<DiagnosticEventSummary> {
    events
        .iter()
        .rev()
        .filter(|event| event.kind == kind)
        .take(RECENT_EVENT_LIMIT)
        .map(|event| DiagnosticEventSummary {
            id: event.id,
            time: event.time,
            kind: event.kind.clone(),
            message: event_message(event),
        })
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn event_message(event: &UiEvent) -> String {
    let payload = &event.payload;
    let message = payload
        .get("message")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("error").and_then(|value| value.as_str()))
        .or_else(|| payload.get("line").and_then(|value| value.as_str()))
        .map(ToString::to_string)
        .unwrap_or_else(|| payload.to_string());
    sanitize_diagnostic_text(&message)
}

fn session_summary(
    meta: &SessionMeta,
    stderr: &[String],
    errors: &[DiagnosticEventSummary],
    system_events: &[DiagnosticEventSummary],
) -> String {
    if meta.status == SessionStatus::Failed {
        return "Claude process startup or resume failed.".to_string();
    }
    if let Some(error) = errors.last() {
        return error.message.clone();
    }
    if let Some(line) = stderr.last() {
        return line.clone();
    }
    if let Some(system) = system_events.last() {
        return system.message.clone();
    }
    "No recent process errors recorded for this session.".to_string()
}

fn session_guidance(
    meta: &SessionMeta,
    stderr: &[String],
    errors: &[DiagnosticEventSummary],
    system_events: &[DiagnosticEventSummary],
) -> Vec<String> {
    let mut guidance = Vec::new();
    let combined = stderr
        .iter()
        .chain(errors.iter().map(|event| &event.message))
        .chain(system_events.iter().map(|event| &event.message))
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("\n");

    if meta.status == SessionStatus::Failed {
        guidance
            .push("Check that the launcher argv points to an installed executable.".to_string());
    }
    if combined.contains("permission denied") || combined.contains("eacces") {
        guidance.push(
            "Fix filesystem permissions for the launcher, cwd, or data directory.".to_string(),
        );
    }
    if combined.contains("no such file") || combined.contains("not found") {
        guidance.push(
            "Verify the configured launcher path and the session working directory.".to_string(),
        );
    }
    if combined.contains("resume") || combined.contains("session id") {
        guidance.push(
            "Try restarting fresh if the saved Claude session id is no longer valid.".to_string(),
        );
    }
    if guidance.is_empty() {
        guidance.push("Review recent stderr and system events, then restart the session after correcting the cause.".to_string());
    }
    guidance
}

fn sanitized_lines(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| sanitize_diagnostic_text(&line))
        .filter(|line| !line.trim().is_empty())
        .collect()
}

fn combine_status(statuses: impl IntoIterator<Item = DiagnosticStatus>) -> DiagnosticStatus {
    let mut result = DiagnosticStatus::Healthy;
    for status in statuses {
        match status {
            DiagnosticStatus::Error => return DiagnosticStatus::Error,
            DiagnosticStatus::Warning => result = DiagnosticStatus::Warning,
            DiagnosticStatus::Healthy => {}
        }
    }
    result
}

fn is_sensitive_flag(value: &str) -> bool {
    let stripped = value.trim_start_matches('-');
    if stripped.contains('=') || stripped.contains(':') {
        return false;
    }
    let normalized = normalize_key(stripped);
    matches_sensitive_key(&normalized)
}

fn redact_assignment(token: &str) -> String {
    for separator in ['=', ':'] {
        if let Some((key, value)) = token.split_once(separator) {
            if !value.is_empty()
                && matches_sensitive_key(&normalize_key(key.trim_start_matches('-')))
            {
                return format!("{key}{separator}<redacted>");
            }
        }
    }
    token.to_string()
}

fn matches_sensitive_key(key: &str) -> bool {
    key.contains("token")
        || key.contains("password")
        || key.contains("secret")
        || key.contains("credential")
        || key.contains("authorization")
        || key.contains("cookie")
        || key.contains("jwt")
        || key.contains("apikey")
        || key.contains("api-key")
        || key == "auth"
}

fn normalize_key(key: &str) -> String {
    key.to_ascii_lowercase().replace('_', "-")
}

fn truncate_for_display(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("...");
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_sensitive_argv_without_shell_parsing() {
        let argv = sanitize_argv(&[
            "wrapper".to_string(),
            "--api-key".to_string(),
            "sk-secret".to_string(),
            "--model=gpt".to_string(),
            "token=abc123".to_string(),
        ]);

        assert_eq!(
            argv,
            vec![
                "wrapper",
                "--api-key",
                "<redacted>",
                "--model=gpt",
                "token=<redacted>"
            ]
        );
    }

    #[test]
    fn redacts_sensitive_stderr_lines() {
        let line = sanitize_diagnostic_text(
            "failed authorization: Bearer abc123 password=hunter2 token:abc",
        );

        assert!(line.contains("Bearer <redacted>"));
        assert!(line.contains("password=<redacted>"));
        assert!(line.contains("token:<redacted>"));
        assert!(!line.contains("hunter2"));
        assert!(!line.contains("abc123"));
    }

    #[tokio::test]
    async fn web_dir_reports_missing_index() {
        let temp = tempfile::tempdir().unwrap();

        let diagnostics = web_dir_diagnostics(Some(temp.path().to_string_lossy().as_ref()))
            .await
            .unwrap();

        assert_eq!(diagnostics.status, DiagnosticStatus::Error);
        assert_eq!(diagnostics.has_index_html, Some(false));
        assert!(diagnostics.message.contains("index.html"));
    }
}
