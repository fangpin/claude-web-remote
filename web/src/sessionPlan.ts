import type { UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

type PlanSource = 'ExitPlanMode' | 'plan-file';

export type SessionPlan = {
  markdown: string;
  source: PlanSource;
  eventId: number;
  updatedAt: string;
};

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toolName(payload: ObjectPayload): string | null {
  return stringField(payload, ['name', 'tool_name', 'toolName']);
}

function contentText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;

  const text = value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isObject(entry)) return null;
      return stringField(entry, ['text', 'content']);
    })
    .filter((entry): entry is string => entry !== null && entry.trim().length > 0)
    .join('\n');

  return text.trim() || null;
}

function planTextFromPayload(payload: ObjectPayload): string | null {
  const direct = stringField(payload, ['plan', 'markdown', 'text', 'message', 'output', 'result']);
  if (direct) return direct;

  const content = contentText(payload.content);
  if (content) return content;

  const input = payload.input;
  if (isObject(input)) {
    const inputDirect = stringField(input, ['plan', 'content', 'markdown', 'text', 'message']);
    if (inputDirect) return inputDirect;
    return contentText(input.content);
  }

  return null;
}

function planPathFromPayload(payload: ObjectPayload): string | null {
  const input = payload.input;
  const path = isObject(input)
    ? stringField(input, ['file_path', 'filePath', 'path'])
    : stringField(payload, ['file_path', 'filePath', 'path']);

  if (!path) return null;
  return path.includes('.claude/plans/') && path.endsWith('.md') ? path : null;
}

function toolBlocks(event: UiEvent): ObjectPayload[] {
  const payload = isObject(event.payload) ? event.payload : null;
  if (!payload) return [];

  const blocks: ObjectPayload[] = [];
  const type = typeof payload.type === 'string' ? payload.type : event.kind;
  if (type === 'tool_use' || type === 'tool_result') blocks.push(payload);

  const contentSources = [payload.content, isObject(payload.message) ? payload.message.content : null];
  for (const source of contentSources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isObject(entry)) continue;
      if (entry.type === 'tool_use' || entry.type === 'tool_result') blocks.push(entry);
    }
  }

  return blocks;
}

function planFileText(payload: ObjectPayload): string | null {
  const name = toolName(payload);
  if (!name || !['Read', 'Write'].includes(name)) return null;
  if (!planPathFromPayload(payload)) return null;

  if (name === 'Write' && isObject(payload.input)) {
    const inputText = stringField(payload.input, ['content', 'text', 'markdown']);
    if (inputText) return inputText;
  }

  return planTextFromPayload(payload);
}

export function extractSessionPlan(events: UiEvent[]): SessionPlan | null {
  let planFileCandidate: SessionPlan | null = null;
  let exitPlanCandidate: SessionPlan | null = null;

  for (const event of events) {
    for (const block of toolBlocks(event)) {
      const name = toolName(block);
      if (name === 'ExitPlanMode') {
        const markdown = planTextFromPayload(block);
        if (markdown) {
          exitPlanCandidate = {
            markdown,
            source: 'ExitPlanMode',
            eventId: event.id,
            updatedAt: event.time
          };
        }
        continue;
      }

      const markdown = planFileText(block);
      if (markdown) {
        planFileCandidate = {
          markdown,
          source: 'plan-file',
          eventId: event.id,
          updatedAt: event.time
        };
      }
    }
  }

  return exitPlanCandidate ?? planFileCandidate;
}
