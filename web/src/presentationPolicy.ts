export type ToolStatus = 'running' | 'completed' | 'failed';
export type ToolVisibility = 'hidden' | 'visible';
export type ToolDetail = 'hidden' | 'collapsed' | 'expanded';

export type ToolPresentation = {
  visibility: ToolVisibility;
  detail: ToolDetail;
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
