# Launcher Command Design

## Goal

Support launching Claude Code through wrapper commands such as `ttadk claude -m gpt-5.5 --skip-check -a`, while preserving the existing native `claude` default.

## Design

Replace the single-binary-only launch model with a launcher argv prefix. The daemon builds the child process command as:

```text
launcher + native_claude_args
```

For native Claude Code, the launcher is:

```toml
launcher = ["claude"]
```

For the ttadk wrapper, the launcher is:

```toml
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
```

The resulting argv is:

```text
ttadk claude -m gpt-5.5 --skip-check -a \
  --input-format stream-json \
  --output-format stream-json \
  --permission-mode acceptEdits \
  --verbose \
  --resume <id>
```

The daemon does not interpret wrapper semantics. The user decides whether `-a` is needed by including it in `launcher`.

## Configuration

Add a new config field:

```toml
launcher = ["claude"]
```

Keep backward compatibility:

```toml
claude_bin = "claude"
```

Resolution rules:

1. If `launcher` is set, use it.
2. Else if `claude_bin` is set, use `[claude_bin]`.
3. Else use `["claude"]`.

CLI also supports repeated launcher args:

```bash
claude-remote-web \
  --launcher ttadk \
  --launcher claude \
  --launcher -m \
  --launcher gpt-5.5 \
  --launcher --skip-check \
  --launcher -a
```

CLI `--launcher` overrides file `launcher` and `claude_bin`.

## Security

The launcher is argv-based and never run through a shell. This avoids shell quoting ambiguity and command injection risks from user-provided config.

## Testing

Backend tests cover:

- Default launcher is `["claude"]`.
- `claude_bin` maps to a one-item launcher for backward compatibility.
- `launcher` overrides `claude_bin`.
- CLI repeated `--launcher` overrides config file values.
- `ClaudeProcess` appends native Claude args after the launcher prefix.
- Integration test verifies a fake wrapper receives wrapper args followed by native args and `--resume <id>`.
