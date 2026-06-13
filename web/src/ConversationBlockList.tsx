import ReactMarkdown from 'react-markdown';
import RawEventDetails from './RawEventDetails';
import type { ConversationBlock, ErrorBlock, MessageBlock, RawBlock, TaskBlock, ToolBlock } from './conversationBlocks';

function roleLabel(role: MessageBlock['role']): string {
  if (role === 'assistant') return 'Claude';
  if (role === 'user') return 'You';
  return 'System';
}

function blockElementId(block: ConversationBlock): string | undefined {
  const firstEventId = block.eventIds[0];
  return firstEventId === undefined ? undefined : `event-${firstEventId}`;
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block message-block ${block.role}`}>
      <header className="block-header">
        <span>{roleLabel(block.role)}</span>
      </header>
      <div className="message-text">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              return (
                <code className={className ?? 'inline-code'} {...props}>
                  {children}
                </code>
              );
            }
          }}
        >
          {block.text}
        </ReactMarkdown>
      </div>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block tool-block ${block.status}`}>
      <header className="block-header">
        <span>{block.name}</span>
        <span>{block.status}</span>
      </header>
      {block.inputSummary.trim() && (
        <section className="block-section">
          <h4>Input</h4>
          <pre>{block.inputSummary}</pre>
        </section>
      )}
      {block.resultSummary.trim() && block.resultDisplay === 'visible' && (
        <section className="block-section">
          <h4>Result</h4>
          <pre>{block.resultSummary}</pre>
        </section>
      )}
      {block.resultSummary.trim() && block.resultDisplay === 'collapsed' && (
        <details className="block-section collapsed-result">
          <summary>Result</summary>
          <pre>{block.resultSummary}</pre>
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
        <span>{block.title}</span>
        <span>{block.source}</span>
        <span>{block.status}</span>
      </header>
      <p>{block.summary}</p>
      {block.outputPath && (
        <section className="block-section output-path">
          <h4>Output path</h4>
          <pre>{block.outputPath}</pre>
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
