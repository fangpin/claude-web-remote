# Preview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Inspector Preview tab that shows worktree diffs for worktree sessions and transcript-derived file snippets, with Open in Preview actions from conversation cards.

**Architecture:** Keep filesystem access narrow by extending the existing worktree-only diff endpoint and deriving snippets entirely from persisted transcript events on the frontend. Add a focused `PreviewPanel` under `InspectorPanel`, backed by a small transcript reference helper and App-level state for the selected preview path.

**Tech Stack:** Rust/Axum/Tokio backend, React/Vite/TypeScript frontend, Vitest + Testing Library, Cargo tests.

---

## File structure

- Modify `crates/server/src/worktree.rs`
  - Owns git worktree operations. Extend `WorktreeDiff` to include file metadata and truncation fields, add diff size limiting, and parse `git diff --numstat` / `git diff --name-status` output.
- Modify `crates/server/src/session.rs`
  - Keeps worktree-only gating through `SessionManager::worktree_diff`; no arbitrary path reads.
- Modify `crates/server/src/api.rs`
  - Route already exists; add/adjust route-level tests for the richer response shape.
- Modify `web/src/types.ts`
  - Extend `WorktreeDiff` and add preview-related frontend types.
- Modify `web/src/api.ts`
  - Keep `getWorktreeDiff`, now returning the richer `WorktreeDiff` type.
- Create `web/src/previewReferences.ts`
  - Extracts file references and snippets from `UiEvent` / raw event references without reading files.
- Create `web/src/previewReferences.test.ts`
  - Unit tests for Read/Edit/MultiEdit/Write/Grep/Glob extraction.
- Create `web/src/PreviewPanel.tsx`
  - Renders worktree diff states, changed file list, transcript reference list, selected file diff/snippets.
- Create `web/src/PreviewPanel.test.tsx`
  - Component tests for non-worktree, loading/error/empty/truncated, file selection, and snippet display.
- Modify `web/src/InspectorPanel.tsx`
  - Add `preview` tab after Activity and render `PreviewPanel`.
- Modify `web/src/App.tsx`
  - Add selected preview target state, keyboard tab order, and `openPreviewPath` handler.
- Modify `web/src/ConversationWorkspace.tsx`
  - Pass `onOpenPreviewPath` through to the conversation list.
- Modify `web/src/ConversationBlockList.tsx`
  - Add Open in Preview buttons for tool/task cards whose raw events contain file paths.
- Modify `web/src/ConversationBlockList.test.tsx`
  - Cover Open in Preview button rendering and callback behavior.
- Modify `web/src/App.test.tsx`
  - Cover Preview tab order, fetching worktree diff, non-worktree empty state, and Open in Preview integration.
- Modify `web/src/App.css`
  - Add Preview tab/panel styles and update tab grid from five to six columns.
- Review `README.md` and `CLAUDE.md`
  - Update only if implementation changes user-visible workflows or instructions beyond the already-documented endpoint.

---

### Task 1: Backend worktree diff response model

**Files:**
- Modify: `crates/server/src/worktree.rs:42-126`
- Test: `crates/server/src/worktree.rs:267-556`

- [ ] **Step 1: Write failing worktree diff tests**

Add these tests inside `#[cfg(test)] mod tests` in `crates/server/src/worktree.rs` after `reports_dirty_worktree_status_files`:

```rust
#[tokio::test]
async fn reports_worktree_diff_with_file_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let manager = WorktreeManager::new(WorktreeConfig {
        worktrees_dir: None,
        branch_prefix: "pin".to_string(),
        base_ref: WorktreeBaseRef::Head,
    });
    let meta = manager.create(&repo).await.unwrap();
    fs::write(meta.worktree_cwd.join("README.md"), "hello\nchanged\n").unwrap();

    let diff = manager.diff(&meta).await.unwrap();

    assert!(diff.diff.contains("diff --git a/README.md b/README.md"));
    assert!(diff.diff.contains("+changed"));
    assert_eq!(diff.files.len(), 1);
    assert_eq!(diff.files[0].path, "README.md");
    assert_eq!(diff.files[0].status, "modified");
    assert_eq!(diff.files[0].additions, Some(1));
    assert_eq!(diff.files[0].deletions, Some(0));
    assert!(!diff.truncated);
    assert_eq!(diff.limit_bytes, WORKTREE_DIFF_LIMIT_BYTES);
}

#[tokio::test]
async fn reports_clean_worktree_diff() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let manager = WorktreeManager::new(WorktreeConfig {
        worktrees_dir: None,
        branch_prefix: "pin".to_string(),
        base_ref: WorktreeBaseRef::Head,
    });
    let meta = manager.create(&repo).await.unwrap();

    let diff = manager.diff(&meta).await.unwrap();

    assert_eq!(diff.diff, "");
    assert!(diff.files.is_empty());
    assert!(!diff.truncated);
}

#[test]
fn truncates_diff_on_utf8_boundary() {
    let source = format!("{}é", "a".repeat(WORKTREE_DIFF_LIMIT_BYTES));

    let (truncated, did_truncate) = truncate_diff(source.clone());

    assert!(did_truncate);
    assert!(truncated.len() <= WORKTREE_DIFF_LIMIT_BYTES);
    assert!(source.starts_with(&truncated));
}

#[test]
fn parses_diff_file_metadata() {
    let numstat = "12\t4\tweb/src/App.tsx\n-\t-\tassets/logo.png";
    let name_status = "M\tweb/src/App.tsx\nA\tassets/logo.png";

    let files = parse_diff_files(numstat, name_status);

    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "web/src/App.tsx");
    assert_eq!(files[0].status, "modified");
    assert_eq!(files[0].additions, Some(12));
    assert_eq!(files[0].deletions, Some(4));
    assert_eq!(files[1].path, "assets/logo.png");
    assert_eq!(files[1].status, "added");
    assert_eq!(files[1].additions, None);
    assert_eq!(files[1].deletions, None);
}
```

- [ ] **Step 2: Run the focused backend test and confirm it fails**

Run:

```bash
cargo test --manifest-path Cargo.toml worktree::tests::reports_worktree_diff_with_file_metadata
```

Expected: fail to compile because `WorktreeDiff` lacks `files`, `truncated`, `limit_bytes`, `WorktreeDiffFile`, `WORKTREE_DIFF_LIMIT_BYTES`, `truncate_diff`, and `parse_diff_files`.

- [ ] **Step 3: Extend the worktree diff model and implementation**

In `crates/server/src/worktree.rs`, replace the existing `WorktreeDiff` definition with:

```rust
pub const WORKTREE_DIFF_LIMIT_BYTES: usize = 200_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiff {
    pub diff: String,
    pub files: Vec<WorktreeDiffFile>,
    pub truncated: bool,
    pub limit_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiffFile {
    pub path: String,
    pub status: String,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}
```

Replace `WorktreeManager::diff` with:

```rust
pub async fn diff(&self, meta: &WorktreeMeta) -> AppResult<WorktreeDiff> {
    let base_ref = meta.base_ref.as_deref().unwrap_or("HEAD");
    let diff = run_git(
        &meta.worktree_cwd,
        ["diff", "--no-ext-diff", "--find-renames", base_ref, "--", "."],
    )
    .await?;
    let numstat = run_git(
        &meta.worktree_cwd,
        ["diff", "--numstat", "--find-renames", base_ref, "--", "."],
    )
    .await?;
    let name_status = run_git(
        &meta.worktree_cwd,
        ["diff", "--name-status", "--find-renames", base_ref, "--", "."],
    )
    .await?;
    let files = parse_diff_files(&numstat, &name_status);
    let (diff, truncated) = truncate_diff(diff);

    Ok(WorktreeDiff {
        diff,
        files,
        truncated,
        limit_bytes: WORKTREE_DIFF_LIMIT_BYTES,
    })
}
```

Add these helpers near `parse_short_status_line`:

```rust
fn truncate_diff(diff: String) -> (String, bool) {
    if diff.len() <= WORKTREE_DIFF_LIMIT_BYTES {
        return (diff, false);
    }

    let mut end = WORKTREE_DIFF_LIMIT_BYTES;
    while !diff.is_char_boundary(end) {
        end -= 1;
    }
    (diff[..end].to_string(), true)
}

fn parse_diff_files(numstat: &str, name_status: &str) -> Vec<WorktreeDiffFile> {
    let stats = parse_numstat(numstat);
    name_status
        .lines()
        .filter_map(|line| parse_name_status_line(line, &stats))
        .collect()
}

fn parse_numstat(numstat: &str) -> HashMap<String, (Option<usize>, Option<usize>)> {
    numstat
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let additions = parse_optional_count(parts.next()?);
            let deletions = parse_optional_count(parts.next()?);
            let path = parts.next()?.to_string();
            Some((path, (additions, deletions)))
        })
        .collect()
}

fn parse_optional_count(value: &str) -> Option<usize> {
    value.parse::<usize>().ok()
}

fn parse_name_status_line(
    line: &str,
    stats: &HashMap<String, (Option<usize>, Option<usize>)>,
) -> Option<WorktreeDiffFile> {
    let mut parts = line.split('\t');
    let status_code = parts.next()?;
    let first_path = parts.next()?;
    let path = if status_code.starts_with('R') || status_code.starts_with('C') {
        parts.next().unwrap_or(first_path)
    } else {
        first_path
    };
    let (additions, deletions) = stats.get(path).copied().unwrap_or((None, None));

    Some(WorktreeDiffFile {
        path: path.to_string(),
        status: diff_status_label(status_code),
        additions,
        deletions,
    })
}

fn diff_status_label(status_code: &str) -> String {
    match status_code.chars().next().unwrap_or('M') {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'T' => "type-changed",
        'U' => "unmerged",
        _ => "modified",
    }
    .to_string()
}
```

Add this import at the top of `crates/server/src/worktree.rs`:

```rust
collections::HashMap,
```

inside the existing `use std::{ ... }` block.

- [ ] **Step 4: Run focused backend tests and confirm they pass**

Run:

```bash
cargo test --manifest-path Cargo.toml worktree::tests::reports_worktree_diff_with_file_metadata worktree::tests::reports_clean_worktree_diff worktree::tests::truncates_diff_on_utf8_boundary worktree::tests::parses_diff_file_metadata
```

Expected: all four tests pass.

- [ ] **Step 5: Commit backend diff model**

Run:

```bash
git add crates/server/src/worktree.rs
git commit -m "$(cat <<'EOF'
Add structured worktree diff metadata
EOF
)"
```

---

### Task 2: Backend route/session coverage

**Files:**
- Modify: `crates/server/src/session.rs:343-350`
- Modify: `crates/server/src/api.rs:253-258,424-1150`

- [ ] **Step 1: Add session manager tests for worktree diff gating and metadata**

Add these tests in `crates/server/src/session.rs` after `reports_worktree_status_for_worktree_sessions`:

```rust
#[tokio::test]
async fn reports_worktree_diff_for_worktree_sessions() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    init_repo(&repo).await;
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store,
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        worktree_config(),
    );
    let created = manager
        .create_session(CreateSessionRequest {
            cwd: repo,
            name: None,
            permission_mode: None,
            worktree: Some(WorktreeRequest { enabled: true }),
        })
        .await
        .unwrap();
    let worktree_path = created.worktree.as_ref().unwrap().worktree_cwd.clone();
    fs::write(worktree_path.join("README.md"), "hello\nchanged\n").unwrap();

    let diff = manager.worktree_diff(created.id).await.unwrap();

    assert!(diff.diff.contains("diff --git a/README.md b/README.md"));
    assert_eq!(diff.files[0].path, "README.md");
    assert!(!diff.truncated);
    manager.stop_session(created.id).await.unwrap();
}

#[tokio::test]
async fn worktree_diff_rejects_non_worktree_sessions() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(
        store,
        vec![bin.to_string_lossy().to_string()],
        "acceptEdits".to_string(),
        worktree_config(),
    );
    let created = manager
        .create_session(CreateSessionRequest {
            cwd: temp.path().to_path_buf(),
            name: None,
            permission_mode: None,
            worktree: None,
        })
        .await
        .unwrap();

    let err = manager.worktree_diff(created.id).await.unwrap_err();

    assert!(err.to_string().contains("session has no worktree"));
    manager.stop_session(created.id).await.unwrap();
}
```

- [ ] **Step 2: Add API route test for `GET /worktree-diff` response shape**

Add this test in `crates/server/src/api.rs` near other route tests:

```rust
#[tokio::test]
async fn worktree_diff_route_returns_structured_diff() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    std::process::Command::new("git")
        .current_dir(&repo)
        .args(["init", "-b", "master"])
        .status()
        .unwrap();
    std::process::Command::new("git")
        .current_dir(&repo)
        .args(["config", "user.email", "test@example.com"])
        .status()
        .unwrap();
    std::process::Command::new("git")
        .current_dir(&repo)
        .args(["config", "user.name", "Test User"])
        .status()
        .unwrap();
    fs::write(repo.join("README.md"), "hello\n").unwrap();
    std::process::Command::new("git")
        .current_dir(&repo)
        .args(["add", "README.md"])
        .status()
        .unwrap();
    std::process::Command::new("git")
        .current_dir(&repo)
        .args(["commit", "-m", "initial"])
        .status()
        .unwrap();

    let state = test_state(&temp).await;
    let session = state
        .manager
        .create_session(CreateSessionRequest {
            cwd: repo,
            name: Some("diff route".to_string()),
            permission_mode: None,
            worktree: Some(crate::session::WorktreeRequest { enabled: true }),
        })
        .await
        .unwrap();
    fs::write(session.worktree.as_ref().unwrap().worktree_cwd.join("README.md"), "hello\nchanged\n").unwrap();
    let app = build_router(state, None);

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/sessions/{}/worktree-diff", session.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body["diff"].as_str().unwrap().contains("+changed"));
    assert_eq!(body["files"][0]["path"], "README.md");
    assert_eq!(body["files"][0]["status"], "modified");
    assert_eq!(body["truncated"], false);
    assert!(body["limitBytes"].as_u64().unwrap() > 0);
}
```

- [ ] **Step 3: Run the focused route/session tests**

Run:

```bash
cargo test --manifest-path Cargo.toml session::tests::reports_worktree_diff_for_worktree_sessions session::tests::worktree_diff_rejects_non_worktree_sessions api::tests::worktree_diff_route_returns_structured_diff
```

Expected: all tests pass after Task 1.

- [ ] **Step 4: Commit backend coverage**

Run:

```bash
git add crates/server/src/session.rs crates/server/src/api.rs
git commit -m "$(cat <<'EOF'
Cover worktree diff API behavior
EOF
)"
```

---

### Task 3: Frontend preview types and API contract

**Files:**
- Modify: `web/src/types.ts:29-31`
- Modify: `web/src/api.ts:129-135`

- [ ] **Step 1: Update frontend types**

Replace `WorktreeDiff` in `web/src/types.ts` with:

```ts
export type WorktreeDiffFile = {
  path: string;
  status: string;
  additions?: number | null;
  deletions?: number | null;
};

export type WorktreeDiff = {
  diff: string;
  files: WorktreeDiffFile[];
  truncated: boolean;
  limitBytes: number;
};

export type PreviewReferenceKind = 'read' | 'edited' | 'written' | 'searched' | 'mentioned';

export type PreviewFileReference = {
  path: string;
  kind: PreviewReferenceKind;
  eventId: number;
  title: string;
  snippet?: string;
};
```

No `api.ts` behavior change is needed because `getWorktreeDiff` already returns `WorktreeDiff`.

- [ ] **Step 2: Update test fetch fixtures that return worktree diff**

In `web/src/App.test.tsx`, replace the existing worktree diff mock response with:

```ts
return jsonResponse({
  diff: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n+changed',
  files: [{ path: 'web/src/App.tsx', status: 'modified', additions: 1, deletions: 0 }],
  truncated: false,
  limitBytes: 200000
});
```

- [ ] **Step 3: Run frontend typecheck through test compile**

Run:

```bash
npm --prefix web test -- --run App.test.tsx
```

Expected: existing App tests still pass or only fail because Preview UI is not wired yet in later tasks; there should be no TypeScript error for `WorktreeDiff`.

- [ ] **Step 4: Commit frontend contract update**

Run:

```bash
git add web/src/types.ts web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
Update frontend worktree diff contract
EOF
)"
```

---

### Task 4: Transcript preview reference extraction

**Files:**
- Create: `web/src/previewReferences.ts`
- Create: `web/src/previewReferences.test.ts`

- [ ] **Step 1: Write failing extraction tests**

Create `web/src/previewReferences.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { extractPreviewFileReferences } from './previewReferences';
import type { UiEvent } from './types';

function event(id: number, payload: unknown): UiEvent {
  return {
    id,
    sessionId: 's1',
    time: '2026-06-14T00:00:00Z',
    kind: 'tool',
    payload
  };
}

describe('extractPreviewFileReferences', () => {
  it('extracts Read paths and result snippets', () => {
    const refs = extractPreviewFileReferences([
      event(1, { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/repo/web/src/App.tsx' } }),
      event(2, { type: 'tool_result', tool_use_id: 'toolu_read', content: '1\tconst value = true;' })
    ]);

    expect(refs).toEqual([
      {
        path: '/repo/web/src/App.tsx',
        kind: 'read',
        eventId: 1,
        title: 'Read /repo/web/src/App.tsx',
        snippet: '1\tconst value = true;'
      }
    ]);
  });

  it('extracts Edit, MultiEdit, and Write snippets from tool input', () => {
    const refs = extractPreviewFileReferences([
      event(3, {
        type: 'tool_use',
        id: 'toolu_edit',
        name: 'Edit',
        input: { file_path: 'web/src/App.tsx', old_string: 'old()', new_string: 'new()' }
      }),
      event(4, {
        type: 'tool_use',
        id: 'toolu_multi',
        name: 'MultiEdit',
        input: { file_path: 'web/src/api.ts', edits: [{ old_string: 'a', new_string: 'b' }] }
      }),
      event(5, {
        type: 'tool_use',
        id: 'toolu_write',
        name: 'Write',
        input: { file_path: 'README.md', content: 'hello\nworld' }
      })
    ]);

    expect(refs.map((ref) => [ref.path, ref.kind, ref.snippet])).toEqual([
      ['web/src/App.tsx', 'edited', 'old()\n---\nnew()'],
      ['web/src/api.ts', 'edited', 'a\n---\nb'],
      ['README.md', 'written', 'hello\nworld']
    ]);
  });

  it('extracts Grep and Glob result paths as searched references', () => {
    const refs = extractPreviewFileReferences([
      event(6, { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'Preview' } }),
      event(7, { type: 'tool_result', tool_use_id: 'toolu_grep', content: 'web/src/App.tsx:12:Preview\nweb/src/PreviewPanel.tsx:1:export' }),
      event(8, { type: 'tool_use', id: 'toolu_glob', name: 'Glob', input: { pattern: '**/*.tsx' } }),
      event(9, { type: 'tool_result', tool_use_id: 'toolu_glob', content: 'web/src/App.tsx\nweb/src/InspectorPanel.tsx' })
    ]);

    expect(refs.map((ref) => [ref.path, ref.kind])).toEqual([
      ['web/src/App.tsx', 'searched'],
      ['web/src/PreviewPanel.tsx', 'searched'],
      ['web/src/InspectorPanel.tsx', 'searched']
    ]);
  });

  it('deduplicates by path and kind while preserving earliest event id', () => {
    const refs = extractPreviewFileReferences([
      event(10, { type: 'tool_use', id: 'toolu_read_1', name: 'Read', input: { file_path: 'web/src/App.tsx' } }),
      event(11, { type: 'tool_use', id: 'toolu_read_2', name: 'Read', input: { file_path: 'web/src/App.tsx' } })
    ]);

    expect(refs).toHaveLength(1);
    expect(refs[0].eventId).toBe(10);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm --prefix web test -- --run previewReferences.test.ts
```

Expected: fail because `web/src/previewReferences.ts` does not exist.

- [ ] **Step 3: Implement extraction helper**

Create `web/src/previewReferences.ts` with:

```ts
import type { EventKind, PreviewFileReference, PreviewReferenceKind, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;
type PreviewSourceEvent = Pick<UiEvent, 'id' | 'kind' | 'payload'>;

type ToolUse = {
  event: PreviewSourceEvent;
  id: string;
  name: string;
  input: unknown;
};

export type PreviewRawEventRef = {
  id: number;
  kind: EventKind;
  payload: unknown;
};

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

function toolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['id', 'tool_use_id', 'toolUseId']);
}

function toolResultUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['tool_use_id', 'toolUseId', 'id']);
}

function toolName(payload: ObjectPayload): string {
  return stringField(payload, ['name', 'tool_name', 'toolName']) ?? 'tool';
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => isObject(entry) ? stringField(entry, ['text', 'content']) : null)
      .filter((entry): entry is string => entry !== null)
      .join('\n');
  }
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function resultText(payload: ObjectPayload): string {
  return textFromContent(payload.result ?? payload.content ?? payload.output ?? payload.stdout ?? payload.stderr ?? payload.error ?? payload.message ?? '');
}

function truncateSnippet(text: string, maxLength = 2000): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function pathFromInput(input: unknown): string | null {
  if (!isObject(input)) return null;
  return stringField(input, ['file_path', 'filePath', 'path']);
}

function editSnippet(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  if (Array.isArray(input.edits)) {
    const firstEdit = input.edits.find(isObject);
    if (!firstEdit) return undefined;
    const oldString = stringField(firstEdit, ['old_string', 'oldString']) ?? '';
    const newString = stringField(firstEdit, ['new_string', 'newString']) ?? '';
    return truncateSnippet([oldString, '---', newString].join('\n'));
  }
  const oldString = stringField(input, ['old_string', 'oldString']) ?? '';
  const newString = stringField(input, ['new_string', 'newString']) ?? '';
  return truncateSnippet([oldString, '---', newString].join('\n'));
}

function writeSnippet(input: unknown): string | undefined {
  if (!isObject(input) || typeof input.content !== 'string') return undefined;
  return truncateSnippet(input.content);
}

function resultPaths(toolName: string, result: string): string[] {
  if (!['Grep', 'Glob'].includes(toolName)) return [];
  return result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^([^:]+):\d+:/)?.[1] ?? line)
    .filter((path) => /[/\\]/.test(path) || /\.[A-Za-z0-9]+$/.test(path));
}

function makeReference(path: string, kind: PreviewReferenceKind, eventId: number, snippet?: string): PreviewFileReference {
  const verb = kind === 'read' ? 'Read' : kind === 'edited' ? 'Edited' : kind === 'written' ? 'Wrote' : kind === 'searched' ? 'Matched' : 'Mentioned';
  return {
    path,
    kind,
    eventId,
    title: `${verb} ${path}`,
    ...(snippet ? { snippet } : {})
  };
}

function referencesFromToolUse(tool: ToolUse): PreviewFileReference[] {
  const path = pathFromInput(tool.input);
  if (!path) return [];
  if (tool.name === 'Read') return [makeReference(path, 'read', tool.event.id)];
  if (tool.name === 'Edit' || tool.name === 'MultiEdit') return [makeReference(path, 'edited', tool.event.id, editSnippet(tool.input))];
  if (tool.name === 'Write') return [makeReference(path, 'written', tool.event.id, writeSnippet(tool.input))];
  return [makeReference(path, 'mentioned', tool.event.id)];
}

function mergeResultSnippet(reference: PreviewFileReference, snippet: string): PreviewFileReference {
  if (reference.snippet || !snippet.trim()) return reference;
  return { ...reference, snippet: truncateSnippet(snippet) };
}

function dedupeReferences(references: PreviewFileReference[]): PreviewFileReference[] {
  const byKey = new Map<string, PreviewFileReference>();
  for (const reference of references) {
    const key = `${reference.kind}:${reference.path}`;
    if (!byKey.has(key)) byKey.set(key, reference);
  }
  return Array.from(byKey.values()).sort((a, b) => a.eventId - b.eventId || a.path.localeCompare(b.path));
}

export function extractPreviewFileReferences(events: PreviewSourceEvent[]): PreviewFileReference[] {
  const references: PreviewFileReference[] = [];
  const tools = new Map<string, ToolUse>();
  const referenceIndexesByToolId = new Map<string, number[]>();

  for (const event of events) {
    if (!isObject(event.payload)) continue;
    const payload = event.payload;
    const type = typeof payload.type === 'string' ? payload.type : event.kind;

    if (type === 'tool_use') {
      const id = toolUseId(payload) ?? String(event.id);
      const tool = { event, id, name: toolName(payload), input: payload.input };
      tools.set(id, tool);
      const nextReferences = referencesFromToolUse(tool);
      referenceIndexesByToolId.set(id, nextReferences.map((_, index) => references.length + index));
      references.push(...nextReferences);
      continue;
    }

    if (type === 'tool_result') {
      const id = toolResultUseId(payload);
      if (!id) continue;
      const tool = tools.get(id);
      const result = resultText(payload);
      if (!tool) continue;

      const existingIndexes = referenceIndexesByToolId.get(id) ?? [];
      for (const index of existingIndexes) {
        references[index] = mergeResultSnippet(references[index], result);
      }

      for (const path of resultPaths(tool.name, result)) {
        references.push(makeReference(path, 'searched', event.id));
      }
    }
  }

  return dedupeReferences(references);
}
```

- [ ] **Step 4: Run extraction tests**

Run:

```bash
npm --prefix web test -- --run previewReferences.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit extraction helper**

Run:

```bash
git add web/src/previewReferences.ts web/src/previewReferences.test.ts
git commit -m "$(cat <<'EOF'
Extract preview references from transcript events
EOF
)"
```

---

### Task 5: PreviewPanel component

**Files:**
- Create: `web/src/PreviewPanel.tsx`
- Create: `web/src/PreviewPanel.test.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: Write failing PreviewPanel tests**

Create `web/src/PreviewPanel.test.tsx` with:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PreviewPanel from './PreviewPanel';
import type { SessionInfo, UiEvent, WorktreeDiff } from './types';

const baseSession = {
  id: 's1',
  name: 'Preview session',
  cwd: '/repo/worktree',
  permissionMode: 'acceptEdits',
  status: 'running' as const,
  runtimeStatus: 'waiting' as const,
  claudeSessionId: null,
  groupId: null,
  deletedAt: null,
  createdAt: '2026-06-14T00:00:00Z',
  updatedAt: '2026-06-14T00:00:00Z'
};

const worktreeSession: SessionInfo = {
  ...baseSession,
  worktree: {
    sourceCwd: '/repo/source',
    worktreeCwd: '/repo/worktree',
    branch: 'pin/abc123',
    baseRef: 'HEAD',
    createdByClaudeRemoteWeb: true
  }
};

const diff: WorktreeDiff = {
  diff: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n@@ -1 +1 @@\n-old\n+new',
  files: [{ path: 'web/src/App.tsx', status: 'modified', additions: 1, deletions: 1 }],
  truncated: false,
  limitBytes: 200000
};

function event(id: number, payload: unknown): UiEvent {
  return { id, sessionId: 's1', time: '2026-06-14T00:00:00Z', kind: 'tool', payload };
}

describe('PreviewPanel', () => {
  it('shows non-worktree empty state and transcript snippets', async () => {
    render(
      <PreviewPanel
        activeSession={{ ...baseSession, worktree: null }}
        events={[
          event(1, { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'web/src/App.tsx' } }),
          event(2, { type: 'tool_result', tool_use_id: 'toolu_read', content: 'const app = true;' })
        ]}
        selectedPath={null}
        loadWorktreeDiff={vi.fn()}
      />
    );

    expect(screen.getByText('Preview is available for worktree sessions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /web\/src\/App\.tsx/ })).toBeInTheDocument();
    expect(screen.getByText('const app = true;')).toBeInTheDocument();
  });

  it('loads and renders worktree diff files', async () => {
    const loadWorktreeDiff = vi.fn().mockResolvedValue(diff);
    render(<PreviewPanel activeSession={worktreeSession} events={[]} selectedPath={null} loadWorktreeDiff={loadWorktreeDiff} />);

    expect(screen.getByText('Loading diff...')).toBeInTheDocument();
    expect(await screen.findByText('Worktree diff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /web\/src\/App\.tsx/ })).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getByText(/diff --git a\/web\/src\/App\.tsx/)).toBeInTheDocument();
  });

  it('shows empty, truncated, and error states', async () => {
    const emptyDiff: WorktreeDiff = { diff: '', files: [], truncated: false, limitBytes: 200000 };
    const { rerender } = render(<PreviewPanel activeSession={worktreeSession} events={[]} selectedPath={null} loadWorktreeDiff={vi.fn().mockResolvedValue(emptyDiff)} />);

    expect(await screen.findByText('No worktree changes yet.')).toBeInTheDocument();

    rerender(<PreviewPanel activeSession={worktreeSession} events={[]} selectedPath={null} loadWorktreeDiff={vi.fn().mockResolvedValue({ ...diff, truncated: true })} />);
    expect(await screen.findByText(/Diff truncated at 200000 bytes/)).toBeInTheDocument();

    rerender(<PreviewPanel activeSession={worktreeSession} events={[]} selectedPath={null} loadWorktreeDiff={vi.fn().mockRejectedValue(new Error('git failed'))} />);
    expect(await screen.findByText('Unable to load worktree diff: git failed')).toBeInTheDocument();
  });

  it('selects requested path and falls back to transcript snippet', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        activeSession={worktreeSession}
        events={[
          event(1, { type: 'tool_use', id: 'toolu_write', name: 'Write', input: { file_path: 'README.md', content: 'hello preview' } })
        ]}
        selectedPath="README.md"
        loadWorktreeDiff={vi.fn().mockResolvedValue(diff)}
      />
    );

    expect(await screen.findByRole('button', { name: /README\.md/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('hello preview')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /web\/src\/App\.tsx/ }));
    const selected = screen.getByRole('button', { name: /web\/src\/App\.tsx/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByLabelText('Preview detail')).getByText(/diff --git/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing component tests**

Run:

```bash
npm --prefix web test -- --run PreviewPanel.test.tsx
```

Expected: fail because `PreviewPanel.tsx` does not exist.

- [ ] **Step 3: Implement PreviewPanel**

Create `web/src/PreviewPanel.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { getWorktreeDiff } from './api';
import { extractPreviewFileReferences } from './previewReferences';
import type { PreviewFileReference, SessionInfo, UiEvent, WorktreeDiff, WorktreeDiffFile } from './types';

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

function diffForPath(diff: string, path: string): string | null {
  if (!diff.trim()) return null;
  const lines = diff.split('\n');
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) chunks.push(current);
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.find((chunk) => chunk[0].includes(` b/${path}`) || chunk[0].endsWith(` ${path}`))?.join('\n') ?? null;
}

function fileLabel(file: WorktreeDiffFile): string {
  const stats = [file.additions !== null && file.additions !== undefined ? `+${file.additions}` : null, file.deletions !== null && file.deletions !== undefined ? `-${file.deletions}` : null]
    .filter((item): item is string => item !== null)
    .join(' ');
  return stats ? `${file.path} ${stats}` : file.path;
}

function referencesForPath(references: PreviewFileReference[], path: string): PreviewFileReference[] {
  return references.filter((reference) => reference.path === path);
}

function uniquePaths(diff: WorktreeDiff | null, references: PreviewFileReference[]): string[] {
  const paths = new Set<string>();
  diff?.files.forEach((file) => paths.add(file.path));
  references.forEach((reference) => paths.add(reference.path));
  return Array.from(paths);
}

export default function PreviewPanel({ activeSession, events, selectedPath, loadWorktreeDiff = getWorktreeDiff }: Props) {
  const [diffState, setDiffState] = useState<DiffState>({ status: 'idle', diff: null, error: null });
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(selectedPath);
  const references = useMemo(() => extractPreviewFileReferences(events), [events]);
  const diff = diffState.status === 'loaded' ? diffState.diff : null;
  const paths = useMemo(() => uniquePaths(diff, references), [diff, references]);
  const activePath = selectedPath ?? localSelectedPath ?? paths[0] ?? null;
  const activeDiff = activePath && diff ? diffForPath(diff.diff, activePath) : null;
  const activeReferences = activePath ? referencesForPath(references, activePath) : [];

  useEffect(() => {
    setLocalSelectedPath(selectedPath);
  }, [selectedPath]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSession?.worktree) {
      setDiffState({ status: 'idle', diff: null, error: null });
      return;
    }
    setDiffState({ status: 'loading', diff: null, error: null });
    loadWorktreeDiff(activeSession.id)
      .then((worktreeDiff) => {
        if (!cancelled) setDiffState({ status: 'loaded', diff: worktreeDiff, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setDiffState({ status: 'error', diff: null, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.worktree, loadWorktreeDiff]);

  if (!activeSession) {
    return <p className="inspector-empty">No session selected.</p>;
  }

  return (
    <section className="preview-panel" aria-label="Preview panel">
      <div className="preview-panel-heading">
        <h3>Preview</h3>
        <p>Worktree diff plus transcript snippets from Claude tool activity.</p>
      </div>

      {!activeSession.worktree && <p className="preview-empty">Preview is available for worktree sessions.</p>}
      {diffState.status === 'loading' && <p className="preview-empty">Loading diff...</p>}
      {diffState.status === 'error' && <p className="preview-error">Unable to load worktree diff: {diffState.error}</p>}
      {diff && diff.diff.trim() === '' && <p className="preview-empty">No worktree changes yet.</p>}
      {diff?.truncated && <p className="preview-warning">Diff truncated at {diff.limitBytes} bytes.</p>}

      {paths.length > 0 ? (
        <div className="preview-layout">
          <div className="preview-file-list" aria-label="Preview files">
            {paths.map((path) => {
              const file = diff?.files.find((item) => item.path === path);
              return (
                <button
                  key={path}
                  type="button"
                  aria-pressed={activePath === path}
                  onClick={() => setLocalSelectedPath(path)}
                >
                  <span>{file ? fileLabel(file) : path}</span>
                  <small>{file?.status ?? referencesForPath(references, path)[0]?.kind ?? 'snippet'}</small>
                </button>
              );
            })}
          </div>
          <div className="preview-detail" aria-label="Preview detail">
            {activePath ? <h4>{activePath}</h4> : <h4>No file selected</h4>}
            {activeDiff && (
              <section>
                <span className="state-kicker">Worktree diff</span>
                <pre>{activeDiff}</pre>
              </section>
            )}
            {activeReferences.length > 0 && (
              <section>
                <span className="state-kicker">Transcript snippets</span>
                {activeReferences.map((reference) => (
                  <article key={`${reference.kind}:${reference.eventId}:${reference.path}`} className="preview-snippet-card">
                    <strong>{reference.title}</strong>
                    {reference.snippet ? <pre>{reference.snippet}</pre> : <p>No snippet captured for this tool event.</p>}
                  </article>
                ))}
              </section>
            )}
            {!activeDiff && activeReferences.length === 0 && <p className="preview-empty">No preview details for this file.</p>}
          </div>
        </div>
      ) : (
        <p className="preview-empty">No transcript snippets yet.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add PreviewPanel styles**

Append this block near existing inspector styles in `web/src/App.css`:

```css
.preview-panel {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
}

.preview-panel-heading,
.preview-layout,
.preview-detail,
.preview-detail section,
.preview-snippet-card {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.preview-panel-heading h3,
.preview-panel-heading p,
.preview-detail h4,
.preview-snippet-card p {
  margin: 0;
}

.preview-panel-heading h3,
.preview-detail h4 {
  color: #4f4a43;
  font-size: 13px;
  font-weight: 720;
  line-height: 1.25;
}

.preview-panel-heading p,
.preview-empty,
.preview-snippet-card p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.42;
  overflow-wrap: anywhere;
}

.preview-empty,
.preview-error,
.preview-warning {
  margin: 0;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: rgb(255 253 250 / 0.58);
  padding: 10px;
}

.preview-error {
  border-style: solid;
  border-color: #e2b4ab;
  color: var(--danger);
  background: var(--danger-soft);
}

.preview-warning {
  border-style: solid;
  border-color: #e8d5aa;
  color: var(--warning);
  background: var(--warning-soft);
}

.preview-file-list {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.preview-file-list button {
  display: grid;
  gap: 2px;
  width: 100%;
  min-width: 0;
  border-color: transparent;
  background: transparent;
  padding: 8px 9px;
  text-align: left;
}

.preview-file-list button:hover,
.preview-file-list button[aria-pressed='true'] {
  border-color: var(--border);
  background: rgb(255 253 250 / 0.72);
}

.preview-file-list span,
.preview-file-list small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-file-list span {
  color: var(--text-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.preview-file-list small {
  color: var(--muted);
  font-size: 11px;
  text-transform: capitalize;
}

.preview-detail {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgb(255 253 250 / 0.58);
  padding: 10px;
}

.preview-detail pre,
.preview-snippet-card pre {
  max-height: 340px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--surface);
  padding: 9px;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-snippet-card {
  border-left: 2px solid var(--border-strong);
  padding-left: 8px;
}

.preview-snippet-card strong {
  color: var(--text-soft);
  font-size: 12px;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Run PreviewPanel tests**

Run:

```bash
npm --prefix web test -- --run PreviewPanel.test.tsx
```

Expected: all PreviewPanel tests pass.

- [ ] **Step 6: Commit PreviewPanel**

Run:

```bash
git add web/src/PreviewPanel.tsx web/src/PreviewPanel.test.tsx web/src/App.css
git commit -m "$(cat <<'EOF'
Add inspector preview panel
EOF
)"
```

---

### Task 6: Wire Preview tab into the Inspector

**Files:**
- Modify: `web/src/InspectorPanel.tsx:0-164`
- Modify: `web/src/App.tsx:43-752`
- Modify: `web/src/App.css:3476-3508`
- Modify: `web/src/App.test.tsx:1704-1745`

- [ ] **Step 1: Add failing App test for Preview tab order and worktree diff fetch**

Add this test in `web/src/App.test.tsx` near the existing inspector tests:

```tsx
it('shows Preview as the second inspector tab and loads worktree diff', async () => {
  render(<App />);

  fireEvent.click(await screen.findByText('Worktree Repo'));
  const inspector = openInspector();
  const tabs = within(inspector).getAllByRole('tab').map((tab) => tab.textContent);
  expect(tabs).toEqual(['Activity', 'Preview', 'Session tasks', 'All tasks', 'Plan', 'Diagnostics']);

  fireEvent.click(within(inspector).getByRole('tab', { name: 'Preview' }));
  const previewPanel = within(inspector).getByRole('tabpanel', { name: 'Preview' });

  expect(await within(previewPanel).findByText('Worktree diff')).toBeInTheDocument();
  expect(within(previewPanel).getByText(/diff --git a\/web\/src\/App\.tsx/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/worktree-diff', undefined);
});

it('keeps Preview available for non-worktree transcript snippets without fetching diff', async () => {
  eventsBySession = {
    s1: [
      {
        id: 1,
        sessionId: 's1',
        time: '2026-06-14T00:00:00Z',
        kind: 'tool',
        payload: { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'web/src/App.tsx' } }
      },
      {
        id: 2,
        sessionId: 's1',
        time: '2026-06-14T00:00:00Z',
        kind: 'tool',
        payload: { type: 'tool_result', tool_use_id: 'toolu_read', content: 'const app = true;' }
      }
    ]
  };
  render(<App />);

  const inspector = openInspector();
  fireEvent.click(within(inspector).getByRole('tab', { name: 'Preview' }));
  const previewPanel = within(inspector).getByRole('tabpanel', { name: 'Preview' });

  expect(await within(previewPanel).findByText('Preview is available for worktree sessions.')).toBeInTheDocument();
  expect(within(previewPanel).getByText('const app = true;')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/worktree-diff'))).toBe(false);
});
```

- [ ] **Step 2: Run the failing App tests**

Run:

```bash
npm --prefix web test -- --run App.test.tsx -t "Preview"
```

Expected: fail because `preview` tab is not in `InspectorTab` and not rendered.

- [ ] **Step 3: Wire InspectorPanel**

In `web/src/InspectorPanel.tsx`:

- Add imports:

```ts
import PreviewPanel from './PreviewPanel';
import type { UiEvent } from './types';
```

- Change the tab type:

```ts
export type InspectorTab = 'activity' | 'preview' | 'session' | 'global' | 'plan' | 'diagnostics';
```

- Add props:

```ts
activeEvents: UiEvent[];
selectedPreviewPath: string | null;
```

- Destructure those props in the component.
- Add this tab button immediately after Activity:

```tsx
<button type="button" id="inspector-tab-preview" role="tab" aria-selected={inspectorTab === 'preview'} aria-controls="inspector-panel-preview" tabIndex={inspectorTab === 'preview' ? 0 : -1} onClick={() => onSetInspectorTab('preview')} onKeyDown={onInspectorTabKeyDown}>Preview</button>
```

- Add this panel immediately after the Activity panel:

```tsx
<section id="inspector-panel-preview" role="tabpanel" aria-labelledby="inspector-tab-preview" hidden={inspectorTab !== 'preview'}>
  <PreviewPanel activeSession={activeSession} events={activeEvents} selectedPath={selectedPreviewPath} />
</section>
```

- [ ] **Step 4: Wire App state and keyboard order**

In `web/src/App.tsx`:

- Add state near `inspectorTab`:

```ts
const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
```

- Change tab order in `onInspectorTabKeyDown`:

```ts
const tabs: Array<typeof inspectorTab> = ['activity', 'preview', 'session', 'global', 'plan', 'diagnostics'];
```

- Pass props to `InspectorPanel`:

```tsx
activeEvents={eventState.activeEvents}
selectedPreviewPath={selectedPreviewPath}
```

- [ ] **Step 5: Update inspector tab grid CSS**

In `web/src/App.css`, change:

```css
.inspector-tabs {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
```

to:

```css
.inspector-tabs {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
```

- [ ] **Step 6: Run App Preview tests**

Run:

```bash
npm --prefix web test -- --run App.test.tsx -t "Preview"
```

Expected: the two Preview tests pass.

- [ ] **Step 7: Run full App tests because tab order changed**

Run:

```bash
npm --prefix web test -- --run App.test.tsx
```

Expected: all App tests pass. Update existing expectations that list inspector tabs so they include Preview after Activity.

- [ ] **Step 8: Commit Inspector wiring**

Run:

```bash
git add web/src/InspectorPanel.tsx web/src/App.tsx web/src/App.css web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
Wire preview tab into inspector
EOF
)"
```

---

### Task 7: Open in Preview actions from conversation cards

**Files:**
- Modify: `web/src/ConversationBlockList.tsx:0-442`
- Modify: `web/src/ConversationWorkspace.tsx:18-69,277-490`
- Modify: `web/src/App.tsx:328-338,640-704`
- Modify: `web/src/ConversationBlockList.test.tsx:145-173`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Add failing ConversationBlockList test for Open in Preview**

Add this test in `web/src/ConversationBlockList.test.tsx` after `renders tool activity with compact input and result sections`:

```tsx
it('opens tool file paths in Preview', () => {
  const onOpenPreviewPath = vi.fn();
  const blocks: ConversationBlock[] = [
    {
      id: 'tool-read',
      type: 'tool',
      name: 'Read',
      status: 'completed',
      inputSummary: 'web/src/App.tsx',
      resultSummary: 'Read output hidden (20 chars)',
      resultKind: 'text',
      resultDisplay: 'hidden',
      resultLabel: 'Read output hidden (20 chars)',
      eventIds: [10, 11],
      rawEvents: [
        rawEvent(10, { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'web/src/App.tsx' } }),
        rawEvent(11, { type: 'tool_result', tool_use_id: 'toolu_read', content: 'const app = true;' })
      ]
    }
  ];

  render(<ConversationBlockList blocks={blocks} onOpenPreviewPath={onOpenPreviewPath} />);

  fireEvent.click(screen.getByRole('button', { name: 'Open web/src/App.tsx in Preview' }));

  expect(onOpenPreviewPath).toHaveBeenCalledWith('web/src/App.tsx');
});
```

- [ ] **Step 2: Run the failing ConversationBlockList test**

Run:

```bash
npm --prefix web test -- --run ConversationBlockList.test.tsx -t "opens tool file paths in Preview"
```

Expected: fail because `ConversationBlockList` does not accept `onOpenPreviewPath` and renders no button.

- [ ] **Step 3: Update ConversationBlockList props and render action**

In `web/src/ConversationBlockList.tsx`:

- Import extraction helper:

```ts
import { extractPreviewFileReferences } from './previewReferences';
```

- Add props type:

```ts
type ConversationBlockListProps = {
  blocks: ConversationBlock[];
  onOpenPreviewPath?: (path: string) => void;
};
```

- Add helper near `blockElementId`:

```ts
function previewPathsForBlock(block: ConversationBlock): string[] {
  if (block.type !== 'tool' && block.type !== 'task') return [];
  return [...new Set(extractPreviewFileReferences(block.rawEvents).map((reference) => reference.path))];
}
```

- Change `ToolBlockView` signature:

```tsx
function ToolBlockView({ block, onOpenPreviewPath }: { block: ToolBlock; onOpenPreviewPath?: (path: string) => void }) {
```

- Inside `ToolBlockView`, before `return`, add:

```ts
const previewPaths = previewPathsForBlock(block);
const firstPreviewPath = previewPaths[0];
```

- Inside the `header`, after the status span, add:

```tsx
{firstPreviewPath && onOpenPreviewPath && (
  <button
    type="button"
    className="open-preview-button"
    onClick={() => onOpenPreviewPath(firstPreviewPath)}
    aria-label={`Open ${firstPreviewPath} in Preview`}
    title={`Open ${firstPreviewPath} in Preview`}
  >
    Preview
  </button>
)}
```

- Repeat the same pattern for `TaskBlockView` because background task details can include output paths later, with signature:

```tsx
function TaskBlockView({ block, onOpenPreviewPath }: { block: TaskBlock; onOpenPreviewPath?: (path: string) => void }) {
```

- Change `ConversationBlockView` signature and calls:

```tsx
function ConversationBlockView({ block, onOpenPreviewPath }: { block: ConversationBlock; onOpenPreviewPath?: (path: string) => void }) {
  if (block.type === 'anchor') return <span id={blockElementId(block)} className="conversation-anchor" aria-hidden="true" />;
  if (block.type === 'message') return <MessageBlockView block={block} />;
  if (block.type === 'tool') return <ToolBlockView block={block} onOpenPreviewPath={onOpenPreviewPath} />;
  if (block.type === 'task') return <TaskBlockView block={block} onOpenPreviewPath={onOpenPreviewPath} />;
  if (block.type === 'error') return <ErrorBlockView block={block} />;
  return <RawBlockView block={block} />;
}

export default function ConversationBlockList({ blocks, onOpenPreviewPath }: ConversationBlockListProps) {
  return (
    <div className="conversation-blocks">
      {blocks.map((block) => (
        <ConversationBlockView key={block.id} block={block} onOpenPreviewPath={onOpenPreviewPath} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add button styles**

In `web/src/App.css`, near `.tool-status`, add:

```css
.open-preview-button {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--accent-strong);
  font-size: 11px;
  line-height: 1.25;
}
```

- [ ] **Step 5: Wire ConversationWorkspace and App**

In `web/src/ConversationWorkspace.tsx`:

- Add prop:

```ts
onOpenPreviewPath: (path: string) => void;
```

- Destructure it.
- Change the conversation list render to:

```tsx
<ConversationBlockList blocks={activeBlocks} onOpenPreviewPath={onOpenPreviewPath} />
```

In `web/src/App.tsx`:

- Add handler near `onOpenReviewActivity`:

```ts
function onOpenPreviewPath(path: string) {
  setView('sessions');
  setIsInspectorOpen(true);
  setInspectorTab('preview');
  setSelectedPreviewPath(path);
}
```

- Pass to `ConversationWorkspace`:

```tsx
onOpenPreviewPath={onOpenPreviewPath}
```

- [ ] **Step 6: Add App integration test**

Add this test near Preview tests in `web/src/App.test.tsx`:

```tsx
it('opens Preview from a conversation tool card path', async () => {
  eventsBySession = {
    s1: [
      {
        id: 1,
        sessionId: 's1',
        time: '2026-06-14T00:00:00Z',
        kind: 'tool',
        payload: { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'web/src/App.tsx' } }
      }
    ]
  };
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Open web/src/App.tsx in Preview' }));

  const inspector = screen.getByRole('complementary', { name: 'Session inspector' });
  expect(within(inspector).getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  const previewPanel = within(inspector).getByRole('tabpanel', { name: 'Preview' });
  expect(within(previewPanel).getByRole('button', { name: /web\/src\/App\.tsx/ })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 7: Run focused frontend tests**

Run:

```bash
npm --prefix web test -- --run ConversationBlockList.test.tsx -t "opens tool file paths in Preview"
npm --prefix web test -- --run App.test.tsx -t "opens Preview"
```

Expected: both tests pass.

- [ ] **Step 8: Commit Open in Preview wiring**

Run:

```bash
git add web/src/ConversationBlockList.tsx web/src/ConversationWorkspace.tsx web/src/App.tsx web/src/App.css web/src/ConversationBlockList.test.tsx web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
Open transcript file references in preview
EOF
)"
```

---

### Task 8: Remove duplicate inline worktree diff surface

**Files:**
- Modify: `web/src/ConversationWorkspace.tsx:1-216`
- Modify: `web/src/App.test.tsx:1664-1684`

- [ ] **Step 1: Update test expectation away from inline diff**

In `web/src/App.test.tsx`, update the dirty worktree test to use Preview instead of the `View diff` button. Replace this part:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'View diff' }));
expect(await screen.findByText('Worktree diff')).toBeInTheDocument();
expect(screen.getByText(/diff --git a\/web\/src\/App\.tsx/)).toBeInTheDocument();
```

with:

```tsx
const inspector = openInspector();
fireEvent.click(within(inspector).getByRole('tab', { name: 'Preview' }));
const previewPanel = within(inspector).getByRole('tabpanel', { name: 'Preview' });
expect(await within(previewPanel).findByText('Worktree diff')).toBeInTheDocument();
expect(within(previewPanel).getByText(/diff --git a\/web\/src\/App\.tsx/)).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused dirty worktree test and confirm it still fails before cleanup**

Run:

```bash
npm --prefix web test -- --run App.test.tsx -t "shows dirty worktree files"
```

Expected: may pass with both surfaces present, but this step confirms the new Preview path is tested before deleting inline diff code.

- [ ] **Step 3: Remove inline diff loading from WorktreeStatusPanel**

In `web/src/ConversationWorkspace.tsx`:

- Remove `useState` from the import if it is no longer used:

```ts
import { type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
```

- Remove `getWorktreeDiff` import.
- Delete `diff`, `diffError`, and `isDiffLoading` state from `WorktreeStatusPanel`.
- Delete `loadDiff()`.
- Delete the `View diff` button from the worktree status heading.
- Delete the `diffError` paragraph and `worktree-diff-viewer` details block.

Keep changed files and copy delivery context in the header panel.

- [ ] **Step 4: Run workspace/App tests**

Run:

```bash
npm --prefix web test -- --run App.test.tsx -t "worktree"
```

Expected: all worktree-related App tests pass and no test expects inline `View diff`.

- [ ] **Step 5: Commit inline diff cleanup**

Run:

```bash
git add web/src/ConversationWorkspace.tsx web/src/App.test.tsx
git commit -m "$(cat <<'EOF'
Move worktree diff viewing into preview
EOF
)"
```

---

### Task 9: Full verification and documentation review

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Modify only if needed: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Run backend formatting and tests**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
```

Expected: format check passes and all backend tests pass.

- [ ] **Step 2: Run frontend tests and build**

Run:

```bash
npm --prefix web test
npm --prefix web run build
```

Expected: all frontend tests pass and the production build succeeds.

- [ ] **Step 3: Review README and CLAUDE documentation impact**

Open `README.md` and `CLAUDE.md` and check whether the implementation changed documented commands, APIs, or user-visible workflow. The spec already notes `GET /api/sessions/{id}/worktree-diff`; if `CLAUDE.md` still documents that endpoint and no new commands/config fields were added, no docs edit is needed.

If docs need no edits, do not create a docs-only change. If docs need edits, make the minimal update and commit it with:

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Document preview tab behavior
EOF
)"
```

- [ ] **Step 4: Manually verify in the running app**

Start the app with the project server command:

```bash
scripts/start-server.sh
```

In the browser:

1. Open a worktree session.
2. Make or select a session with a small file change.
3. Open Inspector → Preview.
4. Confirm the Preview tab shows the changed file and diff.
5. Trigger or select transcript events with Read/Edit/Write file paths.
6. Confirm transcript snippets appear in Preview.
7. Click Open in Preview from a conversation tool card.
8. Confirm the Inspector opens, Preview is selected, and the file is selected.
9. Select a non-worktree session.
10. Confirm Preview shows the worktree-only empty state without fetching `/worktree-diff`.

Expected: UI behavior matches the approved spec and no console errors appear.

- [ ] **Step 5: Commit any final fixes**

If verification required code fixes, commit them with a focused message. If no fixes were required, do not create an empty commit.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intentionally untracked local helper directories such as `.superpowers/` remain, or the working tree is clean.
