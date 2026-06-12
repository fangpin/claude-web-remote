import type { UiEvent } from './types';

export type MessageDisplayEvent = {
  kind: 'message';
  role: 'assistant' | 'user';
  label: string;
  text: string;
  raw: unknown;
};

export type ToolDisplayEvent = {
  kind: 'tool';
  name: string;
  status: 'running' | 'complete' | 'error';
  input?: string;
  output?: string;
  error?: string;
  defaultOpen: boolean;
  raw: unknown;
};

export type StatusDisplayEvent = {
  kind: 'status';
  tone: 'system' | 'error' | 'raw';
  label: string;
  text: string;
  raw: unknown;
};

export type UnknownDisplayEvent = {
  kind: 'unknown';
  label: string;
  raw: unknown;
};

export type DisplayEvent = MessageDisplayEvent | ToolDisplayEvent | StatusDisplayEvent | UnknownDisplayEvent;

type PayloadRecord = Record<string, unknown>;

export function parseDisplayEvent(event: UiEvent): DisplayEvent {
  return parseDisplayEvents(event)[0];
}

export function parseDisplayEvents(event: UiEvent): DisplayEvent[] {
  const payload = event.payload;
  const record = asRecord(payload);
  const payloadType = stringField(record, 'type');
  const label = event.kind;

  if (isToolEvent(event, payloadType)) {
    return [parseToolEvent(label, payload, record, payloadType)];
  }

  if (event.kind === 'assistant' || event.kind === 'user') {
    const contentDisplays = parseContentDisplayEvents(event.kind, label, payload, record);
    if (contentDisplays.length > 0) {
      return contentDisplays;
    }

    const text = extractText(payload);
    if (text !== undefined) {
      return [{
        kind: 'message',
        role: event.kind,
        label,
        text,
        raw: payload
      }];
    }
  }

  if (event.kind === 'system' || event.kind === 'error' || event.kind === 'raw') {
    const text = extractText(payload);
    if (text !== undefined) {
      return [{
        kind: 'status',
        tone: event.kind === 'error' ? 'error' : event.kind === 'raw' ? 'raw' : 'system',
        label,
        text,
        raw: payload
      }];
    }
  }

  return [{
    kind: 'unknown',
    label,
    raw: payload
  }];
}

export function formatRawPayload(raw: unknown): string {
  return JSON.stringify(raw, null, 2) ?? String(raw);
}

function parseContentDisplayEvents(
  role: 'assistant' | 'user',
  label: string,
  raw: unknown,
  record: PayloadRecord | undefined
): DisplayEvent[] {
  const content = contentBlocks(record);
  if (!content) {
    return [];
  }

  const displays: DisplayEvent[] = [];
  let textParts: string[] = [];

  const flushText = () => {
    const text = joinParts(textParts);
    textParts = [];
    if (text !== undefined) {
      displays.push({
        kind: 'message',
        role,
        label,
        text,
        raw
      });
    }
  };

  for (const block of content) {
    const blockRecord = asRecord(block);
    const blockType = stringField(blockRecord, 'type');

    if (blockType === 'tool_use' || blockType === 'tool_result') {
      flushText();
      displays.push(parseToolEvent(label, raw, blockRecord, blockType));
      continue;
    }

    const text = extractText(block);
    if (text !== undefined) {
      textParts.push(text);
    }
  }

  flushText();
  return displays;
}

function contentBlocks(record: PayloadRecord | undefined): unknown[] | undefined {
  if (Array.isArray(record?.content)) {
    return record.content;
  }

  const message = asRecord(record?.message);
  if (Array.isArray(message?.content)) {
    return message.content;
  }

  return undefined;
}

function parseToolEvent(label: string, raw: unknown, record: PayloadRecord | undefined, payloadType: string | undefined): ToolDisplayEvent {
  const hasError = hasField(record, 'error');
  const isErrorResult = record?.is_error === true;
  const status: ToolDisplayEvent['status'] = hasError || isErrorResult
    ? 'error'
    : payloadType === 'tool_use' && !hasOutput(record)
      ? 'running'
      : 'complete';

  const display: ToolDisplayEvent = {
    kind: 'tool',
    name: toolName(record),
    status,
    defaultOpen: status === 'running',
    raw
  };

  if (hasField(record, 'input')) {
    display.input = summarize(record.input);
  }

  const outputValue = firstPresent(record, ['result', 'output', 'content']);
  if (status === 'error') {
    const errorValue = hasError ? record?.error : outputValue;
    if (errorValue !== undefined) {
      display.error = summarize(errorValue);
    }
  } else if (outputValue !== undefined) {
    display.output = summarize(outputValue);
  }

  return display;
}

function isToolEvent(event: UiEvent, payloadType: string | undefined): boolean {
  return event.kind === 'tool' || payloadType === 'tool_use' || payloadType === 'tool_result';
}

function toolName(record: PayloadRecord | undefined): string {
  return stringField(record, 'name') ?? stringField(record, 'tool_name') ?? stringField(record, 'toolName') ?? 'tool';
}

function hasOutput(record: PayloadRecord | undefined): boolean {
  return hasField(record, 'result') || hasField(record, 'output') || hasField(record, 'content');
}

function firstPresent(record: PayloadRecord | undefined, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function summarize(value: unknown): string {
  const text = extractText(value);
  return text ?? formatRawPayload(value);
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.flatMap((item) => textParts(item));
    return joinParts(parts);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ['message', 'text', 'status', 'error', 'line', 'content']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }

    const text = extractText(record[key]);
    if (text !== undefined) {
      return text;
    }
  }

  return undefined;
}

function textParts(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const text = extractText(record.text ?? record.content);
  return text === undefined ? [] : [text];
}

function joinParts(parts: string[]): string | undefined {
  const nonEmptyParts = parts.filter((part) => part.length > 0);
  return nonEmptyParts.length > 0 ? nonEmptyParts.join('\n\n') : undefined;
}

function stringField(record: PayloadRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function hasField(record: PayloadRecord | undefined, key: string): record is PayloadRecord {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

function asRecord(value: unknown): PayloadRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as PayloadRecord) : undefined;
}
