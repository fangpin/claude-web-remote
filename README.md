# Claude Remote Web

Claude Remote Web is a self-hosted Web console for controlling Claude Code sessions running on a remote devbox.

The code, files, git repositories, Claude CLI, and model gateway all stay on the remote machine. The browser is only a control UI.

## Features

- Rust daemon with REST and WebSocket APIs
- React Web UI for multi-session control
- Session creation by working directory
- Streaming event display from `claude --output-format stream-json`
- User input forwarding to the remote Claude process
- Claude-like composer with slash commands, context hints, context reference attachments, and inline stop/send controls
- Stop and restart session controls
- Event, stderr, raw stdout, and session metadata persistence
- Automatic Claude session id extraction and restart resume
- Config file support through `~/.claude-remote-web/config.toml`
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
--input-format stream-json
--output-format stream-json
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

In the Web UI:

```text
Working directory: /path/to/remote/repo
Permission mode: bypassPermissions
```

The daemon starts the configured launcher in that working directory, streams events back to the browser, and names the session from the first user message.

## Add context to a prompt

Use the composer `+` button to attach context references before sending:

- Repo path references are sent as `@path/to/file` in the prompt, so Claude Code can read the file from the session working directory. Use paths relative to the session cwd. The Web UI does not read the file contents or browse arbitrary devbox paths.
- Pasted text context is sent as a named fenced text block with the prompt.

Attachment chips can be removed before sending. Attachments are cleared after a successful send.

## Session History API

Session transcripts can be read without attaching to a running Claude process:

```text
GET /api/sessions/<session-id>/transcript?afterId=<last-seen-event-id>
```

This returns persisted append-only UI events as `{ "events": [...] }` for active, stopped, ended, failed, or archived sessions. `GET /api/sessions/<session-id>/events?afterId=...` remains the WebSocket replay-then-live stream for running sessions. Archived sessions remain read-only and reject mutation routes such as input, stop, restart, and resume until unarchived.

## Data layout

Default data directory:

```text
~/.claude-remote-web/
  config.toml
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
- `cargo test --manifest-path Cargo.toml` is currently red with backend failures
- Frontend Vitest suite passes
- Frontend production build succeeds
- Frontend Playwright visual smoke checks pass across wide desktop, desktop, and narrow viewports without screenshot snapshots

## Security notes

- Keep `bind` set to `127.0.0.1` unless there is a separate trusted reverse proxy/auth layer.
- Prefer SSH local port forwarding for access.
- `launcher` is argv-based and is not executed through a shell.
- The first version does not include multi-user authentication or interactive allow/deny permission prompts.
