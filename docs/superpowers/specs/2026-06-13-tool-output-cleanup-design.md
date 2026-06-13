# Tool Output Cleanup Design

## Goal

Reduce noisy tool output in the conversation stream so the UI feels closer to Claude Desktop App: tool activity remains visible, but large results do not dominate the chat by default.

## Scope

This phase changes frontend conversation block shaping and rendering only. It does not change backend event persistence, raw stdout/stderr storage, Claude stream-json ingestion, or API shapes.

## Current Problem

Tool blocks currently render input and result sections directly in the conversation. This makes the chat noisy when tools return large payloads, especially:

- `Read` results that include entire file contents
- `Glob` / `Grep` results that include many paths or matches
- `Bash` output with long stdout/stderr
- tool result blocks that duplicate information already available through raw event details

The result is closer to a debug event log than a Claude-like conversation.

## Display Strategy

Use tool-specific presentation policies.

### Read / Glob / Grep

Show compact cards with:

- tool name
- status
- key input summary, such as `file_path`, `pattern`, `path`, or `glob`

Do not show result output in the main card by default. Preserve full raw event access through existing raw event details.

### Bash

Show command and status. Put result output behind a collapsed disclosure by default.

This keeps commands visible while avoiding long stdout/stderr in the main flow.

### Edit / Write / Other ordinary tools

Show a compact input summary and collapsed result disclosure when result exists.

### Task-like tools

Keep task-style cards for `Agent`, `Workflow`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskOutput`, `TaskStop`, and background Bash. Shorten summaries where practical, but do not remove task state or output path information.

## Data Model Direction

Extend `ToolBlock` with presentation metadata rather than hard-coding all display decisions in React:

- `resultDisplay: 'hidden' | 'collapsed' | 'visible'`

Initial defaults:

- `hidden`: `Read`, `Glob`, `Grep`
- `collapsed`: `Bash` and other ordinary tools with result text
- `visible`: tool cards without a result or any case where a failure result should remain obvious if tests require it

Keep `resultSummary` in the block object even when hidden, so tests and future details UI can still reason about it. Rendering decides whether it appears.

## Rendering Direction

Update `ToolBlockView`:

- Always show tool header with name/status.
- Show input summary if present.
- If `resultDisplay === 'hidden'`, do not render the Result section.
- If `resultDisplay === 'collapsed'`, render Result inside a `<details>` element with summary text such as `Result`.
- If `resultDisplay === 'visible'`, render Result as it works today.
- Keep `RawEventDetails` available so hidden output can still be inspected.

## Constraints

- Do not drop raw event payloads.
- Do not change event persistence or backend stream parsing.
- Do not hide real errors entirely; failed status must remain visible.
- Keep tests focused on rendered behavior rather than CSS-only clipping.
- Avoid adding dependencies or a markdown renderer in this phase.

## Testing Plan

Automated tests should cover:

- Read tool result is not shown in the main card while raw events remain available.
- Glob/Grep result is not shown in the main card.
- Bash result is rendered inside a collapsed disclosure.
- Ordinary failed tool status remains visible.
- Existing task block behavior still works.
- Frontend test suite and build pass.

## Acceptance Criteria

- Large Read/Glob/Grep outputs no longer clutter the main conversation.
- Bash output is available but collapsed by default.
- Tool status and key input remain visible.
- Raw details still provide access to full original events.
- Existing task and message rendering behavior remains intact.
