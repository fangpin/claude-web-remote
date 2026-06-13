import type { FormEvent } from 'react';
import { runtimeStatusLabels, type SessionListMode } from './AppShell';
import type { SessionInfo } from './types';

type Props = {
  activeId: string | null;
  cwd: string;
  isListLoading: boolean;
  isNewSessionOpen: boolean;
  listMode: SessionListMode;
  permissionMode: string;
  recentDirectories: string[];
  sessionSearch: string;
  sessions: SessionInfo[];
  useWorktree: boolean;
  visibleSessions: SessionInfo[];
  onCreateSession: (event: FormEvent) => void;
  onSelectSession: (sessionId: string) => void;
  onSetCwd: (cwd: string) => void;
  onSetIsNewSessionOpen: (isOpen: boolean) => void;
  onSetListMode: (mode: SessionListMode) => void;
  onSetPermissionMode: (mode: string) => void;
  onSetSessionSearch: (search: string) => void;
  onSetUseWorktree: (useWorktree: boolean) => void;
  onToggleNewSession: () => void;
};

export default function SessionSidebar({
  activeId,
  cwd,
  isListLoading,
  isNewSessionOpen,
  listMode,
  permissionMode,
  recentDirectories,
  sessionSearch,
  sessions,
  useWorktree,
  visibleSessions,
  onCreateSession,
  onSelectSession,
  onSetCwd,
  onSetIsNewSessionOpen,
  onSetListMode,
  onSetPermissionMode,
  onSetSessionSearch,
  onSetUseWorktree,
  onToggleNewSession
}: Props) {
  return (
    <aside className="session-sidebar" aria-label="Session navigation">
      <div className="sidebar-header">
        <div>
          <h1>Claude Remote Web</h1>
          <p>Remote Claude sessions</p>
        </div>
        <button type="button" className="primary-action" onClick={onToggleNewSession}>
          New chat
        </button>
      </div>

      {isNewSessionOpen && (
        <form className="new-session-panel" onSubmit={onCreateSession}>
          <div className="new-session-heading">
            <div>
              <h2>New session</h2>
              <p>Start Claude in a local working directory.</p>
            </div>
            <button type="button" onClick={() => onSetIsNewSessionOpen(false)}>Close</button>
          </div>
          <label>
            Working directory
            <input value={cwd} onChange={(event) => onSetCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
          </label>
          {recentDirectories.length > 0 && (
            <div className="directory-suggestions" aria-label="Recent working directories">
              <span>Recent</span>
              {recentDirectories.map((directory) => (
                <button key={directory} type="button" onClick={() => onSetCwd(directory)} aria-label={`Use ${directory}`}>
                  {directory}
                </button>
              ))}
            </div>
          )}
          <div className="new-session-options">
            <label className="checkbox-label">
              <input type="checkbox" checked={useWorktree} onChange={(event) => onSetUseWorktree(event.target.checked)} />
              Use git worktree
            </label>
            <label>
              Permission mode
              <select value={permissionMode} onChange={(event) => onSetPermissionMode(event.target.value)}>
                <option value="bypassPermissions">bypassPermissions</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="auto">auto</option>
                <option value="default">default</option>
              </select>
            </label>
          </div>
          <div className="new-session-actions">
            <button className="primary-action" type="submit">Create session</button>
          </div>
        </form>
      )}

      <div className="session-modes" role="group" aria-label="Session list mode">
        <button
          type="button"
          className={listMode === 'active' ? 'selected' : undefined}
          aria-pressed={listMode === 'active'}
          onClick={() => onSetListMode('active')}
        >
          Active
        </button>
        <button
          type="button"
          className={listMode === 'archived' ? 'selected' : undefined}
          aria-pressed={listMode === 'archived'}
          onClick={() => onSetListMode('archived')}
        >
          Archived
        </button>
      </div>

      <section className="sessions" aria-label={listMode === 'archived' ? 'Archived sessions' : 'Active sessions'}>
        <div className="session-list-toolbar">
          <div>
            <h2>{listMode === 'archived' ? 'Archived sessions' : 'Active sessions'}</h2>
            <p>
              {sessionSearch.trim()
                ? `${visibleSessions.length} of ${sessions.length} shown`
                : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`}
            </p>
          </div>
          {sessionSearch && (
            <button type="button" onClick={() => onSetSessionSearch('')}>Clear</button>
          )}
        </div>
        <label className="session-search">
          <span className="sr-only">Search sessions</span>
          <input
            type="search"
            value={sessionSearch}
            onChange={(event) => onSetSessionSearch(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>
        {isListLoading && <p className="muted">Loading sessions...</p>}
        {!isListLoading && sessions.length === 0 && <p className="muted">{listMode === 'archived' ? 'No archived sessions.' : 'No sessions yet.'}</p>}
        {!isListLoading && sessions.length > 0 && visibleSessions.length === 0 && (
          <p className="muted">No sessions match "{sessionSearch.trim()}".</p>
        )}
        {visibleSessions.map((session) => {
          const runtimeStatus = session.runtimeStatus ?? session.status;
          return (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => onSelectSession(session.id)}
            >
              <span className="session-main-row">
                <strong>{session.name || session.cwd}</strong>
                <em className={`status status-${runtimeStatus}`}>{runtimeStatusLabels[runtimeStatus]}</em>
              </span>
              <span className="session-path" title={session.cwd}>{session.cwd}</span>
              {session.worktree && (
                <span className="session-worktree-row">
                  <span>Worktree</span>
                  <span className="session-branch" title={session.worktree.branch}>{session.worktree.branch}</span>
                </span>
              )}
            </button>
          );
        })}
      </section>
    </aside>
  );
}
