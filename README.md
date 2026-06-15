# Claude Remote Web

Claude Remote Web is a self-hosted Web console for controlling Claude Code sessions running on a remote devbox.

The code, files, git repositories, Claude CLI, and model gateway all stay on the remote machine. The browser is only a control UI.

## Features

- Rust daemon with REST and WebSocket APIs
- React Web UI for multi-session control
- Chat-first session creation with workspace context selection
- Session rename/update support
- Custom session groups with drag-and-drop organization
- Optional git worktree sessions with branch, dirty state, and changed-file visibility
- Compact chat-first transcript display from `claude --output-format stream-json`, with detailed tool activity available in the Activity drawer
- User input forwarding to the remote Claude process
- Claude-like composer with slash commands, context hints, context reference attachments, and inline stop/send controls
- Read-only action review cards for waiting sessions, permission-like events, risky commands, and failed actions
- Stop and restart session controls
- Event, stderr, raw stdout, and session metadata persistence
- Automatic Claude session id extraction and restart resume
- Config file support through `~/.claude-remote-web/config.toml`
- Runtime diagnostics for resolved config, launcher argv, web assets, data directory, and recent session failures
- Wrapper launcher support, including `ttadk claude ... -a`
- SSH-only access model by binding to `127.0.0.1`

## Architecture

```text
Local browser
  ↕ http://127.0.0.1:<local-port>
SSH local port forward
  ↕ ssh -L <local-port>:127.0.0.1:<remote-port> devbox
Rust daemon on devbox
  ↕ stdin/stdout stream-json
configured Claude launcher on devbox
  ↕ existing gateway setup
model provider
```

The daemon binds to loopback by default. Do not expose it publicly.

## Runtime requirements

Release users need:

- A working Claude Code CLI or compatible wrapper on the devbox
- SSH access to the devbox if accessing from another machine

## Download a release

GitHub Releases provide ready-to-run packages for:

- Linux x86_64
- Linux arm64
- macOS x86_64
- macOS arm64

Download the package that matches your machine, extract it, and run the binary:

```bash
tar -xzf claude-remote-web-v0.1.0-linux-x86_64.tar.gz
cd claude-remote-web-v0.1.0-linux-x86_64
./claude-remote-web --check
./claude-remote-web
```

Release binaries include the Web UI, so `web_dir` is optional. By default the daemon binds on loopback and may let the OS choose an available port; set `bind = "127.0.0.1:8787"` in the config file if you want a stable port. Use SSH port forwarding when accessing a remote devbox.

macOS binaries are not signed or notarized in the initial release pipeline. If macOS blocks first launch, right-click the binary in Finder and choose Open, or run:

```bash
xattr -dr com.apple.quarantine claude-remote-web
```

## Build

Build requirements:

- Rust toolchain with `cargo` and `rustfmt`
- Node.js and npm

From the project root:

```bash
npm --prefix web install
npm --prefix web run build
cargo build --release --manifest-path Cargo.toml
```

## Configuration

Create:

```bash
mkdir -p ~/.claude-remote-web
vim ~/.claude-remote-web/config.toml
```

Native Claude example:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["claude"]
default_permission_mode = "bypassPermissions"
```

`web_dir` is optional for release binaries because the Web UI is embedded. Set `web_dir` when running from source or when you want to serve a custom frontend build.

Source/custom frontend only:

```toml
web_dir = "/absolute/path/to/web/dist"
```

`ttadk` wrapper example:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
default_permission_mode = "bypassPermissions"
```

The daemon appends native Claude arguments after the launcher prefix:

```text
--print
--input-format stream-json
--output-format stream-json
--include-partial-messages
--permission-mode <mode>
--verbose
--resume <id>    # only when a session id is known
```

`claude_bin = "claude"` is still supported for backward compatibility and is treated as `launcher = ["claude"]`.

You can also pass a config file explicitly:

```bash
./claude-remote-web --config /path/to/config.toml
```

When running from source:

```bash
cargo run --release --manifest-path Cargo.toml -- --config /path/to/config.toml
```

## Run from source

Start the daemon from the project root on the devbox:

```bash
scripts/start-server.sh
```

Useful source-tree variants:

```bash
scripts/start-server.sh --config /path/to/config.toml
scripts/start-server.sh --skip-web-build
scripts/start-server.sh --check --config /path/to/config.toml
```

The source-tree helper script builds `web/dist` unless `--skip-web-build` is set, then starts the Rust backend with `cargo run --release`.

After the daemon binds successfully, it prints the resolved remote bind address, an SSH tunnel command, and the local browser URL:

```text
Claude Remote Web is running.

Remote bind: 127.0.0.1:8787

From your local machine, open an SSH tunnel:
  ssh -N -L 8787:127.0.0.1:8787 <devbox>

Then open in your browser:
  http://127.0.0.1:8787
```

If accessing from another machine, run the printed SSH tunnel command on your local machine, replacing `<devbox>` with the remote host name. Then open the printed browser URL.

## Create a session

Open the Web UI and click **New chat**. The start screen asks what Claude can help with first, then shows the selected project, worktree, and permission mode as Project context. Use **Change** to choose a recent project, enter a devbox workspace path, toggle git worktree creation, or adjust permission mode.

The daemon starts the configured launcher in the selected project context, streams events back to the browser, and sends the first prompt from the start screen into the new session. Chat titles can be renamed later from the conversation header.

Use **New group** in the session sidebar to create custom chat groups. Drag chats onto a group heading/list, or use a chat row's **Move** control, to persist the session's group membership on the daemon.

## Add context to a prompt

Use the composer `+` button to attach context references before sending:

- Repo path references are sent as `@path/to/file` in the prompt, so Claude Code can read the file from the session working directory. Use paths relative to the session cwd. The Web UI does not read the file contents or browse arbitrary devbox paths.
- Pasted text context appears as a collapsible snippet card with line/character counts, then is sent as a named fenced text block with the prompt.

Attachment chips and snippet cards can be removed before sending. Attachments are cleared after a successful send.

## Keyboard shortcuts

The Web UI supports app-level shortcuts for keyboard-first navigation:

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+K` | Focus the composer and open slash commands when the draft is empty |
| `/` | Focus the composer from outside text fields |
| `Esc` | Close shortcut help, slash autocomplete, the Activity drawer, or the command palette |
| `Cmd/Ctrl+B` | Toggle the session sidebar |
| `Cmd/Ctrl+I` | Toggle the Activity drawer |
| `Alt/Option+Up` / `Alt/Option+Down` | Switch between visible sessions |

`Cmd/Ctrl+L` is intentionally left to the browser address bar; use `Cmd/Ctrl+K` or `/` to return to Claude input.

Enable **Use git worktree** to start Claude in an isolated checkout. Worktree sessions show the checkout path, source repo, branch, clean/dirty state, and changed files in the worktree status panel below the session header. Dirty worktrees expose a read-only **View diff** action. Worktree sessions can also copy delivery context for manual commit/PR handoff without executing git writes. `Stop only` keeps the worktree for review; `Stop and remove worktree` is only available for clean app-created worktrees and never force-removes dirty changes.

## Session API

Worktree diffs are read-only and available for worktree sessions:

```text
GET /api/sessions/<session-id>/worktree-diff
```

This returns `{ "diff": "..." }` for the current unstaged worktree diff.

Session groups can be managed without touching Claude processes:

```text
GET /api/session-groups
POST /api/session-groups
{ "name": "Launch work" }
PATCH /api/session-groups/<group-id>
{ "name": "Renamed", "sortOrder": 1 }
DELETE /api/session-groups/<group-id>
```

Deleting a group keeps the sessions and clears their group assignment.

Session names and group assignments can be updated without restarting Claude:

```text
PATCH /api/sessions/<session-id>
{ "name": "Renamed chat", "groupId": "<group-id>" }
```

Send `null` or an empty string as `name` to clear the custom name and fall back to the workspace-derived title. Send `"groupId": null` to move a session back to the ungrouped project sections.

Session transcripts can be read without attaching to a running Claude process:

```text
GET /api/sessions/<session-id>/transcript?afterId=<last-seen-event-id>&limit=<max-events>
```

This returns persisted append-only UI events as `{ "events": [...] }` for active, stopped, ended, failed, or archived sessions. `limit` keeps long-session initial loads bounded by returning only the latest matching events, and `beforeId` can page backward through older transcript windows. The Web UI renders a bounded event window and loads older transcript pages as the conversation scrolls upward while keeping the persisted transcript append-only. `GET /api/sessions/<session-id>/events?afterId=...` remains the WebSocket replay-then-live stream for running sessions. Archived sessions remain read-only and reject mutation routes such as input, stop, restart, and resume until unarchived.

## Diagnostics

The Activity drawer includes a dev-only Diagnostics section for startup and runtime health. It shows the resolved config summary, a secret-redacted launcher argv preview with the native Claude args appended, web asset status, data directory writability, recent failed sessions, and the selected session's recent stderr/error/system event summaries.

The same data is available through:

```text
GET /api/diagnostics
GET /api/sessions/<session-id>/diagnostics
```

Diagnostics redact common secret-bearing argv and stderr shapes such as token, password, secret, credential, authorization, cookie, JWT, and API key values. Raw stdout/stderr/event logs remain append-only on disk.

## Data layout

Default data directory:

```text
~/.claude-remote-web/
  config.toml
  session-groups.json
  sessions/
    <session-id>/
      meta.json
      events.jsonl
      raw-stdout.jsonl
      stderr.log
```

## Verification

Run the full verification suite:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:visual
```

Expected current coverage:

- `cargo fmt --manifest-path Cargo.toml -- --check` passes
- `cargo test --manifest-path Cargo.toml` passes
- Frontend Vitest suite passes
- Frontend production build succeeds
- Frontend Playwright visual smoke checks and screenshot baselines pass across wide desktop, desktop, and narrow viewports

## Security notes

- Keep `bind` set to `127.0.0.1` unless there is a separate trusted reverse proxy/auth layer.
- Prefer SSH local port forwarding for access.
- `launcher` is argv-based and is not executed through a shell.
- The first version does not include multi-user authentication or interactive allow/deny permission prompts.
- The current raw Claude Code CLI `stream-json` control path does not expose documented browser-side stop-generating or permission approve/deny frames. The Web UI may highlight risky or permission-like actions, but approval/denial still has to happen in the terminal until the daemon adopts a real permission decision control API.
