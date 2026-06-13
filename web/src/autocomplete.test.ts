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
    expect(getCommandSuggestions('/').length).toBe(CLAUDE_COMMANDS.length);
    expect(getCommandSuggestions('/he').map((command) => command.name)).toEqual(['/help']);
    expect(getCommandSuggestions('/perm').map((command) => command.name)).toEqual(['/permissions']);
  });

  it('returns fuzzy matches when no command prefix matches', () => {
    expect(getCommandSuggestions('/github').map((command) => command.name)).toEqual(['/install-github-app']);
    expect(getCommandSuggestions('/pullrequest').map((command) => command.name)).toEqual(['/pr-comments']);
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

  it('replaces the whole slash command token when the cursor is inside it', () => {
    const token = findSlashCommandToken('/hezz', 3);

    expect(token).toEqual({ start: 0, end: 5, query: '/he' });
    expect(applyCommandCompletion('/hezz', token!, '/help')).toEqual({
      value: '/help ',
      cursor: 6
    });
  });

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
    expect(CLAUDE_COMMANDS.find((command) => command.name === '/help')).toMatchObject({
      category: 'Help',
      description: expect.any(String)
    });
  });

  it('keeps command names unique and sorted', () => {
    const names = CLAUDE_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it('returns multiple sorted matches for broader prefixes', () => {
    expect(getCommandSuggestions('/m').map((command) => command.name)).toEqual(['/mcp', '/memory', '/migrate-installer', '/model']);
    expect(getCommandSuggestions('/re').map((command) => command.name)).toEqual(['/release-notes', '/reload-skills', '/resume', '/review']);
  });
});
