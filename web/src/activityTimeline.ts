import { summarizeToolInput } from './toolSummaries';
import type { EventKind, SessionInfo, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

export type ActivityStatus = 'running' | 'waiting' | 'failed' | 'done';

export type ActivityReviewKind = 'permission' | 'risky-command' | 'failed-action';

export type ActivityItem = {
  id: string;
  name: string;
  status: ActivityStatus;
  summary: string;
  resultSummary?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  startEventId: number;
  finishEventId?: number;
  anchorEventId: number;
  rawEventKinds: EventKind[];
  isPermissionLike: boolean;
  reviewKind?: ActivityReviewKind;
  riskHint?: string;
  transcriptHidden: boolean;
};

type PendingActivity = {
  event: UiEvent;
  payload: ObjectPayload;
};

type ToolUseItem = {
  type: 'tool_use';
  event: UiEvent;
  payload: ObjectPayload;
};

type ToolResultItem = {
  type: 'tool_result';
  event: UiEvent;
  payload: ObjectPayload;
};

type ToolEventItem = ToolUseItem | ToolResultItem;

const READ_ONLY_INSPECTION_TOOLS = new Set(['Read', 'Glob', 'Grep']);

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(payload: ObjectPayload | undefined, keys: string[]): string | null {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function compactText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function shortText(text: string, maxLength = 180): string {
  const compact = compactText(text);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
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

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => (isObject(entry) && entry.type === 'text' ? stringField(entry, ['text']) : null))
    .filter((entry): entry is string => entry !== null)
    .join('\n');
  return text || null;
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

function toolName(payload: ObjectPayload): string {
  return stringField(payload, ['name', 'tool_name', 'toolName']) ?? 'tool';
}

function toolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['id', 'tool_use_id', 'toolUseId']);
}

function resultToolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['tool_use_id', 'toolUseId', 'id']);
}

function hasStructuredFailure(payload: ObjectPayload | undefined): boolean {
  if (!payload) return false;
  if (payload.is_error === true || payload.isError === true) return true;
  const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
  if (['error', 'failed', 'failure'].includes(status)) return true;
  const error = payload.error;
  if (typeof error === 'string') return error.trim().length > 0;
  return isObject(error);
}

function hasClearFailureText(result: string): boolean {
  return /(^|\n)\s*(error|failed|failure):|\bcommand failed\b|\bexit code\s+[1-9]\d*\b/i.test(result);
}

function contentArray(payload: ObjectPayload): unknown[] | null {
  if (Array.isArray(payload.content)) return payload.content;
  const message = payload.message;
  if (isObject(message) && Array.isArray(message.content)) return message.content;
  return null;
}

function toolEventItems(event: UiEvent): ToolEventItem[] {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };
  const type = typeof payload.type === 'string' ? payload.type : event.kind;
  const items: ToolEventItem[] = [];
  const content = contentArray(payload);

  if (content) {
    for (const entry of content) {
      if (!isObject(entry)) continue;
      if (entry.type === 'tool_use') items.push({ type: 'tool_use', event, payload: entry });
      if (entry.type === 'tool_result') items.push({ type: 'tool_result', event, payload: entry });
    }
  }

  if (type === 'tool_use') items.push({ type: 'tool_use', event, payload });
  if (type === 'tool_result') items.push({ type: 'tool_result', event, payload });
  return items;
}

function durationMs(startedAt: string, finishedAt?: string): number | undefined {
  if (!finishedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return undefined;
  return Math.max(0, finish - start);
}

function payloadSearchText(payload: ObjectPayload): string {
  return JSON.stringify(payload).toLowerCase();
}

function isPermissionLikeTool(name: string, payload: ObjectPayload, resultPayload?: ObjectPayload): boolean {
  const haystack = `${name} ${payloadSearchText(payload)} ${resultPayload ? payloadSearchText(resultPayload) : ''}`;
  return /\b(permission|permissions|approval|approve|deny|review|risky|risk|confirm|confirmation)\b/.test(haystack);
}

function bashCommand(payload: ObjectPayload): string | null {
  if (!isObject(payload.input)) return null;
  return stringField(payload.input, ['command']);
}

function riskyCommandHint(command: string): string | null {
  const normalized = command.toLowerCase();
  if (/\brm\s+-(?:[^\s]*[rf]|[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)/.test(normalized)) return 'Deletes files recursively or forcefully.';
  if (/\b(git\s+push(?:\s+[^\n;|&]*)?|gh\s+pr\s+create|gh\s+issue\s+create|gh\s+pr\s+comment|gh\s+issue\s+comment)\b/.test(normalized)) return 'Changes shared remote state.';
  if (/\b(git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|git\s+checkout\s+--|git\s+restore\s+(?:[^\n;|&]*\s)?\.)\b/.test(normalized)) return 'Can discard local work.';
  if (/\b(drop\s+table|truncate\s+table|delete\s+from)\b/.test(normalized)) return 'Can delete database data.';
  if (/\b(curl|wget)\b[^\n;|&]*(?:\|\s*(?:sh|bash)|>\s*\/dev\/|--upload-file|-t\s*)/.test(normalized)) return 'Performs network or shell action that may affect external systems.';
  return null;
}

function activityReview(name: string, payload: ObjectPayload, resultPayload: ObjectPayload | undefined, status: ActivityStatus): Pick<ActivityItem, 'isPermissionLike' | 'reviewKind' | 'riskHint'> {
  const permissionLike = isPermissionLikeTool(name, payload, resultPayload);
  if (permissionLike) {
    return {
      isPermissionLike: true,
      reviewKind: 'permission',
      riskHint: 'Claude emitted a permission or confirmation-style event.'
    };
  }

  const command = name === 'Bash' ? bashCommand(payload) : null;
  const commandRisk = command ? riskyCommandHint(command) : null;
  if (commandRisk) {
    return {
      isPermissionLike: false,
      reviewKind: 'risky-command',
      riskHint: commandRisk
    };
  }

  if (status === 'failed') {
    return {
      isPermissionLike: false,
      reviewKind: 'failed-action',
      riskHint: 'The tool or action failed; review the result before continuing.'
    };
  }

  return { isPermissionLike: false };
}

function completedStatus(resultPayload: ObjectPayload, result: string): ActivityStatus {
  return hasStructuredFailure(resultPayload) || hasClearFailureText(result) ? 'failed' : 'done';
}

function makeActivity(
  toolUse: UiEvent,
  usePayload: ObjectPayload,
  visibleEventIds: Set<number>,
  resultEvent?: UiEvent,
  resultPayload?: ObjectPayload
): ActivityItem {
  const name = toolName(usePayload);
  const id = toolUseId(usePayload) ?? String(toolUse.id);
  const result = resultPayload ? resultSummary(resultPayload) : '';
  const permissionLike = isPermissionLikeTool(name, usePayload, resultPayload);
  const status: ActivityStatus = resultPayload
    ? completedStatus(resultPayload, result)
    : permissionLike
      ? 'waiting'
      : 'running';
  const finishedAt = resultEvent?.time;
  const eventIds = resultEvent ? [toolUse.id, resultEvent.id] : [toolUse.id];
  const review = activityReview(name, usePayload, resultPayload, status);

  return {
    id: `activity-${id}`,
    name,
    status,
    summary: summarizeToolInput(name, usePayload.input),
    ...(result.trim() ? { resultSummary: shortText(result, 220) } : {}),
    startedAt: toolUse.time,
    ...(finishedAt ? { finishedAt } : {}),
    durationMs: durationMs(toolUse.time, finishedAt),
    startEventId: toolUse.id,
    ...(resultEvent ? { finishEventId: resultEvent.id } : {}),
    anchorEventId: toolUse.id,
    rawEventKinds: resultEvent ? [toolUse.kind, resultEvent.kind] : [toolUse.kind],
    ...review,
    transcriptHidden: !eventIds.some((eventId) => visibleEventIds.has(eventId)) || (READ_ONLY_INSPECTION_TOOLS.has(name) && status === 'done')
  };
}

export function buildActivityTimeline(events: UiEvent[], visibleBlockEventIds: number[] = []): ActivityItem[] {
  const activities: ActivityItem[] = [];
  const pendingTools = new Map<string, PendingActivity>();
  const visibleEventIds = new Set(visibleBlockEventIds);

  for (const event of events) {
    for (const item of toolEventItems(event)) {
      if (item.type === 'tool_use') {
        const id = toolUseId(item.payload) ?? String(item.event.id);
        pendingTools.set(id, { event: item.event, payload: item.payload });
        continue;
      }

      const id = resultToolUseId(item.payload);
      if (id) {
        const pending = pendingTools.get(id);
        if (pending) {
          activities.push(makeActivity(pending.event, pending.payload, visibleEventIds, item.event, item.payload));
          pendingTools.delete(id);
          continue;
        }
      }

      const name = toolName(item.payload);
      const result = resultSummary(item.payload);
      const status = completedStatus(item.payload, result);
      activities.push({
        id: `activity-result-${item.event.id}`,
        name,
        status,
        summary: 'Tool result without matching start event',
        ...(result.trim() ? { resultSummary: shortText(result, 220) } : {}),
        startedAt: item.event.time,
        finishedAt: item.event.time,
        durationMs: 0,
        startEventId: item.event.id,
        finishEventId: item.event.id,
        anchorEventId: item.event.id,
        rawEventKinds: [item.event.kind],
        ...activityReview(name, item.payload, undefined, status),
        transcriptHidden: !visibleEventIds.has(item.event.id)
      });
    }
  }

  for (const [id, pending] of pendingTools) {
    activities.push(makeActivity(pending.event, { ...pending.payload, id }, visibleEventIds));
  }

  return activities.sort((a, b) => b.startEventId - a.startEventId);
}

export type ReviewSurface = {
  title: string;
  message: string;
  actionName?: string;
  actionSummary?: string;
  riskHint?: string;
  cwd: string;
  permissionMode: string;
  canAct: false;
  limitation: string;
  activity?: ActivityItem;
};

export function latestReviewActivity(activities: ActivityItem[]): ActivityItem | null {
  return activities.find((activity) => activity.status !== 'done' && activity.reviewKind !== undefined)
    ?? activities.find((activity) => activity.reviewKind === 'failed-action')
    ?? null;
}

export function reviewSurface(session: SessionInfo | null, activity: ActivityItem | null): ReviewSurface | null {
  if (!session || session.deletedAt || session.status !== 'running') return null;

  if (activity?.reviewKind) {
    return {
      title: activity.reviewKind === 'failed-action' ? 'Claude action needs attention' : 'Claude needs your review',
      message: activity.reviewKind === 'permission'
        ? 'Claude emitted a permission or confirmation-style event. Review the payload before continuing.'
        : activity.reviewKind === 'risky-command'
          ? 'Claude requested an action that may be destructive or affect shared state.'
          : 'A tool or action failed. Review the result before deciding how to continue.',
      actionName: activity.name,
      actionSummary: activity.summary,
      riskHint: activity.riskHint,
      cwd: session.cwd,
      permissionMode: session.permissionMode,
      canAct: false,
      limitation: 'This server does not expose Claude CLI permission approval or denial controls yet. Continue in the terminal if Claude is waiting on an interactive prompt.',
      activity
    };
  }

  if (session.runtimeStatus === 'waiting') {
    return {
      title: 'Claude is waiting',
      message: 'No tool is currently running. Send a message when you are ready to continue, or check the terminal if Claude is waiting on an interactive prompt.',
      cwd: session.cwd,
      permissionMode: session.permissionMode,
      canAct: false,
      limitation: 'Web approval controls are not available in this build.'
    };
  }

  return null;
}

export function waitingCopy(session: SessionInfo | null, latestPermissionActivity: ActivityItem | null): string | null {
  if (!session || session.deletedAt || session.status !== 'running' || session.runtimeStatus !== 'waiting') return null;
  if (latestPermissionActivity) {
    return 'Claude appears to be waiting on a permission or review-style event. This build can show the payload, but approval controls are not wired yet.';
  }
  return 'Claude is waiting. No tool is currently running; send a message when you are ready to continue.';
}
