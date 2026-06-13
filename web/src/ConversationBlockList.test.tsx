/// <reference types="node" />

import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import ConversationBlockList from './ConversationBlockList';
import type { ConversationBlock } from './conversationBlocks';

const rawEvent = (id: number, payload: unknown) => ({ id, kind: 'raw' as const, payload });
const appCss = () => {
  const appCssPath = './App.css';
  return readFileSync(new URL(appCssPath, import.meta.url), 'utf8');
};

describe('ConversationBlockList', () => {
  beforeEach(() => cleanup());

  it('renders assistant messages as readable text including code blocks', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'message-1',
        type: 'message',
        role: 'assistant',
        text: 'Here is a snippet:\n\n```ts\nconst answer = 42;\n```',
        eventIds: [1],
        rawEvents: [rawEvent(1, { message: 'Here is a snippet' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'message-block', 'assistant');
    expect(within(article).getByText('Claude').closest('header')).toHaveClass('block-header');
    expect(within(article).getByText(/const answer = 42/)).toHaveClass('message-text');
    expect(within(article).getByText('Raw events')).toBeInTheDocument();
  });

  it('renders tool activity with compact input and result sections', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-1',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: 'command: git status',
        resultSummary: 'On branch main',
        resultDisplay: 'visible',
        eventIds: [2, 3],
        rawEvents: [rawEvent(2, { name: 'Bash' }), rawEvent(3, { result: 'On branch main' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'tool-block', 'completed');
    expect(within(article).getByText('Bash')).toBeInTheDocument();
    expect(within(article).getByText('completed').closest('header')).toHaveClass('block-header');
    expect(within(article).getByText('Input').closest('section')).toHaveClass('block-section');
    expect(within(article).getByText('command: git status')).toBeInTheDocument();
    expect(within(article).getByText('Result').closest('section')).toHaveClass('block-section');
    expect(within(article).getByText('On branch main')).toBeInTheDocument();
  });

  it('hides Read tool result output from the main card while keeping raw details', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-read',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        inputSummary: 'file_path: /tmp/a.txt',
        resultSummary: 'secret file contents',
        resultDisplay: 'hidden',
        eventIds: [10, 11],
        rawEvents: [rawEvent(10, { name: 'Read' }), rawEvent(11, { content: 'secret file contents' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(within(article).getByText('Read')).toBeInTheDocument();
    expect(within(article).getByText('file_path: /tmp/a.txt')).toBeInTheDocument();
    expect(within(article).queryByText('Result')).not.toBeInTheDocument();
    expect(within(article).queryByText('secret file contents')).not.toBeInTheDocument();
    expect(within(article).getByText('Raw events')).toBeInTheDocument();
  });

  it('collapses Bash tool result output by default', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-bash',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: 'command: npm test',
        resultSummary: 'long stdout',
        resultDisplay: 'collapsed',
        eventIds: [12, 13],
        rawEvents: [rawEvent(12, { name: 'Bash' }), rawEvent(13, { content: 'long stdout' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    const details = within(article).getByText('Result').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('long stdout');
  });

  it('renders task activity with output path when present', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'task-1',
        type: 'task',
        title: 'Run backend checks',
        source: 'Bash',
        status: 'running',
        summary: 'Task started in background',
        outputPath: '/tmp/backend-check.log',
        eventIds: [4],
        rawEvents: [rawEvent(4, { outputPath: '/tmp/backend-check.log' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'task-block', 'running');
    expect(within(article).getByText('Run backend checks').closest('header')).toHaveClass(
      'block-header',
      'task-header'
    );
    expect(within(article).getByText('Bash')).toBeInTheDocument();
    expect(within(article).getByText('running')).toBeInTheDocument();
    expect(within(article).getByText('Task started in background')).toBeInTheDocument();
    expect(within(article).getByText('Output path').closest('section')).toHaveClass(
      'block-section',
      'output-path'
    );
    expect(within(article).getByText('/tmp/backend-check.log')).toBeInTheDocument();
  });

  it('uses distinct classes for messages, tools, tasks, and raw details', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'message-user-1',
        type: 'message',
        role: 'user',
        text: 'hello',
        eventIds: [1],
        rawEvents: [rawEvent(1, { message: 'hello' })]
      },
      {
        id: 'message-system-1',
        type: 'message',
        role: 'system',
        text: 'system reminder',
        eventIds: [2],
        rawEvents: [rawEvent(2, { message: 'system reminder' })]
      },
      {
        id: 'tool-2',
        type: 'tool',
        name: 'Read',
        status: 'running',
        inputSummary: 'file_path: /tmp/a.txt',
        resultSummary: '',
        resultDisplay: 'visible',
        eventIds: [3],
        rawEvents: [rawEvent(3, { name: 'Read' })]
      },
      {
        id: 'task-3',
        type: 'task',
        title: 'Explore',
        source: 'Agent',
        status: 'pending',
        summary: 'queued',
        eventIds: [4],
        rawEvents: [rawEvent(4, { summary: 'queued' })]
      }
    ];

    const { container } = render(<ConversationBlockList blocks={blocks} />);

    expect(container.querySelector('.message-block.user')).not.toBeNull();
    expect(container.querySelector('.message-block.system')).not.toBeNull();
    expect(container.querySelector('.tool-block.running')).not.toBeNull();
    expect(container.querySelector('.task-block.pending')).not.toBeNull();
    expect(container.querySelectorAll('.raw-event-details')).toHaveLength(4);
  });

  it('keeps App.css selectors aligned with rendered conversation block DOM', () => {
    const css = appCss();

    expect(css).toMatch(/\.conversation-workspace\s*{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s);
    expect(css).toMatch(/\.message-block\.system\b/);
    expect(css).toMatch(/\.task-block\.pending\b/);
    expect(css).not.toMatch(/\.task-header\s+small/);
    expect(css).not.toMatch(/\.task-header\s*>\s*div/);
    expect(css).not.toMatch(/\.block-section\s+strong/);
    expect(css).not.toMatch(/\.output-path\s+code/);
  });

  it('renders error and raw fallback blocks', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'error-1',
        type: 'error',
        message: 'Something failed',
        eventIds: [5],
        rawEvents: [rawEvent(5, { error: 'Something failed' })]
      },
      {
        id: 'raw-1',
        type: 'raw',
        label: 'unknown_event',
        eventIds: [6],
        rawEvents: [rawEvent(6, { unexpected: true })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveClass('conversation-block', 'error-block');
    expect(within(articles[0]).getByText('Error').closest('header')).toHaveClass('block-header');
    expect(within(articles[0]).getByText('Something failed')).toBeInTheDocument();
    expect(articles[1]).toHaveClass('conversation-block', 'raw-block');
    expect(within(articles[1]).getByText('unknown_event').closest('header')).toHaveClass('block-header');
  });

  it('renders raw event details with pretty JSON for message, tool, task, error, and raw blocks', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'message-raw',
        type: 'message',
        role: 'user',
        text: 'hello',
        eventIds: [7],
        rawEvents: [rawEvent(7, { messageNested: { ok: true } })]
      },
      {
        id: 'tool-raw',
        type: 'tool',
        name: 'Read',
        status: 'running',
        inputSummary: 'file_path: /tmp/example.txt',
        resultSummary: '',
        resultDisplay: 'visible',
        eventIds: [8],
        rawEvents: [rawEvent(8, { toolNested: { path: '/tmp/example.txt' } })]
      },
      {
        id: 'task-raw',
        type: 'task',
        title: 'Run tests',
        source: 'Bash',
        status: 'completed',
        summary: 'Tests passed',
        eventIds: [9],
        rawEvents: [rawEvent(9, { taskNested: { exitCode: 0 } })]
      },
      {
        id: 'error-raw',
        type: 'error',
        message: 'Boom',
        eventIds: [10],
        rawEvents: [rawEvent(10, { errorNested: { message: 'Boom' } })]
      },
      {
        id: 'fallback-raw',
        type: 'raw',
        label: 'unknown_event',
        eventIds: [11],
        rawEvents: [rawEvent(11, { rawNested: { preserved: true } })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const articles = screen.getAllByRole('article');
    const expectedRawFragments = [
      ['"messageNested": {', '"ok": true'],
      ['"toolNested": {', '"path": "/tmp/example.txt"'],
      ['"taskNested": {', '"exitCode": 0'],
      ['"errorNested": {', '"message": "Boom"'],
      ['"rawNested": {', '"preserved": true']
    ];

    articles.forEach((article, index) => {
      const details = within(article).getByText('Raw events').closest('details');
      expect(details).toHaveClass('raw-event-details');
      expectedRawFragments[index].forEach((fragment) => {
        expect(details).toHaveTextContent(fragment);
      });
    });
  });
});
