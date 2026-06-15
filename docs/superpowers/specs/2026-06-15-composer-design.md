# Composer redesign toward Claude app input

## Goal

Make the session composer feel lighter, steadier, and closer to the Claude app input box while preserving the current power-user capabilities: slash commands, path context, pasted text context, prompt history, attachments, and stop/send behavior.

The default composer should read as a message input first, not as a command controller.

## Current problems

The current composer default state exposes too much implementation detail at once:

- `Permission: ...` is technical and visually loud.
- `Target: ... · worktree` is useful but should be lighter.
- `Details` duplicates context that can live behind one project chip.
- `History` is a visible peer to sending, even though keyboard recall is the primary behavior.
- The hints row permanently consumes vertical space.
- Stop should be the primary action only when Claude is actively working, not a standing control beside Send.

## Design direction

Use a compact single-surface composer with an inline status cue.

Default hierarchy:

1. A small status pill, such as `Ready` or `Claude is working`.
2. The textarea with `Message Claude...`.
3. A bottom action rail with `+`, `Project: <repo>`, and the primary send/stop button.

The status pill remains inside the composer rather than moving into a separate bar. This keeps a lightweight status cue visible without increasing the composer’s footprint or crowding the bottom rail.

## Composer layout

The composer stays a single rounded input container. Its default state shows only:

- inline status pill
- message textarea
- `+` attachment button
- `Project: <repo>` context chip
- primary send button

The default state does not show:

- permission chip
- target chip
- details chip
- history button
- always-visible hints row
- always-visible stop control

Attachment chips still appear when attachments exist, but their styling should be quieter than today so they do not compete with the input surface. Text snippets can still expand for preview and be removed.

## Project context chip

Replace the current permission chip, target chip, and `Details` disclosure with a single `Project: <repo>` chip.

The chip is an information-only disclosure. It should not contain project switching, changed-file attachment, or other future actions.

The closed chip shows:

- `Project: claude-web-remote` for normal sessions
- the same project label plus a subtle worktree cue when the session is in a worktree

The open popover shows a definition list with the available session context:

- project/source cwd
- active cwd or worktree cwd
- branch, when in a worktree
- permission mode
- session/runtime status

The chip does not change the session data model. It only changes how existing session fields are presented.

## Send and stop behavior

The composer has one primary action.

When Claude is not actively working, the primary action is Send. It is enabled only when the composer has a message draft or attachments and the session can receive input.

When Claude is actively working, the primary action becomes Stop. The button uses a subtle danger style and exposes `Stop` through visible title and accessible label text.

This design intentionally avoids showing Send and Stop as equal standing controls. If the current app does not already expose a real stop handler to the composer, implementation must first connect to existing stop capability or add real stop support before making the button interactive. Do not add a fake Stop button.

## Prompt history

Prompt history should not be a default visible button.

Keep the existing keyboard behavior:

- `ArrowUp` recalls older prompts when allowed by the current cursor/draft state.
- `ArrowDown` moves forward through recalled prompts.

If a mouse-visible history affordance is retained, it should be secondary: for example, inside a light keyboard/help popover or another non-primary affordance. It should not sit beside the primary send/stop action in the default composer.

## Hints

The shortcut hints become contextual instead of permanent.

Show a single quiet hints line only when:

- the composer has focus, and
- the message is empty.

Suggested text:

`Enter send · Shift Enter newline · / commands · ↑ history`

Hide hints when the composer is blurred or the user has typed content. This reduces persistent vertical height while still teaching the shortcuts at the moment they are useful.

## Attachment menu

The `+` button continues to open the attachment popover.

Current capabilities remain in scope:

- Add repo path
- Paste text

The copy should be less technical than today. Use labels such as `Add context`, `Add repo path`, and `Paste text`. Avoid exposing implementation details like “references are sent as prompt context” in the default copy unless needed for clarity.

Do not add unimplemented menu items such as changed files, current diff, selected transcript, or switch project unless existing data and handlers already support them cleanly.

## Slash command autocomplete

Slash command autocomplete keeps the current `/` trigger, keyboard navigation, and completion behavior.

The autocomplete popover remains attached to the composer input area and is not folded into the Project chip. Styling can be adjusted only as needed to fit the lighter composer, but behavior should remain stable.

## State and component boundaries

Prefer local restructuring over a state-machine rewrite.

Expected touch points:

- `web/src/Composer.tsx` for layout, Project chip rendering, and primary button state.
- `web/src/useComposerState.ts` only for data needed by the new UI, such as contextual hint visibility or real stop wiring if it exists there.
- `web/src/App.css` for composer layout, chip, popover, hint, attachment, and send/stop styling.

Keep the existing attachment, autocomplete, and history logic unless a small change is necessary for the new visual hierarchy.

## Accessibility

Preserve current keyboard flows and accessible labels:

- textarea remains labeled as the message input
- slash autocomplete keeps listbox/option semantics
- Project chip has an accessible disclosure label
- Send and Stop expose accurate labels and disabled states
- hint visibility is visual only and does not remove keyboard behavior

The Stop button must not be rendered as an active control unless it calls a real stop action.

## Testing and verification

Manual verification should cover:

- default composer is visually shorter and reads as a message input
- Project chip opens and shows cwd, branch/worktree, permission, and status details
- hints appear only when focused and empty, then hide after typing or blur
- `/` autocomplete still opens, navigates, and completes commands
- `ArrowUp`/`ArrowDown` history recall still works
- path context attachments can be added and removed
- pasted text context can be added, previewed, and removed
- Send remains disabled without a draft or attachment and enabled with one
- running-state primary action switches to Stop only if real stop wiring exists

Run the frontend checks after implementation:

```bash
npm --prefix web test
npm --prefix web run build
```

Because this is a frontend composer change, manually run the app and verify the golden path in the browser before calling the implementation complete.

## Documentation impact

After implementation, review `README.md` and `CLAUDE.md` as required by project instructions.

This redesign is primarily UI behavior and likely does not require documentation changes unless the implementation adds or changes user-facing composer capabilities.