import { describe, expect, it } from 'vitest';
import { summarizeToolInput, transcriptToolSummaryLabel } from './toolSummaries';

describe('toolSummaries', () => {
  it('summarizes representative tool inputs', () => {
    expect(summarizeToolInput('Read', { file_path: '/repo/web/src/App.tsx', offset: 10, limit: 20 })).toBe('/repo/web/src/App.tsx (offset 10, limit 20)');
    expect(summarizeToolInput('Bash', { command: 'npm --prefix web test', description: 'Run frontend tests' })).toBe('Run frontend tests · $ npm --prefix web test');
    expect(summarizeToolInput('Edit', { file_path: 'web/src/App.tsx', old_string: 'old', new_string: 'new' })).toBe('web/src/App.tsx · replace "old" -> "new"');
  });

  it('creates compact transcript labels from task status', () => {
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'pending', summary: '' })).toBe('Explore rendering');
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'running', summary: '' })).toBe('Explore rendering');
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'completed', summary: 'Completed.' })).toBe('Explore rendering');
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'failed', summary: 'Failed.' })).toBe('Failed Explore rendering');
  });

  it('creates compact transcript labels from read tool status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'completed', inputSummary: '/repo/a.ts', resultSummary: 'hidden' })).toBe('Read /repo/a.ts');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'running', inputSummary: '', resultSummary: '' })).toBe('Read file');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'failed', inputSummary: '/repo/a.ts', resultSummary: 'missing' })).toBe('Failed reading /repo/a.ts');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'failed', inputSummary: '', resultSummary: 'missing' })).toBe('Failed reading file');
  });

  it('creates compact transcript labels from edit-like tool status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Edit', status: 'completed', inputSummary: 'web/src/App.tsx · replace "old" -> "new"', resultSummary: 'updated' })).toBe('Edited web/src/App.tsx');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'MultiEdit', status: 'running', inputSummary: '', resultSummary: '' })).toBe('Edited file');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Write', status: 'failed', inputSummary: 'web/src/App.tsx · write 1 line, 12 chars', resultSummary: 'denied' })).toBe('Failed editing web/src/App.tsx');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'NotebookEdit', status: 'failed', inputSummary: '', resultSummary: 'denied' })).toBe('Failed editing file');
  });

  it('creates compact transcript labels from bash command status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'completed', inputSummary: 'Run tests · $ npm --prefix web test', resultSummary: 'passed' })).toBe('Ran npm test');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'failed', inputSummary: '$ cargo test --manifest-path Cargo.toml', resultSummary: 'Command failed' })).toBe('Failed cargo test --manifest-path Cargo.toml');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'running', inputSummary: 'description only', resultSummary: '' })).toBe('Ran command');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'failed', inputSummary: '', resultSummary: 'Command failed' })).toBe('Failed command');
  });

  it('creates compact transcript labels from search, review, and generic tool status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Glob', status: 'completed', inputSummary: '**/*.ts', resultSummary: 'found' })).toBe('Searched files');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Glob', status: 'failed', inputSummary: '**/*.ts', resultSummary: 'denied' })).toBe('Failed file search');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Grep', status: 'completed', inputSummary: 'needle', resultSummary: 'found' })).toBe('Searched text');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Grep', status: 'failed', inputSummary: 'needle', resultSummary: 'denied' })).toBe('Failed text search');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'code-review', status: 'completed', inputSummary: '', resultSummary: 'done' })).toBe('Reviewed changes');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'PermissionPrompt', status: 'failed', inputSummary: '', resultSummary: 'denied' })).toBe('Failed review');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'WebFetch', status: 'completed', inputSummary: 'https://example.com', resultSummary: 'done' })).toBe('WebFetch');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'WebFetch', status: 'failed', inputSummary: 'https://example.com', resultSummary: 'failed' })).toBe('Failed WebFetch');
  });
});
