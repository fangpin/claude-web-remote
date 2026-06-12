# Claude app-style output blocks design

## Goal

Improve the web UI output so it follows Claude Code app information hierarchy instead of rendering each raw event as an isolated card. Background Bash tasks, Agent/subagent work, and workflow/task notifications should look like task or subagent activity, not ordinary tool use.

This change should preserve the current backend event stream and append-only raw logs. The first implementation introduces a frontend block model; a later backend protocol can formalize the same semantics once the UI behavior is stable.

## Scope

Included:

- Add a frontend conversation block aggregation layer over existing `UiEvent[]`.
- Replace direct per-event `EventCard` rendering with block rendering.
- Render messages, tools, background tasks, subagents, workflow/task events, system messages, errors, and unknown events with Claude app-style hierarchy.
- Keep raw event payloads available in collapsed details for debugging.
- Add root `AGENTS.md` guidance that future output UX should follow Claude Code app behavior where practical.

Not included:

- No Rust WebSocket, storage, or event normalization protocol changes in this phase.
- No public HTTP exposure or security posture changes.
- No attempt to exactly clone Claude app visuals beyond information hierarchy and behavior.

## Architecture

`App.tsx` continues to receive append-only `UiEvent[]` from the existing WebSocket. Before rendering, it calls a new `buildConversationBlocks(events)` layer that converts raw events into display-oriented blocks.

Each block keeps:

- a stable block id,
- a block type,
- derived display fields,
- source event ids,
- raw payloads for collapsed debug details.

The rendering path becomes:

```text
UiEvent[] -> buildConversationBlocks -> ConversationBlockList -> block components
```

This keeps the current backend contract intact and lets historical event logs replay through the improved UI.

## Block types

### Message blocks

`MessageBlock` renders user, assistant, and ordinary system text. It prioritizes human-readable text fields and supports markdown-friendly formatting, including line breaks and code blocks. Consecutive compatible text events may merge when they represent one logical message.

### Tool blocks

`ToolBlock` renders ordinary tool use and tool results. The collapsed view shows the tool name, status, and a short input/result summary. Expanded details show structured input, result excerpts, and raw payloads.

Tool calls and results should be paired when stable identifiers are present. If pairing is not possible, the UI still renders each event as a useful standalone tool block.

### Task blocks

`TaskBlock` renders long-running or background activity as task progress rather than generic tool calls. It covers background Bash tasks, Agent/subagent work, Workflow runs, and TaskCreate/TaskUpdate-style task events when the payload shape is recognizable.

The default view emphasizes task name, status, progress or completion, and short output hints such as output file paths. Detailed tool inputs and raw payloads stay collapsed.

### System and error blocks

`SystemBlock` shows concise status updates. `ErrorBlock` shows errors prominently with the most useful message first and raw details collapsed.

### Raw fallback blocks

Unknown payloads fall back to `RawEventDetails` so no data disappears. The raw fallback is visually quieter than current event cards and appears only when no clearer block type applies.

## Classification rules

The block builder should prefer explicit payload signals over brittle text matching:

1. Match event kind and payload `type` values such as `tool_use`, `tool_result`, `assistant`, `user`, `system`, and `error`.
2. Use stable ids, tool names, task ids, agent labels, and notification metadata when present.
3. Classify background Bash, Agent/subagent, Workflow, and task-list operations as `TaskBlock` when their payload shape indicates task lifecycle behavior.
4. Fall back to system/raw blocks when the payload is unknown or ambiguous.

The classifier should be deterministic so replaying the same event log produces the same blocks.

## Component boundaries

- `buildConversationBlocks` owns event-to-block classification and pairing.
- `ConversationBlockList` owns list rendering and block dispatch.
- `MessageBlock`, `ToolBlock`, `TaskBlock`, `SystemBlock`, and `ErrorBlock` own presentation.
- `RawEventDetails` owns collapsed raw JSON display.
- The existing `EventCard` can either be retired from the main path or reduced to raw/debug fallback behavior.

## AGENTS.md guidance

Add a root `AGENTS.md` with a short project-specific instruction: output rendering should follow Claude Code app behavior where practical. In particular, background work should be presented as task/subagent progress and results, not as exposed raw tool use. The guidance should also repeat that raw payloads must be preserved and the default security posture must remain SSH-local.

## Testing

Frontend tests should cover:

- assistant and user text rendering through blocks,
- markdown/code-block-friendly text display,
- tool use/result pairing,
- unpaired tool fallback rendering,
- background Bash task rendering as a task block,
- Agent/subagent rendering as a task block,
- Workflow or TaskCreate/TaskUpdate-style events rendering as task activity,
- unknown payload fallback with raw details preserved,
- App WebSocket ingestion still rendering existing event streams.

Run:

```bash
npm --prefix web test
npm --prefix web run build
```

Backend checks are not required unless implementation changes Rust event normalization, API, process, config, or session behavior.

## Future protocol phase

After the UI model proves stable, Rust can optionally emit explicit block/task/subagent semantics. That later phase should keep backward compatibility with existing logs and should not remove raw payload preservation.