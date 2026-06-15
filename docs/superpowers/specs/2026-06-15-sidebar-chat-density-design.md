# Sidebar Chat Density Design

## Context

The sidebar has already moved toward a chat list, but session rows still expose too much Claude Code metadata by default: runtime labels, cwd/path, branch, explicit Active/Archived mode controls, and always-adjacent power actions. The goal is to make the default scan feel like Claude app chat history while keeping engineering context available for power users.

## Goals

- Make the default sidebar read as recent chat history, not a session metadata list.
- Keep running, waiting, and failed sessions visible enough to act on quickly.
- Preserve cwd, branch, worktree, permission, pin, move, group, and archive affordances without making them default visual content.
- Keep the implementation local to the existing sidebar and CSS unless the code demands a small helper component.

## Non-goals

- No new data model or API changes.
- No browser-side fake Claude Code controls.
- No redesign of the main conversation view, inspector, or primary rail.
- No new persistent user preference for density.

## Component structure

`SessionSidebar` will continue to own list-level behavior: grouping, search, active/archived mode, drag/drop targets, and section rendering. The per-session row rendering inside `sessions.map(...)` will be extracted into a `SessionListItem` component in `web/src/SessionSidebar.tsx`.

`SessionListItem` will receive the session, active state, list mode, groups, pinned state, and existing callbacks. It will own the compact default row, expanded detail layer, runtime indicator, move select, and pin action.

This keeps the refactor bounded while separating row density rules from section/list logic.

## Default row content

Each session row defaults to two layers:

1. Title row
   - Runtime dot before the title.
   - Session title from `session.name` with existing project-name fallback.
   - No default full status pill for ordinary ended/stopped sessions.
2. Subtitle row
   - `project name · relative time` for ordinary sessions.
   - For important runtime states, include the status in the subtitle, such as `running · 8m ago`, `waiting · 20m ago`, or `failed · yesterday`.

The default row should be about 54–60px tall when content fits on one line. Text may wrap naturally where the current sidebar already allows it, but the visual hierarchy should still privilege title and subtitle.

## Expanded row content

Rows reveal Claude Code details inline on `:hover`, `:focus-within`, and `.active`.

The expanded layer includes:

- Full cwd/source cwd, truncated with ellipsis where needed.
- Branch if present.
- Worktree indicator if present.
- Permission mode if it exists on the current `SessionInfo` type; otherwise omit it rather than inventing a placeholder.
- Move select.
- Pin button.

The active row remains expanded so the currently selected session always exposes its engineering context. Hover/focus expansion should use subtle opacity/height/translate transitions and avoid dramatic movement.

Pinned sessions keep a visible but quiet pin indicator even when not hovered, so pinned state remains discoverable. Unpinned pin and move controls stay hidden until hover/focus/active.

## Active and archived mode

The current prominent `Active / Archived` segmented control will be removed from the default top stack.

The sidebar defaults to `Recent chats`. A lightweight `Archived` affordance moves into the toolbar area near search/list controls. When in archived mode, the heading becomes `Archived chats`, and the same area offers a quiet `Recent` return action.

This keeps archived sessions reachable without making list mode feel like an admin filter.

## Sections and groups

Section headings become lighter and more chat-list-like:

- Keep `Pinned`, date buckets/project/custom group labels, and chat counts.
- Avoid showing long parent paths or metadata-heavy descriptions as default section copy.
- Keep custom group rename/delete controls on hover/focus of the group heading.
- Preserve drag/drop behavior for custom groups and the ungrouped area.

## Visual style

Use the existing warm Claude-like palette and avoid adding a new visual language.

- Title is the strongest text element.
- Subtitle uses muted color and short copy.
- Runtime dot is 6–7px; running/starting may pulse; waiting/failed use attention colors.
- Active row uses a light surface, fine border, and soft shadow at most.
- Engineering detail chips are small and only appear in the expanded layer.
- The row should feel calm and readable before it feels powerful.

## Accessibility

- Expanded content appears on both hover and keyboard focus via `:focus-within`.
- Pin and move controls remain keyboard-reachable.
- Runtime dot should not be the only accessible status source for important states; the subtitle text covers running/waiting/failed.
- Buttons and selects keep descriptive `aria-label` values.
- The selected session keeps `aria-current="page"`.

## Testing

Automatic checks after implementation:

```bash
npm --prefix web test
npm --prefix web run build
```

Manual UI verification after implementation:

- Default sidebar rows show title plus compact subtitle only.
- Hover, focus, and selected rows reveal cwd, branch/worktree, permission if available, pin, and move controls.
- Running, waiting, and failed sessions remain noticeable.
- Archived mode can be entered and exited without a prominent top segmented control.
- Pin, move, drag/drop group, rename group, and delete group affordances still work.
- README.md and CLAUDE.md are reviewed for update need; expected result is no docs change for this UI-only density adjustment.

## Acceptance criteria

- At a glance, the sidebar reads like chat history rather than session metadata.
- Current running or attention-needed sessions remain easy to identify.
- Branch, worktree, cwd, and related power-user context are retained but no longer occupy default row space.
