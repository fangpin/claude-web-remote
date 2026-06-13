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
  isShortcutHelpOpen: boolean;
  isSidebarOpen: boolean;
  sidebar: ReactNode;
  workspace: ReactNode;
  inspector: ReactNode;
  onSetShortcutHelpOpen: (isOpen: boolean) => void;
  onShowActiveSessions: () => void;
  onShowConfig: () => void;
  onShowArchivedSessions: () => void;
  onToggleSidebar: () => void;
};

export default function AppShell({
  view,
  listMode,
  isInspectorOpen,
  isShortcutHelpOpen,
  isSidebarOpen,
  sidebar,
  workspace,
  inspector,
  onSetShortcutHelpOpen,
  onShowActiveSessions,
  onShowConfig,
  onShowArchivedSessions,
  onToggleSidebar
}: Props) {
  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'} ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <nav className="primary-rail" aria-label="Primary navigation">
        <div className="rail-brand" aria-label="Claude Remote Web">CRW</div>
        <button
          type="button"
          aria-current={view === 'sessions' && listMode === 'active' ? 'page' : 'false'}
          className={view === 'sessions' && listMode === 'active' ? 'active' : ''}
          title="Show active sessions"
          onClick={onShowActiveSessions}
        >
          Sessions
        </button>
        <button
          type="button"
          aria-current={view === 'config' ? 'page' : 'false'}
          className={view === 'config' ? 'active' : ''}
          title="Open daemon config"
          onClick={onShowConfig}
        >
          Config
        </button>
        <button
          type="button"
          aria-current={listMode === 'archived' && view === 'sessions' ? 'page' : 'false'}
          aria-label="Archived sessions"
          title="Show archived sessions"
          className={listMode === 'archived' && view === 'sessions' ? 'active' : ''}
          onClick={onShowArchivedSessions}
        >
          Archived
        </button>
        <button
          type="button"
          aria-pressed={isSidebarOpen}
          aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={isSidebarOpen ? 'Hide sidebar (⌘/Ctrl+B)' : 'Show sidebar (⌘/Ctrl+B)'}
          onClick={onToggleSidebar}
        >
          Sidebar
        </button>
        <div className="shortcut-help">
          <button
            type="button"
            aria-expanded={isShortcutHelpOpen}
            aria-controls="keyboard-shortcuts-help"
            title="Show keyboard shortcuts"
            onClick={() => onSetShortcutHelpOpen(!isShortcutHelpOpen)}
          >
            Keys
          </button>
          {isShortcutHelpOpen && (
            <section id="keyboard-shortcuts-help" className="shortcut-help-popover" aria-label="Keyboard shortcuts">
              <h2>Keyboard shortcuts</h2>
              <dl>
                <div><dt>⌘/Ctrl K</dt><dd>Focus command input</dd></div>
                <div><dt>/</dt><dd>Focus composer</dd></div>
                <div><dt>⌘/Ctrl B</dt><dd>Toggle sidebar</dd></div>
                <div><dt>⌘/Ctrl I</dt><dd>Toggle inspector</dd></div>
                <div><dt>⌥ Up/Down</dt><dd>Switch sessions</dd></div>
                <div><dt>Esc</dt><dd>Close popovers</dd></div>
              </dl>
            </section>
          )}
        </div>
      </nav>

      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
    </div>
  );
}
