pub mod api;
pub mod config;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;
pub mod worktree;

pub use api::{AppState, build_router};
pub use config::{Config, WorktreeBaseRef, WorktreeConfig};
pub use error::{AppError, AppResult};
pub use event::{EventKind, UiEvent, extract_claude_session_id, normalize_claude_stdout};
pub use process::{ClaudeProcess, ClaudeProcessConfig, ProcessEvent};
pub use session::{CreateSessionRequest, SessionInfo, SessionManager};
pub use store::{EventStore, SessionMeta, SessionStatus};
pub use worktree::{WorktreeManager, WorktreeMeta};
