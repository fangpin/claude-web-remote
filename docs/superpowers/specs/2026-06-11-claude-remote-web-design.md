# Claude Remote Web Design

## Goal

Build a self-hosted Web control console for running Claude Code on a remote devbox where the code, files, git repositories, and configured model gateway stay on the remote machine. The browser is only a control UI.

The first version does not depend on Claude app Remote Control. It wraps an already working `claude` CLI installation and exposes multi-session control through a Rust daemon and React Web UI.

## Architecture

```text
Local browser
  ↕ http://127.0.0.1:<local-port>
SSH local port forward
  ↕ ssh -L <local-port>:127.0.0.1:<remote-port> devbox
Rust daemon on devbox
  ↕ stdin/stdout stream-json
configured claude CLI on devbox
  ↕ existing gateway setup
model provider
```

The daemon binds to `127.0.0.1` by default. The devbox does not expose an HTTP service to the network. Access is through SSH local port forwarding.

## Components

### React Web UI

- Shows a multi-session list.
- Creates sessions with a working directory, optional display name, and permission mode.
- Shows a terminal-like conversation/event stream.
- Sends user input to the active session.
- Supports stop, restart, and continue/resume actions.
- Reconnects WebSocket streams after refresh and displays persisted history.

### Rust daemon

- Uses `axum` for HTTP and WebSocket endpoints.
- Uses `tokio::process` to manage `claude` child processes.
- Serves the built React static assets.
- Owns session lifecycle, event persistence, and process IO.

Core modules:

- `SessionManager`: creates sessions, lists sessions, tracks status, cwd, and process handles.
- `ClaudeProcess`: starts and stops `claude`, writes stdin, reads stdout/stderr.
- `EventStore`: persists metadata and UI events, and replays events for reconnecting clients.
- `Api`: exposes REST and WebSocket endpoints.

## CLI invocation

A new session starts the configured `claude` binary from the selected working directory. The first version uses fixed permission mode instead of interactive permission prompts.

Default command shape:

```bash
claude --input-format stream-json \
       --output-format stream-json \
       --permission-mode acceptEdits \
       --verbose
```

The permission mode is configurable per session. If a session needs a different mode, the user restarts it with a different setting.

Resume support is implemented by storing the Claude Code session id when it appears in output, then passing `--resume <claude-session-id>` where available. If no Claude session id is known, restart creates a fresh process in the same working directory.

## API

```text
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/input
POST /api/sessions/:id/stop
POST /api/sessions/:id/restart
WS   /api/sessions/:id/events
```

`POST /api/sessions` body:

```json
{
  "cwd": "/data00/home/user/repos/project",
  "name": "optional display name",
  "permissionMode": "acceptEdits"
}
```

`POST /api/sessions/:id/input` body:

```json
{
  "text": "user message"
}
```

## Event model

The daemon normalizes process output into UI events:

```json
{
  "id": "monotonic-event-id",
  "sessionId": "session-id",
  "time": "2026-06-11T00:00:00Z",
  "kind": "assistant|user|tool|system|error|raw",
  "payload": {}
}
```

Stdout JSON lines from `claude` are parsed and converted to display events. Unknown messages are preserved as `raw` events so the UI does not silently drop new Claude Code output shapes. Stderr is written to a log file and summarized as `error` or `system` events.

## Persistence

Default data directory:

```text
~/.claude-remote-web/
  config.toml
  sessions/
    <session-id>/
      meta.json
      events.jsonl
      stderr.log
      raw-stdout.jsonl
```

`meta.json` stores session name, cwd, permission mode, status, timestamps, process status, and Claude Code session id if known.

`events.jsonl` stores normalized UI events for replay. `raw-stdout.jsonl` is optional but enabled in the first version to simplify compatibility debugging.

## Security and deployment

- The daemon binds to `127.0.0.1` by default.
- The intended access path is SSH local port forwarding:

```bash
ssh -N -L 8787:127.0.0.1:8787 devbox
```

- The local browser opens `http://127.0.0.1:8787`.
- No multi-user authentication is included in the first version.
- The daemon may support an optional local bearer token, but this is not a substitute for SSH access control.
- Binding to `0.0.0.0` is out of scope for the first version.

## Error handling

- If `claude` fails to start, the UI shows cwd, command, exit code, and stderr.
- If WebSocket disconnects, the child process keeps running and the UI replays missed events after reconnect.
- If a child process exits, the session status becomes `exited` and can be restarted.
- If fixed permission mode blocks a task, the UI tells the user to restart the session with another permission mode.
- If cwd does not exist or is not a directory, session creation fails before spawning `claude`.

## Testing

### Backend unit tests

- Session creation, lookup, status transitions, stop, and restart.
- EventStore append, read, and replay ordering.
- ClaudeProcess behavior using a fake `claude` executable that emits stdout, stderr, and exit statuses.

### Backend integration tests

- Start the daemon on a random loopback port.
- Create a temporary working directory.
- Create a session using a fake `claude` executable.
- Verify `/input` writes to child stdin.
- Verify stdout becomes WebSocket events.
- Verify reconnect replays persisted events.

### Frontend tests

- Session list rendering.
- Create session form validation.
- Event stream rendering for assistant, tool, system, and error events.
- Stop and restart controls.

### Manual verification

1. Start daemon on devbox.
2. Open SSH tunnel: `ssh -N -L 8787:127.0.0.1:8787 devbox`.
3. Open `http://127.0.0.1:8787` locally.
4. Create two sessions in different working directories.
5. Send simple prompts.
6. Refresh the page and verify event history reloads.
7. Stop and restart a session.

## Non-goals

- No official Claude app Remote Control compatibility.
- No gateway or model adapter implementation.
- No remote file synchronization to the local machine.
- No multi-user login, RBAC, or team sharing.
- No interactive allow/deny permission UI in the first version.
- No public HTTP exposure from the devbox.
