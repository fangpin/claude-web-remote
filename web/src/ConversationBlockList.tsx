import RawEventDetails from './RawEventDetails';
import type { ConversationBlock, ErrorBlock, MessageBlock, RawBlock, TaskBlock, ToolBlock } from './conversationBlocks';
import { createElement, type ReactNode } from 'react';
import './ConversationBlockList.css';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type MarkdownBlock =
  | { type: 'heading'; level: HeadingLevel; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; code: string };

function roleLabel(role: MessageBlock['role']): string {
  if (role === 'assistant') return 'Claude';
  if (role === 'user') return 'You';
  return 'System';
}

function blockElementId(block: ConversationBlock): string | undefined {
  const firstEventId = block.eventIds[0];
  return firstEventId === undefined ? undefined : `event-${firstEventId}`;
}

function headingFromLine(line: string): MarkdownBlock | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  return { type: 'heading', level: match[1].length as HeadingLevel, text: match[2] };
}

function listItemFromLine(line: string): { ordered: boolean; text: string } | null {
  const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
  if (unordered) return { ordered: false, text: unordered[1] };

  const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
  if (ordered) return { ordered: true, text: ordered[1] };

  return null;
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join('\n').trim();
    if (joined) blocks.push({ type: 'paragraph', text: joined });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^```([A-Za-z0-9_-]+)?\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', language: fence[1] ?? '', code: codeLines.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = headingFromLine(line);
    if (heading) {
      flushParagraph();
      blocks.push(heading);
      continue;
    }

    const listItem = listItemFromLine(line);
    if (listItem) {
      flushParagraph();
      const items = [listItem.text];
      const ordered = listItem.ordered;
      while (index + 1 < lines.length) {
        const nextItem = listItemFromLine(lines[index + 1]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        items.push(nextItem.text);
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<code key={`code-${match.index}`}>{match[1]}</code>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineLines(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => {
    const nodes = renderInline(line);
    return index === 0 ? nodes : [<br key={`br-${index}`} />, ...nodes];
  });
}

function MessageMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="message-text">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return createElement(`h${block.level}`, { key: index }, renderInline(block.text));
        }

        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineLines(item)}</li>
              ))}
            </List>
          );
        }

        if (block.type === 'code') {
          return (
            <pre key={index} className="message-code">
              <code className={block.language ? `language-${block.language}` : undefined}>{block.code}</code>
            </pre>
          );
        }

        return <p key={index}>{renderInlineLines(block.text)}</p>;
      })}
    </div>
  );
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block message-block ${block.role}`}>
      <header className="block-header">
        <span>{roleLabel(block.role)}</span>
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
      <ul className="tool-path-list">
        {pathLines(block.resultSummary).map((path, index) => (
          <li key={`${path}-${index}`}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    );
  }

  const code = block.resultKind === 'code' ? stripCodeFence(block.resultSummary) : block.resultSummary;
  const languageClass = block.resultLanguage ? `language-${block.resultLanguage}` : undefined;

  return (
    <pre className={`tool-result-pre ${block.resultKind}`}>
      <code className={languageClass}>{code}</code>
    </pre>
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
    <article id={blockElementId(block)} className={`conversation-block tool-block ${block.status} result-${block.resultKind}`}>
      <header className="block-header tool-activity-header">
        <span className="tool-name">{block.name}</span>
        <span className="tool-status">{block.status}</span>
      </header>
      <div className="tool-activity-body">
        {block.inputSummary.trim() && <p className="tool-input-summary">{block.inputSummary}</p>}
        {block.resultLabel && <p className="tool-result-label">{block.resultLabel}</p>}
      </div>
      {block.resultSummary.trim() && block.resultDisplay === 'visible' && (
        <section className="block-section tool-result visible-result">
          <h4>{toolResultTitle(block)}</h4>
          <ToolResultContent block={block} />
        </section>
      )}
      {block.resultSummary.trim() && block.resultDisplay === 'collapsed' && (
        <details className="block-section tool-result collapsed-result">
          <summary>{block.resultLabel}</summary>
          <ToolResultContent block={block} />
        </details>
      )}
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function TaskBlockView({ block }: { block: TaskBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block task-block ${block.status}`}>
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
    <article id={blockElementId(block)} className="conversation-block raw-block">
      <header className="block-header">
        <span>{block.label}</span>
      </header>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ConversationBlockView({ block }: { block: ConversationBlock }) {
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
