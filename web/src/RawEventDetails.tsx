import type { RawEventRef } from './conversationBlocks';

export default function RawEventDetails({ rawEvents }: { rawEvents: RawEventRef[] }) {
  return (
    <details className="raw-event-details">
      <summary>Raw events</summary>
      <pre>{JSON.stringify(rawEvents, null, 2)}</pre>
    </details>
  );
}
