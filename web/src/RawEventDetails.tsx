import type { RawEventRef } from './conversationBlocks';

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function rawEventSummary(rawEvents: RawEventRef[]): string {
  const kinds = Array.from(new Set(rawEvents.map((event) => event.kind)));
  return [countLabel(rawEvents.length, 'event'), kinds.join(', ')].filter(Boolean).join(' · ');
}

export default function RawEventDetails({ rawEvents }: { rawEvents: RawEventRef[] }) {
  if (rawEvents.length === 0) return null;

  return (
    <details className="raw-event-details">
      <summary>
        <span>Raw events</span>
        <span className="raw-event-summary">{rawEventSummary(rawEvents)}</span>
      </summary>
      <pre>{JSON.stringify(rawEvents, null, 2)}</pre>
    </details>
  );
}
