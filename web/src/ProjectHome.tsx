import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { runtimeStatusLabels } from './AppShell';
import type { RecentProject } from './useSessions';
import type { SessionInfo } from './types';

type Props = {
  cwd: string;
  permissionMode: string;
  recentProjects: RecentProject[];
  recentSessions: SessionInfo[];
  useWorktree: boolean;
  onStartSession: (initialPrompt: string) => Promise<void> | void;
  onSelectSession: (sessionId: string) => void;
  onSetCwd: (cwd: string) => void;
  onSetPermissionMode: (mode: string) => void;
  onSetUseWorktree: (useWorktree: boolean) => void;
};

const permissionModeDescriptions: Record<string, string> = {
  bypassPermissions: 'Skip prompts for trusted local repos.',
  acceptEdits: 'Auto-accept file edits, still ask for riskier actions.',
  auto: 'Let Claude choose the safest available flow.',
  default: 'Use the daemon or Claude CLI default.'
};

const startSuggestions = [
  'Explain this repo',
  'Fix a bug',
  'Review changes',
  'Run tests',
  'Implement a feature'
];

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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sessionProjectCwd(session: SessionInfo): string {
  return session.worktree?.sourceCwd ?? session.cwd;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || pathBasename(sessionProjectCwd(session));
}

function defaultProjectCwd(recentSessions: SessionInfo[], recentProjects: RecentProject[]): string {
  const waitingSession = recentSessions.find((session) => (session.runtimeStatus ?? session.status) === 'waiting');
  const runningSession = recentSessions.find((session) => !session.worktree && (session.runtimeStatus ?? session.status) === 'running');
  const directSession = recentSessions.find((session) => !session.worktree);
  return waitingSession ? sessionProjectCwd(waitingSession) : runningSession?.cwd ?? directSession?.cwd ?? recentProjects[0]?.cwd ?? '';
}

export default function ProjectHome({
  cwd,
  permissionMode,
  recentProjects,
  recentSessions,
  useWorktree,
  onStartSession,
  onSelectSession,
  onSetCwd,
  onSetPermissionMode,
  onSetUseWorktree
}: Props) {
  const [initialPrompt, setInitialPrompt] = useState('');
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [hasEditedContext, setHasEditedContext] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const fallbackCwd = defaultProjectCwd(recentSessions, recentProjects);
  const shouldUseFallbackCwd = Boolean(!hasEditedContext && fallbackCwd && (!cwd.trim() || cwd.trim() === recentProjects[0]?.cwd));
  const launchCwd = cwd.trim();
  const canStart = Boolean(launchCwd && initialPrompt.trim());
  const projectLabel = launchCwd ? pathBasename(launchCwd) : 'Choose project';

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!shouldUseFallbackCwd || cwd.trim() === fallbackCwd) return;
    onSetCwd(fallbackCwd);
  }, [cwd, fallbackCwd, onSetCwd, shouldUseFallbackCwd]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    void onStartSession(initialPrompt);
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as unknown as {
      isComposing?: boolean;
      nativeEvent?: { isComposing?: boolean };
      keyCode?: number;
      which?: number;
    };
    const isComposing =
      nativeEvent.isComposing === true ||
      nativeEvent.nativeEvent?.isComposing === true ||
      (event as unknown as { isComposing?: boolean }).isComposing === true ||
      nativeEvent.keyCode === 229 ||
      nativeEvent.which === 229;

    if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
    event.preventDefault();
    if (canStart) void onStartSession(initialPrompt);
  }

  return (
    <section className="project-home" aria-label="Project home">
      <div className="project-home-inner">
        <header className="project-home-hero">
          <span className="empty-eyebrow">New chat</span>
          <h2>What would you like Claude to do?</h2>
          <p>Start with a task. Claude will use your selected project context when the chat begins.</p>
        </header>

        <form className="start-composer-card" onSubmit={onSubmit} aria-label="Start a new Claude session">
          <label className="sr-only" htmlFor="project-home-prompt">Start prompt</label>
          <div className="start-composer-input">
            <textarea
              id="project-home-prompt"
              ref={promptRef}
              value={initialPrompt}
              aria-label="Start prompt"
              placeholder="Ask Claude to explain, edit, test, review…"
              onChange={(event) => setInitialPrompt(event.target.value)}
              onKeyDown={onPromptKeyDown}
              rows={4}
            />
            <button className="primary-action" type="submit" disabled={!canStart}>Send</button>
          </div>

          <div className="start-context-row" aria-label="Project context summary">
            <span className="start-context-chip" title={launchCwd || 'Choose a repo path on the devbox'}>Project: {projectLabel}</span>
            <span className="start-context-chip">Worktree: {useWorktree ? 'On' : 'Off'}</span>
            <span className="start-context-chip">Permission: {permissionMode}</span>
            <details className="project-context-panel" open={isContextOpen}>
              <summary
                role="button"
                aria-label="Change project context"
                onClick={(event) => {
                  event.preventDefault();
                  setIsContextOpen((open) => !open);
                }}
              >
                Change
              </summary>
              {isContextOpen && (
              <div className="project-context-body">
                <label className="field-stack" htmlFor="project-home-cwd">
                  <span>Workspace context</span>
                  <input
                    id="project-home-cwd"
                    value={cwd}
                    onChange={(event) => {
                      setHasEditedContext(true);
                      onSetCwd(event.target.value);
                    }}
                    placeholder="Choose a repo path on the devbox"
                    required
                  />
                </label>

                {recentProjects.length > 0 && (
                  <div className="project-home-section context-projects" aria-label="Recent projects">
                    <div className="project-section-heading">
                      <h3>Recent projects</h3>
                      <p>Switch the context Claude will use.</p>
                    </div>
                    <div className="project-card-grid">
                      {recentProjects.map((project) => (
                        <button
                          key={project.cwd}
                          type="button"
                          className="project-card"
                          onClick={() => {
                            setHasEditedContext(true);
                            onSetCwd(project.cwd);
                          }}
                          aria-label={`Use ${project.cwd} as project context`}
                        >
                          <strong>{pathBasename(project.cwd)}</strong>
                          <span title={project.cwd}>{parentPath(project.cwd)}</span>
                          <small>
                            {countLabel(project.sessionCount, 'chat')}
                            {project.runningCount > 0 ? ` · ${project.runningCount} active` : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="advanced-session-grid">
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
                  <label className="field-stack" htmlFor="project-home-permission-mode">
                    <span>Permission mode</span>
                    <select
                      id="project-home-permission-mode"
                      value={permissionMode}
                      onChange={(event) => onSetPermissionMode(event.target.value)}
                      aria-describedby="project-home-permission-help"
                    >
                      <option value="bypassPermissions">bypassPermissions</option>
                      <option value="acceptEdits">acceptEdits</option>
                      <option value="auto">auto</option>
                      <option value="default">default</option>
                    </select>
                    <span id="project-home-permission-help">{permissionModeDescriptions[permissionMode] ?? 'Use the selected Claude permission policy.'}</span>
                  </label>
                </div>
              </div>
              )}
            </details>
          </div>
        </form>

        <div className="start-suggestion-grid" aria-label="Start prompt suggestions">
          {startSuggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setInitialPrompt(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>

        {recentSessions.length > 0 && (
          <section className="project-home-section" aria-label="Recent sessions">
            <div className="project-section-heading">
              <h3>Recent chats</h3>
              <p>Resume where you left off.</p>
            </div>
            <div className="recent-session-grid">
              {recentSessions.map((session) => {
                const runtimeStatus = session.runtimeStatus ?? session.status;
                const statusLabel = runtimeStatusLabels[runtimeStatus];
                const projectCwd = sessionProjectCwd(session);
                return (
                  <button
                    key={session.id}
                    type="button"
                    className="recent-session-card"
                    onClick={() => onSelectSession(session.id)}
                    aria-label={`Open ${sessionTitle(session)}`}
                  >
                    <span className="session-main-row">
                      <strong>{sessionTitle(session)}</strong>
                      <em className={`status status-${runtimeStatus}`}>{statusLabel}</em>
                    </span>
                    <span className="session-path" title={projectCwd}>{projectCwd}</span>
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
          </section>
        )}
      </div>
    </section>
  );
}
