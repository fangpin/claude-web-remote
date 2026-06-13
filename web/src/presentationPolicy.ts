export type ToolStatus = 'running' | 'completed' | 'failed';
export type ToolVisibility = 'hidden' | 'visible';
export type ToolDetail = 'hidden' | 'collapsed' | 'expanded';

export type ToolPresentation = {
  visibility: ToolVisibility;
  detail: ToolDetail;
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
export function isReadOnlyInspectionTool(name: string): boolean {
  return READ_ONLY_INSPECTION_TOOLS.has(name);
}

export function shouldProjectTaskTool(toolKind: string): boolean {
  // Task projection only filters low-value read-only inspection tools;
  // every other tool kind remains projectable by this policy.
  return !isReadOnlyInspectionTool(toolKind);
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
