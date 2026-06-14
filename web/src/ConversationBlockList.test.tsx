/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationBlockList from './ConversationBlockList';
import type { ConversationBlock } from './conversationBlocks';

const rawEvent = (id: number, payload: unknown) => ({ id, kind: 'raw' as const, payload });
const appCss = () => {
  const appCssPath = './App.css';
  return readFileSync(new URL(appCssPath, import.meta.url), 'utf8');
};

describe('ConversationBlockList', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());

  it('renders assistant messages as Markdown', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'message-1',
        type: 'message',
        role: 'assistant',
        text: '# Summary\n\nHere is `inline code` in a paragraph.\n\n- first item\n- second item\n\n```ts\nconst answer = 42;\n```',
        eventIds: [1],
        rawEvents: [rawEvent(1, { message: 'Here is a snippet' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'message-block', 'assistant');
    expect(within(article).getByText('Claude').closest('header')).toHaveClass('block-header', 'message-header');
    expect(within(article).getByText('C')).toHaveClass('message-avatar');
    expect(within(article).getByRole('heading', { name: 'Summary', level: 1 })).toBeInTheDocument();
    expect(within(article).getByRole('heading', { name: 'Summary', level: 1 }).closest('.message-text')).toHaveClass('message-text');
    expect(within(article).getByText('inline code')).toHaveProperty('tagName', 'CODE');
    expect(within(article).getByText('first item')).toHaveProperty('tagName', 'LI');
    expect(within(article).getByText(/const answer = 42/).closest('pre')).toHaveClass('message-code');
    expect(within(article).getByText('TypeScript')).toHaveClass('code-language');
    expect(within(article).getByRole('button', { name: 'Copy code' })).toHaveClass('copy-button');
    expect(within(article).getByText('Raw events')).toBeInTheDocument();
  });

  it('uses react-markdown for richer message Markdown without rendering raw HTML', () => {
    const longPath = '/Users/example/repos/claude-web-remote/web/src/ConversationBlockList.tsx';
    const blocks: ConversationBlock[] = [
      {
        id: 'message-rich-markdown',
        type: 'message',
        role: 'assistant',
        text: [
          'Before',
          '',
          '- parent item',
          '  - nested item with **strong text**',
          '',
          `See [component](${longPath}) and \`${longPath}\`.`,
          '[unsafe link](javascript:alert(1))',
          '',
          '<img src=x onerror=alert(1)>',
          '<script>alert("xss")</script>'
        ].join('\n'),
        eventIds: [2],
        rawEvents: [rawEvent(2, { message: 'rich markdown' })]
      }
    ];

    const { container } = render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    const nestedItem = within(article).getByText(/nested item with/).closest('li');
    expect(nestedItem).not.toBeNull();
    expect(nestedItem?.closest('ul')?.closest('li')).toHaveTextContent('parent item');
    expect(within(article).getByText('strong text')).toHaveProperty('tagName', 'STRONG');
    expect(within(article).getByRole('link', { name: 'component' })).toHaveAttribute('href', longPath);
    expect(within(article).getByText('unsafe link')).toHaveAttribute('href', '');
    expect(within(article).getByText(longPath)).toHaveProperty('tagName', 'CODE');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(article).not.toHaveTextContent('onerror');
    expect(article).not.toHaveTextContent('alert("xss")');
  });

  it('renders user and system messages with clear hierarchy', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'message-user-1',
        type: 'message',
        role: 'user',
        text: 'Please run:\n\n1. tests\n2. build',
        eventIds: [1],
        rawEvents: [rawEvent(1, { message: 'Please run' })]
      },
      {
        id: 'message-system-2',
        type: 'message',
        role: 'system',
        text: 'Session resumed',
        eventIds: [2],
        rawEvents: [rawEvent(2, { message: 'Session resumed' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveClass('message-block', 'user');
    expect(within(articles[0]).getByText('You')).toBeInTheDocument();
    expect(within(articles[0]).getByText('tests')).toHaveProperty('tagName', 'LI');
    expect(articles[1]).toHaveClass('message-block', 'system');
    expect(within(articles[1]).getByText('System')).toBeInTheDocument();
    expect(within(articles[1]).getByText('Session resumed')).toHaveProperty('tagName', 'P');
  });

  it('renders tool activity with compact input and result sections', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-1',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: '$ git status',
        resultSummary: 'On branch main',
        resultKind: 'text',
        resultDisplay: 'visible',
        resultLabel: 'Result shown (14 chars)',
        eventIds: [2, 3],
        rawEvents: [rawEvent(2, { name: 'Bash' }), rawEvent(3, { result: 'On branch main' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'tool-block', 'completed');
    expect(within(article).getByText('Bash')).toBeInTheDocument();
    expect(within(article).getByText('completed').closest('header')).toHaveClass('tool-activity-header');
    expect(within(article).getByText('completed').closest('.tool-status')).toHaveClass('tool-status-completed');
    expect(within(article).getByText('$ git status')).toBeInTheDocument();
    expect(within(article).getAllByText('Result shown (14 chars)')).toHaveLength(2);
    const details = within(article).getByText('On branch main').closest('details');
    expect(details).toHaveClass('tool-details');
    expect(details).not.toHaveAttribute('open');
  });

  it('hides Read tool result output from the main card while keeping raw details', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-read',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        inputSummary: '/tmp/a.txt',
        resultSummary: 'Read output hidden (20 chars)',
        resultKind: 'text',
        resultDisplay: 'hidden',
        resultLabel: 'Read output hidden (20 chars)',
        eventIds: [10, 11],
        rawEvents: [rawEvent(10, { name: 'Read' }), rawEvent(11, { content: 'secret file contents' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(within(article).getByText('Read')).toBeInTheDocument();
    expect(within(article).getByText('/tmp/a.txt')).toBeInTheDocument();
    expect(within(article).getAllByText('Read output hidden (20 chars)')).toHaveLength(2);
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
        inputSummary: '$ npm test',
        resultSummary: 'long stdout',
        resultKind: 'text',
        resultDisplay: 'collapsed',
        resultLabel: 'Result collapsed (11 chars)',
        eventIds: [12, 13],
        rawEvents: [rawEvent(12, { name: 'Bash' }), rawEvent(13, { content: 'long stdout' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(within(article).getAllByText('Result collapsed (11 chars)')).toHaveLength(2);
    const details = within(article).getByText('long stdout').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('long stdout');
  });

  it('renders failed tool output as an expanded failure panel', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-fail',
        type: 'tool',
        name: 'Bash',
        status: 'failed',
        inputSummary: '$ npm test',
        resultSummary: 'Command failed with exit code 1',
        resultKind: 'text',
        resultDisplay: 'visible',
        resultLabel: 'Failed result shown (31 chars)',
        eventIds: [14, 15],
        rawEvents: [rawEvent(14, { name: 'Bash' }), rawEvent(15, { content: 'Command failed with exit code 1' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('tool-block', 'failed', 'result-text');
    expect(within(article).getByText('Failure').closest('section')).toHaveClass('tool-result-detail');
    expect(within(article).getByText('Command failed with exit code 1').closest('pre')).toHaveClass('tool-result-pre', 'text');
    expect(within(article).getByRole('button', { name: 'Copy code' })).toHaveClass('copy-button');
  });

  it('renders diff, code, and path tool results with semantic containers', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-diff',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: '$ git diff',
        resultSummary: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new',
        resultKind: 'diff',
        resultLanguage: 'diff',
        resultDisplay: 'visible',
        resultLabel: 'Result shown (51 chars)',
        eventIds: [16],
        rawEvents: [rawEvent(16, { content: 'diff' })]
      },
      {
        id: 'tool-code',
        type: 'tool',
        name: 'Read',
        status: 'failed',
        inputSummary: '/repo/web/src/App.tsx',
        resultSummary: '```tsx\nconst answer = 42;\n```',
        resultKind: 'code',
        resultLanguage: 'tsx',
        resultDisplay: 'visible',
        resultLabel: 'Failed result shown (28 chars)',
        eventIds: [17],
        rawEvents: [rawEvent(17, { content: 'code' })]
      },
      {
        id: 'tool-paths',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: '$ rg --files',
        resultSummary: 'web/src/App.tsx\nweb/src/ConversationBlockList.tsx',
        resultKind: 'paths',
        resultDisplay: 'visible',
        resultLabel: 'Result shown (49 chars)',
        eventIds: [18],
        rawEvents: [rawEvent(18, { content: 'paths' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const articles = screen.getAllByRole('article');
    expect(within(articles[0]).getByText('Diff')).toBeInTheDocument();
    expect(within(articles[0]).getByText(/diff --git/).closest('pre')).toHaveClass('tool-result-pre', 'diff');
    expect(within(articles[0]).getByText('-old')).toHaveClass('diff-line', 'deletion');
    expect(within(articles[0]).getByText('+new')).toHaveClass('diff-line', 'addition');
    expect(within(articles[0]).getByRole('button', { name: 'Copy code' })).toHaveClass('copy-button');
    expect(within(articles[1]).getByText('Failure')).toBeInTheDocument();
    expect(within(articles[1]).getByText('TSX')).toHaveClass('code-language');
    expect(within(articles[1]).getByText('const answer = 42;')).toHaveProperty('tagName', 'CODE');
    expect(within(articles[1]).getByText('const answer = 42;').closest('pre')).toHaveClass('tool-result-pre', 'code');
    expect(within(articles[2]).getByText('Paths')).toBeInTheDocument();
    expect(within(articles[2]).getByText('web/src/App.tsx').closest('ul')).toHaveClass('tool-path-list');
    expect(within(articles[2]).getByText('2 paths')).toBeInTheDocument();
    expect(within(articles[2]).getByRole('button', { name: 'Copy paths' })).toHaveClass('copy-button');
  });

  it('copies rendered code, diffs, and paths without exposing raw details by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const blocks: ConversationBlock[] = [
      {
        id: 'message-copy',
        type: 'message',
        role: 'assistant',
        text: '```ts\nconst copied = true;\n```',
        eventIds: [19],
        rawEvents: [rawEvent(19, { content: '```ts\nconst copied = true;\n```', rawOnly: true })]
      },
      {
        id: 'tool-copy-diff',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: '$ git diff',
        resultSummary: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new',
        resultKind: 'diff',
        resultLanguage: 'diff',
        resultDisplay: 'visible',
        resultLabel: 'Result shown (51 chars)',
        eventIds: [20],
        rawEvents: [rawEvent(20, { content: 'raw diff payload' })]
      },
      {
        id: 'tool-copy-paths',
        type: 'tool',
        name: 'Glob',
        status: 'completed',
        inputSummary: '**/*.tsx',
        resultSummary: 'web/src/App.tsx\nweb/src/ConversationBlockList.tsx',
        resultKind: 'paths',
        resultDisplay: 'visible',
        resultLabel: 'Result shown (49 chars)',
        eventIds: [21],
        rawEvents: [rawEvent(21, { content: 'raw paths payload' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const articles = screen.getAllByRole('article');
    articles.forEach((article) => {
      expect(within(article).getByText('Raw events').closest('details')).not.toHaveAttribute('open');
    });

    fireEvent.click(within(articles[0]).getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const copied = true;'));
    expect(within(articles[0]).getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copied');

    fireEvent.click(within(articles[1]).getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new'));

    fireEvent.click(within(articles[2]).getByRole('button', { name: 'Copy paths' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('web/src/App.tsx\nweb/src/ConversationBlockList.tsx'));
  });

  it('falls back to textarea copy when clipboard permissions fail', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('not allowed');
    });
    const execCommand = vi.fn(() => true);
    const originalExecCommand = document.execCommand;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    const blocks: ConversationBlock[] = [
      {
        id: 'message-copy-fallback',
        type: 'message',
        role: 'assistant',
        text: '```ts\nconst fallback = true;\n```',
        eventIds: [22],
        rawEvents: [rawEvent(22, { message: 'copy fallback raw' })]
      }
    ];

    try {
      render(<ConversationBlockList blocks={blocks} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

      await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
      expect(writeText).toHaveBeenCalledWith('const fallback = true;');
      expect(screen.getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copied');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', { configurable: true, value: originalExecCommand });
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  it('renders task activity with output path when present', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'task-1',
        type: 'task',
        title: 'Run backend checks',
        source: 'Background Bash',
        status: 'running',
        summary: 'Started in background.',
        detail: 'npm test',
        outputPath: '/tmp/backend-check.log',
        eventIds: [4],
        rawEvents: [rawEvent(4, { outputPath: '/tmp/backend-check.log' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(article).toHaveClass('conversation-block', 'task-block', 'running');
    expect(within(article).getByText('Background Bash').closest('header')).toHaveClass(
      'block-header',
      'task-header'
    );
    expect(within(article).getByText('Run backend checks').closest('.task-title-row')).not.toBeNull();
    expect(within(article).getByText('running')).toHaveClass('task-status');
    expect(within(article).getByText('Started in background.')).toBeInTheDocument();
    expect(within(article).getByText('Details').closest('details')).toHaveClass('task-detail');
    expect(within(article).getByText('npm test')).toBeInTheDocument();
    expect(within(article).getByText('Output').closest('section')).toHaveClass(
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
        resultKind: 'text',
        resultDisplay: 'visible',
        resultLabel: 'Waiting for result',
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

    expect(css).toMatch(/\.conversation-workspace\s*{[^}]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/s);
    expect(css).toMatch(/\.message-block\.system\b/);
    expect(css).toMatch(/\.message-text h1\b/);
    expect(css).toMatch(/\.message-text ul,/);
    expect(css).toMatch(/\.message-text \.message-code\b/);
    expect(css).toMatch(/\.task-block\.pending\b/);
    expect(css).not.toMatch(/\.task-header\s+small/);
    expect(css).not.toMatch(/\.task-header\s*>\s*div/);
    expect(css).not.toMatch(/\.block-section\s+strong/);
    expect(css).toMatch(/\.output-(path|value)\b/);
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
        resultKind: 'text',
        resultDisplay: 'visible',
        resultLabel: 'Waiting for result',
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
      expect(details).not.toHaveAttribute('open');
      expectedRawFragments[index].forEach((fragment) => {
        expect(details).toHaveTextContent(fragment);
      });
    });
  });
});
