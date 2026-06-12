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

function toolName(payload: ObjectPayload): string | null {
  return stringField(payload, ['name', 'tool_name', 'toolName']);
}

function textContent(payload: ObjectPayload): string | null {
  return stringField(payload, ['message', 'text', 'content', 'status', 'error']);
}

export default function EventCard({ event }: { event: UiEvent }) {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = typeof payload.type === 'string' ? payload.type : event.kind;
  const text = textContent(payload);
  const name = toolName(payload);
  const isTool = event.kind === 'tool' || type === 'tool_use' || type === 'tool_result';

  return (
    <article className={`event ${event.kind}`}>
      <header className="event-header">
        <span>{event.kind}</span>
        {type !== event.kind && <em>{type}</em>}
      </header>

      {isTool && (
        <div className="event-section">
          <strong>{name ?? 'tool'}</strong>
          {payload.input !== undefined && <pre>{summarize(payload.input)}</pre>}
          {payload.result !== undefined && <pre>{summarize(payload.result)}</pre>}
          {payload.content !== undefined && !text && <pre>{summarize(payload.content)}</pre>}
        </div>
      )}

      {!isTool && text && <pre>{text}</pre>}

      {(!text || event.kind === 'raw') && (
        <details className="event-json" open={event.kind === 'raw'}>
          <summary>JSON payload</summary>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
