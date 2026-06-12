# Prettified Output Rendering Design

## Goal

Make Claude Remote Web session output readable like a chat transcript instead of exposing raw stream-json as the primary UI. Preserve full raw payloads for debugging and keep backend event storage append-only.

## Scope

This change focuses on frontend rendering of existing `UiEvent` data:

- Assistant and user messages render as conversation bubbles.
- Tool calls and results render as inline tool blocks.
- System, error, and unknown events render as compact status blocks.
- Full raw JSON remains available in a collapsed debug section.

The backend WebSocket/API event schema, event persistence format, launcher arguments, and session lifecycle behavior do not change.

## Architecture

The backend continues to normalize Claude stdout into `UiEvent` objects while preserving each event payload exactly as received. The frontend owns presentation-specific interpretation.

`EventCard` gains a small parsing layer that converts `UiEvent.payload` into display data. The parser recognizes common Claude stream-json shapes but does not mutate the original payload. Rendering then switches on the display type rather than directly dumping payload fields.

Primary display types:

- `message`: user or assistant text.
- `tool`: tool invocation/result with name, status, input, output, or error.
- `status`: system/error/raw metadata shown compactly.
- `unknown`: fallback with raw JSON only.

Keeping this logic in the frontend avoids migrating existing logs and avoids coupling backend storage to UI preferences.

## Message rendering

Assistant and user events render as chat bubbles in the event stream. Text extraction supports these payload shapes:

- `message` string.
- `text` string.
- `content` string.
- `content` arrays containing text blocks such as `{ "type": "text", "text": "..." }`.

If a message event has no readable text, the UI falls back to a compact status block with the raw JSON debug section available.

## Tool rendering

Tool events include payloads whose event kind is `tool` or whose payload type resembles `tool_use` or `tool_result`.

Tool blocks show:

- Tool name from `name`, `tool_name`, or `toolName` when present.
- Status inferred from payload type and available result/error fields.
- Pretty-printed input when available.
- Result, content, or error summary when available.

Tool blocks default to expanded while they appear to be in progress and collapsed once they have a result or error. This keeps live progress visible without letting historical tool output dominate the transcript.

## System, error, and raw rendering

System and error events render as compact status blocks with the most useful text first. Unknown payloads never disappear: they render with a short label and a collapsed raw JSON debug section.

Raw JSON is no longer the main visual output for recognized events. It remains available under a `JSON payload` details element, closed by default.

## Styling

The event stream shifts from uniform event cards toward a chat transcript:

- User and assistant messages use distinct bubble alignment or coloring.
- Tool blocks are visually subordinate to messages and fit inline between them.
- System/error/raw blocks stay compact so they do not interrupt reading.
- Existing sidebar, session controls, composer, and API behavior remain unchanged.

This is intentionally not a full redesign of the app shell.

## Error handling and compatibility

The parser is defensive at UI boundaries. If a payload shape is missing fields, has non-string content, or contains an unknown structure, the renderer falls back to the raw JSON debug view.

Existing persisted events continue to render because the frontend still consumes the same `UiEvent` shape.

## Testing

Frontend tests cover:

- Assistant text from simple fields.
- User/assistant text from Claude-style `content` arrays.
- Tool invocation rendering with tool name and formatted input.
- Tool result/error rendering with formatted output or error text.
- System/error status rendering.
- Unknown payload fallback with collapsed pretty JSON.

Verification commands:

```bash
npm --prefix web test
npm --prefix web run build
```

Because this is a frontend rendering change, implementation verification should also include launching the app and manually checking a representative event stream when feasible. If browser verification is not possible in the environment, report that explicitly.
