# Claude start surface design

## Goal

Make the empty/new chat page feel like the Claude app: the first question should be what the user wants Claude to do, not where Claude should run. Repository, worktree, and permission settings remain available, but become context attached to the prompt instead of the main visual task.

## Current gap

`web/src/ProjectHome.tsx` currently leads with “Where should Claude work?” and a required workspace input. This makes the page feel like a session launcher or admin form. The product still needs a devbox cwd, worktree choice, and permission mode, but those should read as context for Claude rather than launch parameters.

## Proposed UX

The page becomes a Claude-style start surface:

1. Centered hero title: “What would you like Claude to do?”
2. A large start composer with placeholder text: “Ask Claude to explain, edit, test, review…” and a primary Send button.
3. Context chips directly below the composer:
   - `Project: <basename>`
   - `Worktree: On/Off`
   - `Permission: <mode>`
   - `Change`
4. `Change` expands a `Project context` area containing:
   - cwd input
   - recent project buttons as context selectors
   - worktree checkbox
   - permission mode select
5. Suggestion cards below the context row:
   - Explain this repo
   - Fix a bug
   - Review changes
   - Run tests
   - Implement a feature
6. Recent chats stay below the start composer as the main resume path.
7. Recent projects are no longer a primary page section; they are part of changing context.

## Behavior

Submitting the start composer requires both a non-empty cwd and a non-empty prompt. On submit, the app creates a session with the selected cwd, worktree, and permission mode, then immediately sends the prompt to that session.

If session creation fails, the user stays on the start surface and sees the existing app error. If prompt sending fails after session creation succeeds, the new session remains open and the existing error surface reports the send failure. This preserves user work and avoids hiding a successfully created session.

Clicking a suggestion card fills the start composer with that prompt; it does not auto-submit. Clicking a recent project updates the cwd/context chip; it does not start a session.

Defaults remain unchanged: worktree stays on by default, and the selected permission mode continues to come from existing app state/config.

## Implementation shape

`web/src/ProjectHome.tsx` owns a lightweight start composer state and renders the new layout. It should not reuse the full `Composer.tsx` because that component depends on an active session, prompt history, context attachments, autocomplete state, and runtime status. Reusing it would force unrelated state into the start surface.

The frontend session creation flow changes from a submit-only `onCreateSession(event)` callback to a start-session action that can receive the initial prompt. The implementation can still use the existing API calls: `createSession(...)` followed by `sendInput(sessionId, prompt)`.

`web/src/App.css` should replace the existing `project-home` styles with the new composer-first hierarchy while keeping the current warm Claude-like palette and responsive behavior.

No backend API changes are required.

## Accessibility and responsive behavior

The composer textarea has an explicit accessible label and supports keyboard submission. Context settings remain reachable through a normal details/summary or button-controlled disclosure. Suggestion cards are buttons with descriptive labels.

On narrow screens, context chips wrap, the Send button remains reachable, and the context settings stack vertically.

## Verification

Run frontend checks:

```bash
npm --prefix web test
npm --prefix web run build
```

Manual verification:

1. Open the app on the new chat/start surface.
2. Confirm the first visual focus is the prompt composer and the title asks what Claude should do.
3. Confirm the page can create a session and send the initial prompt.
4. Confirm empty prompt or empty cwd does not submit.
5. Confirm `Change` exposes cwd, recent projects, worktree, and permission controls.
6. Confirm suggestion cards populate the prompt without starting a session.
7. Confirm recent chats remain available below the start surface.
