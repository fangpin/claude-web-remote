import RawEventDetails from './RawEventDetails';
import type { ConversationBlock, ErrorBlock, MessageBlock, RawBlock, TaskBlock, ToolBlock } from './conversationBlocks';
import ReactMarkdown, { type Components } from 'react-markdown';
import React, { useState } from 'react';
import './ConversationBlockList.css';

function roleLabel(role: MessageBlock['role']): string {
  if (role === 'assistant') return 'Claude';
  if (role === 'user') return 'You';
  return 'System';
}

function blockElementId(block: ConversationBlock): string | undefined {
  const firstEventId = block.eventIds[0];
  return firstEventId === undefined ? undefined : `event-${firstEventId}`;
}

function textFromReactNode(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join('');
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    return textFromReactNode(element.props.children);
  }
  return '';
}

function languageFromClassName(className?: string): string | undefined {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
}

function prettyLanguage(language?: string): string {
  if (!language) return 'Text';
  const labels: Record<string, string> = {
    js: 'JavaScript',
    jsx: 'JSX',
    ts: 'TypeScript',
    tsx: 'TSX',
    sh: 'Shell',
    bash: 'Bash',
    json: 'JSON',
    md: 'Markdown',
    py: 'Python',
    rs: 'Rust',
    yaml: 'YAML',
    yml: 'YAML'
  };
  return labels[language.toLowerCase()] ?? language;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Browser clipboard permission can be denied even for a user click; try the legacy path below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await copyToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button className="copy-button" type="button" onClick={onCopy} aria-label={label} title={label}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeFrame({
  code,
  language,
  children,
  className,
  variant = 'message'
}: {
  code: string;
  language?: string;
  children?: React.ReactNode;
  className?: string;
  variant?: 'message' | 'tool';
}) {
  return (
    <div className={`code-frame ${variant}-code-frame`}>
      <div className="code-frame-header">
        <span className="code-language">{prettyLanguage(language)}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className={className}>
        {children ?? <code className={language ? `language-${language}` : undefined}>{code}</code>}
      </pre>
    </div>
  );
}

function diffStats(code: string): { files: string[]; additions: number; deletions: number } {
  const files: string[] = [];
  let additions = 0;
  let deletions = 0;

  code.split('\n').forEach((line) => {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      files.push(match?.[2] ?? line.replace(/^diff --git\s+/, ''));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  });

  return { files: [...new Set(files)], additions, deletions };
}

function DiffResult({ code }: { code: string }) {
  const stats = diffStats(code);

  return (
    <div className="diff-preview">
      <div className="diff-summary" aria-label="Diff summary">
        <span>{stats.files.length || 1} changed {stats.files.length === 1 ? 'file' : 'files'}</span>
        <span className="diff-additions">+{stats.additions}</span>
        <span className="diff-deletions">-{stats.deletions}</span>
      </div>
      {stats.files.length > 0 && (
        <ul className="diff-file-list" aria-label="Changed files">
          {stats.files.slice(0, 4).map((file) => <li key={file} title={file}>{file}</li>)}
          {stats.files.length > 4 && <li>+ {stats.files.length - 4} more</li>}
        </ul>
      )}
      <CodeFrame code={code} language="diff" className="tool-result-pre diff" variant="tool">
        <code className="language-diff">
          {code.split('\n').map((line, index) => {
          const kind =
            line.startsWith('+') && !line.startsWith('+++')
              ? 'addition'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'deletion'
                : line.startsWith('@@')
                  ? 'hunk'
                  : line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
                    ? 'meta'
                    : 'context';
          return (
            <span className={`diff-line ${kind}`} key={`${index}-${line}`}>
              {line || ' '}
            </span>
          );
          })}
        </code>
      </CodeFrame>
    </div>
  );
}

const markdownComponents = {
  pre({ children }: { children?: React.ReactNode }) {
    const codeElement = React.Children.toArray(children).find(React.isValidElement) as
      | React.ReactElement<{ className?: string; children?: React.ReactNode }>
      | undefined;
    const language = languageFromClassName(codeElement?.props.className);
    const code = textFromReactNode(codeElement?.props.children ?? children).replace(/\n$/, '');
    return (
      <CodeFrame code={code} language={language} className="message-code">
        {children}
      </CodeFrame>
    );
  }
} satisfies Components;

function MessageMarkdown({ text }: { text: string }) {
  return (
    <div className="message-text">
      <ReactMarkdown components={markdownComponents} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block message-block ${block.role}`}>
      <header className="block-header message-header">
        <span className="message-author">
          <span className="message-avatar" aria-hidden="true">{block.role === 'assistant' ? 'C' : block.role === 'user' ? 'Y' : 'S'}</span>
          <span>{roleLabel(block.role)}</span>
        </span>
        <span>{block.eventIds.length === 1 ? '1 event' : `${block.eventIds.length} events`}</span>
      </header>
      <MessageMarkdown text={block.text} />
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function stripCodeFence(text: string): string {
  const match = /^```[A-Za-z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return match ? match[1] : text;
}

function pathLines(text: string): string[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ToolResultContent({ block }: { block: ToolBlock }) {
  if (block.resultKind === 'paths') {
    return (
      <div className="tool-path-frame">
        <div className="tool-path-header">
          <span>{pathLines(block.resultSummary).length} paths</span>
          <CopyButton text={block.resultSummary} label="Copy paths" />
        </div>
        <ul className="tool-path-list">
          {pathLines(block.resultSummary).map((path, index) => (
            <li key={`${path}-${index}`}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const code = block.resultKind === 'code' ? stripCodeFence(block.resultSummary) : block.resultSummary;
  if (block.resultKind === 'diff') return <DiffResult code={code} />;

  return (
    <CodeFrame code={code} language={block.resultLanguage} className={`tool-result-pre ${block.resultKind}`} variant="tool" />
  );
}

function toolResultTitle(block: ToolBlock): string {
  if (block.status === 'failed') return 'Failure';
  if (block.resultKind === 'diff') return 'Diff';
  if (block.resultKind === 'code') return block.resultLanguage ? `Code · ${block.resultLanguage}` : 'Code';
  if (block.resultKind === 'paths') return 'Paths';
  return 'Result';
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block tool-block ${block.status} result-${block.resultKind}${block.density === 'compact' ? ' compact' : ''}`}>
      <header className="block-header tool-activity-header">
        <span className="tool-name">{block.name}</span>
        <span className={`tool-status tool-status-${block.status}`}>
          <span className="tool-status-dot" aria-hidden="true" />
          {block.status}
        </span>
      </header>
      <div className="tool-activity-body">
        {block.inputSummary.trim() && <p className="tool-input-summary">{block.inputSummary}</p>}
        {block.resultLabel && <p className="tool-result-label">{block.resultLabel}</p>}
      </div>
      {(block.resultSummary.trim() || block.rawEvents.length > 0) && (
        <details className="block-section tool-result collapsed-result tool-details">
          <summary>{block.status === 'running' ? 'Details' : block.resultLabel || 'Details'}</summary>
          {block.resultSummary.trim() && block.resultDisplay !== 'hidden' && (
            <section className="tool-result-detail">
              <h4>{toolResultTitle(block)}</h4>
              <ToolResultContent block={block} />
            </section>
          )}
          <RawEventDetails rawEvents={block.rawEvents} />
        </details>
      )}
    </article>
  );
}

function TaskBlockView({ block }: { block: TaskBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block task-block ${block.status}${block.density === 'compact' ? ' compact' : ''}`}>
      <header className="block-header task-header">
        <span className="task-title-row">
          <span className="task-status-dot" aria-hidden="true" />
          <span className="task-title">{block.title}</span>
        </span>
        <span className="task-meta-row">
          <span className="task-source">{block.source}</span>
          <span className="task-status">{block.status}</span>
        </span>
      </header>
      <p className="task-summary">{block.summary}</p>
      {block.completionSummary && (
        <section className="task-result">
          <h4>Completed</h4>
          <p>{block.completionSummary}</p>
        </section>
      )}
      {block.failureSummary && (
        <section className="task-result task-failure">
          <h4>Failed</h4>
          <p>{block.failureSummary}</p>
        </section>
      )}
      {block.detail && (
        <details className="block-section task-detail">
          <summary>Details</summary>
          <pre>{block.detail}</pre>
        </details>
      )}
      {block.outputPath && (
        <section className="block-section output-path">
          <h4>Output</h4>
          <code>{block.outputPath}</code>
        </section>
      )}
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ErrorBlockView({ block }: { block: ErrorBlock }) {
  return (
    <article id={blockElementId(block)} className="conversation-block error-block">
      <header className="block-header">
        <span>Error</span>
      </header>
      <p>{block.message}</p>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function RawBlockView({ block }: { block: RawBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block raw-block ${block.severity ?? 'info'}`}>
      <header className="block-header">
        <span>{block.label}</span>
      </header>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ConversationBlockView({ block }: { block: ConversationBlock }) {
  if (block.type === 'anchor') return <span id={blockElementId(block)} className="conversation-anchor" aria-hidden="true" />;
  if (block.type === 'message') return <MessageBlockView block={block} />;
  if (block.type === 'tool') return <ToolBlockView block={block} />;
  if (block.type === 'task') return <TaskBlockView block={block} />;
  if (block.type === 'error') return <ErrorBlockView block={block} />;
  return <RawBlockView block={block} />;
}

export default function ConversationBlockList({ blocks }: { blocks: ConversationBlock[] }) {
  return (
    <div className="conversation-blocks">
      {blocks.map((block) => (
        <ConversationBlockView key={block.id} block={block} />
      ))}
    </div>
  );
}
