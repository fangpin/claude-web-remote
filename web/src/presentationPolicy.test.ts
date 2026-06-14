import { describe, expect, it } from 'vitest';
import {
  rawEventPresentation,
  taskToolPresentation,
  shouldProjectTaskTool,
  toolActivityPresentation,
  toolPresentation,
  toolResultSemantics
} from './presentationPolicy';

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

  it('classifies result semantics without changing visibility policy', () => {
    expect(toolResultSemantics('Bash', 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new')).toEqual({
      kind: 'diff',
      language: 'diff'
    });
    expect(toolResultSemantics('Read', 'const value: string = "ok";', '/repo/web/src/App.tsx')).toEqual({
      kind: 'code',
      language: 'tsx'
    });
    expect(toolResultSemantics('Bash', 'web/src/App.tsx\nweb/src/main.tsx')).toEqual({ kind: 'paths' });
    expect(toolResultSemantics('Read', 'Error: missing file', '/repo/web/src/App.tsx')).toEqual({ kind: 'text' });
  });

  it('hides successful raw metadata and stream-json user wrappers', () => {
    expect(rawEventPresentation('raw', { type: 'result', subtype: 'success' })).toMatchObject({ visibility: 'anchor' });
    expect(rawEventPresentation('user', { type: 'user', message: { content: [{ type: 'text', text: 'internal' }] } })).toMatchObject({ visibility: 'anchor' });
  });

  it('keeps permission and unknown raw events visible', () => {
    expect(rawEventPresentation('raw', { type: 'permission_request', status: 'waiting', prompt: 'Allow command?' })).toMatchObject({
      visibility: 'visible',
      severity: 'permission'
    });
    expect(rawEventPresentation('raw', { type: 'future_event', subtype: 'delta_chunk' })).toMatchObject({
      visibility: 'visible',
      severity: 'warning',
      label: 'Unknown event'
    });
  });

  it('hides routine raw/system events in chat mode and exposes them in debug mode', () => {
    expect(rawEventPresentation('system', { message: 'session detail' }, 'chat')).toMatchObject({
      visibility: 'hidden',
      severity: 'info'
    });
    expect(rawEventPresentation('system', { message: 'session detail' }, 'debug')).toMatchObject({
      visibility: 'visible',
      severity: 'info',
      label: 'System event'
    });
    expect(rawEventPresentation('raw', { type: 'result', subtype: 'success' }, 'chat')).toMatchObject({
      visibility: 'anchor',
      severity: 'info'
    });
    expect(rawEventPresentation('raw', { type: 'result', subtype: 'success' }, 'debug')).toMatchObject({
      visibility: 'visible',
      severity: 'info',
      label: 'Raw event'
    });
  });

  it('keeps permission and error raw events visible in chat mode', () => {
    expect(rawEventPresentation('raw', { type: 'permission_request', prompt: 'Allow command?' }, 'chat')).toMatchObject({
      visibility: 'visible',
      severity: 'permission',
      label: 'Permission event'
    });
    expect(rawEventPresentation('raw', { type: 'result', subtype: 'error', error: 'command failed' }, 'chat')).toMatchObject({
      visibility: 'visible',
      severity: 'error',
      label: 'Error event'
    });
  });

  it('keeps failed tool details expanded in chat and debug modes', () => {
    expect(toolPresentation('Bash', 'failed', 'Command failed with exit code 1', 'chat')).toEqual({
      visibility: 'visible',
      detail: 'expanded'
    });
    expect(toolPresentation('Bash', 'failed', 'Command failed with exit code 1', 'debug')).toEqual({
      visibility: 'visible',
      detail: 'expanded'
    });
  });

  it('anchors routine task-management tools and compacts meaningful task activity', () => {
    expect(taskToolPresentation('TaskList', 'completed', {}, '1 task')).toMatchObject({ visibility: 'anchor' });
    expect(taskToolPresentation('TaskGet', 'completed', {}, 'Task #1')).toMatchObject({ visibility: 'anchor' });
    expect(taskToolPresentation('TaskUpdate', 'completed', { status: 'completed' }, 'updated')).toMatchObject({ visibility: 'anchor' });
    expect(taskToolPresentation('TaskUpdate', 'failed', { status: 'completed' }, 'failed')).toMatchObject({ visibility: 'visible', detail: 'expanded' });
    expect(taskToolPresentation('TaskCreate', 'completed', { subject: 'Fix output rendering' }, 'Task #1 created')).toMatchObject({ visibility: 'compact' });
  });

  it('anchors low-value bash inspection and compacts important bash work', () => {
    expect(toolActivityPresentation('Bash', 'completed', { command: 'ls web/src' }, 'App.tsx')).toMatchObject({ visibility: 'anchor' });
    expect(toolActivityPresentation('Bash', 'completed', { command: 'npm --prefix web test' }, 'passed')).toMatchObject({ visibility: 'compact' });
    expect(toolActivityPresentation('Bash', 'failed', { command: 'ls web/src' }, 'failed')).toMatchObject({ visibility: 'visible', detail: 'expanded' });
  });
});
