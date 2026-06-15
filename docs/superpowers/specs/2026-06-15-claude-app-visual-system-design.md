# Claude app visual system design

## Goal

Make Claude Remote Web visually and structurally feel like the native Claude app rather than a remote session control surface. The first version should redesign the full visible frontend surface: app shell, sidebar, conversation workspace, composer, transcript rendering, inspector, and empty states.

The product should optimize for Claude app fidelity over preserving every current affordance in its current position. Unnecessary management chrome can be removed from the default UI, and necessary controls should move to the places where the Claude app exposes analogous controls.

## Non-goals

- Do not change backend APIs, WebSocket event flow, session persistence, or daemon security posture.
- Do not add unsupported browser-side Claude Code control frames.
- Do not introduce a public HTTP exposure model or weaken the SSH-only default.
- Do not create a configurable theme system in this version.
- Do not make dark mode a first-class deliverable in this version.

## Design direction

Use a strict Claude app layout model:

1. Left session sidebar.
2. Central conversation workspace.
3. Far-right contextual inspector for plan, background tasks, activity, and diagnostics.

Do not add a persistent rail. The native Claude app does not use one, and a rail makes the product feel like a generic admin shell. Global or advanced destinations should either be removed from the default surface or placed behind compact Claude-like menu affordances.

The visual language should use a warm light Claude-style palette: soft canvas, low-contrast borders, warm neutral surfaces, restrained shadows, rounded containers, and calm text hierarchy. The UI should feel like a chat app first, with operational state available but quiet.

## Claude shell design system

Create a small frontend visual system for this shell rather than a one-off CSS skin. It should define reusable tokens for:

- Warm canvas and raised surface colors.
- Border, divider, hover, selected, and focus states.
- Text hierarchy for primary, secondary, tertiary, danger, and attention states.
- Radius levels for sidebar rows, cards, composer, transcript blocks, and panels.
- Spacing levels for shell gutters, list rows, message rhythm, and panel content.
- Shadow levels for composer, floating menus, and elevated inspector sections.

The system should be intentionally narrow. It exists to make this redesign coherent and extendable, not to become a broad theming framework.

## App shell layout

Desktop uses a three-region layout:

- Left: session sidebar.
- Center: conversation workspace.
- Right: contextual inspector.

The center conversation remains the primary focus. The inspector can be collapsed or quiet when it has no meaningful content, but when visible it stays at the far right rather than appearing as a generic overlay from arbitrary chrome.

Medium widths should collapse or hide the inspector first. Narrow widths should prioritize the conversation, with the session list available as an overlay or drawer. The composer must remain reachable and stable at all widths.

## Session sidebar

The sidebar should read like Claude app chat history, not a session metadata table.

- Keep recent, grouped, pinned, and archived session capabilities where they are still useful.
- Put per-session actions on the session row overflow menu (`...`): rename, archive, delete, pin, group/move, and worktree-related actions.
- Do not place session management actions in the conversation workspace header if they can live on the session row.
- Keep row defaults calm: title, short subtitle, runtime/attention cue only when relevant.
- Reveal power-user metadata such as cwd, branch, worktree, and permission mode only on hover, focus, active row, or overflow menu.

The top of the sidebar should contain only Claude-like essentials: product identity, new chat, search or jump affordance, and compact access to advanced destinations if still needed.

## Conversation workspace

The conversation workspace should stop acting as a management header and become a clean chat canvas.

- Keep the header minimal: current conversation identity and only unavoidable state.
- Remove or relocate session actions from the header to the session row overflow menu.
- Avoid broad system banners unless the issue blocks the conversation.
- Center transcript content at a readable chat width on a warm canvas.
- Keep background operational details discoverable through the inspector rather than always visible in the conversation chrome.

## Composer

The composer should look and feel like Claude app input, not a generic form.

- Use a bottom anchored, rounded, warm elevated input surface.
- Keep multiline typing, send, stop, slash autocomplete, context chips, and attachments where already supported.
- Use quiet icon-style controls and clear focus state.
- Keep command and context affordances visually subordinate to the text input.

## Transcript rendering

Transcript rendering should reduce log-console feel while preserving important Claude Code detail.

- Assistant and user messages should use Claude-like readable spacing and typography.
- Tool calls, results, diffs, code blocks, and system events should share the same warm surface hierarchy.
- Successful low-value details should stay collapsed or visually quiet.
- Failures, permission prompts, and action-needed states should remain visible without overwhelming the chat.
- Raw details should remain reachable where the current UI already supports them, but not dominate the default view.

## Right inspector

The inspector remains the far-right contextual area, matching the native Claude app pattern for plan and background task information.

- Use it for plan, background tasks, activity, diagnostics, and other session-context panels.
- Keep it visually distinct from the central chat but aligned to the same warm design system.
- Do not treat it as global navigation or a replacement rail.
- When empty or irrelevant, collapse or minimize its visual weight.
- When attention is needed, use a quiet indicator in the appropriate existing location, then show detail inside the inspector.

## Empty and loading states

Empty states should feel like Claude app welcome surfaces.

- Center the welcome content in the conversation area.
- Use short, friendly copy and a few useful starter actions.
- Avoid exposing implementation details such as daemon state, config paths, or session metadata unless the user asks for diagnostics.
- Loading and disconnected states should use small, calm status treatments with detailed diagnostics available in the inspector.

## Error handling and state presentation

Keep data behavior unchanged, but change where state appears.

- Blocking send/session errors can appear near the composer or conversation top as lightweight notices.
- Diagnostics, process detail, and verbose recovery information should live in the right inspector.
- Worktree or permission states should appear only where they affect the user's next action.
- Avoid admin-dashboard alert stacks in the default chat path.

## Implementation shape

Likely frontend work:

- `web/src/AppShell.tsx`: replace the current shell structure with the strict Claude app layout: sidebar, conversation, far-right inspector, no rail.
- `web/src/App.css`: introduce the Claude shell tokens and migrate shell/sidebar/workspace/composer/transcript/inspector styling to them.
- `web/src/SessionSidebar.tsx`: move session actions into row overflow menus and reduce default metadata density.
- `web/src/ConversationWorkspace.tsx`: remove management-style header actions, simplify header hierarchy, and align workspace layout with the new shell.
- `web/src/Composer.tsx`: align the input surface, chips, controls, and focus states with the new design system.
- `web/src/ConversationBlockList.tsx` and related rendering files: align message/tool/code/system block surfaces and spacing with the new hierarchy.
- `web/src/InspectorPanel.tsx`: preserve content while restyling it as the far-right contextual panel.
- `web/e2e/visual.spec.ts`: update or add visual states for the new default layout.

Prefer reusing existing app state and API clients. Refactor component boundaries only where needed to make the visual responsibilities clear.

## Responsive behavior

- Desktop: sidebar, centered conversation, far-right inspector.
- Medium width: collapse or minimize the inspector before compressing the chat.
- Narrow width: show one primary surface at a time, prioritizing conversation and composer; session list can become an overlay/drawer.
- The layout should avoid horizontal scrolling and keep transcript reading width reasonable.

## Accessibility

- Session overflow menus must be keyboard reachable and screen-reader labeled.
- Focus order should follow sidebar, conversation, composer, inspector in a predictable way.
- Collapsed inspector and sidebar states must remain discoverable through labeled buttons.
- Color should not be the only indicator for running, waiting, failed, or attention-needed states.
- Existing keyboard shortcuts should keep working unless intentionally redesigned in a later spec.

## Acceptance criteria

- The default desktop UI has no persistent rail.
- The default desktop UI reads as Claude app-like: left chat history, center conversation, far-right contextual inspector.
- Per-session actions live on the session row overflow menu, not in the conversation header.
- Conversation header is minimal and does not act as a management toolbar.
- The right inspector is used for plan, background tasks, activity, and diagnostics.
- Composer, transcript, tool blocks, code blocks, empty states, sidebar, and inspector share the same warm Claude-style visual system.
- Unnecessary admin/config chrome is removed from the default surface or moved behind compact menu affordances.
- Existing core flows still work: new chat, switch chat, send message, stop where currently supported, inspect plan/tasks/diagnostics, use session row actions, and access archived sessions.
- README.md and CLAUDE.md are reviewed after implementation; update them only if the user-facing behavior or project instructions need documentation changes.

## Verification plan

Automatic checks after implementation:

```bash
npm --prefix web test
npm --prefix web run build
```

Manual UI verification after implementation:

- Start the app and verify the desktop default layout has no rail.
- Verify the sidebar resembles chat history and session row `...` menus contain session actions.
- Verify the conversation header stays minimal during normal chat use.
- Send a message and confirm composer, transcript, tool blocks, and code blocks keep readable Claude-like hierarchy.
- Verify the right inspector shows plan/background tasks/activity/diagnostics in the far-right region.
- Verify empty state, loading state, blocked/error state, and long transcript state.
- Resize to medium and narrow widths and confirm inspector/sidebar collapse before the conversation becomes unusable.
