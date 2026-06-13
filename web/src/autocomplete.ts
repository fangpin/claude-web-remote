export type ClaudeCommand = {
  name: string;
  description: string;
  category: 'Session' | 'Context' | 'Review' | 'Tools' | 'Account' | 'Setup';
};

export type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

export const CLAUDE_COMMANDS: ClaudeCommand[] = [
  { name: '/add-dir', description: 'Add another working directory', category: 'Context' },
  { name: '/agents', description: 'Manage configured agents', category: 'Tools' },
  { name: '/bug', description: 'Report a Claude Code bug', category: 'Setup' },
  { name: '/clear', description: 'Clear the current conversation', category: 'Session' },
  { name: '/compact', description: 'Compact conversation context', category: 'Context' },
  { name: '/config', description: 'Open Claude Code configuration', category: 'Setup' },
  { name: '/context', description: 'Inspect context usage', category: 'Context' },
  { name: '/cost', description: 'Show usage and cost', category: 'Session' },
  { name: '/doctor', description: 'Check Claude Code health', category: 'Setup' },
  { name: '/exit', description: 'Exit the current Claude session', category: 'Session' },
  { name: '/export', description: 'Export the current conversation', category: 'Session' },
  { name: '/help', description: 'Show Claude Code help', category: 'Tools' },
  { name: '/init', description: 'Create or update project guidance', category: 'Context' },
  { name: '/install-github-app', description: 'Install the Claude GitHub app', category: 'Setup' },
  { name: '/login', description: 'Sign in to Claude Code', category: 'Account' },
  { name: '/logout', description: 'Sign out of Claude Code', category: 'Account' },
  { name: '/mcp', description: 'Manage MCP server connections', category: 'Tools' },
  { name: '/memory', description: 'Manage Claude memory', category: 'Context' },
  { name: '/migrate-installer', description: 'Migrate Claude Code installer setup', category: 'Setup' },
  { name: '/model', description: 'Choose or show the active model', category: 'Session' },
  { name: '/permissions', description: 'Review permission settings', category: 'Setup' },
  { name: '/pr-comments', description: 'Work through pull request comments', category: 'Review' },
  { name: '/release-notes', description: 'Show Claude Code release notes', category: 'Setup' },
  { name: '/reload-skills', description: 'Reload available Claude skills', category: 'Tools' },
  { name: '/resume', description: 'Resume a previous conversation', category: 'Session' },
  { name: '/review', description: 'Review code changes', category: 'Review' },
  { name: '/status', description: 'Show Claude Code status', category: 'Session' },
  { name: '/terminal-setup', description: 'Configure terminal integration', category: 'Setup' },
  { name: '/vim', description: 'Toggle or configure Vim mode', category: 'Setup' }
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
  return { start, end, query };
}

export function getCommandSuggestions(query: string): ClaudeCommand[] {
  if (!query.startsWith('/')) return [];
  if (query === '/') return CLAUDE_COMMANDS;

  const normalizedQuery = query.toLocaleLowerCase();
  const prefixMatches = CLAUDE_COMMANDS.filter((command) => command.name.toLocaleLowerCase().startsWith(normalizedQuery));
  if (prefixMatches.length > 0) return prefixMatches;

  const search = normalizedQuery.slice(1).trim();
  if (!search) return CLAUDE_COMMANDS;
  const compactSearch = search.replace(/[-_\s]/g, '');
  return CLAUDE_COMMANDS.filter((command) => {
    const searchable = `${command.category} ${command.name} ${command.description}`.toLocaleLowerCase();
    const compactSearchable = searchable.replace(/[-_\s]/g, '');
    return searchable.includes(search) || compactSearchable.includes(compactSearch);
  });
}

export function applyCommandCompletion(value: string, token: SlashCommandToken, commandName: string): { value: string; cursor: number } {
  const replacement = `${commandName} `;
  const suffixStart = value[token.end] === ' ' ? token.end + 1 : token.end;
  const nextValue = `${value.slice(0, token.start)}${replacement}${value.slice(suffixStart)}`;
  return {
    value: nextValue,
    cursor: token.start + replacement.length
  };
}
