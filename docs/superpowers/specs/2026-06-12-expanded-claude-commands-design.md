# Expanded Claude Commands Design

## Goal

Expand message input autocomplete so it suggests a more complete set of Claude Code slash commands, including `/reload-skills`.

## Scope

This change only updates the frontend static command list and tests. It does not change autocomplete interaction behavior, add backend APIs, or dynamically inspect Claude at runtime.

## Command Source

Use a combined static list:

- Commands already present in the first autocomplete implementation.
- Commands aligned with the local Claude Code CLI capabilities observed from `claude --help` on Claude Code 2.1.153.
- Common interactive Claude Code slash commands that are useful in the remote web composer.
- The user-requested `/reload-skills` command.

The list remains intentionally local and explicit so the browser UI works without launching Claude or depending on a machine-readable command export.

## User Experience

The autocomplete UI behavior stays unchanged. Typing `/` shows all commands; typing a prefix filters by command name; Tab, Enter, arrow keys, Escape, and click completion keep their existing behavior.

Commands are sorted alphabetically by command name so filtered results are predictable.

Each command has one short UI-facing description.

## Testing

Extend `web/src/autocomplete.test.ts` to verify:

- The command list includes representative expanded commands, including `/agents`, `/config`, `/memory`, `/mcp`, `/review`, and `/reload-skills`.
- Command names are unique.
- Command names are alphabetically sorted.
- Prefix filtering returns multiple relevant matches for broader prefixes such as `/m`.

Run:

```bash
npm --prefix web test
npm --prefix web run build
```
