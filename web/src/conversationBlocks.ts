import type { EventKind, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

export type RawEventRef = { id: number; kind: EventKind; payload: unknown };

export type MessageBlock = {
  id: string;
  type: 'message';
  role: 'assistant' | 'user' | 'system';
  text: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ToolBlock = {
  id: string;
  type: 'tool';
  name: string;
  status: 'running' | 'completed' | 'failed';
  inputSummary: string;
  resultSummary: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type TaskBlock = {
  id: string;
  type: 'task';
  title: string;
  source: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  summary: string;
  outputPath?: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ErrorBlock = {
  id: string;
  type: 'error';
  message: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type RawBlock = {
  id: string;
  type: 'raw';
  label: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ConversationBlock = MessageBlock | ToolBlock | TaskBlock | ErrorBlock | RawBlock;

type PendingTool = {
  event: UiEvent;
  payload: ObjectPayload;
  blockIndex: number;
};

type NormalizedItem =
  | { type: 'message'; event: UiEvent; role: MessageBlock['role']; text: string }
  | { type: 'tool_use'; event: UiEvent; payload: ObjectPayload }
  | { type: 'tool_result'; event: UiEvent; payload: ObjectPayload }
  | { type: 'error'; event: UiEvent; payload: ObjectPayload };

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawEvent(event: UiEvent): RawEventRef {
  return { id: event.id, kind: event.kind, payload: event.payload };
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function payloadType(event: UiEvent, payload: ObjectPayload): string {
  return typeof payload.type === 'string' ? payload.type : event.kind;
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => (isObject(entry) && entry.type === 'text' ? stringField(entry, ['text']) : null))
      .filter((entry): entry is string => entry !== null)
      .join('\n');
    return text || null;
  }
  return null;
}

function textContent(payload: ObjectPayload): string | null {
  const direct = stringField(payload, ['message', 'text', 'status', 'error']);
  if (direct) return direct;

  const content = textFromContent(payload.content);
  if (content) return content;

  const message = payload.message;
  if (isObject(message)) {
    const messageDirect = stringField(message, ['text']);
    if (messageDirect) return messageDirect;
    return textFromContent(message.content);
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

function toolName(payload: ObjectPayload): string {
  return stringField(payload, ['name', 'tool_name', 'toolName']) ?? 'tool';
}

function toolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['id', 'tool_use_id', 'toolUseId']);
}

function resultToolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['tool_use_id', 'toolUseId', 'id']);
}

function resultSummary(payload: ObjectPayload): string {
  return summarize(payload.result ?? payload.content ?? payload.output ?? payload.error ?? payload.message ?? '');
}

function hasStructuredFailure(payload: ObjectPayload | undefined): boolean {
  if (!payload) return false;
  if (payload.is_error === true || payload.isError === true) return true;

  const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
  if (['error', 'failed', 'failure'].includes(status)) return true;

  const error = payload.error;
  if (typeof error === 'string') return error.trim().length > 0;
  if (isObject(error)) return true;

  return false;
}

function hasClearFailureText(result: string): boolean {
  return /(^|\n)\s*(error|failed|failure):/i.test(result);
}

function hasFailedResult(resultPayload: ObjectPayload | undefined, result: string): boolean {
  return hasStructuredFailure(resultPayload) || hasClearFailureText(result);
}

function isBackgroundBash(name: string, input: unknown, result: string): boolean {
  return name === 'Bash' && isObject(input) && (input.run_in_background === true || /Task started in background|Output file:/i.test(result));
}

function isTaskTool(name: string): boolean {
  return ['Agent', 'Workflow', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'].includes(name);
}

function outputPath(summary: string): string | undefined {
  return summary.match(/Output file:\s*(\S+)/i)?.[1];
}

function taskStatus(name: string, input: unknown, result: string, hasResult: boolean, resultPayload?: ObjectPayload): TaskBlock['status'] {
  if (hasFailedResult(resultPayload, result)) return 'failed';
  if (isObject(input) && typeof input.status === 'string') {
    if (input.status === 'pending') return 'pending';
    if (input.status === 'completed') return 'completed';
    if (input.status === 'failed') return 'failed';
    if (input.status === 'in_progress' || input.status === 'running') return 'running';
  }
  if (/Task started in background/i.test(result)) return 'running';
  if (name === 'TaskCreate') return 'pending';
  return hasResult ? 'completed' : 'running';
}

function taskTitle(name: string, input: unknown): string {
  if (!isObject(input)) return name;
  if (typeof input.description === 'string' && input.description.trim()) return input.description;
  if (typeof input.subject === 'string' && input.subject.trim()) return input.subject;
  if (typeof input.taskId === 'string' && input.taskId.trim()) return `${name} #${input.taskId}`;
  if (typeof input.command === 'string' && input.command.trim()) return input.command;
  return name;
}

function taskSource(name: string, input: unknown): string {
  if (name === 'Agent' && isObject(input)) {
    const subagentType = stringField(input, ['subagent_type', 'subagentType']);
    return subagentType ? `${subagentType} agent` : 'Agent';
  }
  return name;
}

function taskSummary(name: string, input: unknown, inputSummary: string, result: string): string {
  if (result) return result;
  if (isObject(input) && typeof input.status === 'string' && input.status.trim()) return `status: ${input.status}`;
  if (name === 'Bash' && isObject(input)) return stringField(input, ['description', 'command']) ?? inputSummary;
  return inputSummary;
}

function makeMessageBlock(event: UiEvent, role: MessageBlock['role'], text: string): MessageBlock {
  return {
    id: `message-${role}-${event.id}`,
    type: 'message',
    role,
    text,
    eventIds: [event.id],
    rawEvents: [rawEvent(event)]
  };
}

function appendMessage(block: MessageBlock, event: UiEvent, text: string): MessageBlock {
  return {
    ...block,
    text: `${block.text}\n\n${text}`,
    eventIds: [...block.eventIds, event.id],
    rawEvents: [...block.rawEvents, rawEvent(event)]
  };
}

function makeToolBlock(toolUse: UiEvent, usePayload: ObjectPayload, resultEvent?: UiEvent, resultPayload?: ObjectPayload): ToolBlock | TaskBlock {
  const name = toolName(usePayload);
  const id = toolUseId(usePayload) ?? String(toolUse.id);
  const input = usePayload.input;
  const inputSummary = summarize(input);
  const result = resultPayload ? resultSummary(resultPayload) : '';
  const events = resultEvent ? [toolUse, resultEvent] : [toolUse];
  const taskLike = isBackgroundBash(name, input, result) || isTaskTool(name);

  if (taskLike) {
    const summary = taskSummary(name, input, inputSummary, result);
    const path = outputPath(summary);
    return {
      id: `task-${id}`,
      type: 'task',
      title: taskTitle(name, input),
      source: taskSource(name, input),
      status: taskStatus(name, input, result, resultEvent !== undefined, resultPayload),
      summary,
      ...(path ? { outputPath: path } : {}),
      eventIds: events.map((event) => event.id),
      rawEvents: events.map(rawEvent)
    };
  }

  return {
    id: `tool-${id}`,
    type: 'tool',
    name,
    status: resultEvent ? (hasFailedResult(resultPayload, result) ? 'failed' : 'completed') : 'running',
    inputSummary,
    resultSummary: result,
    eventIds: events.map((event) => event.id),
    rawEvents: events.map(rawEvent)
  };
}

function makeStandaloneToolResult(event: UiEvent, payload: ObjectPayload): ToolBlock {
  const result = resultSummary(payload);
  return {
    id: `tool-result-${event.id}`,
    type: 'tool',
    name: toolName(payload),
    status: hasFailedResult(payload, result) ? 'failed' : 'completed',
    inputSummary: '',
    resultSummary: result,
    eventIds: [event.id],
    rawEvents: [rawEvent(event)]
  };
}

function roleFromEvent(event: UiEvent, payload: ObjectPayload): MessageBlock['role'] | null {
  if (event.kind === 'assistant' || event.kind === 'user' || event.kind === 'system') return event.kind;
  if (payload.type === 'assistant' || payload.type === 'user' || payload.type === 'system') return payload.type;
  return null;
}

function contentArray(payload: ObjectPayload): unknown[] | null {
  if (Array.isArray(payload.content)) return payload.content;
  const message = payload.message;
  if (isObject(message) && Array.isArray(message.content)) return message.content;
  return null;
}

function normalizedItems(event: UiEvent): NormalizedItem[] | null {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = payloadType(event, payload);

  if (event.kind === 'error' || type === 'error') return [{ type: 'error', event, payload }];

  const role = roleFromEvent(event, payload);
  const items: NormalizedItem[] = [];
  const content = contentArray(payload);
  if (content) {
    for (const entry of content) {
      if (!isObject(entry)) continue;
      if (entry.type === 'text') {
        const text = stringField(entry, ['text']);
        if (text && role) items.push({ type: 'message', event, role, text });
      } else if (entry.type === 'tool_use') {
        items.push({ type: 'tool_use', event, payload: entry });
      } else if (entry.type === 'tool_result') {
        items.push({ type: 'tool_result', event, payload: entry });
      }
    }
  }

  if (items.length > 0) return items;

  if (type === 'tool_use') return [{ type: 'tool_use', event, payload }];
  if (type === 'tool_result') return [{ type: 'tool_result', event, payload }];

  const text = textContent(payload);
  if (text && role) return [{ type: 'message', event, role, text }];

  return null;
}

export function buildConversationBlocks(events: UiEvent[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  const pendingTools = new Map<string, PendingTool>();

  for (const event of events) {
    const items = normalizedItems(event);

    if (!items) {
      blocks.push({
        id: `raw-${event.id}`,
        type: 'raw',
        label: event.kind,
        eventIds: [event.id],
        rawEvents: [rawEvent(event)]
      });
      continue;
    }

    for (const item of items) {
      if (item.type === 'error') {
        blocks.push({
          id: `error-${item.event.id}`,
          type: 'error',
          message: textContent(item.payload) ?? summarize(item.event.payload),
          eventIds: [item.event.id],
          rawEvents: [rawEvent(item.event)]
        });
        continue;
      }

      if (item.type === 'message') {
        const previous = blocks[blocks.length - 1];
        if (previous?.type === 'message' && previous.role === item.role) {
          blocks[blocks.length - 1] = appendMessage(previous, item.event, item.text);
        } else {
          blocks.push(makeMessageBlock(item.event, item.role, item.text));
        }
        continue;
      }

      if (item.type === 'tool_use') {
        const id = toolUseId(item.payload) ?? String(item.event.id);
        const blockIndex = blocks.length;
        pendingTools.set(id, { event: item.event, payload: item.payload, blockIndex });
        blocks.push(makeToolBlock(item.event, item.payload));
        continue;
      }

      const id = resultToolUseId(item.payload);
      if (id) {
        const pending = pendingTools.get(id);
        if (pending) {
          blocks[pending.blockIndex] = makeToolBlock(pending.event, pending.payload, item.event, item.payload);
          pendingTools.delete(id);
        } else {
          blocks.push(makeStandaloneToolResult(item.event, item.payload));
        }
      } else {
        blocks.push(makeStandaloneToolResult(item.event, item.payload));
      }
    }
  }

  return blocks;
}
