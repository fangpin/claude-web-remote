import type { FormEvent } from 'react';
import { runtimeStatusLabels, type SessionListMode } from './AppShell';
import type { SessionInfo } from './types';

type RuntimeStatusKey = keyof typeof runtimeStatusLabels;

type SessionSection = {
  key: string;
  title: string;
  description: string;
  sessions: SessionInfo[];
};

type ProjectGroup = {
  key: string;
  title: string;
  path: string;
  sessions: SessionInfo[];
};

type Props = {
  activeId: string | null;
  cwd: string;
  isListLoading: boolean;
  isNewSessionOpen: boolean;
  listError: string | null;
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
  onRetryList: () => void;
};

const permissionModeDescriptions: Record<string, string> = {
  bypassPermissions: 'Skip prompts for trusted local repos.',
  acceptEdits: 'Auto-accept file edits, still ask for riskier actions.',
  auto: 'Let Claude choose the safest available flow.',
  default: 'Use the daemon or Claude CLI default.'
};

function getRuntimeStatus(session: SessionInfo): RuntimeStatusKey {
  return (session.runtimeStatus ?? session.status) as RuntimeStatusKey;
}

function projectPathForSession(session: SessionInfo): string {
  return session.worktree?.sourceCwd ?? session.cwd;
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  if (!normalized) return path || 'Repository';
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function parentPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized || path;
  return `/${parts.slice(0, -1).join('/')}`;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}

function buildSessionSections(sessions: SessionInfo[], listMode: SessionListMode): SessionSection[] {
  if (listMode === 'archived') {
    return sessions.length
      ? [{ key: 'archived', title: 'Archived', description: 'Read-only history', sessions }]
      : [];
  }

  const waiting = sessions.filter((session) => getRuntimeStatus(session) === 'waiting');
  const running = sessions.filter((session) => ['starting', 'running'].includes(getRuntimeStatus(session)));
  const recent = sessions.filter((session) => {
    const runtimeStatus = getRuntimeStatus(session);
    return !['waiting', 'starting', 'running'].includes(runtimeStatus);
  });

  return [
    { key: 'waiting', title: 'Waiting', description: 'Ready for your reply', sessions: waiting },
    { key: 'running', title: 'Running', description: 'Claude is working', sessions: running },
    { key: 'recent', title: 'Recent stopped', description: 'Ended, stopped, or failed', sessions: recent }
  ].filter((section) => section.sessions.length > 0);
}

function groupSessionsByProject(sessions: SessionInfo[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const byPath = new Map<string, ProjectGroup>();

  sessions.forEach((session) => {
    const path = projectPathForSession(session);
    const existing = byPath.get(path);
    if (existing) {
      existing.sessions.push(session);
      return;
    }

    const group = {
      key: path,
      title: pathBasename(path),
      path,
      sessions: [session]
    };
    byPath.set(path, group);
    groups.push(group);
  });

  return groups;
}

function toolbarSummary(sessionSearch: string, sessions: SessionInfo[], visibleSessions: SessionInfo[]): string {
  const query = sessionSearch.trim();
  if (!query) return countLabel(sessions.length);
  return `${visibleSessions.length} of ${sessions.length} matches for "${query}"`;
}

export default function SessionSidebar({
  activeId,
  cwd,
  isListLoading,
  isNewSessionOpen,
  listError,
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
  onToggleNewSession,
  onRetryList
}: Props) {
  const searchQuery = sessionSearch.trim();
  const sections = buildSessionSections(visibleSessions, listMode);

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
              <h2>Start a session</h2>
              <p>Pick a repo, isolation style, and permission mode.</p>
            </div>
            <button type="button" onClick={() => onSetIsNewSessionOpen(false)}>Close</button>
          </div>
          <div className="field-stack">
            <label htmlFor="new-session-cwd">Working directory</label>
            <input
              id="new-session-cwd"
              value={cwd}
              onChange={(event) => onSetCwd(event.target.value)}
              placeholder="/data00/home/user/repos/project"
              aria-describedby="new-session-cwd-help"
              required
            />
            <span id="new-session-cwd-help">Claude starts on the devbox in this directory.</span>
          </div>
          {recentDirectories.length > 0 && (
            <div className="directory-suggestions" aria-label="Recent working directories">
              <span>Recent</span>
              {recentDirectories.map((directory) => (
                <button key={directory} type="button" onClick={() => onSetCwd(directory)} aria-label={`Use ${directory}`}>
                  <strong>{pathBasename(directory)}</strong>
                  <small>{parentPath(directory)}</small>
                </button>
              ))}
            </div>
          )}
          <div className="new-session-options">
            <label className="checkbox-label option-line">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(event) => onSetUseWorktree(event.target.checked)}
                aria-label="Use git worktree"
              />
              <span>
                <strong>Use git worktree</strong>
                <small>Start from an isolated checkout when available.</small>
              </span>
            </label>
            <div className="field-stack">
              <label htmlFor="new-session-permission-mode">Permission mode</label>
              <select
                id="new-session-permission-mode"
                value={permissionMode}
                onChange={(event) => onSetPermissionMode(event.target.value)}
                aria-describedby="new-session-permission-help"
              >
                <option value="bypassPermissions">bypassPermissions</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="auto">auto</option>
                <option value="default">default</option>
              </select>
              <span id="new-session-permission-help">{permissionModeDescriptions[permissionMode] ?? 'Use the selected Claude permission policy.'}</span>
            </div>
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
            <h2>{searchQuery ? 'Search results' : listMode === 'archived' ? 'Archived sessions' : 'Active sessions'}</h2>
            <p>{toolbarSummary(sessionSearch, sessions, visibleSessions)}</p>
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
        {isListLoading && (
          <div className="session-list-skeleton" aria-label="Loading sessions">
            <span />
            <span />
            <span />
          </div>
        )}
        {!isListLoading && listError && (
          <div className="session-empty session-empty-error">
            <span className="state-kicker">Connection issue</span>
            <h3>Could not load sessions.</h3>
            <p>The daemon did not return the session list. You can retry without losing anything.</p>
            <details>
              <summary>Details</summary>
              <pre>{listError}</pre>
            </details>
            <button type="button" onClick={onRetryList}>Retry</button>
          </div>
        )}
        {!isListLoading && !listError && sessions.length === 0 && (
          <div className="session-empty">
            <span className="state-kicker">{listMode === 'archived' ? 'Archive' : 'Start here'}</span>
            <h3>{listMode === 'archived' ? 'No archived sessions.' : 'No chats yet.'}</h3>
            <p>{listMode === 'archived' ? 'Archived chats will land here when you clean up active work.' : 'Create a chat from a repository path when you are ready.'}</p>
          </div>
        )}
        {!isListLoading && !listError && sessions.length > 0 && visibleSessions.length === 0 && (
          <div className="session-empty">
            <span className="state-kicker">No matches</span>
            <h3>{listMode === 'archived' ? 'No archived chats match your search.' : `No chats match "${searchQuery}".`}</h3>
            <p>Try a repo name, branch, path, or status.</p>
          </div>
        )}
        {!isListLoading && !listError && visibleSessions.length > 0 && (
          <div className="session-sections">
            {sections.map((section) => (
              <div className={`session-section session-section-${section.key}`} key={section.key}>
                <div className="session-section-heading">
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.description}</p>
                  </div>
                  <span>{countLabel(section.sessions.length)}</span>
                </div>
                {groupSessionsByProject(section.sessions).map((group) => (
                  <div className="session-project-group" key={group.key} aria-label={`Project ${group.title}`}>
                    <div className="session-project-heading">
                      <strong>{group.title}</strong>
                      <span title={group.path}>{group.path}</span>
                    </div>
                    {group.sessions.map((session) => {
                      const runtimeStatus = getRuntimeStatus(session);
                      const statusClass = listMode === 'archived' ? 'archived' : runtimeStatus;
                      const statusLabel = runtimeStatusLabels[runtimeStatus];
                      return (
                        <button
                          key={session.id}
                          className={session.id === activeId ? 'session active' : 'session'}
                          aria-current={session.id === activeId ? 'page' : undefined}
                          onClick={() => onSelectSession(session.id)}
                        >
                          <span className="session-main-row">
                            <strong>{session.name || session.cwd}</strong>
                            <em className={`status status-${statusClass}`}>{statusLabel}</em>
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
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
