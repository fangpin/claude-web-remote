# Working Directory and Git Worktree Design

## Goal

Improve new-session creation so users no longer need to repeatedly type working directories, and optionally create each session in a fresh git worktree that matches Claude Code's worktree behavior.

## Scope

This enhancement covers:

1. Recent working directory suggestions in the new-session form.
2. Optional git worktree creation when starting a session.
3. Configurable worktree location, branch prefix, and base-ref mode.
4. A stop flow that can optionally remove a worktree created by Claude Remote Web.

It does not add a full working-directory management screen, saved favorites, pinned directories, browser filesystem access, or automatic worktree cleanup outside explicit user action.

## Backend configuration

Add these optional config fields:

```toml
worktrees_dir = "/absolute/path/to/worktrees"
worktree_branch_prefix = "pin"
worktree_base_ref = "fresh"
```

Resolution rules:

- `worktrees_dir` is optional. When omitted, worktrees are created under the selected repo's `.claude/worktrees` directory.
- `worktree_branch_prefix` defaults to `pin`.
- `worktree_base_ref` defaults to `fresh` and accepts `fresh` or `head`.
- Path fields expand `~` with the same rules as existing config paths.

The `fresh` and `head` modes follow Claude Code's worktree model:

- `fresh`: create from `origin/<default-branch>`.
- `head`: create from the selected repo's current local `HEAD`.

The daemon does not run `git fetch` during session creation. If `fresh` is selected and the required remote ref is missing, session creation fails with a clear error telling the user to sync the repo or use `head`.

## Session model

Extend `CreateSessionRequest` with an optional worktree field:

```json
{
  "cwd": "/path/to/repo",
  "name": "optional",
  "permissionMode": "acceptEdits",
  "worktree": { "enabled": true }
}
```

When worktree mode is disabled or omitted, session creation keeps the current behavior: validate `cwd`, persist it, and launch Claude with that directory as `current_dir`.

When worktree mode is enabled, the request `cwd` is treated as the source repo. The server validates that it is a git repository, creates a worktree, and stores the worktree path as the session's actual `cwd`.

Extend `SessionMeta` and `SessionInfo` with optional worktree metadata:

```json
{
  "sourceCwd": "/path/to/repo",
  "worktreeCwd": "/path/to/repo/.claude/worktrees/abc123",
  "branch": "pin/abc123",
  "createdByClaudeRemoteWeb": true
}
```

The metadata is persisted with the session so restart continues to use the same worktree cwd, and stop/remove can prove the worktree belongs to this app before deleting it.

## Worktree creation

For each worktree session, generate a random slug and use it for both directory naming and branch naming:

```text
slug: abc123
branch: <worktree_branch_prefix>/<slug>
path: <resolved-worktrees-dir>/<slug>
```

The resolved worktrees directory is:

1. `worktrees_dir` from config when set.
2. Otherwise `<source repo>/.claude/worktrees`.

Creation is argv-based and shell-free, using git commands equivalent to:

```text
git -C <source repo> worktree add -b <branch> <path> <base-ref>
```

Base ref resolution:

- For `head`, use `HEAD`.
- For `fresh`, inspect the selected repo's default branch and use `origin/<default-branch>`.

Expected failures include non-git directories, missing remote default branch refs, existing branch/path collisions, and git command failure. These return `InvalidRequest`-style errors that the UI can show in its existing error area.

## API design

Existing endpoints keep their current responsibilities:

- `GET /api/sessions` returns all sessions, including optional worktree metadata.
- `POST /api/sessions` creates either a normal session or a worktree session based on the request body.
- `POST /api/sessions/:id/stop` stops the running Claude process only.

Add one endpoint:

```text
POST /api/sessions/:id/stop-and-remove-worktree
```

This endpoint stops the session first, then removes the worktree only if the session metadata says it was created by Claude Remote Web. If the session has no app-created worktree metadata, the endpoint returns a clear error and does not delete anything.

Removal uses git worktree removal semantics, equivalent to:

```text
git -C <source repo> worktree remove <worktree path>
```

The endpoint does not force-remove dirty worktrees. If git refuses to remove the worktree, the error is returned and the session metadata remains intact so the user can resolve it manually.

## Frontend interaction

The new-session form keeps the existing `Working directory` text input. Beneath it, show recent directory suggestions derived from `GET /api/sessions`:

- Sort sessions by `updatedAt` descending.
- Deduplicate by `cwd`.
- Render a small list of recent paths.
- Clicking a path fills the input.

This uses existing session history and does not introduce a separate working-directory database.

Add a `Use git worktree` switch to the form. When enabled, the frontend sends:

```json
"worktree": { "enabled": true }
```

The user does not provide a worktree name; the backend generates one.

For session display:

- Normal sessions show the current `cwd` as they do today.
- Worktree sessions show the actual worktree cwd as the primary cwd.
- Worktree sessions also show the source repo and branch so users understand where the session is running.

For stopping:

- Normal sessions keep the current Stop behavior.
- Worktree sessions offer two actions: stop only, or stop and remove worktree.
- Stop and remove calls the new endpoint and reports backend errors through the existing error state.

## Error handling

Backend errors should be specific enough for the UI to show directly:

- Source cwd does not exist.
- Source cwd is not a directory.
- Source cwd is not a git repository.
- `fresh` base ref cannot be resolved to `origin/<default-branch>`.
- Worktree branch or path already exists.
- Git worktree creation failed.
- Stop-and-remove was requested for a session without an app-created worktree.
- Git worktree removal failed, commonly because the worktree has uncommitted changes.

The UI should not hide these errors or replace them with generic messages.

## Testing

Backend tests:

- Config defaults include `worktree_branch_prefix = "pin"` and `worktree_base_ref = "fresh"`.
- Config loads `worktrees_dir`, `worktree_branch_prefix`, and `worktree_base_ref` from TOML.
- Invalid `worktree_base_ref` fails config parsing or resolution clearly.
- Creating a normal session preserves existing cwd behavior.
- Creating a worktree session rejects non-git directories.
- Creating a worktree session records source cwd, worktree cwd, branch, and ownership metadata.
- `head` mode creates from local `HEAD`.
- `fresh` mode uses the repo's remote default branch ref without fetching.
- Stop-and-remove rejects sessions without app-created worktree metadata.
- Stop-and-remove calls git worktree removal for app-created worktrees and keeps metadata when removal fails.

Frontend tests:

- Recent directory suggestions are derived from sessions, deduplicated, and sorted by `updatedAt`.
- Clicking a suggestion fills the working directory input.
- Submitting with worktree disabled omits or disables the worktree request field.
- Submitting with worktree enabled sends `worktree.enabled = true`.
- Worktree sessions render source repo and branch metadata.
- Worktree session Stop offers both stop-only and stop-and-remove actions.

Manual verification:

1. Start the app and create a normal session using a hand-entered cwd.
2. Confirm the cwd appears as a recent suggestion for the next session.
3. Create a session with `Use git worktree` disabled and confirm behavior matches today.
4. Create a session with `Use git worktree` enabled in a git repo.
5. Confirm Claude starts in the generated worktree directory.
6. Stop the worktree session without deleting it and confirm the worktree remains on disk.
7. Start or select another worktree session and use stop-and-remove.
8. Confirm the worktree is removed when clean, and that dirty worktrees produce a visible error without force deletion.
