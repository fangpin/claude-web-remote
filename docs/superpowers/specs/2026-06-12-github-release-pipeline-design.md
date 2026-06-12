# GitHub Release Pipeline Design

## Goal

Publish Claude Remote Web to GitHub Releases as ready-to-run macOS and Linux packages. Each release package contains a single `claude-remote-web` executable with the React Web UI embedded into the Rust server binary.

The release flow should preserve the project's default security posture: the daemon binds to `127.0.0.1` by default and is intended to be reached through local access or SSH port forwarding.

## Release model

Releases are created by pushing a version tag that matches `v*`, such as:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Actions workflow creates or updates the matching GitHub Release and uploads one package per platform.

Supported platforms:

- Linux x86_64: `x86_64-unknown-linux-gnu`
- Linux arm64: `aarch64-unknown-linux-gnu`
- macOS x86_64: `x86_64-apple-darwin`
- macOS arm64: `aarch64-apple-darwin`

macOS artifacts are not signed or notarized in the first release pipeline. Release notes must tell macOS users that first launch may require right-click opening from Finder or removing the quarantine attribute with:

```bash
xattr -dr com.apple.quarantine claude-remote-web
```

## Runtime asset strategy

The Rust daemon should support two frontend asset sources:

1. If `web_dir` is configured, serve static frontend files from that external directory.
2. If `web_dir` is not configured, serve the frontend assets embedded into the binary at compile time.

This keeps local development and custom deployments flexible while making GitHub Release packages work without a separate `web/dist` directory.

The existing `web_dir` configuration remains valid and keeps priority over embedded assets.

## Package format

Each GitHub Release artifact is a `.tar.gz` package. The package name includes the version and platform:

```text
claude-remote-web-v0.1.0-linux-x86_64.tar.gz
claude-remote-web-v0.1.0-linux-aarch64.tar.gz
claude-remote-web-v0.1.0-macos-x86_64.tar.gz
claude-remote-web-v0.1.0-macos-aarch64.tar.gz
```

Each package contains:

```text
claude-remote-web
README.release.md
config.example.toml
```

The archive format is used so Linux and macOS executable permissions are preserved after extraction.

## User installation flow

A Linux x86_64 user flow looks like this after downloading the matching asset from the GitHub Release page:

```bash
tar -xzf claude-remote-web-v0.1.0-linux-x86_64.tar.gz
./claude-remote-web --check
./claude-remote-web
```

The daemon starts with embedded frontend assets unless the user provides a config file with `web_dir`.

Configuration continues to support the current fields, including:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["claude"]
default_permission_mode = "acceptEdits"
```

## GitHub Actions workflow

Add one release workflow under `.github/workflows/`.

The workflow trigger is:

```yaml
on:
  push:
    tags:
      - 'v*'
```

The workflow has two stages.

### Validation job

Run the existing project checks before publishing artifacts:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
npm --prefix web test
npm --prefix web run build
```

The build jobs should depend on this validation job so a broken tag does not publish release assets.

### Build and upload jobs

Run a matrix over the four supported targets.

Each matrix job should:

1. Check out the repository.
2. Install Node.js and Rust.
3. Install the required Rust target.
4. Install frontend dependencies.
5. Build `web/dist`.
6. Compile the Rust server for the selected target with release optimizations.
7. Run the built binary with `--check` when the binary can run on the current runner.
8. Create the package directory with `claude-remote-web`, `README.release.md`, and `config.example.toml`.
9. Create a `.tar.gz` package.
10. Upload the package to the GitHub Release for the pushed tag.

macOS targets should build on macOS runners. Linux x86_64 should build on Ubuntu. Linux arm64 may use cross-compilation from Ubuntu, with the workflow installing the required linker/toolchain support.

## Release documentation

Add or update release-facing documentation so users know:

- Which asset to download for their platform.
- How to extract and run the binary.
- That `web_dir` is optional for release binaries because assets are embedded.
- That default binding remains `127.0.0.1:8787`.
- How to use SSH port forwarding.
- How to handle macOS unsigned binary warnings.

## Verification

Implementation should verify three layers.

Backend tests:

- No `web_dir` uses embedded frontend assets as the fallback service.
- Configured `web_dir` still takes priority over embedded assets.

Project checks:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
npm --prefix web test
npm --prefix web run build
```

Release workflow checks:

- Each package contains the expected files.
- Built binaries that can execute on the runner pass `--check`.
- A tag-triggered workflow uploads all four platform packages to the GitHub Release.

## Out of scope

- Apple Developer ID signing and notarization.
- Windows artifacts.
- Homebrew, apt, yum, or other package manager distribution.
- Public HTTP exposure or changing the default bind address.
