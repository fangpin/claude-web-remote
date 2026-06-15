import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PermissionActionCard from './PermissionActionCard';
import type { PendingPermissionRequest, PermissionCapability } from './types';

const capability: PermissionCapability = { status: 'available' };
const permission: PendingPermissionRequest = {
  requestId: 'req-1',
  sessionId: 'session-1',
  hookSessionId: 'hook-1',
  toolName: 'Bash',
  toolInput: { command: 'npm --prefix web test' },
  summary: 'Run: npm --prefix web test',
  cwd: '/repo',
  permissionMode: 'default',
  status: 'pending',
  editable: 'bashCommand',
  decision: null,
  createdAt: '2026-06-14T00:00:00Z',
  resolvedAt: null
};

afterEach(() => cleanup());

describe('PermissionActionCard', () => {
  it('renders allow deny edit and details controls when capability is available', () => {
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={vi.fn()} onDeny={vi.fn()} />);

    expect(screen.getByText('Claude needs your permission')).toBeInTheDocument();
    expect(screen.getByText('Run: npm --prefix web test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit command' })).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('does not render action buttons when capability is unavailable', () => {
    render(
      <PermissionActionCard
        permission={permission}
        capability={{ status: 'unavailable', reason: 'hook unsupported' }}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.getByText(/hook unsupported/)).toBeInTheDocument();
  });

  it('allows an edited bash command', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={onAllow} onDeny={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit command' }));
    const input = screen.getByLabelText('Command to allow');
    await user.clear(input);
    await user.type(input, 'npm --prefix web run build');
    await user.click(screen.getByRole('button', { name: 'Allow edited command' }));

    expect(onAllow).toHaveBeenCalledWith(permission, { command: 'npm --prefix web run build' });
  });

  it('denies with a message', async () => {
    const user = userEvent.setup();
    const onDeny = vi.fn();
    render(<PermissionActionCard permission={permission} capability={capability} onAllow={vi.fn()} onDeny={onDeny} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await user.type(screen.getByLabelText('Denial message'), 'Run unit tests first');
    await user.click(screen.getByRole('button', { name: 'Send denial' }));

    expect(onDeny).toHaveBeenCalledWith(permission, 'Run unit tests first');
  });
});
