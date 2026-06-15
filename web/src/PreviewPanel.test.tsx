import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PreviewPanel from './PreviewPanel';
import type { SessionInfo, UiEvent, WorktreeDiff } from './types';

const baseSession = {
  permissionMode: 'acceptEdits',
  claudeSessionId: null,
  deletedAt: null,
  createdAt: '2026-06-11T00:00:00Z',
  updatedAt: '2026-06-11T00:00:00Z'
};

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ...baseSession,
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    status: 'running',
    runtimeStatus: 'waiting',
    ...overrides
  };
}

function worktreeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return session({
    id: 'worktree-session',
    name: 'Worktree Repo',
    cwd: '/repo/one/.claude/worktrees/abc123',
    worktree: {
      sourceCwd: '/repo/one',
      worktreeCwd: '/repo/one/.claude/worktrees/abc123',
      branch: 'pin/abc123',
      baseRef: 'HEAD',
      createdByClaudeRemoteWeb: true
    },
    ...overrides
  });
}

function readReferenceEvents(path: string, snippet: string): UiEvent[] {
  return [
    {
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'tool',
      payload: { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: path } }
    },
    {
      id: 2,
      sessionId: 's1',
      time: '2026-06-11T00:00:01Z',
      kind: 'tool',
      payload: { type: 'tool_result', tool_use_id: 'toolu_read', content: snippet }
    }
  ];
}

function diff(overrides: Partial<WorktreeDiff> = {}): WorktreeDiff {
  return {
    diff: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n@@\n-old\n+new',
    files: [{ path: 'web/src/App.tsx', status: 'modified', additions: 1, deletions: 1 }],
    truncated: false,
    limitBytes: 200000,
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe('PreviewPanel', () => {
  it('shows the non-worktree empty state while still rendering transcript snippets', () => {
    render(
      <PreviewPanel
        activeSession={session()}
        events={readReferenceEvents('/repo/one/web/src/App.tsx', 'const answer = 42;')}
        selectedPath={null}
      />
    );

    expect(screen.getByText('Preview is available for worktree sessions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /web\/src\/App.tsx/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Transcript snippets' })).toBeInTheDocument();
    expect(screen.getByText('Read /repo/one/web/src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
  });

  it('loads a worktree session diff and renders structured diff-backed files', async () => {
    const loadWorktreeDiff = vi.fn(async () => diff());

    render(<PreviewPanel activeSession={worktreeSession()} events={[]} selectedPath={null} loadWorktreeDiff={loadWorktreeDiff} />);

    expect(screen.getByText('Loading diff...')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /web\/src\/App.tsx/ })).toHaveTextContent('+1 -1');
    expect(loadWorktreeDiff).toHaveBeenCalledWith('worktree-session');

    const detail = screen.getByLabelText('Preview details');
    expect(within(detail).getByRole('heading', { name: 'Worktree diff' })).toBeInTheDocument();
    expect(within(detail).getByText(/diff --git a\/web\/src\/App.tsx b\/web\/src\/App.tsx/)).toBeInTheDocument();
    expect(within(detail).queryByText('No preview details for this file.')).not.toBeInTheDocument();
  });

  it('shows empty, truncated, and error states for worktree diffs', async () => {
    const { rerender } = render(
      <PreviewPanel
        activeSession={worktreeSession({ id: 'empty-session' })}
        events={[]}
        selectedPath={null}
        loadWorktreeDiff={vi.fn(async () => diff({ diff: '', files: [] }))}
      />
    );

    expect(await screen.findByText('No worktree changes yet.')).toBeInTheDocument();

    rerender(
      <PreviewPanel
        activeSession={worktreeSession({ id: 'truncated-session' })}
        events={[]}
        selectedPath={null}
        loadWorktreeDiff={vi.fn(async () => diff({ truncated: true, limitBytes: 128 }))}
      />
    );

    expect(await screen.findByText('Diff truncated at 128 bytes.')).toBeInTheDocument();

    rerender(
      <PreviewPanel
        activeSession={worktreeSession({ id: 'error-session' })}
        events={[]}
        selectedPath={null}
        loadWorktreeDiff={vi.fn(async () => {
          throw new Error('git failed');
        })}
      />
    );

    expect(await screen.findByText('Unable to load worktree diff: git failed')).toBeInTheDocument();
  });

  it('uses selectedPath, allows local selection, and falls back to transcript snippets', async () => {
    const loadWorktreeDiff = vi.fn(async () =>
      diff({
        diff: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n+changed',
        files: [{ path: 'web/src/App.tsx', status: 'modified', additions: 1, deletions: 0 }]
      })
    );
    const events = readReferenceEvents('/repo/one/web/src/PreviewPanel.tsx', 'preview snippet');

    const { rerender } = render(
      <PreviewPanel
        activeSession={worktreeSession()}
        events={events}
        selectedPath="web/src/PreviewPanel.tsx"
        loadWorktreeDiff={loadWorktreeDiff}
      />
    );

    const transcriptButton = await screen.findByRole('button', { name: /web\/src\/PreviewPanel.tsx/ });
    expect(transcriptButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Worktree diff' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transcript snippets' })).toBeInTheDocument();
    expect(screen.getByText('preview snippet')).toBeInTheDocument();

    rerender(<PreviewPanel activeSession={worktreeSession()} events={events} selectedPath={null} loadWorktreeDiff={loadWorktreeDiff} />);

    const diffButton = await screen.findByRole('button', { name: /web\/src\/App.tsx/ });
    fireEvent.click(diffButton);

    expect(diffButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Worktree diff' })).toBeInTheDocument();
    expect(screen.queryByText('preview snippet')).not.toBeInTheDocument();

    cleanup();
    render(
      <PreviewPanel
        activeSession={worktreeSession({ id: 'fallback-session' })}
        events={events}
        selectedPath="web/src/Missing.tsx"
        loadWorktreeDiff={vi.fn(async () => diff({ diff: '', files: [] }))}
      />
    );

    expect(await screen.findByRole('button', { name: /web\/src\/PreviewPanel.tsx/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no session selected when there is no active session', () => {
    render(<PreviewPanel activeSession={null} events={[]} selectedPath={null} />);

    expect(screen.getByText('No session selected.')).toBeInTheDocument();
  });
});
