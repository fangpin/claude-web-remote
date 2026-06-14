import { DragEvent, useEffect, useMemo, useState } from 'react';
import { runtimeStatusLabels, type SessionListMode } from './AppShell';
import { getContinuityLabel, getRuntimeStatus } from './sessionContinuity';
import type { SessionGroup, SessionInfo } from './types';

type RuntimeStatusKey = keyof typeof runtimeStatusLabels;

const PINNED_SESSION_STORAGE_KEY = 'claude-remote-web:pinned-session-ids';
const DAY_MS = 24 * 60 * 60 * 1000;

type SessionSection = {
  key: string;
  title: string;
  description: string;
  sessions: SessionInfo[];
  projectPath?: string;
  groupId?: string;
  isCustomGroup?: boolean;
};

type Props = {
  activeId: string | null;
  isListLoading: boolean;
  listError: string | null;
  listMode: SessionListMode;
  sessionSearch: string;
  sessions: SessionInfo[];
  sessionGroups: SessionGroup[];
  visibleSessions: SessionInfo[];
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveSessionToGroup: (sessionId: string, groupId: string | null) => void;
  onNewChat: () => void;
  onRenameGroup: (groupId: string, name: string) => void;
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

function timeHintForSession(session: SessionInfo, now: Date): string {
  const updatedAt = new Date(session.updatedAt);
  const dayDelta = Math.floor((startOfLocalDay(now) - startOfLocalDay(updatedAt)) / DAY_MS);

  if (dayDelta <= 0) return 'Active today';
  if (dayDelta === 1) return 'Active yesterday';
  if (dayDelta <= 7) return 'Active this week';
  return 'Longer-lived work';
}

function sectionKeyForProject(projectPath: string): string {
  return `project:${projectPath}`;
}

function buildSessionSections(
  sessions: SessionInfo[],
  sessionGroups: SessionGroup[],
  listMode: SessionListMode,
  pinnedSessionIds: Set<string>
): SessionSection[] {
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

  const groupedSessionIds = new Set<string>();
  sessionGroups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((group) => {
      const groupSessions = unpinnedSessions.filter((session) => session.groupId === group.id);
      groupSessions.forEach((session) => groupedSessionIds.add(session.id));
      sections.push({
        key: `group:${group.id}`,
        title: group.name,
        description: groupSessions.length > 0 ? 'Custom group' : 'Drop chats here',
        sessions: groupSessions,
        groupId: group.id,
        isCustomGroup: true
      });
    });

  const projects = new Map<string, SessionSection>();
  unpinnedSessions
    .filter((session) => !groupedSessionIds.has(session.id))
    .forEach((session) => {
      const projectPath = projectPathForSession(session);
      const key = sectionKeyForProject(projectPath);
      const existing = projects.get(key);
      if (existing) {
        existing.sessions.push(session);
        return;
      }
      projects.set(key, {
        key,
        title: pathBasename(projectPath),
        description: `${parentPath(projectPath)} · ${timeHintForSession(session, now)}`,
        sessions: [session],
        projectPath
      });
    });

  return [
    ...sections,
    ...[...projects.values()].sort((a, b) => compareSessionsByUpdatedAt(a.sessions[0], b.sessions[0]))
  ];
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
  sessionGroups,
  visibleSessions,
  onCreateGroup,
  onDeleteGroup,
  onMoveSessionToGroup,
  onNewChat,
  onRenameGroup,
  onSelectSession,
  onSetListMode,
  onSetSessionSearch,
  onRetryList
}: Props) {
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const searchQuery = sessionSearch.trim();
  const sections = useMemo(
    () => buildSessionSections(visibleSessions, sessionGroups, listMode, pinnedSessionIds),
    [visibleSessions, sessionGroups, listMode, pinnedSessionIds]
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

  function onAddGroup() {
    const name = window.prompt('Name this chat group');
    if (!name?.trim()) return;
    onCreateGroup(name);
  }

  function onEditGroup(group: SessionSection) {
    if (!group.groupId) return;
    const name = window.prompt('Rename chat group', group.title);
    if (!name?.trim() || name.trim() === group.title) return;
    onRenameGroup(group.groupId, name);
  }

  function onSessionDragStart(event: DragEvent<HTMLDivElement>, sessionId: string) {
    event.dataTransfer.setData('text/plain', sessionId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onGroupDragOver(event: DragEvent<HTMLElement>, groupId: string | null) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(groupId ?? 'ungrouped');
  }

  function onGroupDrop(event: DragEvent<HTMLElement>, groupId: string | null) {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData('text/plain');
    setDragOverGroupId(null);
    if (!sessionId) return;
    onMoveSessionToGroup(sessionId, groupId);
  }

  return (
    <aside className="session-sidebar" aria-label="Session navigation">
      <div className="sidebar-header">
        <div>
          <h1>Claude</h1>
          <p>Chats and remote work</p>
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
          <div className="session-list-toolbar-actions">
            <button type="button" onClick={onAddGroup}>New group</button>
            {sessionSearch && (
              <button type="button" onClick={() => onSetSessionSearch('')}>Clear</button>
            )}
          </div>
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
              <div
                className={`${section.key === `group:${dragOverGroupId}` || (!section.isCustomGroup && dragOverGroupId === 'ungrouped') ? 'session-section drag-over' : 'session-section'} session-section-${section.key.replace(/[^a-z0-9_-]/gi, '-')}`}
                key={section.key}
                onDragLeave={() => setDragOverGroupId(null)}
              >
                <div
                  className={section.isCustomGroup ? 'session-section-heading custom-group-heading' : 'session-section-heading'}
                  onDragOver={(event) => section.isCustomGroup && section.groupId ? onGroupDragOver(event, section.groupId) : onGroupDragOver(event, null)}
                  onDrop={(event) => section.isCustomGroup && section.groupId ? onGroupDrop(event, section.groupId) : onGroupDrop(event, null)}
                >
                  <div>
                    <h3>{section.title}</h3>
                    <p title={section.projectPath ?? undefined}>{section.description}</p>
                  </div>
                  <div className="session-section-heading-actions">
                    <span>{countLabel(section.sessions.length)}</span>
                    {section.isCustomGroup && section.groupId && (
                      <>
                        <button type="button" onClick={() => onEditGroup(section)}>Rename</button>
                        <button type="button" onClick={() => onDeleteGroup(section.groupId!)}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
                <div
                  className="session-section-list"
                  onDragOver={(event) => section.isCustomGroup && section.groupId ? onGroupDragOver(event, section.groupId) : onGroupDragOver(event, null)}
                  onDrop={(event) => section.isCustomGroup && section.groupId ? onGroupDrop(event, section.groupId) : onGroupDrop(event, null)}
                >
                  {section.isCustomGroup && section.sessions.length === 0 && <p className="session-group-empty">Drop a chat here or use Move.</p>}
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
                      <div
                        className={session.id === activeId ? 'session-row active' : 'session-row'}
                        key={session.id}
                        draggable
                        onDragStart={(event) => onSessionDragStart(event, session.id)}
                      >
                        <button
                          className={session.id === activeId ? 'session active' : 'session'}
                          aria-current={session.id === activeId ? 'page' : undefined}
                          data-session-id={session.id}
                          title="Select session (⌥ Up/Down switches sessions)"
                          onClick={() => onSelectSession(session.id)}
                        >
                          <span className="session-title-row">
                            <span className="session-title-main">
                              <span className={`session-attention-dot ${runtimeStatus}`} aria-hidden="true" />
                              <strong>{sessionTitle}</strong>
                            </span>
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
                        <select
                          className="session-move-select"
                          aria-label={`Move ${sessionTitle} to group`}
                          value={session.groupId ?? ''}
                          onChange={(event) => onMoveSessionToGroup(session.id, event.target.value || null)}
                          title="Move conversation to group"
                        >
                          <option value="">Ungrouped</option>
                          {sessionGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
                        </select>
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
