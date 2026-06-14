# Conversation Header Redesign

## Goal

Reduce conversation header information overload and move engineering details into intentional disclosure surfaces. The default header should feel closer to the Claude app: title first, lightweight context second, and actions grouped behind compact controls.

## Current Problem

The current header keeps too much technical state visible at all times: chat/archive eyebrow, editable title, runtime/continuity labels, worktree badge, a `Details` disclosure, full workspace path, and action buttons. This competes with the conversation content and makes the header feel like an admin dashboard rather than chat chrome.

## Selected Direction

Use a compact single-row header:

```text
[Sidebar toggle]  Chat title  [project chip: repo · worktree]        [primary lifecycle] [Activity] [More]
```

This is the lowest-height option and best addresses the user's main pain: the header should stop dominating the conversation. The trade-off is that the project chip may truncate earlier on narrow screens; responsive styling should preserve the title and primary actions first.

## Default Header Behavior

- Remove the always-visible `Chat` / `Archived` eyebrow from the main header row.
- Remove the always-visible full workspace path row.
- Replace `Details` with a project chip that acts as the context popover trigger.
- Make the chat title the dominant text.
- Show the project chip as secondary text: short project name plus `worktree` when isolated.
- Show runtime or continuity status only when attention is useful: `starting`, `running`, `waiting`, or `failed`.
- Keep one primary lifecycle action visible when it is the likely next action:
  - `Stop` while running or starting.
  - `Resume` when stopped or ended.
  - `Unarchive` for archived sessions if that is the primary available action.
- Keep `Activity` visible as a direct inspector entry.
- Put lower-frequency actions in `More`.

## Context Popover

Clicking the project chip opens a popover with technical context that is currently overexposed in the header:

- `cwd`
- `source cwd`
- `worktree cwd`
- `branch`
- `permission mode`
- `runtime status`

Fields that do not apply to a session should be omitted rather than shown empty. Long paths should remain selectable/copyable and use truncation only for display.

## More Menu

The `More` menu groups low-frequency and diagnostic actions:

- `Rename`
- `Archive` or `Unarchive`
- `View activity`
- `View diagnostics`
- `Copy session ID`
- `Open worktree diff` for worktree sessions
- Secondary lifecycle actions such as `Restart`
- Worktree cleanup actions such as stop-and-remove when available

Dangerous or destructive actions should remain visually distinct from routine actions. Existing behavior for archive, unarchive, stop, restart, resume, and worktree cleanup should be preserved; only their placement changes.

## Rename Interaction

Replace any prompt-style rename flow with inline header editing:

- Choosing `Rename` switches the title area into an input.
- `Enter` saves.
- `Escape` cancels.
- Blur can save if the value changed.
- Empty input clears the custom name and falls back to the default session title.

The editing state should stay local to `ConversationWorkspace`; saving should call the existing session update path through the provided rename callback.

## Component Boundaries

- `ConversationWorkspace.tsx` owns header rendering: compact row, project chip, context popover, More menu, inline rename, copy session ID, and worktree diff display entry.
- `App.tsx` continues to own app-level state and lifecycle callbacks. It should pass header-specific actions rather than one pre-rendered action blob so `ConversationWorkspace` can place the primary action and menu actions correctly.
- `App.css` owns the visual treatment for the compact header, chip, popovers, menus, and inline title input.

This should remain a targeted UI refactor. Do not introduce a generic command framework or unrelated session action abstractions.

## Data Flow

- Session metadata comes from the existing `activeSession` prop.
- Worktree status and branch labels come from existing worktree status props.
- Activity and diagnostics actions should toggle the existing inspector and select the appropriate tab.
- Rename should use the existing `PATCH /api/sessions/{id}` session update path.
- Worktree diff should use the existing `GET /api/sessions/{id}/worktree-diff` client function and be available only for worktree sessions.

## Error Handling

- Continue using the existing API error banner for global session action failures.
- For worktree diff failures triggered from the menu, show local inline feedback near the diff viewer or menu-triggered surface.
- Copy session ID can fail silently only if the Clipboard API is unavailable; otherwise use a small local status if practical.
- Avoid adding new global error plumbing for this redesign.

## Responsive Behavior

- The title should remain the highest-priority item.
- The project chip can truncate before the title does.
- On narrow screens, secondary text can wrap or collapse while preserving the primary lifecycle action, `Activity`, and `More`.
- The header should remain visibly shorter and lighter than the current implementation.

## Acceptance Criteria

- Header height is reduced from the current multi-line presentation.
- The user can quickly identify the current chat title.
- Full technical paths are hidden by default but available in the context popover.
- Session lifecycle, activity, diagnostics, archive, rename, copy ID, and worktree diff actions remain reachable.
- Rename works without `window.prompt`.
- Runtime status is prominent only when the session needs attention.
- Frontend tests and build pass.
- The implemented UI is manually checked in a browser for default state, context popover, More menu, rename, worktree diff entry, and narrow viewport behavior.
