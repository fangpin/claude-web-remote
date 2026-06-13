# Claude-like Shell Redesign

## Goal

Restructure the Web UI so it feels closer to Claude Desktop App: a conversation-centered workspace with persistent session navigation, a focused chat surface, a fixed composer, and secondary operational panels that do not dominate the main flow.

## Scope

This phase changes frontend information architecture and layout only. It keeps the current backend APIs and preserves existing behavior for sessions, worktrees, task tracking, config editing, deletion/restoration, restart/resume/stop actions, and slash-command autocomplete.

Out of scope for this phase:

- Backend API changes
- New Claude protocol features
- Authentication or network exposure changes
- Rich message rendering beyond the existing block model
- Mobile-first responsive redesign

## Current Problems

The current UI is functional but reads like an admin console:

- The left sidebar permanently spends a large amount of space on the new-session form.
- Tasks appear both globally and per-session but compete with the conversation layout.
- Config is a top-level view but shares the same broad shell as chat without clear hierarchy.
- The composer is labeled like a form field rather than a chat input.
- Session actions are visible but visually heavy compared with the chat itself.

## Proposed Layout

Use a three-zone desktop shell.

### 1. Primary Rail

A narrow left rail provides top-level product navigation.

Contents:

- Product mark/title treatment for Claude Remote Web
- Sessions entry
- Config entry
- Deleted sessions entry or a secondary sessions filter entry
- Optional compact task indicator if existing task data is easy to surface without extra API changes

The rail should be stable across views and use compact buttons rather than large forms.

### 2. Session Sidebar

The session sidebar is dedicated to session discovery and creation.

Contents:

- “New chat” / “New session” primary action at the top
- Active/deleted session filter, either as segmented control or via rail selection
- Session list with name, cwd summary, status, and worktree branch when present
- Recent directory shortcuts only when the new-session panel is open

Creating a session should move from an always-visible form to an expandable panel or dialog-like inline card. The panel contains the current fields:

- Working directory
- Recent directories
- Use git worktree
- Name
- Permission mode

This preserves functionality while freeing normal navigation space.

### 3. Main Conversation Area

The main area is the primary work surface.

Top header:

- Current session name
- cwd as secondary text
- status badge
- compact session actions: Stop, Restart, Resume, Delete, Restore, Permanently delete, Stop and remove worktree
- worktree metadata collapsed into secondary chips or a details row

Message area:

- Keep using `ConversationBlockList` and `buildConversationBlocks`
- Center content with a readable max width
- Keep event limiting behavior
- Preserve task jump highlighting by event id

Composer:

- Fixed at the bottom of the conversation area
- Remove the prominent “Message” label in favor of placeholder text and accessible labeling
- Keep Enter-to-send, Shift+Enter newline, IME handling, and slash autocomplete
- Keep send disabled behavior implied by current form handling

### 4. Right Inspector

A right-side inspector provides secondary operational details without interrupting chat.

Initial tabs or sections:

- Session tasks
- Global tasks
- Session details

Default state:

- Open on wider desktop screens if space permits
- Collapsible so users can focus on chat

This phase can implement the inspector with existing `TasksPanel` data and current session metadata. It should not require backend changes.

## View Behavior

### Sessions View

Default view. Shows primary rail, session sidebar, main conversation, and inspector.

### Config View

Config remains accessible from the primary rail. In this phase it can render in the main content area using the same shell, with the session sidebar either hidden or replaced by a simple settings-side navigation if that is cheaper to implement cleanly.

### Deleted Sessions

Deleted sessions should remain reachable. Either:

- Keep the current Active/Deleted segmented control inside session sidebar, or
- Promote Deleted to the primary rail.

Prefer the lower-risk option that keeps current list-loading logic intact unless the implementation is simpler with a rail entry.

## Component Direction

Keep implementation focused on the existing frontend files unless extraction clearly reduces complexity.

Likely changes:

- `web/src/App.tsx`
  - Reorganize JSX into rail/sidebar/main/inspector regions.
  - Preserve existing state and handlers.
  - Add small booleans for new-session panel and inspector collapse if needed.

- `web/src/App.css`
  - Replace current two-column `.app-shell` with a Claude-like shell grid.
  - Add styles for primary rail, session sidebar, centered chat surface, fixed composer, and inspector.

- `web/src/ConversationBlockList.tsx`
  - Minimal changes only if message layout needs semantic hooks.

- `web/src/ConfigView.tsx`
  - Minimal styling hook changes if needed for the new shell.

Tests should update existing React tests rather than creating a parallel UI test harness.

## Constraints

- Preserve SSH-only/default loopback security posture.
- Do not remove any existing session lifecycle action.
- Do not change API request/response shapes.
- Do not drop raw event access from conversation blocks.
- Do not hide task information; relocate it into the inspector.
- Keep the first phase shippable without adding a design system dependency.

## Testing Plan

Automated:

- Update `web/src/App.test.tsx` for the new shell structure and preserved flows.
- Update component tests if CSS hooks or labels change.
- Run `npm --prefix web test`.
- Run `npm --prefix web run build`.

Manual/UI verification:

- Launch the frontend.
- Open the app in a browser if tooling is available.
- Verify creating/selecting a session remains usable.
- Verify the composer is fixed and slash autocomplete still appears.
- Verify session actions remain reachable.
- Verify tasks are visible in the inspector.
- Verify Config is reachable from primary navigation.

## Risks

- `App.tsx` already owns many responsibilities, so large JSX movement can accidentally break state flow. Keep state and handlers stable and change layout around them.
- Tests may rely on current labels such as “Message” or “Sessions”; use accessible labels deliberately when changing visible copy.
- Moving tasks can break task jump behavior if event ids or active session selection are changed. Preserve `onSelectTask`, `pendingEventId`, and event element ids.

## Acceptance Criteria

- The default screen has a stable left navigation area, a session list, a central conversation area, and a secondary inspector area.
- New-session controls no longer permanently dominate the sidebar.
- Main chat and composer visually read as the primary product surface.
- Existing session lifecycle, worktree, deleted-session, config, task, and slash-autocomplete functionality remains available.
- Frontend tests and build pass.
