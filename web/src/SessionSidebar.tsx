import { useEffect, useMemo, useState } from 'react';
import { runtimeStatusLabels, type SessionListMode } from './AppShell';
import { getContinuityLabel, getRuntimeStatus } from './sessionContinuity';
import type { SessionInfo } from './types';

type RuntimeStatusKey = keyof typeof runtimeStatusLabels;

const PINNED_SESSION_STORAGE_KEY = 'claude-remote-web:pinned-session-ids';
const DAY_MS = 24 * 60 * 60 * 1000;

type SessionSection = {
  key: string;
  title: string;
  description: string;
  sessions: SessionInfo[];
};

type Props = {
  activeId: string | null;
  isListLoading: boolean;
  listError: string | null;
  listMode: SessionListMode;
  sessionSearch: string;
  sessions: SessionInfo[];
  visibleSessions: SessionInfo[];
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onSetListMode: (mode: SessionListMode) => void;
  onSetSessionSearch: (search: string) => void;
  onRetryList: () => void;
};

function getSidebarRuntimeStatus(session: SessionInfo): RuntimeStatusKey {
  return getRuntimeStatus(session) as RuntimeStatusKey;
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
  return `${count} ${count === 1 ? 'chat' : 'chats'}`;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function compareSessionsByUpdatedAt(a: SessionInfo, b: SessionInfo): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function bucketForSession(session: SessionInfo, now: Date): Pick<SessionSection, 'key' | 'title' | 'description'> {
  const updatedAt = new Date(session.updatedAt);
  const dayDelta = Math.floor((startOfLocalDay(now) - startOfLocalDay(updatedAt)) / DAY_MS);

  if (dayDelta <= 0) {
    return { key: 'today', title: 'Today', description: 'Picked up today' };
  }
  if (dayDelta === 1) {
    return { key: 'yesterday', title: 'Yesterday', description: 'Recent enough to resume quickly' };
  }
  if (dayDelta <= 7) {
    return { key: 'previous-7-days', title: 'Previous 7 days', description: 'Fresh context from this week' };
  }
  return { key: 'older', title: 'Older', description: 'Longer-lived project history' };
}

function buildSessionSections(sessions: SessionInfo[], listMode: SessionListMode, pinnedSessionIds: Set<string>): SessionSection[] {
  const now = new Date();
  const sortedSessions = [...sessions].sort(compareSessionsByUpdatedAt);
  const sections: SessionSection[] = [];
  const pinnedSessions = sortedSessions.filter((session) => pinnedSessionIds.has(session.id));
  const unpinnedSessions = sortedSessions.filter((session) => !pinnedSessionIds.has(session.id));

  if (pinnedSessions.length > 0) {
    sections.push({
      key: 'pinned',
      title: 'Pinned',
      description: listMode === 'archived' ? 'Saved archived conversations' : 'Favorites and active work',
      sessions: pinnedSessions
    });
  }

  const buckets = new Map<string, SessionSection>();
  unpinnedSessions.forEach((session) => {
    const bucket = bucketForSession(session, now);
    const existing = buckets.get(bucket.key);
    if (existing) {
      existing.sessions.push(session);
      return;
    }
    buckets.set(bucket.key, { ...bucket, sessions: [session] });
  });

  return [...sections, ...buckets.values()];
}

function toolbarSummary(sessionSearch: string, sessions: SessionInfo[], visibleSessions: SessionInfo[]): string {
  const query = sessionSearch.trim();
  if (!query) return countLabel(sessions.length);
  return `${visibleSessions.length} of ${sessions.length} matches for "${query}"`;
}

function readPinnedSessionIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PINNED_SESSION_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function writePinnedSessionIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(PINNED_SESSION_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Pinning is an affordance, not a critical control path.
  }
}

function formatRelativeUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Recently updated';

  const diffMs = timestamp - Date.now();
  const absDiffMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absDiffMs < 60 * 1000) return 'Updated just now';
  if (absDiffMs < 60 * 60 * 1000) return `Updated ${formatter.format(Math.round(diffMs / (60 * 1000)), 'minute')}`;
  if (absDiffMs < DAY_MS) return `Updated ${formatter.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')}`;
  if (absDiffMs < 30 * DAY_MS) return `Updated ${formatter.format(Math.round(diffMs / DAY_MS), 'day')}`;

  return `Updated ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(timestamp))}`;
}

function resumeCueForSession(session: SessionInfo, listMode: SessionListMode): string {
  if (listMode === 'archived' || session.deletedAt) return 'Archived. Unarchive to continue.';

  const runtimeStatus = getRuntimeStatus(session);
  if (runtimeStatus === 'waiting') return 'Ready for your reply';
  if (runtimeStatus === 'starting') return 'Starting Claude';
  if (runtimeStatus === 'running') return 'Claude is working';
  if (runtimeStatus === 'failed') return session.claudeSessionId ? 'Resume or restart from saved context' : 'Review the failed run';
  if (session.claudeSessionId) return 'Resume this chat';
  return 'Continue from this project';
}

function branchLabel(session: SessionInfo): string | null {
  if (!session.worktree?.branch) return null;
  return `Branch: ${session.worktree.branch}`;
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path
        d="M5.6 1.5h4.8l-.7 4.1 2.3 2.1v1H8.7l-.5 5.8h-.4l-.5-5.8H4v-1l2.3-2.1-.7-4.1Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SessionSidebar({
  activeId,
  isListLoading,
  listError,
  listMode,
  sessionSearch,
  sessions,
  visibleSessions,
  onNewChat,
  onSelectSession,
  onSetListMode,
  onSetSessionSearch,
  onRetryList
}: Props) {
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const searchQuery = sessionSearch.trim();
  const sections = useMemo(
    () => buildSessionSections(visibleSessions, listMode, pinnedSessionIds),
    [visibleSessions, listMode, pinnedSessionIds]
  );

  useEffect(() => {
    writePinnedSessionIds(pinnedSessionIds);
  }, [pinnedSessionIds]);

  function onTogglePinned(sessionId: string) {
    setPinnedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  return (
    <aside className="session-sidebar" aria-label="Session navigation">
      <div className="sidebar-header">
        <div>
          <h1>Claude</h1>
          <p>Recent conversations and resumable work</p>
        </div>
        <button type="button" className="primary-action" title="Start a new chat" onClick={onNewChat}>
          New chat
        </button>
      </div>

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
            <h2>{searchQuery ? 'Search results' : listMode === 'archived' ? 'Archived chats' : 'Recent chats'}</h2>
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
            <h3>Could not load chats.</h3>
            <p>The daemon did not return the chat list. You can retry without losing anything.</p>
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
            <h3>{listMode === 'archived' ? 'No archived chats.' : 'No chats yet.'}</h3>
            <p>{listMode === 'archived' ? 'Archived chats will land here with their project context intact.' : 'Create a chat from a repository path when you are ready.'}</p>
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
                <div className="session-section-list">
                  {section.sessions.map((session) => {
                    const runtimeStatus = getSidebarRuntimeStatus(session);
                    const statusClass = listMode === 'archived' ? 'archived' : runtimeStatus;
                    const statusLabel = runtimeStatusLabels[runtimeStatus];
                    const continuityLabel = getContinuityLabel(session, listMode);
                    const sessionTitle = session.name || pathBasename(projectPathForSession(session));
                    const projectPath = projectPathForSession(session);
                    const projectName = pathBasename(projectPath);
                    const projectParent = parentPath(projectPath);
                    const isPinned = pinnedSessionIds.has(session.id);
                    const branch = branchLabel(session);

                    return (
                      <div className={session.id === activeId ? 'session-row active' : 'session-row'} key={session.id}>
                        <button
                          className={session.id === activeId ? 'session active' : 'session'}
                          aria-current={session.id === activeId ? 'page' : undefined}
                          data-session-id={session.id}
                          title="Select session (⌥ Up/Down switches sessions)"
                          onClick={() => onSelectSession(session.id)}
                        >
                          <span className="session-title-row">
                            <strong>{sessionTitle}</strong>
                            <em className={`status status-${statusClass}`}>{statusLabel}</em>
                          </span>
                          <span className="session-resume-cue">{continuityLabel ?? resumeCueForSession(session, listMode)}</span>
                          <span className="session-path-row">
                            <span className="session-project" title={projectPath}>{projectName}</span>
                            <span className="session-parent" title={projectPath}>{projectParent}</span>
                          </span>
                          <span className="session-detail-row">
                            {branch && <span className="session-branch" title={branch}>{branch}</span>}
                            <span>{formatRelativeUpdatedAt(session.updatedAt)}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={isPinned ? 'session-pin-button pinned' : 'session-pin-button'}
                          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${sessionTitle}`}
                          aria-pressed={isPinned}
                          title={isPinned ? 'Unpin conversation' : 'Pin conversation'}
                          onClick={() => onTogglePinned(session.id)}
                        >
                          <PinIcon filled={isPinned} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
