# Resume, Config, and Event Rendering Design

## Goal

Enhance Claude Remote Web with persistent daemon configuration, automatic Claude Code session resume, and a more readable event stream UI while preserving the existing SSH-only deployment model and existing fixed-permission session flow.

## Scope

This enhancement covers three connected areas:

1. Configuration file loading from `~/.claude-remote-web/config.toml`, with optional `--config <path>` override.
2. Automatic extraction and persistence of Claude Code session ids from stdout events, then reuse on restart through `claude --resume <id>`.
3. Frontend event rendering that handles common Claude Code stream-json event shapes with dedicated cards and falls back to collapsible JSON for unknown payloads.

It does not add multi-user auth, public HTTP exposure, gateway/model routing, or interactive permission approval UI.

## Configuration

The daemon loads configuration in this priority order:

1. Explicit CLI arguments.
2. File passed by `--config <path>`.
3. Default file at `~/.claude-remote-web/config.toml` when it exists.
4. Built-in defaults.

Supported TOML fields:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
claude_bin = "claude"
web_dir = "/path/to/web/dist"
default_permission_mode = "acceptEdits"
```

Path fields expand `~` only when it is the first path segment. Missing config files are allowed for the default path but are errors for an explicit `--config` path. Invalid TOML or invalid socket addresses fail startup with a clear error.

Session creation uses `default_permission_mode` when the request omits `permissionMode`. Existing request-level `permissionMode` remains supported.

## Resume behavior

The backend keeps `SessionMeta.claude_session_id` as the source of truth. While reading Claude stdout, it parses raw JSON payloads and extracts a session id from the first available supported shape:

```json
{"session_id":"..."}
{"sessionId":"..."}
{"session":{"id":"..."}}
```

When a supported id is found, `SessionManager` updates the session metadata on disk immediately and returns the updated value through later `GET /api/sessions` calls.

Restart behavior:

- If `claude_session_id` is present, restart passes `--resume <id>` to the `claude` process.
- If no id is present, restart starts a fresh process and appends a system event explaining that no Claude session id was found.
- Stop remains stop-only and does not clear the stored Claude session id.

This design keeps the UI simple: the existing Restart button becomes resume-aware without adding a separate Continue button.

## Event rendering

The backend continues to persist full normalized UI events without dropping raw payload fields. Rendering decisions live in the frontend.

Add an `EventCard` component that renders by event kind and payload shape:

- `assistant` and `user`: show `message`, `text`, or `content` when any is a string.
- `tool`, `tool_use`, and `tool_result`-like payloads: show tool name, input summary, and result summary when present.
- `system`, `result`, and `error`: show status, exit information, or error text when present.
- Unknown shapes: show a compact label plus a `<details>` block containing pretty-printed JSON.

The event list remains append-only and compatible with existing `events.jsonl` data.

## API impact

No new endpoint is required for this enhancement. Existing endpoints keep their shape:

- `POST /api/sessions` can omit `permissionMode`; the server fills the configured default.
- `POST /api/sessions/:id/restart` becomes resume-aware.
- `GET /api/sessions` and `GET /api/sessions/:id` may return a non-null `claudeSessionId` after stdout extraction.

## Error handling

- Explicit config path missing: startup fails.
- Default config path missing: daemon uses built-in defaults.
- Config parse error: startup fails with the file path and parse error.
- Bad path expansion: path is preserved as-is unless it starts with `~/` or equals `~`.
- Resume id absent on restart: daemon starts fresh and records a system event.
- Unknown event payload: UI shows collapsible JSON instead of hiding it.

## Testing

Backend tests:

- Config loads defaults without config file.
- Config loads explicit file and expands `~` path fields.
- CLI values override file values.
- Explicit missing config path returns an error.
- Session id extraction supports `session_id`, `sessionId`, and `session.id`.
- Restart with stored session id invokes fake `claude` with `--resume <id>`.
- Restart without stored session id appends a system event.

Frontend tests:

- Assistant/user text events render readable text.
- Tool events render tool name and summaries.
- Error/system/result events render status or error details.
- Unknown payloads render pretty JSON inside a collapsible details block.

Manual verification:

1. Create `~/.claude-remote-web/config.toml` with non-default `default_permission_mode`.
2. Start the daemon without `--data-dir` and confirm the config is used.
3. Start the daemon with `--config /tmp/custom.toml` and confirm that file is used instead.
4. Run a fake or real Claude session that emits a session id.
5. Restart the session and confirm `--resume <id>` is used.
6. Open the UI and confirm assistant, user, tool, error, and raw JSON events are readable.
