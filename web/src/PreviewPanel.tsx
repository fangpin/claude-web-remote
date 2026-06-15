import { useEffect, useMemo, useState } from 'react';
import { getWorktreeDiff } from './api';
import { extractPreviewFileReferences } from './previewReferences';
import type { PreviewFileReference, SessionInfo, UiEvent, WorktreeDiff } from './types';

type Props = {
  activeSession: SessionInfo | null;
  events: UiEvent[];
  selectedPath: string | null;
  loadWorktreeDiff?: (sessionId: string) => Promise<WorktreeDiff>;
};

type DiffState =
  | { status: 'idle'; diff: null; error: null }
  | { status: 'loading'; diff: null; error: null }
  | { status: 'loaded'; diff: WorktreeDiff; error: null }
  | { status: 'error'; diff: null; error: string };

export default function PreviewPanel({
  activeSession,
  events,
  selectedPath,
  loadWorktreeDiff = getWorktreeDiff
}: Props) {
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<DiffState>({ status: 'idle', diff: null, error: null });

  const references = useMemo(() => extractPreviewFileReferences(events), [events]);
  const referenceMap = useMemo(() => groupReferencesByPath(references, activeSession), [activeSession, references]);
  const diffFiles = diffState.status === 'loaded' ? diffState.diff.files : [];
  const diffFilesByPath = useMemo(() => new Map(diffFiles.map((file) => [file.path, file])), [diffFiles]);

  const paths = useMemo(() => {
    const merged = new Set<string>();

    for (const file of diffFiles) {
      merged.add(file.path);
    }
    for (const reference of references) {
      merged.add(relativePreviewPath(reference.path, activeSession));
    }

    return [...merged];
  }, [activeSession, diffFiles, references]);

  const activePathCandidate = selectedPath ?? localSelectedPath ?? paths[0] ?? null;
  const activePath = activePathCandidate && paths.includes(activePathCandidate) ? activePathCandidate : paths[0] ?? null;
  const activeReferences = activePath ? referenceMap.get(activePath) ?? [] : [];
  const activeDiffFile = activePath ? diffFilesByPath.get(activePath) ?? null : null;
  const activeDiffText = activePath && diffState.status === 'loaded' ? diffForPath(diffState.diff.diff, activePath) : null;
  const isWorktree = Boolean(activeSession?.worktree);

  useEffect(() => {
    setLocalSelectedPath(null);
  }, [activeSession?.id, selectedPath]);

  useEffect(() => {
    if (!isWorktree || !activeSession) {
      setDiffState({ status: 'idle', diff: null, error: null });
      return;
    }

    let cancelled = false;
    setDiffState({ status: 'loading', diff: null, error: null });

    loadWorktreeDiff(activeSession.id)
      .then((diff) => {
        if (cancelled) return;
        setDiffState({ status: 'loaded', diff, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDiffState({ status: 'error', diff: null, error: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession, isWorktree, loadWorktreeDiff]);

  if (!activeSession) {
    return <div className="preview-panel preview-empty">No session selected.</div>;
  }

  return (
    <div className="preview-panel">
      <div className="preview-panel-heading">
        <div>
          <h3>Preview</h3>
          <p>Inspect worktree changes alongside transcript file references.</p>
        </div>
      </div>

      {!isWorktree ? <p className="preview-empty">Preview is available for worktree sessions.</p> : null}
      {isWorktree && diffState.status === 'loading' ? <p className="preview-empty">Loading diff...</p> : null}
      {isWorktree && diffState.status === 'error' ? <p className="preview-error">Unable to load worktree diff: {diffState.error}</p> : null}
      {isWorktree && diffState.status === 'loaded' && diffState.diff.truncated ? (
        <p className="preview-warning">Diff truncated at {diffState.diff.limitBytes} bytes.</p>
      ) : null}
      {isWorktree && diffState.status === 'loaded' && diffState.diff.files.length === 0 && references.length === 0 ? (
        <p className="preview-empty">No worktree changes yet.</p>
      ) : null}

      {paths.length > 0 ? (
        <div className="preview-layout">
          <div className="preview-file-list" role="list" aria-label="Preview files">
            {paths.map((path) => {
              const file = diffFilesByPath.get(path);
              return (
                <button
                  key={path}
                  type="button"
                  aria-pressed={path === activePath}
                  onClick={() => setLocalSelectedPath(path)}
                >
                  <span>{path}</span>
                  {file ? <span className="preview-file-stats">{formatDiffStats(file.additions, file.deletions)}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="preview-detail" aria-label="Preview details">
            {activePath ? <h4>{activePath}</h4> : null}
            {activeDiffFile && activeDiffText ? (
              <section>
                <h5>Worktree diff</h5>
                <pre>{activeDiffText}</pre>
              </section>
            ) : null}
            {activeReferences.length > 0 ? (
              <section>
                <h5>Transcript snippets</h5>
                <div className="preview-snippet-list">
                  {activeReferences.map((reference) => (
                    <article className="preview-snippet-card" key={`${reference.kind}-${reference.path}-${reference.eventId}`}>
                      <strong>{reference.title}</strong>
                      {reference.snippet ? <pre>{reference.snippet}</pre> : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            {!activeDiffText && activeReferences.length === 0 ? <p className="preview-empty">No preview details for this file.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupReferencesByPath(
  references: PreviewFileReference[],
  activeSession?: SessionInfo | null
): Map<string, PreviewFileReference[]> {
  const grouped = new Map<string, PreviewFileReference[]>();

  for (const reference of references) {
    const path = relativePreviewPath(reference.path, activeSession);
    const items = grouped.get(path) ?? [];
    items.push(reference);
    grouped.set(path, items);
  }

  return grouped;
}

function relativePreviewPath(path: string, activeSession?: SessionInfo | null): string {
  const source = activeSession?.worktree?.sourceCwd;
  const cwd = activeSession?.cwd;
  const prefixes = [source, cwd].filter((value): value is string => Boolean(value));

  for (const prefix of prefixes) {
    if (path === prefix) return '';
    if (path.startsWith(`${prefix}/`)) {
      return path.slice(prefix.length + 1);
    }
  }

  return path.startsWith('/') ? path.split('/').filter(Boolean).slice(-3).join('/') : path;
}

function formatDiffStats(additions?: number | null, deletions?: number | null): string {
  const plus = additions ?? 0;
  const minus = deletions ?? 0;
  return `+${plus} -${minus}`;
}

function diffForPath(diffText: string, path: string): string | null {
  const sections = splitDiffSections(diffText);
  const section = sections.find((item) => item.path === path);
  return section?.text ?? null;
}

function splitDiffSections(diffText: string): Array<{ path: string; text: string }> {
  if (!diffText.trim()) return [];

  const lines = diffText.split('\n');
  const sections: Array<{ path: string; text: string }> = [];
  let currentPath: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentPath || buffer.length === 0) return;
    sections.push({ path: currentPath, text: buffer.join('\n') });
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      currentPath = parseDiffPath(line);
      buffer = [line];
      continue;
    }

    if (currentPath) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function parseDiffPath(header: string): string {
  const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!match) return header;
  return match[2];
}
