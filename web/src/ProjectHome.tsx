import type { FormEvent } from 'react';
import { runtimeStatusLabels } from './AppShell';
import type { RecentProject } from './useSessions';
import type { SessionInfo } from './types';

type Props = {
  cwd: string;
  permissionMode: string;
  recentProjects: RecentProject[];
  recentSessions: SessionInfo[];
  useWorktree: boolean;
  onCreateSession: (event: FormEvent) => void;
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

export default function ProjectHome({
  cwd,
  permissionMode,
  recentProjects,
  recentSessions,
  useWorktree,
  onCreateSession,
  onSelectSession,
  onSetCwd,
  onSetPermissionMode,
  onSetUseWorktree
}: Props) {
  const launchCwd = cwd.trim();
  const launchCopy = launchCwd
    ? useWorktree
      ? `Claude will create an isolated worktree from ${launchCwd}.`
      : `Claude will start in ${launchCwd}.`
    : 'Choose a project path on the devbox to start.';

  return (
    <section className="project-home" aria-label="Project home">
      <div className="project-home-inner">
        <header className="project-home-hero">
          <span className="empty-eyebrow">New chat</span>
          <h2>Where should Claude work?</h2>
          <p>Start from a recent project, continue a nearby conversation, or choose a directory on the devbox.</p>
        </header>

        <form className="project-launch-card" onSubmit={onCreateSession} aria-label="Start a new Claude session">
          <div className="project-cwd-row">
            <label className="field-stack" htmlFor="project-home-cwd">
              <span>Working directory</span>
              <input
                id="project-home-cwd"
                value={cwd}
                onChange={(event) => onSetCwd(event.target.value)}
                placeholder="/data00/home/user/repos/project"
                required
              />
            </label>
            <button className="primary-action" type="submit">Start chat</button>
          </div>
          <p className="project-launch-context">{launchCopy}</p>

          {recentProjects.length > 0 && (
            <div className="project-home-section" aria-label="Recent projects">
              <div className="project-section-heading">
                <h3>Recent projects</h3>
                <p>Pick a repo to use as the launch context.</p>
              </div>
              <div className="project-card-grid">
                {recentProjects.map((project) => (
                  <button
                    key={project.cwd}
                    type="button"
                    className="project-card"
                    onClick={() => onSetCwd(project.cwd)}
                    aria-label={`Use ${project.cwd} as working directory`}
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

          <details className="advanced-session-options">
            <summary>Advanced options</summary>
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
          </details>
        </form>

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
