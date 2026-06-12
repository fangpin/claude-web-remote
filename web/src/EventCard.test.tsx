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

  it('renders assistant content arrays as chat text', () => {
    render(<EventCard event={event({ content: [{ type: 'text', text: 'hello assistant' }] }, 'assistant')} />);

    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('hello assistant')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
  });

  it('renders user messages as chat text', () => {
    render(<EventCard event={event({ message: 'please inspect this' }, 'user')} />);

    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('please inspect this')).toBeInTheDocument();
  });

  it('renders mixed nested text and tool blocks in order', () => {
    const { container } = render(
      <EventCard
        event={event(
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'before' },
                { type: 'tool_use', name: 'Bash', input: { command: 'pwd' } },
                { type: 'text', text: 'after' }
              ]
            }
          },
          'assistant'
        )}
      />
    );

    const articles = Array.from(container.querySelectorAll('article'));
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveTextContent('before');
    expect(articles[1]).toHaveTextContent('Bash');
    expect(articles[1]).toHaveTextContent('running');
    expect(articles[1]).toHaveTextContent(/pwd/);
    expect(articles[1].querySelector('.event-tool-details')?.hasAttribute('open')).toBe(true);
    expect(articles[2]).toHaveTextContent('after');
  });

  it('renders nested user tool results collapsed with output', () => {
    const { container } = render(
      <EventCard event={event({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } }, 'user')} />
    );

    expect(screen.getAllByText('tool')).toHaveLength(2);
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(container.querySelector('.event-tool-details')?.hasAttribute('open')).toBe(false);
  });

  it('renders running tool calls expanded with input', () => {
    const { container } = render(<EventCard event={event({ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }, 'tool')} />);

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getAllByText(/git status/).length).toBeGreaterThan(0);
    expect(container.querySelector('.event-tool-details')?.hasAttribute('open')).toBe(true);
  });

  it('renders completed tool results collapsed with output available', () => {
    const { container } = render(<EventCard event={event({ type: 'tool_result', name: 'Bash', result: 'done' }, 'tool')} />);

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(container.querySelector('.event-tool-details')?.hasAttribute('open')).toBe(false);
  });

  it('uses scoped modifier class for tool errors while preserving status text', () => {
    const { container } = render(<EventCard event={event({ type: 'tool_result', name: 'Bash', error: 'failed' }, 'tool')} />);

    const toolCard = container.querySelector('.event-tool');
    expect(toolCard?.classList.contains('is-error')).toBe(true);
    expect(toolCard?.classList.contains('error')).toBe(false);
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('renders error events as status blocks with a scoped modifier class', () => {
    const { container } = render(<EventCard event={event({ error: 'failed to start' }, 'error')} />);

    const statusCard = container.querySelector('.event-status');
    expect(statusCard?.classList.contains('is-error')).toBe(true);
    expect(statusCard?.classList.contains('error')).toBe(false);
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('failed to start')).toBeInTheDocument();
  });

  it('renders unknown payloads with collapsed raw json', () => {
    const { container } = render(<EventCard event={event({ unexpected: { nested: true } }, 'raw')} />);

    expect(screen.getByText('raw')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
    expect(screen.getByText(/unexpected/)).toBeInTheDocument();
    expect(container.querySelector('.event-json')?.hasAttribute('open')).toBe(false);
  });
});
