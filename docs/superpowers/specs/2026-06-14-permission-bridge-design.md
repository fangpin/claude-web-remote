# Permission bridge and waiting action cards

## Summary

Claude Remote Web should turn permission/review/waiting states into a real user decision flow, not a log-viewer experience. The browser should clearly show when Claude is blocked on a permission decision, provide Allow/Deny/Edit actions when the backend has real control capability, and avoid fake controls when that capability is unavailable.

The approved approach is a Claude Code `PermissionRequest` hook bridge. This preserves the current Rust daemon + Claude Code CLI launcher path, including third-party launcher/model-provider setups, and avoids undocumented stdin control frames for `--input-format stream-json`.

## Goals

- Show a prominent permission action card in the main conversation when Claude needs a decision.
- Mirror pending permissions in the Activity drawer.
- Support real Allow, Deny, and first-phase Edit command actions through a backend bridge.
- Preserve third-party launcher compatibility; do not require native Anthropic Agent SDK auth.
- Do not write invented approve/deny frames to Claude Code stdin.
- Hide action controls when real backend permission capability is unavailable.

## Non-goals

- Switching session execution to the Claude Agent SDK.
- Public HTTP exposure or any change to the default SSH-only security posture.
- Generic raw JSON editing for all tool inputs in the first phase.
- Fake browser-side Stop Generating or permission controls.

## Current state

The server currently stores and forwards raw Claude Code stream-json events. Waiting is inferred from session activity, and permission/review-like state is inferred in the frontend from payload text. There is no backend approve/deny API and no documented raw CLI stream-json stdin frame for resolving permissions.

The existing UI already shows review/waiting hints, including copy such as “decision controls are not exposed by this server yet.” This design replaces that incomplete experience with a real capability-backed flow.

## Architecture

### Permission bridge

Each Claude Code session still runs through the configured launcher. When permission bridge support is available, the daemon starts the session with a temporary `PermissionRequest` hook configuration scoped to that Claude process.

The hook flow is:

1. Claude Code reaches a permission decision and invokes the `PermissionRequest` hook.
2. The hook helper reads the hook stdin JSON.
3. The helper POSTs the request to a daemon internal endpoint with a per-session token.
4. The daemon creates a `PendingPermissionRequest` and broadcasts a session event to the frontend.
5. The helper blocks waiting for a decision from the daemon.
6. The user resolves the request in the browser.
7. The daemon wakes the helper with allow, deny, or allow-with-edited-input.
8. The helper prints the official hook `hookSpecificOutput.PermissionRequest.decision` JSON to stdout for Claude Code.

No approval or denial is sent through Claude Code stdin.

### Capability detection

The backend exposes whether permission bridge controls are available for a session. If temporary hook injection is unsupported by the installed Claude Code version or cannot be configured safely, the session reports permission controls as unavailable. The frontend may still show waiting/review context, but must not render Allow/Deny/Edit buttons.

### Hook injection

The daemon should not mutate user-global Claude Code settings. It should create temporary hook configuration for the launched session and pass it through the most specific supported mechanism available for the Claude Code process. If this cannot be done reliably, the daemon marks permission controls unavailable.

The hook helper may live in the repo or daemon data directory. It should be small, deterministic, and only responsible for translating hook JSON to daemon requests and daemon decisions back to hook JSON.

## Backend data model

Add a first-class `PendingPermissionRequest` model:

- `requestId`: daemon-generated unique ID.
- `sessionId`: Claude Remote Web session ID.
- `hookSessionId`: Claude Code hook `session_id`, for diagnostics and mapping.
- `toolName`: tool name such as `Bash`, `Edit`, or `Write`.
- `toolInput`: full hook input JSON.
- `summary`: user-readable summary derived from `toolName` and `toolInput`.
- `status`: `pending`, `allowed`, `denied`, `expired`, or `failed`.
- `decision`: resolved allow/deny data, including optional deny message or edited input.
- `createdAt` and `resolvedAt` timestamps.

The first implementation should keep pending state in daemon memory and emit durable transcript/session events so the UI can show what happened. Pending requests that survive daemon restart are not recoverable because the hook process will time out; they should not be resurrected as active controls.

## Backend API

Add public session APIs:

- `GET /api/sessions/{sessionId}/permissions/pending`
  - Returns active pending permission requests for the session and capability metadata.
- `POST /api/sessions/{sessionId}/permissions/{requestId}/allow`
  - Body may be empty or `{ "updatedInput": { ... } }`.
- `POST /api/sessions/{sessionId}/permissions/{requestId}/deny`
  - Body: `{ "message": "..." }`.

Add an internal hook API, bound to localhost and protected by a one-time or per-session token:

- `POST /api/internal/permission-hooks/request`
  - Registers a hook request and blocks or long-polls for a decision.

A repeated resolve returns 409. Resolving a request for the wrong session returns 404 or 409. Session stop/end resolves active pending requests as failed or denied with a clear reason.

## Session events

Emit permission lifecycle events into the existing event stream/transcript:

- `permission_request`: a permission request became pending.
- `permission_resolved`: the user allowed or denied it.
- `permission_expired`: the request expired or the bridge failed.

These events should include safe display fields and IDs. Raw tool input can be available through details, but the summary should avoid unnecessarily surfacing secret-looking values.

## Frontend experience

### Main conversation action card

When a session has a pending permission, render a prominent card near the current assistant output:

```text
Claude needs your permission

Run:
npm --prefix web test

[Allow] [Deny] [Edit command] [Details]
```

Behavior:

- `Allow` calls the allow API, shows a resolving state, then changes to an allowed result state.
- `Deny` opens a small deny-message input and then calls the deny API.
- `Edit command` appears only for supported editable inputs, first-phase `Bash.command`. Submitting sends `updatedInput` with the edited command and resolves as allow.
- `Details` expands tool name, cwd, permission mode, raw input JSON, and request ID.
- If capability is unavailable, the card can explain that Claude is waiting/reviewing, but it must not show action buttons.

### Activity drawer

The Activity drawer shows a compact synchronized card:

```text
Pending permission
Bash
npm --prefix web test
[Allow] [Deny]
```

It should list multiple pending requests if they exist, while the main conversation highlights the newest or most relevant pending request.

### State consistency

- Sidebar/header/composer waiting state should reflect both `runtimeStatus === waiting` and active pending permission requests.
- Sending a new chat message does not implicitly approve permissions.
- Refreshing the browser restores active pending cards via `GET /permissions/pending`.
- Once resolved, cards remain in transcript as result history rather than disappearing without trace.

## Failure handling

Default failure behavior is safe denial:

- Hook helper cannot reach daemon: deny with “web daemon unavailable.”
- User does not decide before timeout: deny with “permission request timed out.”
- Session stopped/ended while pending: deny or fail with a session-ended message.
- Daemon restart: hook eventually times out; no stale pending action is shown after restart.
- Browser disconnect: pending remains until timeout or session end.

The timeout should be long enough for a user to react, but bounded so Claude Code is not blocked forever. The exact duration can be tuned during implementation after testing hook behavior.

## Security

- Keep default bind posture at `127.0.0.1`; do not introduce public unauthenticated endpoints.
- Internal hook endpoints require a per-session token and should not be reachable cross-session.
- Never trust browser-provided `updatedInput` blindly; first phase only supports editing `Bash.command` and reconstructs the full input server-side.
- Avoid putting raw secret-like values in summaries. Full details are available only in the session UI.
- Do not mutate user-global Claude Code configuration.

## Testing plan

### Backend

- Pending request creation and lifecycle transitions.
- Allow, deny, edit-command decision serialization.
- Duplicate resolve returns 409.
- Session stop/end resolves pending requests safely.
- Capability unavailable path is explicit.
- Hook helper returns valid hook decision JSON for allow, deny, and edited input.

### Frontend

- Main permission card renders from pending state.
- Allow, Deny, Edit command, and Details call the correct APIs and update UI state.
- Activity drawer mirrors pending and resolved state.
- Capability unavailable does not render fake controls.
- Browser refresh restores pending permissions.

### Manual verification

- Trigger a Claude Code `Bash` permission request.
- Confirm the browser shows the action card without reading raw logs.
- Allow and verify the command continues.
- Deny and verify Claude receives the denial reason.
- Edit a Bash command and verify the edited command is the one approved.
- Refresh while pending and verify the card returns.

## Documentation impact

`CLAUDE.md` should be reviewed after implementation because it currently warns not to add fake browser-side permission controls. The warning remains correct, but the backend-supported hook bridge may deserve a note. `README.md` may need an update if the feature changes setup requirements, Claude Code version requirements, or permission behavior.