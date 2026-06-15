import { describe, expect, it } from 'vitest';
import { extractPreviewFileReferences, type PreviewRawEventRef } from './previewReferences';
import type { PreviewFileReference } from './types';

describe('extractPreviewFileReferences', () => {
  it('extracts Read paths and merges snippets from matching tool results', () => {
    const events: PreviewRawEventRef[] = [
      {
        id: 10,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_read',
          name: 'Read',
          input: { file_path: 'web/src/App.tsx' }
        }
      },
      {
        id: 11,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_read',
          content: '1\timport App from ./App\n2\texport default App;'
        }
      }
    ];

    expect(extractPreviewFileReferences(events)).toEqual<PreviewFileReference[]>([
      {
        path: 'web/src/App.tsx',
        kind: 'read',
        eventId: 10,
        title: 'Read web/src/App.tsx',
        snippet: '1\timport App from ./App\n2\texport default App;'
      }
    ]);
  });

  it('extracts Edit, MultiEdit, and Write snippets from tool input', () => {
    const events: PreviewRawEventRef[] = [
      {
        id: 20,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_edit',
          name: 'Edit',
          input: {
            file_path: 'web/src/Composer.tsx',
            old_string: 'old composer',
            new_string: 'new composer'
          }
        }
      },
      {
        id: 21,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_multi_edit',
          name: 'MultiEdit',
          input: {
            path: 'web/src/App.tsx',
            edits: [
              { old_string: 'old app', new_string: 'new app' },
              { old_string: 'ignored old', new_string: 'ignored new' }
            ]
          }
        }
      },
      {
        id: 22,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_write',
          name: 'Write',
          input: {
            file_path: 'web/src/previewReferences.ts',
            content: 'export function extractPreviewFileReferences() {}'
          }
        }
      }
    ];

    expect(extractPreviewFileReferences(events)).toEqual<PreviewFileReference[]>([
      {
        path: 'web/src/Composer.tsx',
        kind: 'edited',
        eventId: 20,
        title: 'Edit web/src/Composer.tsx',
        snippet: 'old composer\n---\nnew composer'
      },
      {
        path: 'web/src/App.tsx',
        kind: 'edited',
        eventId: 21,
        title: 'MultiEdit web/src/App.tsx',
        snippet: 'old app\n---\nnew app'
      },
      {
        path: 'web/src/previewReferences.ts',
        kind: 'written',
        eventId: 22,
        title: 'Write web/src/previewReferences.ts',
        snippet: 'export function extractPreviewFileReferences() {}'
      }
    ]);
  });

  it('extracts Grep and Glob result paths as searched references', () => {
    const events: PreviewRawEventRef[] = [
      {
        id: 30,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_grep',
          name: 'Grep',
          input: { pattern: 'Preview' }
        }
      },
      {
        id: 31,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_grep',
          content: 'web/src/App.tsx:12:Preview\nweb/src/PreviewPanel.tsx:4:PreviewPanel'
        }
      },
      {
        id: 32,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_glob',
          name: 'Glob',
          input: { pattern: 'web/src/*.tsx' }
        }
      },
      {
        id: 33,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_glob',
          content: 'web/src/InspectorPanel.tsx\nweb/src/PreviewPanel.tsx'
        }
      }
    ];

    expect(extractPreviewFileReferences(events)).toEqual<PreviewFileReference[]>([
      {
        path: 'web/src/App.tsx',
        kind: 'searched',
        eventId: 30,
        title: 'Grep web/src/App.tsx'
      },
      {
        path: 'web/src/PreviewPanel.tsx',
        kind: 'searched',
        eventId: 30,
        title: 'Grep web/src/PreviewPanel.tsx'
      },
      {
        path: 'web/src/InspectorPanel.tsx',
        kind: 'searched',
        eventId: 32,
        title: 'Glob web/src/InspectorPanel.tsx'
      }
    ]);
  });

  it('extracts streamed Read tool input JSON and merges the matching result snippet', () => {
    const events: PreviewRawEventRef[] = [
      {
        id: 50,
        kind: 'assistant',
        payload: {
          type: 'message_start',
          message: { id: 'msg_streamed_read', role: 'assistant', content: [] }
        }
      },
      {
        id: 51,
        kind: 'assistant',
        payload: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_streamed_read', name: 'Read', input: {} }
        }
      },
      {
        id: 52,
        kind: 'assistant',
        payload: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"file_path":"web/src/previewReferences.ts"' }
        }
      },
      {
        id: 53,
        kind: 'assistant',
        payload: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '}' }
        }
      },
      {
        id: 54,
        kind: 'assistant',
        payload: { type: 'content_block_stop', index: 0 }
      },
      {
        id: 55,
        kind: 'assistant',
        payload: { type: 'message_stop' }
      },
      {
        id: 56,
        kind: 'user',
        payload: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_streamed_read',
                content: '1\tconst streamed = true;'
              }
            ]
          }
        }
      }
    ];

    expect(extractPreviewFileReferences(events)).toEqual<PreviewFileReference[]>([
      {
        path: 'web/src/previewReferences.ts',
        kind: 'read',
        eventId: 51,
        title: 'Read web/src/previewReferences.ts',
        snippet: '1\tconst streamed = true;'
      }
    ]);
  });

  it('truncates long snippets without splitting astral-plane characters', () => {
    const content = `${'a'.repeat(1999)}💡${'b'.repeat(20)}`;
    const events: PreviewRawEventRef[] = [
      {
        id: 60,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_long_read',
          name: 'Read',
          input: { file_path: 'web/src/long.ts' }
        }
      },
      {
        id: 61,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_long_read',
          content
        }
      }
    ];

    const [reference] = extractPreviewFileReferences(events);

    expect(reference.snippet?.endsWith('…')).toBe(true);
    expect(reference.snippet?.length).toBeLessThanOrEqual(2001);
    expect(reference.snippet).not.toContain('�');
    expect(reference.snippet).not.toContain('\ud83d');
    expect(reference.snippet).not.toContain('\udca1');
  });

  it('deduplicates by path and kind while preserving the earliest event id', () => {
    const events: PreviewRawEventRef[] = [
      {
        id: 41,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_late_read',
          name: 'Read',
          input: { file_path: 'web/src/App.tsx' }
        }
      },
      {
        id: 42,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_early_read',
          name: 'Read',
          input: { file_path: 'web/src/App.tsx' }
        }
      },
      {
        id: 43,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_early_read',
          content: 'newer duplicate snippet'
        }
      },
      {
        id: 44,
        kind: 'tool',
        payload: {
          type: 'tool_use',
          id: 'toolu_edit_same_path',
          name: 'Edit',
          input: {
            file_path: 'web/src/App.tsx',
            old_string: 'before',
            new_string: 'after'
          }
        }
      },
      {
        id: 45,
        kind: 'tool',
        payload: {
          type: 'tool_result',
          tool_use_id: 'toolu_late_read',
          content: 'earliest read snippet'
        }
      }
    ];

    expect(extractPreviewFileReferences(events)).toEqual<PreviewFileReference[]>([
      {
        path: 'web/src/App.tsx',
        kind: 'read',
        eventId: 41,
        title: 'Read web/src/App.tsx',
        snippet: 'earliest read snippet'
      },
      {
        path: 'web/src/App.tsx',
        kind: 'edited',
        eventId: 44,
        title: 'Edit web/src/App.tsx',
        snippet: 'before\n---\nafter'
      }
    ]);
  });
});
