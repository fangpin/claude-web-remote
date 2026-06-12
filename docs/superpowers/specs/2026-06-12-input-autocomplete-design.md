# Input Autocomplete Design

## Goal

Add lightweight autocomplete to the session message input so users can quickly insert common Claude slash commands.

## Scope

This first version only supports Claude slash commands in the browser UI. It does not add backend APIs, user configuration, prompt templates, project-specific commands, or command discovery from the Claude CLI.

## User Experience

When the message input cursor is inside a slash-command token, the UI shows a filtered suggestion list. Examples:

- `/` shows all built-in command suggestions.
- `/he` shows matching commands such as `/help`.
- Text without a slash-command token shows no suggestions.

Each suggestion displays the command and a short description. The user can:

- Use ArrowDown and ArrowUp to move the active suggestion.
- Press Tab or Enter to insert the active suggestion.
- Press Escape to close the list.

Completing a suggestion replaces only the current slash-command token and adds a trailing space. For example, completing `/he` with `/help` changes the input to `/help ` and keeps focus in the textarea. Completion does not submit the message.

The existing Send button and message submission behavior remain unchanged.

## Architecture

Keep the feature frontend-only:

- Add a small built-in command list in the web source tree.
- Add pure helper logic to detect the slash-command token around the textarea cursor, filter matching commands, and produce the replacement text.
- Keep UI state in `App.tsx`: whether suggestions are open, which suggestion is active, and the textarea selection position needed for replacement.
- Render the suggestion popup next to the composer, styled consistently with the existing dark UI.

The helper logic should be independent from React so filtering and replacement behavior can be unit-tested without browser event setup.

## Command List

Start with a curated built-in set of common Claude Code commands, such as:

- `/help`
- `/clear`
- `/compact`
- `/cost`
- `/doctor`
- `/exit`
- `/logout`
- `/login`
- `/model`
- `/permissions`
- `/resume`
- `/status`

Descriptions should be short and UI-facing. The list is intentionally static for this version.

## Keyboard Behavior

The textarea keeps normal typing behavior except when the autocomplete list is open:

- ArrowDown, ArrowUp, Tab, Enter, and Escape are intercepted for autocomplete.
- Enter only completes when suggestions are open; otherwise form submission behavior stays as it is today.
- Tab only completes when suggestions are open; otherwise the browser default is unchanged.

When filtering changes, the active suggestion resets to the first item.

## Data Flow

1. The user types or moves the cursor in the message textarea.
2. The UI computes the current slash-command query from the textarea value and selection start.
3. The command list is filtered by command prefix.
4. Matching suggestions render below the textarea.
5. A completion key replaces the detected token and updates the textarea value and cursor.
6. Sending the message posts the final textarea contents through the existing `/api/sessions/:id/input` API.

## Error Handling

This feature has no network or persistence errors because command suggestions are local. If no slash token or no matching commands are found, the suggestion list closes. If cursor position is unavailable, autocomplete does nothing and the textarea remains usable.

## Testing

Frontend tests should cover:

- Typing `/` shows built-in command suggestions.
- Typing a prefix filters the list.
- Tab completes the active suggestion without sending the message.
- Enter completes the active suggestion when the list is open.
- Escape closes the list.
- Normal message sending still calls the existing input API.

Run:

```bash
npm --prefix web test
npm --prefix web run build
```
