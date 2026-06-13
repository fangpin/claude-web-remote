import RawEventDetails from './RawEventDetails';
import type { ConversationBlock, ErrorBlock, MessageBlock, RawBlock, TaskBlock, ToolBlock } from './conversationBlocks';
import ReactMarkdown, { type Components } from 'react-markdown';
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

const markdownComponents: Components = {
  pre({ children }) {
    return <pre className="message-code">{children}</pre>;
  }
};

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
