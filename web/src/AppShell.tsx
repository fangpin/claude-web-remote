import type { CSSProperties, ReactNode } from 'react';

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
  isInspectorOpen: boolean;
  isSidebarOpen: boolean;
  sidebar: ReactNode;
  workspace: ReactNode;
  inspector: ReactNode;
  inspectorWidth: number;
};

export default function AppShell({
  view,
  isInspectorOpen,
  isSidebarOpen,
  sidebar,
  workspace,
  inspector,
  inspectorWidth
}: Props) {
  const shellStyle = { '--inspector-width': `${inspectorWidth}px` } as CSSProperties;

  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'} ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`} style={shellStyle}>
      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
    </div>
  );
}
