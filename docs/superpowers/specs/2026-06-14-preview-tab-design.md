# Preview Tab Design

## Summary

Claude Remote Web should move toward Claude app parity while keeping the browser as a safe control surface for remote Claude Code sessions. The full parity roadmap includes file references, assistant turn actions, artifact previews, sharing/export, prompt suggestions, and settings polish. This design scopes the first implementable phase to a Preview tab in the existing Inspector.

The Preview tab helps users answer: what changed in this worktree session, which files did Claude read or edit, and what relevant snippets are available in the transcript. It does not turn the product into a general web IDE or file browser.

## Goals

- Add a Preview tab to the Inspector for worktree-oriented reading and review.
- Show the current worktree diff for worktree sessions only.
- Extract file references and snippets from existing transcript/tool events.
- Let conversation cards open the relevant file in Preview without expanding long diffs inline.
- Keep the data boundary narrow: no arbitrary file browsing or file content API in this phase.

## Non-goals

- General repository file browsing.
- Reading arbitrary file contents from the browser.
- Artifact/code-block live preview from assistant messages.
- `@` file autocomplete in the composer.
- Assistant turn actions such as retry, continue, add to context, or share/export.
- Public HTTP exposure or any change to the default localhost/SSH security posture.

## Product scope

The broader Claude app parity direction should be tracked as a roadmap, but this spec implements only the first phase: Preview in the Inspector.

The Inspector tab order should become:

1. Activity
2. Preview
3. Session
4. Global
5. Plan
6. Diagnostics

Preview is primarily useful for worktree sessions. For non-worktree sessions, it should show a clear empty state while still allowing transcript-derived snippets if they exist.

The conversation view should remain focused on chat. Tool cards, diff cards, and file path chips can expose an Open in Preview action, but long diffs and snippets should render in the Inspector.

## Backend design

### Worktree diff endpoint

Add or complete:

```text
GET /api/sessions/{id}/worktree-diff
```

Behavior:

- Available only for worktree sessions.
- Returns the current worktree diff relative to the appropriate base for that worktree.
- Does not accept arbitrary path parameters.
- Does not read arbitrary file contents.
- Enforces an output size limit.
- Returns a `truncated` flag when the diff exceeds the limit.
- Returns structured file metadata when practical; otherwise, a raw unified diff plus top-level metadata is acceptable for the first implementation.

Suggested response shape:

```json
{
  "diff": "diff --git ...",
  "files": [
    {
      "path": "web/src/InspectorPanel.tsx",
      "status": "modified",
      "additions": 12,
      "deletions": 4
    }
  ],
  "truncated": false,
  "limitBytes": 200000
}
```

The endpoint should follow the existing worktree-status safety model: operate only inside the session worktree and report recoverable errors without affecting session execution.

### No file content API

This phase intentionally does not add an API for reading file contents. File snippets come only from already-persisted transcript events and raw Claude event payloads. This preserves the append-only event model and avoids expanding the browser surface into a general file reader.

## Frontend design

### PreviewPanel

Add a focused `PreviewPanel` component owned by `InspectorPanel`.

Responsibilities:

- Fetch and display worktree diff state for the selected session.
- Render loading, empty, error, and truncated states.
- Render changed files as a compact list.
- Extract and list transcript-referenced files.
- Select a file and show its relevant diff or transcript snippets.
- Clearly label data sources as either Worktree diff or Transcript snippets.

The component should avoid owning global app state beyond the selected preview target. It receives selected session data and transcript events from the same level that currently feeds Inspector content.

### Transcript file reference extraction

Add a helper near the conversation/event normalization layer rather than embedding parsing in UI JSX.

The helper should extract references from existing Claude tool events, including at least:

- Read tool paths and displayed line snippets.
- Edit/MultiEdit paths and old/new snippets when present.
- Write tool paths and result summaries.
- Grep/Glob path lists when present.
- Existing path list render data from conversation blocks when available.

The extracted model should distinguish reference kinds:

- `read`
- `edited`
- `written`
- `searched`
- `mentioned`

It should preserve event ids so Open in Preview can link back to the relevant conversation block later.

Suggested frontend model:

```ts
type PreviewFileReference = {
  path: string;
  kind: 'read' | 'edited' | 'written' | 'searched' | 'mentioned';
  eventId: number;
  title: string;
  snippet?: string;
};
```

### Open in Preview

Conversation cards that already know a file path should expose an Open in Preview action. Activating it should:

1. Open the Inspector if it is hidden.
2. Select the Preview tab.
3. Select the matching file in Preview.
4. Prefer the worktree diff for that file when available.
5. Fall back to transcript snippets for that file.

The action should not restart sessions, mutate files, or send anything to Claude.

## UI states

- Non-worktree session: show “Preview is available for worktree sessions” and still show transcript snippets if available.
- Empty worktree diff: show “No worktree changes yet”.
- Diff loading: show a compact skeleton or spinner inside the Preview tab.
- Diff too large: show available partial diff, mark it as truncated, and include the limit.
- Git/diff failure: show a recoverable error in Preview only.
- No transcript snippets: hide the section or show a lightweight empty state.

## Data flow

1. User selects a session.
2. App loads persisted transcript events through the existing transcript flow.
3. Inspector Preview tab receives the selected session and transcript events.
4. If the session is a worktree session, Preview fetches `GET /api/sessions/{id}/worktree-diff`.
5. Preview derives transcript file references from existing events locally.
6. Preview merges display around file path, with Worktree diff as authoritative for current changes and Transcript snippets as historical context.
7. Conversation cards can request a selected preview target through App-level inspector state.

## Security and safety

- Keep default binding and access model unchanged.
- Do not add arbitrary path reads.
- Do not add browser-driven file writes.
- Do not modify append-only event logs.
- Treat transcript snippets as already-observed session data, not as fresh filesystem reads.
- Limit diff output to prevent large responses from degrading the UI.

## Testing plan

### Backend

- Worktree diff endpoint rejects or returns the documented empty/error state for non-worktree sessions.
- Worktree with no changes returns an empty diff state.
- Worktree with changed files returns unified diff and file metadata.
- Large diff sets `truncated` and respects the byte limit.
- Git command failure returns a recoverable API error.

### Frontend

- Inspector renders the Preview tab in the expected order.
- Preview tab renders loading, empty, error, and truncated states.
- Transcript helper extracts Read/Edit/Write/Grep/Glob file references from representative events.
- Selecting a referenced file shows the relevant diff or snippet.
- Open in Preview opens Inspector, selects Preview, and selects the requested file.
- Non-worktree sessions show the worktree-only empty state without hiding transcript snippets.

### Manual verification

- Start the app.
- Open or create a worktree session.
- Produce a small file change.
- Confirm Preview shows the worktree diff.
- Confirm tool-event file snippets appear when Claude reads or edits files.
- Confirm Open in Preview works from conversation file/tool cards.
- Confirm normal chat, Activity, Session, Global, Plan, and Diagnostics tabs still work.

## Roadmap after phase one

1. Composer `@` file references with changed/recent file autocomplete and Claude-style attachment chips.
2. Assistant turn actions: copy, retry, continue, add to context, and raw/debug.
3. Artifact/code-block preview from assistant messages in Preview.
4. Share/export flows for sessions and selected messages.
5. Prompt suggestions, theme polish, account/settings parity.

## Documentation impact

README and CLAUDE instructions do not need updates for this design-only change. They should be revisited during implementation if a new API endpoint or user-visible workflow lands.
