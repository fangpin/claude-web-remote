import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import EventCard from './EventCard';
import type { UiEvent } from './types';

function event(payload: unknown, kind: UiEvent['kind'] = 'raw'): UiEvent {
  return {
    id: 1,
    sessionId: 's1',
    time: '2026-06-12T00:00:00Z',
    kind,
    payload
  };
}

describe('EventCard', () => {
  beforeEach(() => cleanup());
  it('renders assistant text from message field', () => {
    render(<EventCard event={event({ message: 'hello assistant' }, 'assistant')} />);
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('hello assistant')).toBeInTheDocument();
  });

  it('renders user text from stream content blocks', () => {
    render(<EventCard event={event({ type: 'user', message: { content: [{ type: 'text', text: 'please inspect the layout' }] } }, 'user')} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('please inspect the layout')).toBeInTheDocument();
  });

  it('renders tool name and input summary', () => {
    render(<EventCard event={event({ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }, 'tool')} />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getAllByText(/git status/).length).toBeGreaterThan(0);
  });

  it('renders error text', () => {
    render(<EventCard event={event({ error: 'failed to start' }, 'error')} />);
    expect(screen.getByText('failed to start')).toBeInTheDocument();
  });

  it('renders unknown payload as collapsible json', () => {
    render(<EventCard event={event({ unexpected: { nested: true } }, 'raw')} />);
    expect(screen.getByText('Raw event')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
    expect(screen.getByText(/unexpected/)).toBeInTheDocument();
  });
});
