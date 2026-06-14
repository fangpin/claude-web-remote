# Chat-first shell design

## Goal

Make the default desktop experience feel like the Claude app rather than a remote session management console. On first load, the product should read as a chat app: chat history on the left, current conversation in the center, and operational tools available only when requested.

## Non-goals

- Do not change the daemon security posture or expose new public HTTP behavior.
- Do not remove access to configuration, archived sessions, diagnostics, keys, tasks, plans, or worktree status.
- Do not redesign message rendering, composer behavior, process lifecycle, or backend APIs.
- Do not add unsupported browser-side Claude Code controls.

## Default layout

Desktop defaults to a two-column chat-first shell:

1. Left sidebar: Claude-branded chat navigation.
2. Main workspace: the active conversation, centered at a readable chat width.

The primary rail is removed from the default layout. Users should not see `CRW`, `Sessions`, `Config`, `Archived`, `Sidebar`, or `Keys` as persistent top-level navigation. The sidebar becomes the primary home for chat actions: `Claude`, `New chat`, chat search, recent chats, active/archived discovery, and a compact menu entry for advanced destinations.

The main workspace keeps the current conversation header, events, start surface, worktree status, and composer. When no drawer is open, the conversation content uses the full remaining workspace and remains visually centered.

## Command menu and advanced destinations

A command/menu surface handles global navigation and rarely used tools. It is opened from the sidebar menu and the existing keyboard shortcut surface. It should support at least:

- Search or jump to chats.
- Start a new chat.
- Open archived chats.
- Open settings/configuration.
- Open keys if key management is currently available in the shell.
- Open diagnostics or shortcut help.

The command menu is the replacement for the current rail as a visible navigation model. It should reuse existing app state where practical instead of introducing a parallel routing system. `ConfigView` remains reachable, but it no longer appears as a persistent top-level mode in the default chrome.

## Inspector drawer

The inspector remains session-specific context, not global navigation. Its existing content and tabs stay available, including activity, session tasks, all tasks, plan, and diagnostics.

The shell changes its presentation from a permanent grid column to a right-side overlay drawer. Closing the drawer removes it from layout flow so the conversation width and center point do not shift. Opening the drawer overlays the right side of the workspace on desktop and uses a modal/sheet-style presentation on smaller screens.

## Sidebar behavior

The sidebar should look and behave like chat history rather than an admin table. It keeps existing session grouping and archive capabilities, but the visible hierarchy should prioritize:

1. Claude identity.
2. New chat.
3. Search.
4. Recent or grouped chat list.
5. Compact access to archived/settings/diagnostics through menu or command actions.

Archived sessions can still be browsed, but `Archived` should not appear as a peer to the main product surface. `Sidebar` should not appear as user-facing button copy; use a clearer icon/action or hide the control inside responsive behavior.

## Responsive behavior

Mobile and tablet remain single-column chat experiences. Sidebar, workspace, command menu, and inspector drawer should appear one at a time where space is limited. The redesign should not make operational panels permanently visible on small screens.

## Accessibility and existing behavior

Preserve existing keyboard shortcuts, focus fallback behavior, ARIA tab semantics, scroll containment, archived read-only behavior, and worktree warnings/actions. The command menu and drawer must be keyboard accessible and dismissible.

## Implementation shape

Likely frontend changes:

- `web/src/AppShell.tsx`: replace the four-column shell with a chat-first shell and overlay drawer container.
- `web/src/App.css`: update grid/layout rules, remove persistent rail spacing, and add command menu/drawer presentation styles.
- `web/src/SessionSidebar.tsx`: add Claude-style header/menu affordance and move advanced entry points out of persistent rail copy.
- `web/src/App.tsx`: keep existing `view`, inspector, archive/config, shortcut help, and sidebar state where possible; wire them through the new command/menu surface.
- `web/src/InspectorPanel.tsx`: preserve panel internals while allowing drawer presentation from the shell.

Prefer reusing existing state and components over adding a new routing layer.

## Acceptance criteria

- Desktop default first visual is sidebar plus conversation, not a console/admin dashboard.
- No persistent rail appears by default.
- Default chrome does not show `CRW`, `Sessions`, `Config`, `Archived`, `Sidebar`, or `Keys` as top-level text buttons.
- New chat, chat search, recent chats, active sessions, and archived session discovery remain reachable.
- Settings/configuration, keys, diagnostics, shortcut help, and archived chats remain reachable from the command/menu surface.
- Inspector opens as a right drawer and closes without leaving a reserved grid column.
- Conversation content remains centered when inspector is closed.
- Mobile and tablet keep a single-column chat-first experience.
- README.md and CLAUDE.md are reviewed after implementation; update them only if user-facing behavior or project instructions need documentation changes.

## Verification plan

- Run `npm --prefix web test`.
- Run `npm --prefix web run build`.
- Manually verify the UI in a browser:
  - desktop default layout,
  - command/menu access to advanced destinations,
  - inspector drawer open/close behavior,
  - archived/config/keys/diagnostics reachability,
  - mobile or narrow viewport single-column behavior.
