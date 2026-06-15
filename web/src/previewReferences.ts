import type { EventKind, PreviewFileReference, PreviewReferenceKind } from './types';

export type PreviewRawEventRef = { id: number; kind: EventKind; payload: unknown };
export type PreviewSourceEvent = PreviewRawEventRef;

type ToolUse = {
  eventId: number;
  name: string;
  toolUseId?: string;
  input: Record<string, unknown>;
};

const SNIPPET_LIMIT = 2000;

export function extractPreviewFileReferences(events: PreviewSourceEvent[]): PreviewFileReference[] {
  const toolUses = events.flatMap((event) => parseToolUse(event));
  const resultByToolUseId = buildResultMap(events);
  const references: PreviewFileReference[] = [];

  for (const toolUse of toolUses) {
    references.push(...referencesForToolUse(toolUse, resultByToolUseId.get(toolUse.toolUseId ?? '')));
  }

  return dedupeReferences(references).sort((left, right) => left.eventId - right.eventId || left.path.localeCompare(right.path));
}

function referencesForToolUse(toolUse: ToolUse, resultContent: string | undefined): PreviewFileReference[] {
  switch (toolUse.name) {
    case 'Read': {
      const path = inputPath(toolUse.input);
      if (!path) return [];
      return [reference(path, 'read', toolUse.eventId, `Read ${path}`, resultContent)];
    }
    case 'Edit': {
      const path = inputPath(toolUse.input);
      if (!path) return [];
      return [reference(path, 'edited', toolUse.eventId, `Edit ${path}`, editSnippet(toolUse.input))];
    }
    case 'MultiEdit': {
      const path = inputPath(toolUse.input);
      if (!path) return [];
      return [reference(path, 'edited', toolUse.eventId, `MultiEdit ${path}`, multiEditSnippet(toolUse.input))];
    }
    case 'Write': {
      const path = inputPath(toolUse.input);
      if (!path) return [];
      return [reference(path, 'written', toolUse.eventId, `Write ${path}`, stringValue(toolUse.input.content))];
    }
    case 'Grep':
    case 'Glob':
      return parseSearchResultPaths(resultContent).map((path) => reference(path, 'searched', toolUse.eventId, `${toolUse.name} ${path}`));
    default: {
      const paths = otherInputPaths(toolUse.input);
      return paths.map((path) => reference(path, 'mentioned', toolUse.eventId, `${toolUse.name} ${path}`));
    }
  }
}

function parseToolUse(event: PreviewSourceEvent): ToolUse[] {
  const payload = event.payload;
  if (!isRecord(payload)) return [];

  const candidates = [payload, ...arrayValue(payload.content), ...arrayValue(payload.message?.content)];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    if (candidate.type !== 'tool_use' && !candidate.name) return [];
    const name = stringValue(candidate.name);
    if (!name) return [];
    const input = isRecord(candidate.input) ? candidate.input : {};
    return [
      {
        eventId: event.id,
        name,
        toolUseId: stringValue(candidate.id) ?? stringValue(candidate.tool_use_id),
        input
      }
    ];
  });
}

function buildResultMap(events: PreviewSourceEvent[]): Map<string, string> {
  const results = new Map<string, string>();

  for (const event of events) {
    const payload = event.payload;
    if (!isRecord(payload)) continue;
    const candidates = [payload, ...arrayValue(payload.content), ...arrayValue(payload.message?.content)];
    for (const candidate of candidates) {
      if (!isRecord(candidate) || candidate.type !== 'tool_result') continue;
      const toolUseId = stringValue(candidate.tool_use_id) ?? stringValue(candidate.id);
      const content = resultContent(candidate.content);
      if (toolUseId && content !== undefined && !results.has(toolUseId)) {
        results.set(toolUseId, content);
      }
    }
  }

  return results;
}

function resultContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return stringValue(item.text) ?? stringValue(item.content);
        return undefined;
      })
      .filter((item): item is string => Boolean(item))
      .join('\n');
    return text || undefined;
  }
  return undefined;
}

function inputPath(input: Record<string, unknown>): string | undefined {
  return stringValue(input.file_path) ?? stringValue(input.path);
}

function otherInputPaths(input: Record<string, unknown>): string[] {
  const pathKeys = ['file_path', 'path', 'notebook_path'];
  const paths = pathKeys.flatMap((key) => {
    const value = input[key];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    return [];
  });
  return [...new Set(paths)];
}

function editSnippet(input: Record<string, unknown>): string | undefined {
  return pairedSnippet(stringValue(input.old_string), stringValue(input.new_string));
}

function multiEditSnippet(input: Record<string, unknown>): string | undefined {
  const firstEdit = arrayValue(input.edits).find(isRecord);
  if (!firstEdit) return undefined;
  return pairedSnippet(stringValue(firstEdit.old_string), stringValue(firstEdit.new_string));
}

function pairedSnippet(oldValue: string | undefined, newValue: string | undefined): string | undefined {
  if (oldValue === undefined && newValue === undefined) return undefined;
  return `${oldValue ?? ''}\n---\n${newValue ?? ''}`;
}

function parseSearchResultPaths(content: string | undefined): string[] {
  if (!content) return [];
  const paths = content
    .split('\n')
    .map((line) => parseSearchLine(line.trim()))
    .filter((path): path is string => Boolean(path));
  return [...new Set(paths)];
}

function parseSearchLine(line: string): string | undefined {
  if (!line) return undefined;
  const grepMatch = line.match(/^(.+?):\d+(?::\d+)?:/);
  if (grepMatch) return grepMatch[1];
  const jsonPath = parseJsonPathLine(line);
  if (jsonPath) return jsonPath;
  return line.replace(/^[-*]\s+/, '').trim() || undefined;
}

function parseJsonPathLine(line: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) return stringValue(parsed.path) ?? stringValue(parsed.file_path);
  } catch {
    return undefined;
  }
  return undefined;
}

function reference(path: string, kind: PreviewReferenceKind, eventId: number, title: string, snippet?: string): PreviewFileReference {
  return {
    path,
    kind,
    eventId,
    title,
    ...(snippet !== undefined ? { snippet: truncateSnippet(snippet) } : {})
  };
}

function truncateSnippet(snippet: string): string {
  if (snippet.length <= SNIPPET_LIMIT) return snippet;
  let limit = SNIPPET_LIMIT;
  const trailingCodeUnit = snippet.charCodeAt(limit - 1);
  if (trailingCodeUnit >= 0xd800 && trailingCodeUnit <= 0xdbff) {
    limit -= 1;
  }
  return `${snippet.slice(0, limit)}…`;
}

function dedupeReferences(references: PreviewFileReference[]): PreviewFileReference[] {
  const byKey = new Map<string, PreviewFileReference>();
  for (const item of references) {
    const key = `${item.kind}:${item.path}`;
    const existing = byKey.get(key);
    if (!existing || item.eventId < existing.eventId) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
