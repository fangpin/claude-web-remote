export type ToolStatus = 'running' | 'completed' | 'failed';
export type ToolVisibility = 'hidden' | 'visible';
export type ToolDetail = 'hidden' | 'collapsed' | 'expanded';
export type ActivityVisibility = 'hidden' | 'anchor' | 'compact' | 'visible';
export type RawSeverity = 'info' | 'warning' | 'error' | 'permission';

type ObjectPayload = Record<string, unknown>;

export type ToolPresentation = {
  visibility: ToolVisibility;
  detail: ToolDetail;
};

export type ActivityPresentation = {
  visibility: ActivityVisibility;
  detail: ToolDetail;
};

export type RawEventPresentation = {
  visibility: Exclude<ActivityVisibility, 'compact'>;
  severity: RawSeverity;
  label?: string;
};

export type ToolResultKind = 'text' | 'code' | 'diff' | 'paths';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  css: 'css',
  go: 'go',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'shell',
  ts: 'typescript',
  tsx: 'tsx',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml'
};

const READ_ONLY_INSPECTION_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const TASK_MANAGEMENT_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop']);
const TASK_LIKE_TOOLS = new Set(['Agent', 'Workflow', ...TASK_MANAGEMENT_TOOLS]);
const MUTATION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const LOW_VALUE_BASH_RE = /^\s*(pwd|ls(?:\s|$)|find\s|rg\s|grep\s|cat\s|head\s|tail\s|sed\s|awk\s)/i;
const IMPORTANT_BASH_RE = /\b(npm|pnpm|yarn|bun|cargo|go test|pytest|vitest|playwright|tsc|vite|build|test|lint|typecheck|git\s+(status|diff|log|push|commit)|gh\s+|scripts\/start-server|curl\s)/i;

export function isReadOnlyInspectionTool(name: string): boolean {
  return READ_ONLY_INSPECTION_TOOLS.has(name);
}

export function isTaskManagementTool(name: string): boolean {
  return TASK_MANAGEMENT_TOOLS.has(name);
}

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

function payloadText(payload: ObjectPayload): string {
  return [
    stringField(payload, ['message', 'text', 'prompt', 'status', 'error', 'reason', 'subtype', 'event', 'phase', 'line']),
    typeof payload.type === 'string' ? payload.type : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

export function isSuccessfulMetadataPayload(payload: unknown): boolean {
  if (!isObject(payload)) return false;
  const type = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
  const markers = ['status', 'subtype', 'event', 'phase', 'reason', 'result']
    .map((key) => (typeof payload[key] === 'string' ? String(payload[key]).toLowerCase() : ''))
    .filter(Boolean);
  if (markers.some((value) => /^(success|succeeded|ok|done|completed)$/.test(value))) return true;
  return ['result', 'status', 'lifecycle'].includes(type) && markers.length > 0 && markers.every((value) => !/error|fail|denied|blocked|permission|warn|interrupt/.test(value));
}

export function isPermissionOrRiskPayload(payload: unknown): boolean {
  if (!isObject(payload)) return false;
  return /permission|approval|approve|deny|denied|review|risky|confirm|blocked|interrupt/i.test(payloadText(payload));
}

function isErrorLikeRawPayload(payload: unknown): boolean {
  if (!isObject(payload)) return false;
  return /error|failed|failure|exception|stderr|fatal|critical/i.test(payloadText(payload));
}

export function rawEventPresentation(kind: string, payload: unknown): RawEventPresentation {
  if (isPermissionOrRiskPayload(payload)) return { visibility: 'visible', severity: 'permission', label: 'Permission event' };
  if (isErrorLikeRawPayload(payload)) return { visibility: 'visible', severity: 'error', label: 'Error event' };
  if (isSuccessfulMetadataPayload(payload)) return { visibility: 'anchor', severity: 'info' };
  if (isObject(payload) && payload.type === 'user') return { visibility: 'anchor', severity: 'info' };
  if (kind === 'system') return { visibility: 'hidden', severity: 'info' };
  return { visibility: 'visible', severity: 'warning', label: 'Unknown event' };
}

export function isLowValueBashInspection(input: unknown, result: string): boolean {
  if (!isObject(input)) return false;
  const command = stringField(input, ['command']);
  if (!command) return false;
  if (IMPORTANT_BASH_RE.test(command)) return false;
  return LOW_VALUE_BASH_RE.test(command) && !/error|failed|failure|exception|stderr/i.test(result);
}

export function isImportantBash(input: unknown): boolean {
  if (!isObject(input)) return false;
  const command = stringField(input, ['command']);
  return Boolean(command && IMPORTANT_BASH_RE.test(command));
}

export function shouldProjectTaskTool(toolKind: string): boolean {
  return !isReadOnlyInspectionTool(toolKind);
}

export function toolActivityPresentation(name: string, status: ToolStatus, input: unknown, result: string): ActivityPresentation {
  if (status === 'failed') return { visibility: 'visible', detail: 'expanded' };
  if (status === 'running') return { visibility: 'compact', detail: 'collapsed' };
  if (isReadOnlyInspectionTool(name)) return { visibility: 'anchor', detail: 'hidden' };
  if (!result.trim()) return { visibility: 'anchor', detail: 'hidden' };
  if (name === 'Bash' && isLowValueBashInspection(input, result)) return { visibility: 'anchor', detail: 'hidden' };
  if (name === 'Bash' || MUTATION_TOOLS.has(name) || TASK_LIKE_TOOLS.has(name)) return { visibility: 'compact', detail: 'collapsed' };
  return { visibility: 'visible', detail: 'collapsed' };
}

export function taskToolPresentation(name: string, status: ToolStatus, input: unknown, result: string): ActivityPresentation {
  if (status === 'failed') return { visibility: 'visible', detail: 'expanded' };
  if (status === 'running') return { visibility: 'compact', detail: 'collapsed' };
  if (name === 'TaskList' || name === 'TaskGet') return { visibility: 'anchor', detail: 'hidden' };
  if (name === 'TaskUpdate') return { visibility: 'anchor', detail: 'hidden' };
  if (name === 'TaskOutput' && !result.trim()) return { visibility: 'anchor', detail: 'hidden' };
  return { visibility: 'compact', detail: result.trim() ? 'collapsed' : 'hidden' };
}

export function toolPresentation(name: string, status: ToolStatus, result: string): ToolPresentation {
  if (status === 'failed') return { visibility: 'visible', detail: 'expanded' };
  if (status === 'running') return { visibility: 'visible', detail: 'expanded' };
  if (isReadOnlyInspectionTool(name)) return { visibility: 'hidden', detail: 'hidden' };
  return { visibility: 'visible', detail: result.trim() ? 'collapsed' : 'hidden' };
}

function nonEmptyLines(text: string): string[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function looksLikeDiff(text: string): boolean {
  return /(^|\n)(diff --git|@@\s+-\d|Index: |---\s+\S+|\+\+\+\s+\S+)/.test(text);
}

function looksLikePathList(text: string): boolean {
  const lines = nonEmptyLines(text);
  if (lines.length === 0 || lines.length > 240) return false;

  const pathLikeLines = lines.filter((line) => {
    if (/\s{2,}/.test(line)) return false;
    if (/^(error|warning|failed|success|found)\b/i.test(line)) return false;
    return /^(\/|~\/|\.{1,2}\/|[A-Za-z]:\\|[\w@.-]+\/)[^\0]*[\w)./-]$/.test(line);
  });

  return pathLikeLines.length === lines.length && (lines.length > 1 || /[./\\]/.test(lines[0]));
}

function languageFromPath(path: string): string | undefined {
  const match = /\.([A-Za-z0-9]+)(?:[)\].,;:]*)$/.exec(path.trim());
  return match ? LANGUAGE_BY_EXTENSION[match[1].toLowerCase()] : undefined;
}

function languageFromFence(text: string): string | undefined {
  const match = /^```([A-Za-z0-9_-]+)?\s*\n[\s\S]*\n```\s*$/.exec(text.trim());
  return match?.[1] || undefined;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function toolResultSemantics(name: string, result: string, inputSummary = ''): { kind: ToolResultKind; language?: string } {
  const trimmed = result.trim();
  if (!trimmed) return { kind: 'text' };
  if (looksLikeDiff(trimmed)) return { kind: 'diff', language: 'diff' };
  if (name === 'Glob' || looksLikePathList(trimmed)) return { kind: 'paths' };

  const fenceLanguage = languageFromFence(trimmed);
  if (fenceLanguage) return { kind: 'code', language: fenceLanguage };
  if (looksLikeJson(trimmed)) return { kind: 'code', language: 'json' };

  if (name === 'Read' && !/^(error|failed|failure):?\b/i.test(trimmed)) {
    return { kind: 'code', language: languageFromPath(inputSummary) };
  }

  return { kind: 'text' };
}
