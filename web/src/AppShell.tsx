import type { ReactNode } from 'react';

export type SessionListMode = 'active' | 'archived';
export type AppView = 'sessions' | 'config';

export const runtimeStatusLabels = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting for you',
  ended: 'Ended',
  exited: 'Ended',
  stopped: 'Stopped',
  failed: 'Failed'
};

type Props = {
  view: AppView;
  listMode: SessionListMode;
  isInspectorOpen: boolean;
  sidebar: ReactNode;
  workspace: ReactNode;
  inspector: ReactNode;
  onShowActiveSessions: () => void;
  onShowConfig: () => void;
  onShowArchivedSessions: () => void;
};

export default function AppShell({
  view,
  listMode,
  isInspectorOpen,
  sidebar,
  workspace,
  inspector,
  onShowActiveSessions,
  onShowConfig,
  onShowArchivedSessions
}: Props) {
  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
      <nav className="primary-rail" aria-label="Primary navigation">
        <div className="rail-brand" aria-label="Claude Remote Web">CRW</div>
        <button
          type="button"
          aria-current={view === 'sessions' && listMode === 'active' ? 'page' : 'false'}
          className={view === 'sessions' && listMode === 'active' ? 'active' : ''}
          onClick={onShowActiveSessions}
        >
          Sessions
        </button>
        <button
          type="button"
          aria-current={view === 'config' ? 'page' : 'false'}
          className={view === 'config' ? 'active' : ''}
          onClick={onShowConfig}
        >
          Config
        </button>
        <button
          type="button"
          aria-current={listMode === 'archived' && view === 'sessions' ? 'page' : 'false'}
          aria-label="Archived sessions"
          className={listMode === 'archived' && view === 'sessions' ? 'active' : ''}
          onClick={onShowArchivedSessions}
        >
          Archived
        </button>
      </nav>

      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
    </div>
  );
}
