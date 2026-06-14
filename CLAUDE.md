# CLAUDE.md

## Project overview

Claude Remote Web is a Rust daemon plus React Web UI for controlling Claude Code sessions on a remote devbox. The browser is only a control surface; repositories, files, Claude CLI, and gateway configuration stay on the devbox.

The product goal is to be the web version of the Claude app: its functionality, UI design, and interactions should stay as close to the Claude app as practical.

Default access is SSH-only:

```text
local browser -> SSH local port forward -> devbox 127.0.0.1:8787 -> Rust daemon -> Claude launcher
```

Do not change the default security posture to public HTTP exposure.

## Repository layout

```text
crates/server/     Rust daemon, APIs, process/session/store/config logic
web/               React + Vite frontend
docs/superpowers/  design specs and implementation plans
```

Key backend modules:

- `crates/server/src/config.rs` resolves CLI/config/default values.
- `crates/server/src/process.rs` starts the configured launcher and appends native Claude args.
- `crates/server/src/session.rs` manages session lifecycle and metadata.
- `crates/server/src/store.rs` persists metadata and event logs.
- `crates/server/src/api.rs` exposes REST and WebSocket endpoints.
- `GET/POST/PATCH/DELETE /api/session-groups` manages durable custom session groups.
- `PATCH /api/sessions/{id}` updates session metadata such as the chat name and `groupId` without restarting Claude.
- `GET /api/sessions/{id}/worktree-diff` returns a read-only git diff for worktree sessions.
- `GET /api/sessions/{id}/transcript?afterId=<id>&beforeId=<id>&limit=<n>` returns persisted transcript events over plain HTTP for active, stopped, ended, failed, and archived sessions; `limit` bounds long-session initial loads and `beforeId` pages older windows, while `GET /api/sessions/{id}/events?afterId=<id>` remains the WebSocket replay-then-live stream for running sessions.

## Commands

Run backend checks:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
```

Run frontend checks:

```bash
npm --prefix web test
npm --prefix web run build
```

In a fresh git worktree, install frontend dependencies before running frontend checks if `web/node_modules` is missing. If `npm --prefix web test` fails with `vitest: command not found`, run this install command and rerun the checks:

```bash
npm --prefix web install
```

Build frontend assets:

```bash
npm --prefix web install
npm --prefix web run build
```

Run daemon:

```bash
scripts/start-server.sh
```

Use an explicit config file or dry-run the resolved command:

```bash
scripts/start-server.sh --config /path/to/config.toml
scripts/start-server.sh --check --config /path/to/config.toml
```

## Configuration

Default config path:

```text
~/.claude-remote-web/config.toml
```

Supported fields:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["claude"]
web_dir = "/absolute/path/to/web/dist"
default_permission_mode = "bypassPermissions"
worktrees_dir = "/absolute/path/to/worktrees"
worktree_branch_prefix = "pin"
worktree_base_ref = "fresh"
```

`worktrees_dir` is optional; when omitted, worktrees are created under the selected repo's `.claude/worktrees`. `worktree_base_ref = "fresh"` creates from the repository's configured `refs/remotes/origin/HEAD` (the remote default branch) without fetching, while `"head"` creates from the repo's current local `HEAD`.

Wrapper launcher example:

```toml
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
```

The daemon appends native Claude args after `launcher`:

```text
--print
--input-format stream-json
--output-format stream-json
--include-partial-messages
--permission-mode <mode>
--verbose
--resume <id>    # when known
```

Keep `claude_bin` backward compatibility unless intentionally removing legacy config support.

## Implementation rules

- Treat `launcher` as argv, not a shell command string.
- Do not use shell parsing for configured launcher values.
- Preserve full raw event payloads; frontend rendering should add readability without dropping data.
- Keep session event logs append-only.
- Do not add fake browser-side Stop Generating or permission approve/deny controls while driving raw Claude Code CLI stream-json; those control frames are not documented as supported.
- Restart should use persisted Claude session id when available.
- If no Claude session id is available, restart fresh and record a system event.
- Bind to `127.0.0.1` by default.
- After every change, review whether `README.md` and `CLAUDE.md` need updates, make needed updates, and mention the result in the final summary.

## Testing expectations

When changing backend process/session/config/API behavior, run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
```

When changing frontend rendering or API client behavior, run:

```bash
npm --prefix web test
npm --prefix web run build
```

For changes affecting startup/config, also manually verify:

```bash
cat > /tmp/claude-remote-web-test.toml <<'EOF'
bind = "127.0.0.1:8789"
data_dir = "/tmp/claude-remote-web-test"
launcher = ["claude"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "bypassPermissions"
EOF
scripts/start-server.sh --config /tmp/claude-remote-web-test.toml --skip-web-build
curl -s http://127.0.0.1:8789/api/sessions
```

Expected response:

```json
{"sessions":[]}
```

Stop the daemon after the check.
