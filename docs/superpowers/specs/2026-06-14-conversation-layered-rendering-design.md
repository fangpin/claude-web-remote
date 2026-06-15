# Conversation Layered Rendering Design

## Goal

Make the transcript read more like the Claude app: the primary reading path is user messages and Claude's answers, while tools, tasks, raw events, and diagnostics remain available as supporting execution trace.

The change should reduce the current event-log feel without removing developer/debug capability.

## Current context

The frontend already projects session events into conversation blocks before rendering:

- `useSessionEvents.ts` builds `activeBlocks` from raw UI events.
- `conversationBlocks.ts` converts raw events into block types such as message, tool, task, error, raw, and anchor.
- `presentationPolicy.ts` controls some visibility/detail policy, including hiding completed read-only tool blocks and expanding failed/running results.
- `ConversationBlockList.tsx` renders the transcript and currently appends raw event details broadly.
- `ActivityPanel.tsx` and `InspectorPanel.tsx` provide secondary surfaces for activity and diagnostics.

The design should extend these boundaries rather than replacing them wholesale.

## Chosen approach

Use an incremental layered rendering model on top of the existing projection and policy layers.

`conversationBlocks.ts` remains the raw-events-to-blocks projection layer. `presentationPolicy.ts` becomes the explicit place for display decisions and accepts a `displayMode: "chat" | "debug"`. `ConversationBlockList.tsx` renders the same blocks differently depending on that mode.

This has lower risk than creating a new transcript model now, while still making the user-facing behavior explicit and testable.

## Display modes

Add a lightweight mode switch at the top of the message stream:

- `chat`: default mode for normal reading.
- `debug`: developer-oriented mode that exposes raw details and low-level blocks.

Switching modes is local UI state. It does not restart sessions, refetch events, or mutate persisted logs.

## Three-layer rendering model

### 1. Conversation layer

Always strong in chat mode:

- user messages
- assistant markdown
- final assistant answers
- important warnings and errors

These blocks keep the main visual hierarchy and should not be visually interrupted by verbose execution details.

### 2. Execution summary layer

Tool, task, diff, path, code, permission, and review activity render as compact collapsed summaries in chat mode.

Use the compact tag-group visual direction selected during brainstorming. Example labels:

- `▸ Read 3 files`
- `▸ Edited web/src/Composer.tsx`
- `▸ Ran npm test`
- `▸ Reviewed changes`

Clicking a summary expands the relevant detail for that block: stdout, stderr, diff, paths, code, or structured tool result. Clicking again collapses it.

Completed low-signal tool activity can remain hidden or anchor-only when current policy already does that, but the policy should be explicit about chat vs debug behavior.

### 3. Developer debug layer

Only visible in debug mode or the Inspector:

- `RawEventDetails`
- raw JSON payloads
- low-level system events
- diagnostics
- raw stream-json details

Debug capability is moved back, not removed.

## Tool classification and summaries

Add or consolidate a helper that classifies tool-like blocks into stable categories:

- file read
- file edit
- bash/test
- diff
- task
- permission/review
- generic tool

The same classification should drive both transcript summary text and, where practical, ActivityPanel labels. This avoids two independent summarizers drifting apart.

Summary labels should be concise, human-readable, and Claude-app-like. They should describe the action, not expose raw event names by default.

## Failure behavior

In chat mode, failed tools automatically show:

- failed status
- concise failure summary
- key stderr or error text

Raw JSON remains hidden unless debug mode or Inspector is open.

If stderr or output is long, show only a useful excerpt by default and allow expansion to the full text. True error blocks remain strongly visible in the conversation layer so users do not miss important failures.

## Component responsibilities

- `App.tsx` or the nearest transcript owner holds `displayMode` state and passes it to `ConversationBlockList`.
- `ConversationBlockList.tsx` owns the mode switch UI, summary expansion state, and rendering of chat/debug variants.
- `presentationPolicy.ts` decides visibility and default detail level for each block in each mode.
- `conversationBlocks.ts` continues to produce semantic blocks from events and may expose classification-friendly metadata where needed.
- `ActivityPanel.tsx` remains an activity navigation surface and should reuse shared summary/classification logic where practical.
- `InspectorPanel.tsx` remains the place for deep session/event diagnostics.

## Data flow

1. Session events arrive through the existing event stream or transcript APIs.
2. `useSessionEvents.ts` produces `activeBlocks` through `conversationBlocks.ts`.
3. The selected `displayMode` flows into `ConversationBlockList.tsx`.
4. `presentationPolicy.ts` returns each block's display decision for that mode.
5. `ConversationBlockList.tsx` renders conversation, summary, or debug details based on that decision.

No raw event payloads are discarded. The change is presentation-only.

## Testing

Add or update tests for:

- `presentationPolicy.test.ts`: chat/debug visibility for raw blocks, system blocks, tool results, failed tools, and raw details.
- `conversationBlocks.test.ts`: stable tool classification and summary data for representative read, edit, bash/test, diff, task, permission/review, and generic tool blocks.
- `ConversationBlockList.test.tsx`: mode switch presence, chat default, collapsed summaries, click-to-expand, debug raw details, and failed-tool key stderr visibility.
- `activityTimeline.test.ts`: keep activity labels consistent if shared summary logic changes.

Run the frontend checks after implementation:

```bash
npm --prefix web test
npm --prefix web run build
```

Because this affects UI rendering, manually verify in the browser that a long session reads like a chat transcript in chat mode, while tool details and raw diagnostics remain reachable in debug mode or Inspector.

## Documentation impact

Review `README.md` and `CLAUDE.md` after implementation. This design does not require a documentation change by itself, but implementation may if a visible debug/chat control or behavior needs user-facing explanation.
