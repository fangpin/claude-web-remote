# Archive/Delete Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename and expose session lifecycle semantics as Archive for reversible inactive sessions and Delete for irreversible persisted-data removal.

**Architecture:** Keep the existing persisted `deleted_at` field as the internal archived marker to avoid a metadata migration. Add semantic backend aliases (`archive`/`unarchive`) while preserving legacy routes, update the frontend API/client/UI wording to Archive/Archived/Delete, and keep hard deletion restricted to archived sessions.

**Tech Stack:** Rust Axum backend, existing session/store metadata model, React/TypeScript frontend, Vitest/Testing Library, existing cargo tests.

---

## File Structure

- Modify `crates/server/src/session.rs`
  - Owns session lifecycle behavior.
  - Add semantic `archive_session` and `unarchive_session` methods that perform current soft-delete/restore behavior.
  - Keep `delete_session` and `restore_session` wrappers for legacy route compatibility and existing tests unless all call sites are updated in the same task.
  - Keep `deleted_at` as storage field for archived state.

- Modify `crates/server/src/api.rs`
  - Owns REST routes and route integration tests.
  - Add `POST /api/sessions/{id}/archive` and `POST /api/sessions/{id}/unarchive`.
  - Keep existing `DELETE /api/sessions/{id}` soft-delete and `POST /api/sessions/{id}/restore` legacy aliases for compatibility.
  - Keep true data deletion at `DELETE /api/sessions/{id}?permanent=true`.

- Modify `web/src/api.ts`
  - Owns frontend API function names.
  - Rename frontend-facing helpers to `archiveSession`, `unarchiveSession`, and `deleteSession` for hard delete.
  - Map `archiveSession` to `/archive`, `unarchiveSession` to `/unarchive`, and hard `deleteSession` to `DELETE /api/sessions/{id}?permanent=true`.
  - Add `archivedOnly` frontend list option that maps to the existing `deletedOnly=true` query.

- Modify `web/src/App.tsx`
  - Owns UI labels, list mode, and action handlers.
  - Rename Deleted mode to Archived mode in UI.
  - Archive active/stopped sessions via `Archive` action.
  - Unarchive archived sessions via `Unarchive` action.
  - Delete archived sessions via `Delete` action and hard-delete confirmation.
  - Keep default session list as active-only.

- Modify `web/src/types.ts`
  - Keep `deletedAt` field for compatibility unless a larger API response migration is explicitly approved later.

- Modify `web/src/App.test.tsx`
  - Update tests from Deleted/Delete/Permanently delete semantics to Archived/Archive/Delete.
  - Preserve behavior checks for hidden archived sessions, no WebSocket/composer for archived mode, unarchive, and hard delete.

- Review `README.md` and `CLAUDE.md`
  - Update only if they describe old Deleted/Permanent Delete UI semantics.

---

### Task 1: Add backend archive/unarchive route coverage

**Files:**
- Modify: `crates/server/src/api.rs`
- Test: `crates/server/src/api.rs`

- [ ] **Step 1: Add failing API integration assertions for semantic archive routes**

In `crates/server/src/api.rs`, find the test `delete_restore_permanent_delete_and_resume_routes_work`. Add route checks after the session is created and before permanent deletion. The relevant body should exercise the new endpoints:

```rust
let archive_response = app
    .clone()
    .oneshot(
        Request::builder()
            .method(Method::POST)
            .uri(format!("/api/sessions/{}/archive", session.id))
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
assert_eq!(archive_response.status(), StatusCode::OK);
let archived: serde_json::Value = body_json(archive_response).await;
assert!(archived.get("deletedAt").and_then(serde_json::Value::as_str).is_some());

let unarchive_response = app
    .clone()
    .oneshot(
        Request::builder()
            .method(Method::POST)
            .uri(format!("/api/sessions/{}/unarchive", session.id))
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
assert_eq!(unarchive_response.status(), StatusCode::OK);
let unarchived: serde_json::Value = body_json(unarchive_response).await;
assert_eq!(unarchived.get("deletedAt"), Some(&serde_json::Value::Null));
```

If the helper in this file has a different name than `body_json`, use the existing JSON-body helper already used in the same test.

- [ ] **Step 2: Run focused backend test and verify it fails**

Run:

```bash
cargo test --manifest-path Cargo.toml delete_restore_permanent_delete_and_resume_routes_work
```

Expected: FAIL with 404 or route-not-found for `/archive` or `/unarchive`.

---

### Task 2: Implement backend archive/unarchive aliases

**Files:**
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/api.rs`
- Test: `crates/server/src/api.rs`

- [ ] **Step 1: Add semantic manager methods while preserving legacy wrappers**

In `crates/server/src/session.rs`, rename the current body of `delete_session` to `archive_session` and make `delete_session` delegate to it:

```rust
pub async fn archive_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
    let _meta = self.load_active_meta(session_id).await?;
    self.stop_running_process(session_id).await?;
    let meta = self
        .store
        .update_meta(session_id, |meta| {
            if meta.deleted_at.is_some() {
                return Err(AppError::InvalidRequest(format!(
                    "session {session_id} is archived; unarchive it before continuing"
                )));
            }
            let now = Utc::now();
            meta.deleted_at = Some(now);
            meta.status = SessionStatus::Stopped;
            meta.updated_at = now;
            Ok(())
        })
        .await?;
    Ok(SessionInfo::from(meta))
}

pub async fn delete_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
    self.archive_session(session_id).await
}
```

Then rename the current body of `restore_session` to `unarchive_session` and make `restore_session` delegate to it:

```rust
pub async fn unarchive_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
    let meta = self
        .store
        .update_meta(session_id, |meta| {
            if meta.deleted_at.is_none() {
                return Err(AppError::InvalidRequest(format!(
                    "session {session_id} is not archived"
                )));
            }
            meta.deleted_at = None;
            meta.updated_at = Utc::now();
            Ok(())
        })
        .await?;
    Ok(SessionInfo::from(meta))
}

pub async fn restore_session(&self, session_id: Uuid) -> AppResult<SessionInfo> {
    self.unarchive_session(session_id).await
}
```

- [ ] **Step 2: Add API route handlers**

In `crates/server/src/api.rs`, add routes next to the existing lifecycle routes:

```rust
.route("/sessions/{id}/archive", post(archive_session))
.route("/sessions/{id}/unarchive", post(unarchive_session))
```

Add handlers near `delete_session` / `restore_session`:

```rust
async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.archive_session(id).await?)))
}

async fn unarchive_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(state.manager.unarchive_session(id).await?)))
}
```

Leave existing `delete_session` and `restore_session` routes intact as compatibility aliases.

- [ ] **Step 3: Run focused backend test**

Run:

```bash
cargo test --manifest-path Cargo.toml delete_restore_permanent_delete_and_resume_routes_work
```

Expected: PASS.

---

### Task 3: Add frontend archive/delete API client coverage through App tests

**Files:**
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Update fetch mock endpoints to expect semantic routes**

In `web/src/App.test.tsx`, change the mock route for soft delete from:

```ts
if (url === '/api/sessions/s1' && init?.method === 'DELETE') {
  return jsonResponse({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' });
}
```

To:

```ts
if (url === '/api/sessions/s1/archive' && init?.method === 'POST') {
  return jsonResponse({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' });
}
```

Change the restore mock from:

```ts
if (url === '/api/sessions/s3/restore' && init?.method === 'POST') {
```

To:

```ts
if (url === '/api/sessions/s3/unarchive' && init?.method === 'POST') {
```

Keep the permanent delete mock as:

```ts
if (url === '/api/sessions/s3?permanent=true' && init?.method === 'DELETE') {
```

- [ ] **Step 2: Update visible product wording in tests**

Rename test descriptions and UI expectations:

```ts
it('archives an active session and removes it from the active list', async () => {
```

Replace button/query text:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/archive', expect.objectContaining({ method: 'POST' })));
```

Replace deleted mode wording:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();
expect(fetchMock).toHaveBeenCalledWith('/api/sessions?deletedOnly=true', undefined);
```

Replace restore action:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3/unarchive', expect.objectContaining({ method: 'POST' })));
```

Replace permanent delete test description and action:

```ts
it('deletes archived session data from the archived list', async () => {
```

```ts
fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3?permanent=true', expect.objectContaining({ method: 'DELETE' })));
```

- [ ] **Step 3: Run focused App tests and verify they fail**

Run:

```bash
npm --prefix web test -- App
```

Expected: FAIL because `App.tsx` and `web/src/api.ts` still use Delete/Restore/Deleted wording and legacy endpoints.

---

### Task 4: Implement frontend archive/delete semantics

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/types.ts` only if TypeScript needs option names
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Update frontend API helpers**

In `web/src/api.ts`, change `listSessions` options type to:

```ts
export async function listSessions(options: { archivedOnly?: boolean; deletedOnly?: boolean; includeDeleted?: boolean } = {}): Promise<SessionInfo[]> {
  const params = new URLSearchParams();
  if (options.archivedOnly || options.deletedOnly) params.set('deletedOnly', 'true');
  if (options.includeDeleted) params.set('includeDeleted', 'true');
  const query = params.toString();
  const result = await request<{ sessions: SessionInfo[] }>(`/api/sessions${query ? `?${query}` : ''}`);
  return result.sessions;
}
```

Replace lifecycle helpers with:

```ts
export async function archiveSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/archive`, { method: 'POST' });
}

export async function unarchiveSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/unarchive`, { method: 'POST' });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}?permanent=true`, { method: 'DELETE' });
}
```

Remove or stop exporting `restoreSession` and `permanentlyDeleteSession` unless tests or other imports still require temporary aliases. If aliases are needed for compatibility, implement them by delegating:

```ts
export const restoreSession = unarchiveSession;
export const permanentlyDeleteSession = deleteSession;
```

- [ ] **Step 2: Update App imports and mode names**

In `web/src/App.tsx`, replace imports:

```ts
archiveSession,
unarchiveSession,
deleteSession,
```

Use type:

```ts
type SessionListMode = 'active' | 'archived';
```

Replace `listMode === 'deleted'` checks with `listMode === 'archived'` for UI/list mode. Keep `activeSession?.deletedAt` because the backend field remains unchanged.

Change list loading to:

```ts
listSessions({ archivedOnly: listMode === 'archived' })
```

- [ ] **Step 3: Update App action handlers**

Rename `onDelete` to `onArchive` and implement:

```ts
async function onArchive() {
  if (!activeId) return;
  const archivedId = activeId;
  if (!confirm('Archive this session? It will be hidden from active sessions but its local data will be kept.')) return;
  setError(null);
  try {
    await archiveSession(archivedId);
    removeSessionFromCurrentList(archivedId);
    void refreshTasks();
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

Rename `onRestore` to `onUnarchive`:

```ts
async function onUnarchive() {
  if (!activeId) return;
  const unarchivedId = activeId;
  setError(null);
  try {
    await unarchiveSession(unarchivedId);
    removeSessionFromCurrentList(unarchivedId);
    void refreshTasks();
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

Rename `onPermanentDelete` to `onDelete`:

```ts
async function onDelete() {
  if (!activeId) return;
  const removedId = activeId;
  if (!confirm('Delete this archived session and its local event logs? This cannot be undone.')) return;
  setError(null);
  try {
    await deleteSession(removedId);
    removeSessionFromCurrentList(removedId);
    setEvents((current) => {
      const next = { ...current };
      delete next[removedId];
      return next;
    });
    void refreshTasks();
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Update render labels**

In `renderActions`, archived sessions should render:

```tsx
<button onClick={onUnarchive}>Unarchive</button>
<button className="danger" onClick={onDelete}>Delete</button>
```

Active/running/stopped/starting sessions should render:

```tsx
<button className="danger" onClick={onArchive}>Archive</button>
```

Update rail and mode labels:

```tsx
aria-label="Archived sessions"
Archived
```

Session list heading and empty text:

```tsx
<h2>{listMode === 'archived' ? 'Archived sessions' : 'Sessions'}</h2>
{listMode === 'archived' ? 'No archived sessions.' : 'No sessions yet.'}
```

Header eyebrow and archived note:

```tsx
<span className="eyebrow">{listMode === 'archived' ? 'Archived Claude session' : 'Remote Claude session'}</span>
<p className="deleted-note">This session is archived. Unarchive it before sending messages.</p>
```

The CSS class can remain `deleted-note` for now because it is just styling; do not rename styling unless tests require it.

- [ ] **Step 5: Run focused App tests**

Run:

```bash
npm --prefix web test -- App
```

Expected: PASS.

---

### Task 5: Update backend test wording and keep compatibility coverage

**Files:**
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/api.rs`
- Test: backend tests

- [ ] **Step 1: Rename backend test descriptions only where low-risk**

In `crates/server/src/session.rs`, rename tests that describe user-facing delete behavior if they are easy to update without broad churn:

- `soft_delete_hides_session_and_restore_shows_it_again` → `archive_hides_session_and_unarchive_shows_it_again`
- Keep `permanently_delete_requires_soft_deleted_session_and_removes_files` unless you also update all wording inside it to archived terminology.

Inside assertions, update error-string expectations only if implementation strings changed in Task 2.

- [ ] **Step 2: Keep legacy route compatibility tests**

Do not remove existing tests that call `DELETE /api/sessions/{id}` or `POST /restore`. They prove backward compatibility. Add comments only if necessary; default to no comments.

- [ ] **Step 3: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml archive_hides_session_and_unarchive_shows_it_again delete_restore_permanent_delete_and_resume_routes_work
```

Expected: PASS.

---

### Task 6: Review documentation impact

**Files:**
- Review/modify if needed: `README.md`
- Review/modify if needed: `CLAUDE.md`

- [ ] **Step 1: Check README for old Deleted wording**

Run:

```bash
grep -n "Deleted\|delete\|archive\|permanent" README.md
```

If README does not describe session archive/delete UI semantics, leave it unchanged.

If README describes the old Deleted/Permanently delete behavior, replace it with:

```markdown
Sessions can be archived to hide them from the default active list while keeping their persisted logs and metadata. Archived sessions can be unarchived. Deleting an archived session removes its persisted session data and cannot be undone.
```

- [ ] **Step 2: Check CLAUDE.md for old Deleted wording**

Run:

```bash
grep -n "Deleted\|delete\|archive\|permanent" CLAUDE.md
```

If CLAUDE.md does not prescribe old UI naming, leave it unchanged.

If it does, update the wording to:

```markdown
Use Archive for reversible session hiding that keeps persisted data, and Delete for irreversible removal of persisted session data.
```

---

### Task 7: Final verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run backend formatting and tests**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
```

Expected: both commands exit 0.

- [ ] **Step 2: Run frontend tests and build**

Run:

```bash
npm --prefix web test
npm --prefix web run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff -- crates/server/src/session.rs crates/server/src/api.rs web/src/api.ts web/src/App.tsx web/src/App.test.tsx README.md CLAUDE.md
```

Expected: diff shows archive/delete naming, semantic endpoints, frontend API/client updates, tests, and only necessary documentation changes.

---

## Self-Review

- Spec coverage: The plan covers Archive as reversible hidden/inactive sessions, Delete as irreversible persisted-data removal, default active list behavior, archived session unarchive/restart path, backend compatibility, frontend wording, tests, and docs review.
- Placeholder scan: No placeholders remain; every change step includes exact route names, helper names, labels, commands, and expected outcomes.
- Type consistency: Frontend mode is consistently `active | archived`; persisted backend field remains `deleted_at`/`deletedAt` for compatibility; semantic helpers are `archiveSession`, `unarchiveSession`, and hard `deleteSession`.
