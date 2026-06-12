import { formatRawPayload, parseDisplayEvents, type DisplayEvent } from './eventDisplay';
import type { UiEvent } from './types';

function JsonDetails({ raw }: { raw: unknown }) {
  return (
    <details className="event-json">
      <summary>JSON payload</summary>
      <pre>{formatRawPayload(raw)}</pre>
    </details>
  );
}

function TextBlock({ children }: { children: string }) {
  return <div className="event-text">{children}</div>;
}

function eventStateClass(state: string) {
  return state === 'error' ? 'is-error' : state;
}

function DisplayArticle({ display, eventId }: { display: DisplayEvent; eventId?: string }) {
  if (display.kind === 'message') {
    return (
      <article id={eventId} className={`event event-message ${display.role}`}>
        <header className="event-header">
          <span>{display.label}</span>
        </header>
        <TextBlock>{display.text}</TextBlock>
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  if (display.kind === 'tool') {
    return (
      <article id={eventId} className={`event event-tool ${eventStateClass(display.status)}`}>
        <header className="event-header">
          <span>tool</span>
          <strong>{display.name}</strong>
          <em>{display.status}</em>
        </header>
        <details className="event-tool-details" open={display.defaultOpen}>
          <summary>Details</summary>
          {display.input && (
            <section className="event-section">
              <strong>Input</strong>
              <pre>{display.input}</pre>
            </section>
          )}
          {display.output && (
            <section className="event-section">
              <strong>Output</strong>
              <pre>{display.output}</pre>
            </section>
          )}
          {display.error && (
            <section className="event-section">
              <strong>Error</strong>
              <pre>{display.error}</pre>
            </section>
          )}
        </details>
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  if (display.kind === 'status') {
    return (
      <article id={eventId} className={`event event-status ${eventStateClass(display.tone)}`}>
        <header className="event-header">
          <span>{display.label}</span>
        </header>
        {display.text && <TextBlock>{display.text}</TextBlock>}
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  return (
    <article id={eventId} className="event event-status raw">
      <header className="event-header">
        <span>{display.label}</span>
      </header>
      <JsonDetails raw={display.raw} />
    </article>
  );
}

export default function EventCard({ event }: { event: UiEvent }) {
  return <>{parseDisplayEvents(event).map((display, index) => <DisplayArticle key={index} eventId={index === 0 ? `event-${event.id}` : undefined} display={display} />)}</>;
}
