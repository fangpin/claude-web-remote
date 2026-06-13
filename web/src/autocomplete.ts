export type ClaudeCommand = {
  name: string;
  description: string;
  category: string;
};

export type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

export const CLAUDE_COMMANDS: ClaudeCommand[] = [
  { name: '/add-dir', description: 'Add another working directory to this session', category: 'Project' },
  { name: '/agents', description: 'Manage or use configured agents', category: 'Workflow' },
  { name: '/bug', description: 'Report a Claude Code bug', category: 'Help' },
  { name: '/clear', description: 'Clear the current conversation view', category: 'Conversation' },
  { name: '/compact', description: 'Compact conversation context', category: 'Conversation' },
  { name: '/config', description: 'Open Claude Code configuration', category: 'Settings' },
  { name: '/context', description: 'Inspect current context usage', category: 'Conversation' },
  { name: '/cost', description: 'Show usage and cost information', category: 'Status' },
  { name: '/doctor', description: 'Check Claude Code installation health', category: 'Status' },
  { name: '/exit', description: 'Exit the current Claude session', category: 'Session' },
  { name: '/export', description: 'Export the current conversation', category: 'Conversation' },
  { name: '/help', description: 'Show Claude Code help', category: 'Help' },
  { name: '/init', description: 'Create or update project guidance for Claude', category: 'Project' },
  { name: '/install-github-app', description: 'Install the Claude GitHub app', category: 'Integrations' },
  { name: '/login', description: 'Sign in to Claude Code', category: 'Account' },
  { name: '/logout', description: 'Sign out of Claude Code', category: 'Account' },
  { name: '/mcp', description: 'Manage MCP server connections', category: 'Integrations' },
  { name: '/memory', description: 'Manage Claude memory', category: 'Settings' },
  { name: '/migrate-installer', description: 'Migrate Claude Code installer setup', category: 'Settings' },
  { name: '/model', description: 'Choose or show the active model', category: 'Settings' },
  { name: '/permissions', description: 'Review permission settings', category: 'Settings' },
  { name: '/pr-comments', description: 'View or work through pull request comments', category: 'Workflow' },
  { name: '/release-notes', description: 'Show Claude Code release notes', category: 'Help' },
  { name: '/reload-skills', description: 'Reload available Claude skills', category: 'Workflow' },
  { name: '/resume', description: 'Resume a previous Claude conversation', category: 'Session' },
  { name: '/review', description: 'Review code changes', category: 'Workflow' },
  { name: '/status', description: 'Show current Claude Code status', category: 'Status' },
  { name: '/terminal-setup', description: 'Configure terminal integration', category: 'Settings' },
  { name: '/vim', description: 'Toggle or configure Vim mode', category: 'Settings' }
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

  const normalizedQuery = query.toLowerCase();
  const prefixMatches = CLAUDE_COMMANDS.filter((command) => command.name.startsWith(normalizedQuery));
  if (prefixMatches.length > 0) return prefixMatches;

  const fuzzyQuery = normalizedQuery.slice(1).replace(/[-_\s]/g, '');
  if (!fuzzyQuery) return CLAUDE_COMMANDS;

  return CLAUDE_COMMANDS.filter((command) => {
    const searchable = `${command.name.slice(1)} ${command.description} ${command.category}`.toLowerCase().replace(/[-_\s]/g, '');
    return searchable.includes(fuzzyQuery);
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
