# Expanded Claude Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the static Claude slash-command autocomplete list, including `/reload-skills`.

**Architecture:** Keep the existing frontend-only autocomplete architecture. Only the static command data and pure helper tests change; UI behavior and backend APIs stay unchanged.

**Tech Stack:** TypeScript, Vitest, React/Vite frontend.

---

## File Structure

- Modify `web/src/autocomplete.ts`: replace `CLAUDE_COMMANDS` with a larger alphabetically sorted static list.
- Modify `web/src/autocomplete.test.ts`: add list coverage tests for expanded commands, uniqueness, sort order, and broader prefix filtering.

---

### Task 1: Expand Static Claude Command Data

**Files:**
- Modify: `web/src/autocomplete.ts`
- Modify: `web/src/autocomplete.test.ts`

- [ ] **Step 1: Write failing command-list tests**

Add these tests inside `describe('autocomplete helpers', () => { ... })` in `web/src/autocomplete.test.ts`:

```ts
  it('includes expanded Claude slash commands', () => {
    expect(CLAUDE_COMMANDS.map((command) => command.name)).toEqual(expect.arrayContaining([
      '/add-dir',
      '/agents',
      '/bug',
      '/config',
      '/context',
      '/export',
      '/help',
      '/init',
      '/install-github-app',
      '/memory',
      '/mcp',
      '/model',
      '/permissions',
      '/pr-comments',
      '/reload-skills',
      '/review',
      '/status',
      '/terminal-setup',
      '/vim'
    ]));
  });

  it('keeps command names unique and sorted', () => {
    const names = CLAUDE_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it('returns multiple sorted matches for broader prefixes', () => {
    expect(getCommandSuggestions('/m').map((command) => command.name)).toEqual(['/memory', '/mcp', '/model']);
    expect(getCommandSuggestions('/re').map((command) => command.name)).toEqual(['/release-notes', '/reload-skills', '/resume', '/review']);
  });
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
npm --prefix web test -- autocomplete.test.ts
```

Expected: FAIL because expanded commands such as `/agents`, `/memory`, and `/reload-skills` are not in the list yet.

- [ ] **Step 3: Replace the static command list**

In `web/src/autocomplete.ts`, replace `CLAUDE_COMMANDS` with this alphabetically sorted list:

```ts
export const CLAUDE_COMMANDS: ClaudeCommand[] = [
  { name: '/add-dir', description: 'Add another working directory to the session' },
  { name: '/agents', description: 'Manage or use configured agents' },
  { name: '/bug', description: 'Report a Claude Code bug' },
  { name: '/clear', description: 'Clear the current conversation view' },
  { name: '/compact', description: 'Compact conversation context' },
  { name: '/config', description: 'Open Claude Code configuration' },
  { name: '/context', description: 'Inspect current context usage' },
  { name: '/cost', description: 'Show usage and cost information' },
  { name: '/doctor', description: 'Check Claude Code installation health' },
  { name: '/exit', description: 'Exit the current Claude session' },
  { name: '/export', description: 'Export the current conversation' },
  { name: '/help', description: 'Show Claude Code help' },
  { name: '/init', description: 'Create or update project guidance for Claude' },
  { name: '/install-github-app', description: 'Install the Claude GitHub app' },
  { name: '/login', description: 'Sign in to Claude Code' },
  { name: '/logout', description: 'Sign out of Claude Code' },
  { name: '/memory', description: 'Manage Claude memory' },
  { name: '/mcp', description: 'Manage MCP server connections' },
  { name: '/migrate-installer', description: 'Migrate Claude Code installer setup' },
  { name: '/model', description: 'Choose or show the active model' },
  { name: '/permissions', description: 'Review permission settings' },
  { name: '/pr-comments', description: 'View or work through pull request comments' },
  { name: '/release-notes', description: 'Show Claude Code release notes' },
  { name: '/reload-skills', description: 'Reload available Claude skills' },
  { name: '/resume', description: 'Resume a previous Claude conversation' },
  { name: '/review', description: 'Review code changes' },
  { name: '/status', description: 'Show current Claude Code status' },
  { name: '/terminal-setup', description: 'Configure terminal integration' },
  { name: '/vim', description: 'Toggle or configure Vim mode' }
];
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run:

```bash
npm --prefix web test -- autocomplete.test.ts
```

Expected: PASS for all autocomplete helper tests.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
npm --prefix web test
npm --prefix web run build
```

Expected: PASS for all frontend tests and the production build.

---

## Self-Review Notes

- Spec coverage: The plan updates only the static command list and tests, includes `/reload-skills`, verifies uniqueness/sort order, and leaves UI/backend behavior unchanged.
- Placeholder scan: No placeholders remain; all commands, tests, and verification commands are explicit.
- Type consistency: Existing `ClaudeCommand`, `CLAUDE_COMMANDS`, and `getCommandSuggestions` names are used consistently.
