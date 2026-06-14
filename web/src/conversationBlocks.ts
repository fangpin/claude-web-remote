import {
  rawEventPresentation,
  taskToolPresentation,
  toolActivityPresentation,
  toolPresentation,
  toolResultSemantics,
  type RawSeverity,
  type ToolResultKind
} from './presentationPolicy';
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
  density?: 'full' | 'compact';
  inputSummary: string;
  resultSummary: string;
  resultKind: ToolResultKind;
  resultLanguage?: string;
  resultDisplay: 'hidden' | 'collapsed' | 'visible';
  resultLabel: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type TaskBlock = {
  id: string;
  type: 'task';
  title: string;
  source: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  density?: 'full' | 'compact';
  summary: string;
  detail?: string;
  completionSummary?: string;
  failureSummary?: string;
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
  severity?: RawSeverity;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type AnchorBlock = {
  id: string;
  type: 'anchor';
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ConversationBlock = MessageBlock | ToolBlock | TaskBlock | ErrorBlock | RawBlock | AnchorBlock;

type PendingTool = {
  event: UiEvent;
  events: UiEvent[];
  payload: ObjectPayload;
  blockIndex: number;
};

type PendingToolResult = {
  event: UiEvent;
  events: UiEvent[];
  payload: ObjectPayload;
  blockIndex?: number;
};

type NormalizedItem =
  | { type: 'message'; event: UiEvent; events?: UiEvent[]; role: MessageBlock['role']; text: string }
  | { type: 'tool_use'; event: UiEvent; events?: UiEvent[]; payload: ObjectPayload }
  | { type: 'tool_result'; event: UiEvent; events?: UiEvent[]; payload: ObjectPayload }
  | { type: 'raw'; event: UiEvent; label?: string; severity?: RawSeverity }
  | { type: 'anchor'; event: UiEvent; events?: UiEvent[]; id?: string }
  | { type: 'error'; event: UiEvent; payload: ObjectPayload };

type StreamingContentBlock = {
  type: 'text' | 'tool_use';
  index: number;
  firstEvent: UiEvent;
  events: UiEvent[];
  text: string;
  id: string | null;
  name: string | null;
  inputJson: string;
  input: unknown;
};

type StreamingMessage = {
  lifecycleEvents: UiEvent[];
  contentBlocks: StreamingContentBlock[];
};

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawEvent(event: UiEvent): RawEventRef {
  return { id: event.id, kind: event.kind, payload: event.payload };
}

function rawEvents(events: UiEvent[]): RawEventRef[] {
  return events.map(rawEvent);
}

function uniqueEvents(events: UiEvent[]): UiEvent[] {
  const byId = new Map<number, UiEvent>();
  for (const event of events) byId.set(event.id, event);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
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

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
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

function compactText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function truncateText(text: string, maxLength = 360): string {
  const compact = compactText(text);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function shortText(text: string, maxLength = 160): string {
  const compact = compactText(text);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

function numberField(payload: ObjectPayload, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
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

function summarizeToolInput(name: string, input: unknown): string {
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
  const value =
    payload.result ??
    payload.content ??
    payload.output ??
    payload.stdout ??
    payload.stderr ??
    payload.error ??
    payload.message ??
    '';
  return textFromContent(value) ?? summarize(value);
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
  return /(^|\n)\s*(error|failed|failure):|\bcommand failed\b|\bexit code\s+[1-9]\d*\b/i.test(result);
}

function hasFailedResult(resultPayload: ObjectPayload | undefined, result: string): boolean {
  return hasStructuredFailure(resultPayload) || hasClearFailureText(result);
}

function toolResultDisplay(name: string, status: ToolBlock['status'], result: string): ToolBlock['resultDisplay'] {
  const presentation = toolPresentation(name, status, result);
  if (presentation.detail === 'expanded') return 'visible';
  if (presentation.detail === 'collapsed') return 'collapsed';
  return 'hidden';
}

function hiddenResultSummary(name: string, result: string): string {
  if (name === 'Read') return `Read output hidden (${outputMeasure(result)})`;
  if (name === 'Glob') return `Matched ${countLabel(lineCount(result), 'path')}`;
  if (name === 'Grep') return `Matched ${countLabel(lineCount(result), 'line')}`;
  return `Result hidden (${outputMeasure(result)})`;
}

function toolResultLabel(
  name: string,
  status: ToolBlock['status'],
  result: string,
  display: ToolBlock['resultDisplay']
): string {
  if (status === 'running') return 'Waiting for result';
  if (!result.trim()) return status === 'failed' ? 'Failed with no result output' : 'No result output';
  if (status === 'failed') return `Failed result shown (${outputMeasure(result)})`;
  if (display === 'hidden') return hiddenResultSummary(name, result);
  if (display === 'collapsed') return `Result collapsed (${outputMeasure(result)})`;
  return `Result shown (${outputMeasure(result)})`;
}

function displayResultSummary(name: string, status: ToolBlock['status'], result: string, display: ToolBlock['resultDisplay']): string {
  if (!result.trim()) return '';
  if (status === 'failed') return result;
  if (display === 'hidden') return hiddenResultSummary(name, result);
  return result;
}

function isBackgroundBash(name: string, input: unknown, result: string): boolean {
  return name === 'Bash' && ((isObject(input) && input.run_in_background === true) || /Task started in background|Output file:/i.test(result));
}

function isTaskTool(name: string): boolean {
  return ['Agent', 'Workflow', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'].includes(name);
}

function outputPath(summary: string): string | undefined {
  return summary.match(/Output file:\s*(\S+)/i)?.[1]?.replace(/[),.;]+$/, '');
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
  if (name === 'TaskCreate') {
    return stringField(input, ['subject', 'description']) ?? name;
  }
  if (['TaskUpdate', 'TaskGet'].includes(name)) {
    const id = stringField(input, ['taskId', 'task_id', 'id']);
    return id ? `Task #${id}` : name;
  }
  if (name === 'TaskList') return 'Task list';
  if (name === 'TaskOutput') return 'Task output';
  if (name === 'TaskStop') return 'Stop task';
  if (typeof input.description === 'string' && input.description.trim()) return input.description;
  if (typeof input.subject === 'string' && input.subject.trim()) return input.subject;
  if (typeof input.taskId === 'string' && input.taskId.trim()) return `${name} #${input.taskId}`;
  if (typeof input.command === 'string' && input.command.trim()) return input.command;
  return name;
}

function taskSource(name: string, input: unknown): string {
  if (name === 'Bash') return 'Background Bash';
  if (name === 'Agent' && isObject(input)) {
    const subagentType = stringField(input, ['subagent_type', 'subagentType']);
    return subagentType ? `${subagentType} subagent` : 'Agent';
  }
  if (name === 'TaskCreate') return 'Task create';
  if (name === 'TaskUpdate') return 'Task update';
  if (name === 'TaskList') return 'Task list';
  if (name === 'TaskGet') return 'Task lookup';
  if (name === 'TaskOutput') return 'Task output';
  if (name === 'TaskStop') return 'Task control';
  return name;
}

function taskDetail(name: string, input: unknown, inputSummary: string): string | undefined {
  if (!isObject(input)) return inputSummary || undefined;
  if (name === 'Bash') return stringField(input, ['command']) ?? inputSummary;
  if (['TaskOutput', 'TaskStop'].includes(name)) return stringField(input, ['task_id', 'taskId', 'id']) ?? undefined;
  return undefined;
}

function cleanedTaskResult(result: string): string {
  return truncateText(result.replace(/\s*Output file:\s*\S+/i, '').trim());
}

function backgroundStartSummary(result: string, hasResult: boolean): string {
  const taskId = result.match(/Task started in background with ID\s+([^\s.]+)/i)?.[1];
  if (taskId) return `Started in background (ID ${taskId}).`;
  if (/Task started in background/i.test(result)) return 'Started in background.';
  return hasResult ? 'Running in background.' : 'Starting in background.';
}

function statusInputSummary(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  const status = stringField(input, ['status']);
  if (!status) return undefined;
  if (status === 'in_progress') return 'Marked in progress.';
  return `Marked ${status}.`;
}

function taskSummaries(
  name: string,
  input: unknown,
  inputSummary: string,
  result: string,
  status: TaskBlock['status'],
  hasResult: boolean
): Pick<TaskBlock, 'summary' | 'detail' | 'completionSummary' | 'failureSummary' | 'outputPath'> {
  const path = outputPath(result);
  const cleanResult = cleanedTaskResult(result);
  const detail = taskDetail(name, input, inputSummary);

  if (status === 'failed') {
    return {
      summary: 'Failed.',
      ...(detail ? { detail } : {}),
      failureSummary: cleanResult || 'Task failed.',
      ...(path ? { outputPath: path } : {})
    };
  }

  if (isBackgroundBash(name, input, result)) {
    return {
      summary: status === 'completed' ? 'Completed.' : backgroundStartSummary(result, hasResult),
      ...(detail ? { detail } : {}),
      ...(status === 'completed' && cleanResult ? { completionSummary: cleanResult } : {}),
      ...(path ? { outputPath: path } : {})
    };
  }

  if (status === 'completed') {
    return {
      summary: statusInputSummary(input) ?? 'Completed.',
      ...(detail ? { detail } : {}),
      ...(cleanResult ? { completionSummary: cleanResult } : {})
    };
  }

  if (status === 'pending') {
    return {
      summary: cleanResult || statusInputSummary(input) || 'Pending.',
      ...(detail ? { detail } : {})
    };
  }

  return {
    summary: cleanResult || statusInputSummary(input) || 'Running.',
    ...(detail ? { detail } : {})
  };
}

function makeMessageBlock(event: UiEvent, role: MessageBlock['role'], text: string, events = [event]): MessageBlock {
  return {
    id: `message-${role}-${event.id}`,
    type: 'message',
    role,
    text,
    eventIds: events.map((sourceEvent) => sourceEvent.id),
    rawEvents: rawEvents(events)
  };
}

function appendMessage(block: MessageBlock, event: UiEvent, text: string, events = [event]): MessageBlock {
  return {
    ...block,
    text: `${block.text}\n\n${text}`,
    eventIds: [...block.eventIds, ...events.map((sourceEvent) => sourceEvent.id)],
    rawEvents: [...block.rawEvents, ...rawEvents(events)]
  };
}

function makeToolBlock(
  toolUse: UiEvent,
  usePayload: ObjectPayload,
  resultEvent?: UiEvent,
  resultPayload?: ObjectPayload,
  useEvents = [toolUse],
  resultEvents = resultEvent ? [resultEvent] : [],
  density: 'full' | 'compact' = 'full'
): ToolBlock | TaskBlock {
  const name = toolName(usePayload);
  const id = toolUseId(usePayload) ?? String(toolUse.id);
  const input = usePayload.input;
  const inputSummary = summarizeToolInput(name, input);
  const result = resultPayload ? resultSummary(resultPayload) : '';
  const events = [...useEvents, ...resultEvents];
  const taskLike = isBackgroundBash(name, input, result) || isTaskTool(name);

  if (taskLike) {
    const status = taskStatus(name, input, result, resultEvent !== undefined, resultPayload);
    return {
      id: `task-${id}`,
      type: 'task',
      title: taskTitle(name, input),
      source: taskSource(name, input),
      status,
      ...(density === 'compact' ? { density } : {}),
      ...taskSummaries(name, input, inputSummary, result, status, resultEvent !== undefined),
      eventIds: events.map((event) => event.id),
      rawEvents: events.map(rawEvent)
    };
  }

  const status: ToolBlock['status'] = resultEvent ? (hasFailedResult(resultPayload, result) ? 'failed' : 'completed') : 'running';
  const resultDisplay = toolResultDisplay(name, status, result);
  const resultSemantics = toolResultSemantics(name, result, inputSummary);

  return {
    id: `tool-${id}`,
    type: 'tool',
    name,
    status,
    ...(density === 'compact' ? { density } : {}),
    inputSummary,
    resultSummary: displayResultSummary(name, status, result, resultDisplay),
    resultKind: resultSemantics.kind,
    ...(resultSemantics.language ? { resultLanguage: resultSemantics.language } : {}),
    resultDisplay,
    resultLabel: toolResultLabel(name, status, result, resultDisplay),
    eventIds: events.map((event) => event.id),
    rawEvents: events.map(rawEvent)
  };
}

function shouldShowStandaloneToolResult(block: ToolBlock): boolean {
  return toolPresentation(block.name, block.status, block.resultSummary).visibility === 'visible';
}

function makeStandaloneToolResult(event: UiEvent, payload: ObjectPayload): ToolBlock {
  const name = toolName(payload);
  const result = resultSummary(payload);
  const status: ToolBlock['status'] = hasFailedResult(payload, result) ? 'failed' : 'completed';
  const resultDisplay = toolResultDisplay(name, status, result);
  const resultSemantics = toolResultSemantics(name, result);
  return {
    id: `tool-result-${event.id}`,
    type: 'tool',
    name,
    status,
    inputSummary: '',
    resultSummary: displayResultSummary(name, status, result, resultDisplay),
    resultKind: resultSemantics.kind,
    ...(resultSemantics.language ? { resultLanguage: resultSemantics.language } : {}),
    resultDisplay,
    resultLabel: toolResultLabel(name, status, result, resultDisplay),
    eventIds: [event.id],
    rawEvents: [rawEvent(event)]
  };
}

function makeAnchorBlock(id: string, events: UiEvent[]): AnchorBlock {
  return {
    id: `anchor-${id}-${events.at(-1)?.id ?? events[0]?.id ?? 'event'}`,
    type: 'anchor',
    eventIds: events.map((event) => event.id),
    rawEvents: rawEvents(events)
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

function isIgnorableErrorPayload(payload: ObjectPayload): boolean {
  const line = stringField(payload, ['line']) ?? textContent(payload) ?? summarize(payload);
  return /NODE_TLS_REJECT_UNAUTHORIZED|node --trace-warnings/i.test(line);
}

function isErrorLikePayload(event: UiEvent, payload: ObjectPayload): boolean {
  if (event.kind === 'error') return true;

  const type = payloadType(event, payload).toLowerCase();
  if (type === 'tool_use' || type === 'tool_result') return false;
  if (hasStructuredFailure(payload)) return true;
  if (/error|failed|failure|exception|stderr/.test(type)) return true;

  const level = stringField(payload, ['level', 'severity']);
  if (level && /error|fatal|critical/.test(level.toLowerCase())) return true;

  return false;
}

function rawLabel(event: UiEvent): string {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = payloadType(event, payload);
  const subtype = stringField(payload, ['subtype', 'reason', 'event', 'phase']);
  const source = stringField(payload, ['source', 'stream']);
  const base = type !== event.kind ? `${humanizeIdentifier(event.kind)} · ${humanizeIdentifier(type)}` : humanizeIdentifier(event.kind);
  const detail = subtype ?? source;
  return detail ? `${base} · ${humanizeIdentifier(detail)}` : base;
}

function errorMessage(event: UiEvent, payload: ObjectPayload): string {
  const direct = stringField(payload, ['line', 'stderr', 'stdout']) ?? textContent(payload);
  if (direct) return direct;

  const error = payload.error;
  if (isObject(error)) {
    const nested = stringField(error, ['line', 'message', 'error']) ?? textContent(error);
    if (nested) return nested;
  }

  return summarize(event.payload) || rawLabel(event);
}

function streamingIndex(payload: ObjectPayload): number | null {
  const index = payload.index;
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

function streamingType(event: UiEvent): string | null {
  if (!isObject(event.payload)) return null;
  const type = event.payload.type;
  return typeof type === 'string' ? type : null;
}

function isStreamingEvent(event: UiEvent): boolean {
  return [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop'
  ].includes(streamingType(event) ?? '');
}

function parsePartialJson(value: string): unknown {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function blockEvents(streamingMessage: StreamingMessage, contentBlock: StreamingContentBlock): UiEvent[] {
  return uniqueEvents([...streamingMessage.lifecycleEvents, ...contentBlock.events]);
}

function upsertStreamingContentBlock(
  streamingMessage: StreamingMessage,
  index: number,
  event: UiEvent,
  type: StreamingContentBlock['type']
): StreamingContentBlock {
  let contentBlock = streamingMessage.contentBlocks.find((block) => block.index === index);
  if (!contentBlock) {
    contentBlock = {
      type,
      index,
      firstEvent: event,
      events: [],
      text: '',
      id: null,
      name: null,
      inputJson: '',
      input: {}
    };
    streamingMessage.contentBlocks.push(contentBlock);
    streamingMessage.contentBlocks.sort((a, b) => a.index - b.index);
  }
  if (!contentBlock.events.some((sourceEvent) => sourceEvent.id === event.id)) {
    contentBlock.events.push(event);
  }
  return contentBlock;
}

function streamingItems(event: UiEvent, streamingMessage: StreamingMessage | null): { consumed: boolean; message: StreamingMessage | null; items: NormalizedItem[] } {
  if (!isObject(event.payload)) return { consumed: false, message: streamingMessage, items: [] };
  const payload = event.payload;
  const type = streamingType(event);

  if (type === 'message_start') {
    const message = payload.message;
    if (isObject(message) && message.role === 'assistant') {
      return { consumed: true, message: { lifecycleEvents: [event], contentBlocks: [] }, items: [] };
    }
    return { consumed: false, message: streamingMessage, items: [] };
  }

  if (!streamingMessage && isStreamingEvent(event)) {
    streamingMessage = { lifecycleEvents: [], contentBlocks: [] };
  }
  if (!streamingMessage) return { consumed: false, message: streamingMessage, items: [] };

  if (type === 'content_block_start') {
    const index = streamingIndex(payload);
    const contentBlock = isObject(payload.content_block) ? payload.content_block : null;
    const blockType = typeof contentBlock?.type === 'string' ? contentBlock.type : null;
    if (index === null || (blockType !== 'text' && blockType !== 'tool_use')) {
      return { consumed: false, message: streamingMessage, items: [] };
    }
    const block = upsertStreamingContentBlock(streamingMessage, index, event, blockType);
    if (blockType === 'text') {
      const text = contentBlock ? stringField(contentBlock, ['text']) : null;
      if (text) block.text += text;
    } else if (contentBlock) {
      block.id = stringField(contentBlock, ['id']) ?? block.id;
      block.name = stringField(contentBlock, ['name']) ?? block.name;
      if (contentBlock.input !== undefined) {
        block.input = contentBlock.input;
        block.inputJson = typeof contentBlock.input === 'string' ? contentBlock.input : isObject(contentBlock.input) && Object.keys(contentBlock.input).length === 0 ? '' : JSON.stringify(contentBlock.input);
      }
    }
    return { consumed: true, message: streamingMessage, items: [] };
  }

  if (type === 'content_block_delta') {
    const index = streamingIndex(payload);
    const delta = isObject(payload.delta) ? payload.delta : null;
    const deltaType = typeof delta?.type === 'string' ? delta.type : null;
    if (index === null || !delta || (deltaType !== 'text_delta' && deltaType !== 'input_json_delta')) {
      return { consumed: false, message: streamingMessage, items: [] };
    }
    if (deltaType === 'text_delta') {
      const block = upsertStreamingContentBlock(streamingMessage, index, event, 'text');
      const text = stringField(delta, ['text']);
      if (text) block.text += text;
    } else {
      const block = upsertStreamingContentBlock(streamingMessage, index, event, 'tool_use');
      const partialJson = typeof delta.partial_json === 'string' ? delta.partial_json : '';
      block.inputJson += partialJson;
      block.input = parsePartialJson(block.inputJson);
    }
    return { consumed: true, message: streamingMessage, items: [] };
  }

  if (type === 'content_block_stop' || type === 'message_delta') {
    streamingMessage.lifecycleEvents.push(event);
    return { consumed: true, message: streamingMessage, items: [] };
  }

  if (type === 'message_stop') {
    streamingMessage.lifecycleEvents.push(event);
    return { consumed: true, message: null, items: streamingContentItems(streamingMessage) };
  }

  return { consumed: false, message: streamingMessage, items: [] };
}

function streamingContentItems(streamingMessage: StreamingMessage): NormalizedItem[] {
  return streamingMessage.contentBlocks.flatMap((block): NormalizedItem[] => {
    const events = blockEvents(streamingMessage, block);
    if (block.type === 'text') {
      return block.text ? [{ type: 'message', event: block.firstEvent, events, role: 'assistant', text: block.text }] : [];
    }

    return [
      {
        type: 'tool_use',
        event: block.firstEvent,
        events,
        payload: {
          type: 'tool_use',
          id: block.id ?? String(block.firstEvent.id),
          name: block.name ?? 'tool',
          input: block.input
        }
      }
    ];
  });
}

function normalizedItems(event: UiEvent): NormalizedItem[] | null {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = payloadType(event, payload);
  const isClaudeUserPayload = payload.type === 'user';
  const isClaudeSystemPayload = payload.type === 'system';

  if (isErrorLikePayload(event, payload)) {
    return isIgnorableErrorPayload(payload) ? [] : [{ type: 'error', event, payload }];
  }
  if (event.kind === 'system') return [];

  const role = roleFromEvent(event, payload);
  const items: NormalizedItem[] = [];
  const content = contentArray(payload);
  if (content) {
    for (const entry of content) {
      if (!isObject(entry)) continue;
      if (entry.type === 'text') {
        const text = stringField(entry, ['text']);
        if (text && role && !isClaudeUserPayload && !isClaudeSystemPayload) items.push({ type: 'message', event, role, text });
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
  if (text && role && !isClaudeUserPayload && !isClaudeSystemPayload) return [{ type: 'message', event, role, text }];

  if (isClaudeUserPayload) {
    const presentation = rawEventPresentation(event.kind, event.payload);
    if (presentation.visibility === 'hidden') return [];
    if (presentation.visibility === 'anchor') return [{ type: 'anchor', event }];
    return [{ type: 'raw', event, label: presentation.label, severity: presentation.severity }];
  }

  return null;
}

export function buildConversationBlocks(events: UiEvent[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  const pendingTools = new Map<string, PendingTool>();
  const pendingToolResults = new Map<string, PendingToolResult>();
  let streamingMessage: StreamingMessage | null = null;

  function appendItems(items: NormalizedItem[] | null, fallbackEvent?: UiEvent) {
    if (!items) {
      if (!fallbackEvent) return;
      const presentation = rawEventPresentation(fallbackEvent.kind, fallbackEvent.payload);
      if (presentation.visibility === 'hidden') return;
      if (presentation.visibility === 'anchor') {
        blocks.push(makeAnchorBlock('raw', [fallbackEvent]));
        return;
      }
      blocks.push({
        id: `raw-${fallbackEvent.id}`,
        type: 'raw',
        label: presentation.label ?? rawLabel(fallbackEvent),
        severity: presentation.severity,
        eventIds: [fallbackEvent.id],
        rawEvents: [rawEvent(fallbackEvent)]
      });
      return;
    }

    for (const item of items) {
      if (item.type === 'error') {
        blocks.push({
          id: `error-${item.event.id}`,
          type: 'error',
          message: errorMessage(item.event, item.payload),
          eventIds: [item.event.id],
          rawEvents: [rawEvent(item.event)]
        });
        continue;
      }

      if (item.type === 'raw') {
        blocks.push({
          id: `raw-${item.event.id}`,
          type: 'raw',
          label: item.label ?? rawLabel(item.event),
          ...(item.severity ? { severity: item.severity } : {}),
          eventIds: [item.event.id],
          rawEvents: [rawEvent(item.event)]
        });
        continue;
      }

      if (item.type === 'anchor') {
        blocks.push(makeAnchorBlock(item.id ?? 'event', item.events ?? [item.event]));
        continue;
      }

      if (item.type === 'message') {
        const sourceEvents = item.events ?? [item.event];
        const previous = blocks[blocks.length - 1];
        if (previous?.type === 'message' && previous.role === item.role) {
          blocks[blocks.length - 1] = appendMessage(previous, item.event, item.text, sourceEvents);
        } else {
          blocks.push(makeMessageBlock(item.event, item.role, item.text, sourceEvents));
        }
        continue;
      }

      if (item.type === 'tool_use') {
        const id = toolUseId(item.payload) ?? String(item.event.id);
        const sourceEvents = item.events ?? [item.event];
        const pendingResult = pendingToolResults.get(id);
        if (pendingResult) {
          const name = toolName(item.payload);
          const result = resultSummary(pendingResult.payload);
          const status = hasFailedResult(pendingResult.payload, result) ? 'failed' : 'completed';
          const presentation = isTaskTool(name)
            ? taskToolPresentation(name, status, item.payload.input, result)
            : toolActivityPresentation(name, status, item.payload.input, result);
          const block = makeToolBlock(item.event, item.payload, pendingResult.event, pendingResult.payload, sourceEvents, pendingResult.events, presentation.visibility === 'compact' ? 'compact' : 'full');
          if (presentation.visibility === 'hidden' || presentation.visibility === 'anchor' || (block.type === 'tool' && toolPresentation(block.name, block.status, block.resultSummary).visibility === 'hidden')) {
            const anchor = makeAnchorBlock(id, [...sourceEvents, ...pendingResult.events]);
            if (pendingResult.blockIndex !== undefined) blocks[pendingResult.blockIndex] = anchor;
            else blocks.push(anchor);
          } else if (pendingResult.blockIndex !== undefined) {
            blocks[pendingResult.blockIndex] = block;
          } else {
            blocks.push(block);
          }
          pendingToolResults.delete(id);
        } else {
          const name = toolName(item.payload);
          const presentation = isTaskTool(name)
            ? taskToolPresentation(name, 'running', item.payload.input, '')
            : toolActivityPresentation(name, 'running', item.payload.input, '');
          if (presentation.visibility === 'hidden' || presentation.visibility === 'anchor') {
            blocks.push(makeAnchorBlock(id, sourceEvents));
          } else {
            const blockIndex = blocks.length;
            pendingTools.set(id, { event: item.event, events: sourceEvents, payload: item.payload, blockIndex });
            blocks.push(makeToolBlock(item.event, item.payload, undefined, undefined, sourceEvents, [], presentation.visibility === 'compact' ? 'compact' : 'full'));
          }
        }
        continue;
      }

      const sourceEvents = item.events ?? [item.event];
      const id = resultToolUseId(item.payload);
      if (id) {
        const pending = pendingTools.get(id);
        if (pending) {
          const name = toolName(pending.payload);
          const result = resultSummary(item.payload);
          const status = hasFailedResult(item.payload, result) ? 'failed' : 'completed';
          const presentation = isTaskTool(name)
            ? taskToolPresentation(name, status, pending.payload.input, result)
            : toolActivityPresentation(name, status, pending.payload.input, result);
          const block = makeToolBlock(pending.event, pending.payload, item.event, item.payload, pending.events, sourceEvents, presentation.visibility === 'compact' ? 'compact' : 'full');
          if (presentation.visibility === 'hidden' || presentation.visibility === 'anchor' || (block.type === 'tool' && toolPresentation(block.name, block.status, block.resultSummary).visibility === 'hidden')) {
            blocks[pending.blockIndex] = makeAnchorBlock(id, [...pending.events, ...sourceEvents]);
          } else {
            blocks[pending.blockIndex] = block;
          }
          pendingTools.delete(id);
        } else {
          const block = makeStandaloneToolResult(item.event, item.payload);
          if (shouldShowStandaloneToolResult(block)) {
            pendingToolResults.set(id, { event: item.event, events: sourceEvents, payload: item.payload, blockIndex: blocks.length });
            blocks.push(block);
          } else {
            pendingToolResults.set(id, { event: item.event, events: sourceEvents, payload: item.payload });
          }
        }
      } else {
        const block = makeStandaloneToolResult(item.event, item.payload);
        if (shouldShowStandaloneToolResult(block)) blocks.push(block);
      }
    }
  }

  for (const event of events) {
    const streaming = streamingItems(event, streamingMessage);
    streamingMessage = streaming.message;
    if (streaming.consumed) {
      appendItems(streaming.items);
      continue;
    }

    appendItems(normalizedItems(event), event);
  }

  if (streamingMessage) appendItems(streamingContentItems(streamingMessage));

  return blocks;
}
