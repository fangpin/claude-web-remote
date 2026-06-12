# Claude Remote Web Release Package

This package contains a `claude-remote-web` executable for Linux or macOS.

## Run

From inside the extracted package directory:

```bash
./claude-remote-web --check
./claude-remote-web
```

Or, from the directory where you extracted the tarball:

```bash
cd <extracted-package-dir>
./claude-remote-web --check
./claude-remote-web
```

By default the daemon listens on `127.0.0.1:8787` and serves the embedded Web UI from the binary.

Open the Web UI locally:

```text
http://127.0.0.1:8787
```

If the daemon runs on a remote devbox, keep the daemon bound to loopback and use SSH port forwarding:

```bash
ssh -N -L 8787:127.0.0.1:8787 <devbox>
```

Then open `http://127.0.0.1:8787` on your local machine.

## Configure

Copy `config.example.toml` to `~/.claude-remote-web/config.toml` and edit it for your environment.

`web_dir` is optional in release binaries because the Web UI is embedded. Set `web_dir` only when you want to serve an external custom frontend build.

## macOS unsigned binary note

The macOS binary is not signed or notarized. On first launch, macOS may block it because the developer cannot be verified.

You can usually open it by right-clicking the binary in Finder and choosing Open. For command-line use, you may need:

```bash
xattr -dr com.apple.quarantine claude-remote-web
```
