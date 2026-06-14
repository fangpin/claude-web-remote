# Activity Drawer Design

## Goal

Replace the always-present Inspector concept with an on-demand Activity drawer that feels closer to the Claude app: chat remains the primary surface, and execution details are available only when the user asks for them.

## Current state

The UI already defaults `isInspectorOpen` to false, but the layout, labels, shortcut copy, and component structure still present the feature as an Inspector. On desktop, the app shell reserves a fourth grid column for the inspector when open. On mobile, the inspector becomes a compressed bottom panel. The default tab is `Session tasks`, and advanced/internal surfaces such as `All tasks` and `Diagnostics` sit alongside user-facing tabs.

## Design

### Entry point

Add an `Activity` button to the right side of the conversation header. This is the primary way to open the drawer from a chat. `⌘/Ctrl+I` and the command palette continue to toggle the same surface, but their copy changes from Inspector to Activity.

The drawer opens as a fixed right-side overlay with a backdrop. Closing works through the drawer close button, the backdrop, and `Esc`.

### Layout

The app shell no longer reserves a permanent right-side grid column for the drawer. The workspace keeps its width when Activity opens, and the drawer overlays the right side. Desktop keeps the existing resizable width behavior with the handle on the drawer's left edge. Mobile uses the same drawer model instead of a separate bottom/inline inspector layout, with the drawer width constrained to the viewport.

### Drawer content

The drawer title is `Activity`. Its subtitle shows the selected session name or path, with an empty state when no session is selected.

Default tab is `Activity`. The user-facing tab row contains:

- `Activity` — current run and recent tool activity.
- `Tasks` — current session tasks, replacing the `Session tasks` label.
- `Plan` — the current session plan.

Advanced/internal surfaces move out of the main tab row:

- `All tasks` appears in an Advanced group.
- `Diagnostics` appears in the Advanced group only when `import.meta.env.DEV` is true.

If the current tab becomes unavailable because the advanced/dev-only tab is hidden, the drawer falls back to `Activity`.

### Activity presentation

Reuse the existing `ActivityPanel` data flow. Tune visible copy toward an execution trace: what Claude is doing now, recent tool calls, and whether it is waiting for permission. Selecting an activity still jumps to the related conversation event.

### Data flow

No backend changes are required. Existing activity, task, plan, and diagnostics props continue to flow from `App.tsx` into the drawer component. Diagnostics fetching remains lazy and only runs when the Diagnostics tab is visible.

### Accessibility

The drawer is a modal-style complementary surface with a labelled close button. The backdrop is clickable but not the only close path. Existing tab keyboard navigation remains, adjusted to the visible tab list so hidden Advanced or dev-only tabs are skipped.

### Testing

Update frontend tests to cover:

- The right-side management panel is absent by default.
- Clicking the conversation header `Activity` button opens the drawer on the `Activity` tab.
- `Tasks` and `Plan` remain available inside the drawer.
- `Diagnostics` is hidden outside Vite dev mode and visible in dev mode.
- Activity/task selections still jump to the corresponding conversation event.

Run `npm --prefix web test` and `npm --prefix web run build` for this frontend change. Also review README.md and CLAUDE.md after implementation; no documentation update is expected unless the user-facing control names are documented there.
