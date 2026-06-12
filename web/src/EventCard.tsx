import type { UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null;
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isObject(item) && typeof item.text === 'string') return item.text;
        if (isObject(item) && typeof item.content === 'string') return item.content;
        return null;
      })
      .filter((item): item is string => Boolean(item?.trim()));
    return parts.length ? parts.join('\n\n') : null;
  }
  if (isObject(value)) {
    return textFromContent(value.content) ?? stringField(value, ['text', 'message']);
  }
  return null;
}

function toolName(payload: ObjectPayload): string | null {
  return stringField(payload, ['name', 'tool_name', 'toolName']);
}

function textContent(payload: ObjectPayload): string | null {
  return stringField(payload, ['text', 'status', 'error'])
    ?? textFromContent(payload.message)
    ?? textFromContent(payload.content);
}

function eventLabel(kind: string, type: string): string {
  if (kind === 'assistant') return 'Claude';
  if (kind === 'user') return 'You';
  if (kind === 'tool' || type === 'tool_use') return 'Tool use';
  if (type === 'tool_result') return 'Tool result';
  if (kind === 'system') return 'System';
  if (kind === 'error') return 'Error';
  return 'Raw event';
}

export default function EventCard({ event }: { event: UiEvent }) {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = typeof payload.type === 'string' ? payload.type : event.kind;
  const text = textContent(payload);
  const name = toolName(payload);
  const isTool = event.kind === 'tool' || type === 'tool_use' || type === 'tool_result';
  const label = eventLabel(event.kind, type);
  const showJson = (!text && !isTool) || event.kind === 'raw';

  return (
    <article className={`event event-${event.kind}`}>
      <header className="event-header">
        <span>{label}</span>
        {type !== event.kind && <em>{type}</em>}
      </header>

      {isTool && (
        <div className="event-section">
          <strong>{name ?? 'Tool'}</strong>
          {text && <pre className="event-text">{text}</pre>}
          {payload.input !== undefined && (
            <details className="event-json">
              <summary>Input</summary>
              <pre>{summarize(payload.input)}</pre>
            </details>
          )}
          {payload.result !== undefined && (
            <details className="event-json" open>
              <summary>Result</summary>
              <pre>{summarize(payload.result)}</pre>
            </details>
          )}
          {payload.content !== undefined && !text && <pre className="event-text">{summarize(payload.content)}</pre>}
        </div>
      )}

      {!isTool && text && <pre className="event-text">{text}</pre>}

      {showJson && (
        <details className="event-json" open={event.kind === 'raw'}>
          <summary>JSON payload</summary>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
