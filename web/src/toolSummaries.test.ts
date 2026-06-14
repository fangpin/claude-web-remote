import { describe, expect, it } from 'vitest';
import { summarizeToolInput, transcriptToolSummaryLabel } from './toolSummaries';

describe('toolSummaries', () => {
  it('summarizes representative tool inputs', () => {
    expect(summarizeToolInput('Read', { file_path: '/repo/web/src/App.tsx', offset: 10, limit: 20 })).toBe('/repo/web/src/App.tsx (offset 10, limit 20)');
    expect(summarizeToolInput('Bash', { command: 'npm --prefix web test', description: 'Run frontend tests' })).toBe('Run frontend tests · $ npm --prefix web test');
    expect(summarizeToolInput('Edit', { file_path: 'web/src/App.tsx', old_string: 'old', new_string: 'new' })).toBe('web/src/App.tsx · replace "old" -> "new"');
  });

  it('creates compact transcript labels from tool category and status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'completed', inputSummary: '/repo/a.ts', resultSummary: 'hidden' })).toBe('Read /repo/a.ts');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Edit', status: 'completed', inputSummary: 'web/src/App.tsx · replace "old" -> "new"', resultSummary: 'updated' })).toBe('Edited web/src/App.tsx');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'completed', inputSummary: 'Run tests · $ npm test', resultSummary: 'passed' })).toBe('Ran npm test');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'failed', inputSummary: '$ npm test', resultSummary: 'Command failed' })).toBe('Failed npm test');
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'completed', summary: 'Completed.' })).toBe('Explore rendering');
  });
});
