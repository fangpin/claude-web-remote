import { describe, expect, it } from 'vitest';
import { shouldProjectTaskTool, toolPresentation } from './presentationPolicy';

describe('presentationPolicy', () => {
  it('hides completed read-only inspection tools', () => {
    expect(toolPresentation('Read', 'completed', 'file contents')).toEqual({ visibility: 'hidden', detail: 'hidden' });
    expect(toolPresentation('Glob', 'completed', 'a.ts\nb.ts')).toEqual({ visibility: 'hidden', detail: 'hidden' });
    expect(toolPresentation('Grep', 'completed', 'line 1')).toEqual({ visibility: 'hidden', detail: 'hidden' });
  });

  it('shows failed read-only inspection tools expanded', () => {
    expect(toolPresentation('Read', 'failed', 'Error: missing file')).toEqual({ visibility: 'visible', detail: 'expanded' });
  });

  it('shows running read-only inspection tools expanded', () => {
    expect(toolPresentation('Read', 'running', '')).toEqual({ visibility: 'visible', detail: 'expanded' });
  });

  it('collapses successful bash and file mutation tools', () => {
    expect(toolPresentation('Bash', 'completed', 'tests passed')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Edit', 'completed', 'updated file')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Write', 'completed', 'created file')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('NotebookEdit', 'completed', 'updated notebook')).toEqual({ visibility: 'visible', detail: 'collapsed' });
  });

  it('hides empty successful tool detail', () => {
    expect(toolPresentation('Bash', 'completed', '')).toEqual({ visibility: 'visible', detail: 'hidden' });
    expect(toolPresentation('WebFetch', 'completed', '   ')).toEqual({ visibility: 'visible', detail: 'hidden' });
  });

  it('collapses successful web and task-like tools', () => {
    expect(toolPresentation('WebFetch', 'completed', 'fetched page')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('WebSearch', 'completed', 'search result')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Agent', 'completed', 'review done')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Workflow', 'completed', 'workflow done')).toEqual({ visibility: 'visible', detail: 'collapsed' });
  });

  it('shows failed tools expanded', () => {
    expect(toolPresentation('Bash', 'failed', 'exit code 1')).toEqual({ visibility: 'visible', detail: 'expanded' });
    expect(toolPresentation('Edit', 'failed', 'stale file')).toEqual({ visibility: 'visible', detail: 'expanded' });
  });

  it('only filters read-only inspection tools from task projection', () => {
    expect(shouldProjectTaskTool('Read')).toBe(false);
    expect(shouldProjectTaskTool('Glob')).toBe(false);
    expect(shouldProjectTaskTool('Grep')).toBe(false);

    expect(shouldProjectTaskTool('Bash')).toBe(true);
    expect(shouldProjectTaskTool('Edit')).toBe(true);
    expect(shouldProjectTaskTool('Agent')).toBe(true);
    expect(shouldProjectTaskTool('UnknownNonInspectionTool')).toBe(true);
  });
});
