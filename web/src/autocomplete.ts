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
  return { start, end, query };
}

export function getCommandSuggestions(query: string): ClaudeCommand[] {
  if (!query.startsWith('/')) return [];
  return CLAUDE_COMMANDS.filter((command) => command.name.startsWith(query));
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
