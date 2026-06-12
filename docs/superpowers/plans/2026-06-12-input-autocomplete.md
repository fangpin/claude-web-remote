# Input Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add frontend-only slash-command autocomplete to the session message textarea.

**Architecture:** Keep command data and pure autocomplete logic outside React, then wire the helpers into the existing `App.tsx` composer. The popup is rendered by the app near the textarea and uses local keyboard state only; the existing backend input API is unchanged.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, CSS.

---

## File Structure

- Create `web/src/autocomplete.ts`: built-in Claude command list and pure helper functions for detection, filtering, navigation, and replacement.
- Create `web/src/autocomplete.test.ts`: unit tests for helper behavior without React.
- Modify `web/src/App.tsx`: add textarea ref, selection tracking, suggestion state, keyboard handling, and popup rendering.
- Modify `web/src/App.css`: add composer layout and autocomplete popup styling.
- Modify `web/src/App.test.tsx`: add integration tests for visible suggestions and keyboard completion.

---

### Task 1: Add Pure Autocomplete Helpers

**Files:**
- Create: `web/src/autocomplete.ts`
- Create: `web/src/autocomplete.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `web/src/autocomplete.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_COMMANDS,
  applyCommandCompletion,
  findSlashCommandToken,
  getCommandSuggestions
} from './autocomplete';

describe('autocomplete helpers', () => {
  it('finds the slash command token before the cursor', () => {
    expect(findSlashCommandToken('/he', 3)).toEqual({ start: 0, end: 3, query: '/he' });
    expect(findSlashCommandToken('please run /sta', 15)).toEqual({ start: 11, end: 15, query: '/sta' });
  });

  it('does not find a token when the cursor is outside a slash command', () => {
    expect(findSlashCommandToken('hello', 5)).toBeNull();
    expect(findSlashCommandToken('/help now', 9)).toBeNull();
    expect(findSlashCommandToken('see http://example.test', 8)).toBeNull();
  });

  it('filters built-in commands by prefix', () => {
    expect(CLAUDE_COMMANDS.map((command) => command.name)).toContain('/help');
    expect(getCommandSuggestions('/he').map((command) => command.name)).toEqual(['/help']);
    expect(getCommandSuggestions('/perm').map((command) => command.name)).toEqual(['/permissions']);
  });

  it('returns no suggestions for text that is not a slash prefix', () => {
    expect(getCommandSuggestions('help')).toEqual([]);
    expect(getCommandSuggestions('')).toEqual([]);
  });

  it('replaces the current token with a completed command and trailing space', () => {
    expect(applyCommandCompletion('please /he today', { start: 7, end: 10, query: '/he' }, '/help')).toEqual({
      value: 'please /help today',
      cursor: 13
    });
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
npm --prefix web test -- autocomplete.test.ts
```

Expected: FAIL because `web/src/autocomplete.ts` does not exist.

- [ ] **Step 3: Implement autocomplete helpers**

Create `web/src/autocomplete.ts` with:

```ts
export type ClaudeCommand = {
  name: string;
  description: string;
};

export type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

export const CLAUDE_COMMANDS: ClaudeCommand[] = [
  { name: '/help', description: 'Show Claude Code help' },
  { name: '/clear', description: 'Clear the current conversation view' },
  { name: '/compact', description: 'Compact conversation context' },
  { name: '/cost', description: 'Show usage and cost information' },
  { name: '/doctor', description: 'Check Claude Code installation health' },
  { name: '/exit', description: 'Exit the current Claude session' },
  { name: '/logout', description: 'Sign out of Claude Code' },
  { name: '/login', description: 'Sign in to Claude Code' },
  { name: '/model', description: 'Choose or show the active model' },
  { name: '/permissions', description: 'Review permission settings' },
  { name: '/resume', description: 'Resume a previous Claude conversation' },
  { name: '/status', description: 'Show current Claude Code status' }
];

const TOKEN_BOUNDARY = /\s/;

export function findSlashCommandToken(value: string, cursor: number | null | undefined): SlashCommandToken | null {
  if (cursor === null || cursor === undefined || cursor < 0 || cursor > value.length) return null;

  let start = cursor;
  while (start > 0 && !TOKEN_BOUNDARY.test(value[start - 1])) {
    start -= 1;
  }

  let end = cursor;
  while (end < value.length && !TOKEN_BOUNDARY.test(value[end])) {
    end += 1;
  }

  const query = value.slice(start, cursor);
  const fullToken = value.slice(start, end);
  if (!query.startsWith('/') || fullToken.includes('://')) return null;
  return { start, end: cursor, query };
}

export function getCommandSuggestions(query: string): ClaudeCommand[] {
  if (!query.startsWith('/')) return [];
  return CLAUDE_COMMANDS.filter((command) => command.name.startsWith(query));
}

export function applyCommandCompletion(value: string, token: SlashCommandToken, commandName: string): { value: string; cursor: number } {
  const replacement = `${commandName} `;
  const nextValue = `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`;
  return {
    value: nextValue,
    cursor: token.start + replacement.length
  };
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
npm --prefix web test -- autocomplete.test.ts
```

Expected: PASS for all tests in `web/src/autocomplete.test.ts`.

---

### Task 2: Render Suggestions in the Composer

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing integration test for visible suggestions**

Add this test inside the existing `describe('App', () => { ... })` block in `web/src/App.test.tsx`:

```ts
  it('shows slash command suggestions while typing a command prefix', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });

    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/help/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\/status/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run App test to verify it fails**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because no suggestion list is rendered.

- [ ] **Step 3: Import helpers and add composer state**

In `web/src/App.tsx`, replace the first import line:

```ts
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
```

Add this import after the API import:

```ts
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
```

Inside `App`, after the existing `message` state line, add:

```ts
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [autocompleteToken, setAutocompleteToken] = useState<SlashCommandToken | null>(null);
  const [suggestions, setSuggestions] = useState<ClaudeCommand[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
```

- [ ] **Step 4: Add autocomplete refresh helper**

In `web/src/App.tsx`, add this function after the `activeSession` `useMemo` block:

```ts
  function refreshAutocomplete(value: string, cursor: number | null | undefined) {
    const token = findSlashCommandToken(value, cursor);
    const nextSuggestions = token ? getCommandSuggestions(token.query) : [];
    setAutocompleteToken(token && nextSuggestions.length > 0 ? token : null);
    setSuggestions(nextSuggestions);
    setActiveSuggestionIndex(0);
  }
```

- [ ] **Step 5: Wire textarea change and select events**

In `web/src/App.tsx`, replace the textarea JSX:

```tsx
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
```

with:

```tsx
                <textarea
                  ref={messageInputRef}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    refreshAutocomplete(event.target.value, event.target.selectionStart);
                  }}
                  onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                  rows={3}
                />
```

- [ ] **Step 6: Render suggestion popup**

In `web/src/App.tsx`, replace the composer form JSX:

```tsx
            <form className="composer" onSubmit={onSend}>
              <label>
                Message
                <textarea
                  ref={messageInputRef}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    refreshAutocomplete(event.target.value, event.target.selectionStart);
                  }}
                  onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                  rows={3}
                />
              </label>
              <button type="submit">Send</button>
            </form>
```

with:

```tsx
            <form className="composer" onSubmit={onSend}>
              <div className="composer-input">
                <label>
                  Message
                  <textarea
                    ref={messageInputRef}
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      refreshAutocomplete(event.target.value, event.target.selectionStart);
                    }}
                    onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                    rows={3}
                  />
                </label>
                {suggestions.length > 0 && autocompleteToken && (
                  <div className="autocomplete" role="listbox" aria-label="Claude command suggestions">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.name}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestionIndex}
                        className={index === activeSuggestionIndex ? 'autocomplete-option active' : 'autocomplete-option'}
                      >
                        <strong>{suggestion.name}</strong>
                        <span>{suggestion.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit">Send</button>
            </form>
```

- [ ] **Step 7: Add popup styles**

Append to `web/src/App.css`:

```css
.composer-input {
  position: relative;
}

.autocomplete {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 10;
  display: grid;
  max-height: 220px;
  overflow: auto;
  border: 1px solid #334155;
  border-radius: 10px;
  background: #111827;
  box-shadow: 0 16px 32px rgb(0 0 0 / 0.35);
}

.autocomplete-option {
  display: grid;
  gap: 3px;
  width: 100%;
  border: 0;
  border-radius: 0;
  padding: 10px 12px;
  text-align: left;
  color: #e5e7eb;
  background: transparent;
}

.autocomplete-option.active,
.autocomplete-option:hover {
  background: #1d4ed8;
}

.autocomplete-option span {
  color: #cbd5e1;
  font-size: 12px;
}
```

- [ ] **Step 8: Run App test to verify it passes**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS including `shows slash command suggestions while typing a command prefix`.

---

### Task 3: Add Keyboard Completion and Closing

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing keyboard tests**

Add these tests inside the existing `describe('App', () => { ... })` block in `web/src/App.test.tsx`:

```ts
  it('completes the active slash command with Tab without sending input', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
    fireEvent.keyDown(messageInput, { key: 'Tab' });

    expect(messageInput.value).toBe('/help ');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.anything());
  });

  it('completes the active slash command with Enter while suggestions are open', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });

    expect(messageInput.value).toBe('/help ');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.anything());
  });

  it('closes slash command suggestions with Escape', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/', selectionStart: 1 } });
    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();

    fireEvent.keyDown(messageInput, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Claude command suggestions' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run App test to verify keyboard tests fail**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because key handling is not implemented.

- [ ] **Step 3: Add completion and close helpers**

In `web/src/App.tsx`, add these functions after `refreshAutocomplete`:

```ts
  function closeAutocomplete() {
    setAutocompleteToken(null);
    setSuggestions([]);
    setActiveSuggestionIndex(0);
  }

  function completeActiveSuggestion() {
    if (!autocompleteToken || suggestions.length === 0) return;
    const suggestion = suggestions[activeSuggestionIndex];
    const completed = applyCommandCompletion(message, autocompleteToken, suggestion.name);
    setMessage(completed.value);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  }
```

- [ ] **Step 4: Add keydown handler**

In `web/src/App.tsx`, add this function after `completeActiveSuggestion`:

```ts
  function onMessageKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length === 0 || !autocompleteToken) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      completeActiveSuggestion();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeAutocomplete();
    }
  }
```

- [ ] **Step 5: Attach keydown handler to textarea**

In `web/src/App.tsx`, add this prop to the textarea:

```tsx
                    onKeyDown={onMessageKeyDown}
```

The textarea JSX should now include:

```tsx
                  <textarea
                    ref={messageInputRef}
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      refreshAutocomplete(event.target.value, event.target.selectionStart);
                    }}
                    onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                    onKeyDown={onMessageKeyDown}
                    rows={3}
                  />
```

- [ ] **Step 6: Run App test to verify keyboard behavior passes**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS for visible suggestions, Tab completion, Enter completion, Escape close, and existing send behavior.

---

### Task 4: Add Pointer Selection and Full Verification

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing pointer and navigation tests**

Add these tests inside the existing `describe('App', () => { ... })` block in `web/src/App.test.tsx`:

```ts
  it('moves the active suggestion with arrow keys', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/', selectionStart: 1 } });

    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(messageInput, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('completes a clicked slash command suggestion', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/sta', selectionStart: 4 } });
    fireEvent.click(await screen.findByRole('option', { name: /\/status/ }));

    expect(messageInput.value).toBe('/status ');
  });
```

- [ ] **Step 2: Run App test to verify pointer test fails**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because suggestion buttons do not complete on click.

- [ ] **Step 3: Allow completing a specific suggestion**

In `web/src/App.tsx`, replace `completeActiveSuggestion`:

```ts
  function completeActiveSuggestion() {
    if (!autocompleteToken || suggestions.length === 0) return;
    const suggestion = suggestions[activeSuggestionIndex];
    const completed = applyCommandCompletion(message, autocompleteToken, suggestion.name);
    setMessage(completed.value);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  }
```

with:

```ts
  function completeSuggestion(suggestion: ClaudeCommand) {
    if (!autocompleteToken) return;
    const completed = applyCommandCompletion(message, autocompleteToken, suggestion.name);
    setMessage(completed.value);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  }

  function completeActiveSuggestion() {
    const suggestion = suggestions[activeSuggestionIndex];
    if (!suggestion) return;
    completeSuggestion(suggestion);
  }
```

- [ ] **Step 4: Add click handler to suggestion buttons**

In `web/src/App.tsx`, add this prop to the suggestion `<button>`:

```tsx
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => completeSuggestion(suggestion)}
```

The suggestion button JSX should now be:

```tsx
                      <button
                        key={suggestion.name}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestionIndex}
                        className={index === activeSuggestionIndex ? 'autocomplete-option active' : 'autocomplete-option'}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => completeSuggestion(suggestion)}
                      >
                        <strong>{suggestion.name}</strong>
                        <span>{suggestion.description}</span>
                      </button>
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS for all frontend tests.

- [ ] **Step 6: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS and Vite produces `web/dist` assets.

- [ ] **Step 7: Manual browser verification**

Run the app using the project startup path:

```bash
npm --prefix web run build
scripts/start-server.sh --skip-web-build
```

Open the served UI through the configured local access path. Verify:

1. Create or select a session.
2. Type `/` in the Message textarea and confirm the suggestions appear.
3. Type `/he` and confirm only `/help` remains.
4. Press Tab and confirm `/help ` is inserted without sending.
5. Type `/sta`, click `/status`, and confirm `/status ` is inserted.
6. Type `/`, press Escape, and confirm suggestions close.
7. Type a normal message and click Send; confirm it still posts to the active session.

Stop the daemon after manual verification.

---

## Self-Review Notes

- Spec coverage: Task 1 covers built-in command data and pure helper logic; Task 2 covers rendering and filtering; Task 3 covers Tab, Enter, Escape, and arrow keys; Task 4 covers click completion and full verification. The backend remains unchanged as required.
- Placeholder scan: No placeholder steps remain; all code edits, commands, and expected outcomes are explicit.
- Type consistency: `ClaudeCommand`, `SlashCommandToken`, `findSlashCommandToken`, `getCommandSuggestions`, and `applyCommandCompletion` are defined in Task 1 and used consistently in later tasks.
