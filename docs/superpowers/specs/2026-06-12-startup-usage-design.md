# Startup Usage Output Design

## Goal

After the daemon successfully starts listening, print concise usage instructions that tell the operator how to reach the Web UI through the default SSH-only access model.

The output must include:

- The actual daemon bind address from resolved configuration.
- An SSH local port forwarding command template for the remote host.
- The browser URL to open on the local machine.

## Scope

This change affects daemon startup output and project documentation only. It does not change networking defaults, authentication, session behavior, launcher behavior, or frontend behavior.

## Runtime behavior

The Rust daemon prints the usage block after `TcpListener::bind(config.bind)` succeeds and before serving requests. This ensures the printed address and port come from the resolved runtime configuration and also covers launches that do not use `scripts/start-server.sh`.

For a bind address like `127.0.0.1:8787`, the daemon prints instructions equivalent to:

```text
Claude Remote Web is running.

Remote bind: 127.0.0.1:8787

From your local machine, open an SSH tunnel:
  ssh -N -L 8787:127.0.0.1:8787 <devbox>

Then open in your browser:
  http://127.0.0.1:8787
```

The SSH command uses `<devbox>` as a placeholder because the daemon cannot know the user's SSH hostname. The local port defaults to the same port as the daemon bind port so the command is easy to copy and matches the default README examples.

## Documentation behavior

`README.md` should continue to document the SSH tunnel and browser URL in the run section. If the runtime output introduces clearer wording, the README should be updated to match.

`CLAUDE.md` should add a project rule requiring future changes to check whether `README.md` and `CLAUDE.md` need updates, and to mention the result in the final summary.

## Error handling

The usage block is printed only after binding succeeds. If binding fails, startup still exits through the existing error path and does not print instructions for a server that is not running.

## Testing

Backend verification should run because this changes daemon startup behavior:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
```

Manual startup/config verification should also confirm that startup output includes the actual bind address, SSH tunnel command, and browser URL.
