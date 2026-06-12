# Claude Remote Web

Claude Remote Web is a self-hosted Web console for controlling Claude Code sessions running on a remote devbox.

The code, files, git repositories, Claude CLI, and model gateway all stay on the remote machine. The browser is only a control UI.

## Features

- Rust daemon with REST and WebSocket APIs
- React Web UI for multi-session control
- Session creation by working directory
- Streaming event display from `claude --output-format stream-json`
- User input forwarding to the remote Claude process
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

## Requirements

- Rust toolchain with `cargo` and `rustfmt`
- Node.js and npm
- A working Claude Code CLI or compatible wrapper on the devbox
- SSH access to the devbox if accessing from another machine

## Build

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
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "acceptEdits"
```

`ttadk` wrapper example:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "acceptEdits"
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
cargo run --release --manifest-path Cargo.toml -- --config /path/to/config.toml
```

## Run

Start the daemon on the devbox:

```bash
scripts/start-server.sh
```

Useful variants:

```bash
scripts/start-server.sh --config /path/to/config.toml
scripts/start-server.sh --skip-web-build
scripts/start-server.sh --check --config /path/to/config.toml
```

The script builds `web/dist` unless `--skip-web-build` is set, then starts the Rust backend with `cargo run --release`.

If accessing from another machine, open an SSH tunnel:

```bash
ssh -N -L 8787:127.0.0.1:8787 <devbox>
```

Then open:

```text
http://127.0.0.1:8787
```

## Create a session

In the Web UI:

```text
Working directory: /path/to/remote/repo
Name: optional display name
Permission mode: acceptEdits
```

The daemon starts the configured launcher in that working directory and streams events back to the browser.

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
```

Expected current coverage:

- Backend unit tests and API integration tests pass
- Frontend Vitest suite passes
- Frontend production build succeeds

## Security notes

- Keep `bind` set to `127.0.0.1` unless there is a separate trusted reverse proxy/auth layer.
- Prefer SSH local port forwarding for access.
- `launcher` is argv-based and is not executed through a shell.
- The first version does not include multi-user authentication or interactive allow/deny permission prompts.
