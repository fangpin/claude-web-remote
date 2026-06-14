pub mod api;
pub mod config;
pub mod diagnostics;
pub mod embedded_assets;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;
pub mod task;
pub mod worktree;

pub use api::{AppState, build_router};
pub use config::{
    Config, ConfigStore, ConfigValues, ResolvedConfig, WorktreeBaseRef, WorktreeConfig,
};
pub use diagnostics::{DiagnosticsResponse, SessionDiagnosticsResponse};
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent, extract_claude_session_id, normalize_claude_stdout};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use session::{CreateSessionRequest, SessionInfo, SessionManager, WorktreeRequest};
pub use store::{EventStore, SessionListFilter, SessionMeta, SessionStatus};
pub use task::{
    TaskGroups, TaskInfo, TaskStatus, group_tasks, has_unfinished_tool_use, project_session_tasks,
};
pub use worktree::{
    WorktreeDiff, WorktreeFileStatus, WorktreeManager, WorktreeMeta, WorktreeStatus,
};
