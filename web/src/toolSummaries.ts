type ObjectPayload = Record<string, unknown>;

export type TranscriptSummaryTarget =
  | {
      type: 'tool';
      name: string;
      status: 'running' | 'completed' | 'failed';
      inputSummary: string;
      resultSummary: string;
    }
  | {
      type: 'task';
      title: string;
      source: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      summary: string;
    };

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function numberField(payload: ObjectPayload, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(summarize).filter(Boolean).join('\n');
  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`)
      .join(', ');
  }
  return String(value);
}

function compactText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function shortText(text: string, maxLength = 160): string {
  const compact = compactText(text);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

function valueSummary(value: unknown, maxLength = 120): string | null {
  if (typeof value === 'string' && value.trim()) return shortText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (isObject(value)) return shortText(JSON.stringify(value), maxLength);
  return shortText(String(value), maxLength);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function lineCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

function outputMeasure(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'no output';
  const lines = lineCount(trimmed);
  const chars = trimmed.length;
  return lines > 1 ? `${countLabel(lines, 'line')}, ${countLabel(chars, 'char')}` : countLabel(chars, 'char');
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (!isObject(input)) return summarize(input);

  if (name === 'Bash') {
    const command = stringField(input, ['command']);
    const description = stringField(input, ['description']);
    const background = input.run_in_background === true ? ' (background)' : '';
    if (!command) return summarize(input);
    return `${description ? `${shortText(description, 72)} · ` : ''}$ ${shortText(command, 180)}${background}`;
  }

  if (name === 'Read') {
    const path = stringField(input, ['file_path', 'path']);
    const offset = numberField(input, ['offset']);
    const limit = numberField(input, ['limit']);
    const range = [offset !== null ? `offset ${offset}` : null, limit !== null ? `limit ${limit}` : null]
      .filter(Boolean)
      .join(', ');
    return path ? `${path}${range ? ` (${range})` : ''}` : summarize(input);
  }

  if (name === 'Glob') {
    const pattern = stringField(input, ['pattern']);
    const path = stringField(input, ['path', 'base_path']);
    if (pattern && path) return `${pattern} in ${path}`;
    return pattern ?? path ?? summarize(input);
  }

  if (name === 'Grep') {
    const pattern = stringField(input, ['pattern']);
    const path = stringField(input, ['path']);
    const glob = stringField(input, ['glob']);
    const outputMode = stringField(input, ['output_mode', 'outputMode']);
    const parts = [
      pattern ? `"${shortText(pattern, 80)}"` : null,
      path ? `in ${path}` : null,
      glob ? `glob ${glob}` : null,
      outputMode
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' · ') : summarize(input);
  }

  if (name === 'Edit') {
    const path = stringField(input, ['file_path', 'path']);
    const oldString = stringField(input, ['old_string', 'oldString']);
    const newString = stringField(input, ['new_string', 'newString']);
    const replacement =
      oldString || newString ? `replace "${shortText(oldString ?? '', 48)}" -> "${shortText(newString ?? '', 48)}"` : null;
    return [path, replacement, input.replace_all === true ? 'replace all' : null]
      .filter((part): part is string => Boolean(part))
      .join(' · ') || summarize(input);
  }

  if (name === 'MultiEdit') {
    const path = stringField(input, ['file_path', 'path']);
    const edits = Array.isArray(input.edits) ? countLabel(input.edits.length, 'edit') : null;
    return [path, edits].filter((part): part is string => Boolean(part)).join(' · ') || summarize(input);
  }

  if (name === 'Write') {
    const path = stringField(input, ['file_path', 'path']);
    const content = typeof input.content === 'string' ? `write ${outputMeasure(input.content)}` : null;
    return [path, content].filter((part): part is string => Boolean(part)).join(' · ') || summarize(input);
  }

  const preferredKeys = ['file_path', 'path', 'url', 'pattern', 'query', 'command', 'name', 'id'];
  const preferred = preferredKeys
    .map((key) => {
      const value = valueSummary(input[key]);
      return value ? `${key}: ${value}` : null;
    })
    .filter((part): part is string => part !== null);
  if (preferred.length > 0) return preferred.slice(0, 3).join(' · ');

  return (
    Object.entries(input)
      .filter(([key]) => !['content', 'prompt', 'message'].includes(key))
      .map(([key, value]) => {
        const summary = valueSummary(value);
        return summary ? `${key}: ${summary}` : null;
      })
      .filter((part): part is string => part !== null)
      .slice(0, 3)
      .join(' · ') || summarize(input)
  );
}

function bashCommand(inputSummary: string): string | null {
  const commandMatch = inputSummary.match(/(?:^| · )\$\s+(.+)$/);
  return commandMatch?.[1]?.trim() || null;
}

function conciseCommand(command: string): string {
  const npmPrefixMatch = command.match(/^npm\s+--prefix\s+\S+\s+(.+)$/);
  if (npmPrefixMatch?.[1]) return `npm ${npmPrefixMatch[1].trim()}`;
  return command;
}

function primaryPath(inputSummary: string): string | null {
  return inputSummary.split(' · ')[0]?.trim() || null;
}

export function transcriptToolSummaryLabel(target: TranscriptSummaryTarget): string {
  const failed = target.status === 'failed';

  if (target.type === 'task') return failed ? `Failed ${target.title}` : target.title;

  if (target.name === 'Read') {
    const path = primaryPath(target.inputSummary) ?? 'file';
    return failed ? `Failed reading ${path}` : `Read ${path}`;
  }

  if (target.name === 'Edit' || target.name === 'MultiEdit' || target.name === 'Write' || target.name === 'NotebookEdit') {
    const path = primaryPath(target.inputSummary) ?? 'file';
    return failed ? `Failed editing ${path}` : `Edited ${path}`;
  }

  if (target.name === 'Bash') {
    const command = bashCommand(target.inputSummary);
    const commandLabel = command ? conciseCommand(command) : 'command';
    return `${failed ? 'Failed' : 'Ran'} ${commandLabel}`;
  }

  if (target.name === 'Glob') return failed ? 'Failed file search' : 'Searched files';
  if (target.name === 'Grep') return failed ? 'Failed text search' : 'Searched text';
  if (/permission|review/i.test(target.name)) return failed ? 'Failed review' : 'Reviewed changes';

  return failed ? `Failed ${target.name}` : target.name;
}
