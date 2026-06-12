# GitHub Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish ready-to-run macOS and Linux GitHub Release packages that contain a `claude-remote-web` binary with the React Web UI embedded.

**Architecture:** Build `web/dist` first, then compile the Rust server so compile-time embedding captures the production frontend. Runtime routing keeps `web_dir` as the highest-priority external asset source and falls back to embedded assets when `web_dir` is absent. A tag-triggered GitHub Actions workflow validates the project, builds four targets, packages each binary with release docs, and uploads `.tar.gz` assets to the matching GitHub Release.

**Tech Stack:** Rust 2024, Axum, tower-http, include_dir, mime_guess, Cargo build scripts, React/Vite/npm, GitHub Actions, softprops/action-gh-release.

---

## File Structure

Create these files:

```text
crates/server/build.rs                         # select real web/dist or generated fallback for embedding
crates/server/src/embedded_assets.rs           # serve compile-time embedded frontend files
.github/workflows/release.yml                  # tag-triggered validation/build/upload workflow
docs/release/README.release.md                 # packaged release instructions
docs/release/config.example.toml               # packaged example config
```

Modify these files:

```text
crates/server/Cargo.toml                       # binary name + build dependencies + embed dependencies
crates/server/src/api.rs                       # route fallback to external web_dir or embedded assets
crates/server/src/config.rs                    # add --check flag without changing resolved runtime config
crates/server/src/lib.rs                       # expose embedded_assets module internally
crates/server/src/main.rs                      # implement binary --check and keep normal startup unchanged
crates/server/tests/api_integration.rs         # cover embedded fallback and web_dir priority
README.md                                      # document release downloads and embedded web assets
```

Do not change the default bind address. The release binary must continue to bind to `127.0.0.1:8787` unless the user configures otherwise.

Commit steps in this plan are checkpoints only. If the user has not explicitly authorized commits, do not run `git commit`; leave changes unstaged or stage only when asked.

---

### Task 1: Add a real release binary name and `--check` mode

**Files:**
- Modify: `crates/server/Cargo.toml`
- Modify: `crates/server/src/config.rs`
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Rename the binary in Cargo metadata**

Edit `crates/server/Cargo.toml` so the top section includes a `[[bin]]` entry immediately after the existing `[lib]` section:

```toml
[package]
name = "claude-remote-web-server"
edition.workspace = true
version.workspace = true
license.workspace = true

[lib]
doctest = false

[[bin]]
name = "claude-remote-web"
path = "src/main.rs"
```

This keeps the library/package name stable while producing `target/<target>/release/claude-remote-web` for release packages.

- [ ] **Step 2: Add the `check` CLI flag to config parsing**

In `crates/server/src/config.rs`, add this field to `pub struct Config` after `config`:

```rust
    #[arg(long)]
    pub check: bool,
```

Every test literal that constructs `Config { ... }` must include:

```rust
            check: false,
```

For example, the start of `uses_built_in_defaults_when_config_file_is_empty` becomes:

```rust
        let config = Config {
            config: Some(config_path),
            check: false,
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
        };
```

- [ ] **Step 3: Add a parser test for `--check`**

Append this test inside `#[cfg(test)] mod tests` in `crates/server/src/config.rs`:

```rust
    #[test]
    fn check_flag_parses_without_runtime_config_changes() {
        let config = Config::parse_from(["claude-remote-web", "--check"]);

        assert!(config.check);
        assert_eq!(config.bind, None);
        assert_eq!(config.data_dir, None);
        assert_eq!(config.web_dir, None);
        assert!(config.launcher.is_empty());
    }
```

- [ ] **Step 4: Run the focused config tests**

Run:

```bash
cargo test --manifest-path Cargo.toml config::tests::check_flag_parses_without_runtime_config_changes -- --nocapture
```

Expected: PASS, proving the flag is accepted before wiring main behavior.

- [ ] **Step 5: Implement `--check` in `main.rs`**

Replace `crates/server/src/main.rs` with:

```rust
use anyhow::Context;
use axum::serve;
use clap::Parser;
use claude_remote_web_server::{AppState, Config, EventStore, SessionManager, build_router};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Config::parse();
    let check = cli.check;
    let config = cli.resolve().await?;

    if check {
        println!("bind = {}", config.bind);
        println!("data_dir = {}", config.data_dir.display());
        println!("launcher = {:?}", config.launcher);
        println!("web_dir = {}", config.web_dir.as_ref().map(|path| path.display().to_string()).unwrap_or_else(|| "<embedded>".to_string()));
        println!("default_permission_mode = {}", config.default_permission_mode);
        return Ok(());
    }

    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.launcher.clone(),
        config.default_permission_mode.clone(),
    );
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}
```

- [ ] **Step 6: Verify the binary check mode**

Run:

```bash
cargo run --manifest-path Cargo.toml --bin claude-remote-web -- --check
```

Expected output contains:

```text
bind = 127.0.0.1:8787
web_dir = <embedded>
default_permission_mode = acceptEdits
```

- [ ] **Step 7: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add crates/server/Cargo.toml crates/server/src/config.rs crates/server/src/main.rs
git commit -m "feat: add release binary check mode"
```

---

### Task 2: Add embedded frontend asset serving

**Files:**
- Modify: `crates/server/Cargo.toml`
- Create: `crates/server/build.rs`
- Create: `crates/server/src/embedded_assets.rs`
- Modify: `crates/server/src/lib.rs`
- Modify: `crates/server/src/api.rs`

- [ ] **Step 1: Add embed dependencies**

In `crates/server/Cargo.toml`, update dependencies to include:

```toml
http = "1"
include_dir = "0.7"
mime_guess = "2"
```

The dependency block should still contain the existing dependencies such as `axum`, `tower-http`, `tokio`, and `uuid`.

- [ ] **Step 2: Create the build script**

Create `crates/server/build.rs` with:

```rust
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let web_dist = manifest_dir.join("../../web/dist");
    println!("cargo:rerun-if-changed={}", web_dist.display());

    let embed_dir = if web_dist.join("index.html").exists() {
        web_dist
    } else {
        let fallback_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set")).join("embedded-web-fallback");
        fs::create_dir_all(&fallback_dir).expect("create embedded web fallback dir");
        fs::write(
            fallback_dir.join("index.html"),
            r#"<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Claude Remote Web</title></head>
  <body><div id="root">Claude Remote Web embedded fallback</div></body>
</html>
"#,
        )
        .expect("write embedded web fallback index");
        fallback_dir
    };

    println!("cargo:rustc-env=CRW_EMBED_WEB_DIR={}", embed_dir.display());
}
```

This lets `cargo test` work before `web/dist` exists while release builds embed the real frontend after `npm --prefix web run build`.

- [ ] **Step 3: Create the embedded asset module**

Create `crates/server/src/embedded_assets.rs` with:

```rust
use axum::{
    body::Body,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use include_dir::{Dir, include_dir};

static WEB_DIST: Dir<'_> = include_dir!("$CRW_EMBED_WEB_DIR");

pub async fn serve(uri: Uri) -> Response {
    let request_path = asset_path(uri.path());

    if let Some(file) = WEB_DIST.get_file(&request_path) {
        return asset_response(&request_path, file.contents());
    }

    if let Some(index) = WEB_DIST.get_file("index.html") {
        return asset_response("index.html", index.contents());
    }

    (StatusCode::NOT_FOUND, "embedded web assets are unavailable").into_response()
}

fn asset_path(uri_path: &str) -> String {
    let trimmed = uri_path.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

fn asset_response(path: &str, contents: &[u8]) -> Response {
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(contents.to_vec()))
        .expect("embedded asset response is valid")
}
```

- [ ] **Step 4: Export the module inside the crate**

In `crates/server/src/lib.rs`, add:

```rust
pub mod embedded_assets;
```

The top of the file should become:

```rust
pub mod api;
pub mod config;
pub mod embedded_assets;
pub mod error;
pub mod event;
pub mod process;
pub mod session;
pub mod store;
```

- [ ] **Step 5: Route missing frontend requests to embedded assets**

In `crates/server/src/api.rs`, change the imports from:

```rust
use crate::{AppError, AppResult, CreateSessionRequest, EventStore, SessionManager};
```

to:

```rust
use crate::{AppError, AppResult, CreateSessionRequest, EventStore, SessionManager, embedded_assets};
```

Then replace `build_router` with:

```rust
pub fn build_router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{id}", get(get_session))
        .route("/api/sessions/{id}/input", post(send_input))
        .route("/api/sessions/{id}/stop", post(stop_session))
        .route("/api/sessions/{id}/restart", post(restart_session))
        .route("/api/sessions/{id}/events", get(events_ws))
        .with_state(state)
        .layer(CorsLayer::permissive());

    if let Some(web_dir) = web_dir {
        api.fallback_service(ServeDir::new(web_dir))
    } else {
        api.fallback(get(embedded_assets::serve))
    }
}
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: PASS. The build script may use the generated fallback index if `web/dist` does not exist.

- [ ] **Step 7: Build the real frontend and verify embedding compiles**

Run:

```bash
npm --prefix web run build
cargo build --release --manifest-path Cargo.toml --bin claude-remote-web
```

Expected: both commands PASS and the release binary exists at:

```text
target/release/claude-remote-web
```

- [ ] **Step 8: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add crates/server/Cargo.toml crates/server/build.rs crates/server/src/embedded_assets.rs crates/server/src/lib.rs crates/server/src/api.rs
git commit -m "feat: embed web assets in release binary"
```

---

### Task 3: Add API integration coverage for asset fallback behavior

**Files:**
- Modify: `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Generalize the test server helper**

In `crates/server/tests/api_integration.rs`, replace `spawn_app` with these two helpers:

```rust
async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr {
    spawn_app_with_web_dir(temp, launcher, None).await
}

async fn spawn_app_with_web_dir(
    temp: &tempfile::TempDir,
    launcher: Vec<String>,
    web_dir: Option<PathBuf>,
) -> SocketAddr {
    let store = EventStore::new(temp.path().join("data")).await.unwrap();
    let manager = SessionManager::new(store.clone(), launcher, "acceptEdits".to_string());
    let state = AppState { manager, store };
    let app: Router = build_router(state, web_dir);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}
```

The existing session tests keep calling `spawn_app` unchanged.

- [ ] **Step 2: Add embedded fallback test**

Append this test to `crates/server/tests/api_integration.rs`:

```rust
#[tokio::test]
async fn serves_embedded_web_assets_without_web_dir() {
    let temp = tempfile::tempdir().unwrap();
    let bin = fake_claude(temp.path());
    let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("http://{addr}/"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let body = response.text().await.unwrap();

    assert!(content_type.starts_with("text/html"));
    assert!(body.contains("Claude Remote Web"));
}
```

- [ ] **Step 3: Add external `web_dir` priority test**

Append this test to `crates/server/tests/api_integration.rs`:

```rust
#[tokio::test]
async fn configured_web_dir_takes_priority_over_embedded_assets() {
    let temp = tempfile::tempdir().unwrap();
    let web_dir = temp.path().join("web-dist");
    fs::create_dir(&web_dir).unwrap();
    fs::write(
        web_dir.join("index.html"),
        "<!doctype html><html><body>external web dir wins</body></html>",
    )
    .unwrap();

    let bin = fake_claude(temp.path());
    let addr = spawn_app_with_web_dir(
        &temp,
        vec![bin.to_string_lossy().to_string()],
        Some(web_dir),
    )
    .await;
    let client = reqwest::Client::new();

    let body = client
        .get(format!("http://{addr}/"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();

    assert!(body.contains("external web dir wins"));
}
```

- [ ] **Step 4: Run the new integration tests**

Run:

```bash
cargo test --manifest-path Cargo.toml --test api_integration serves_embedded_web_assets_without_web_dir configured_web_dir_takes_priority_over_embedded_assets -- --nocapture
```

Expected: both tests PASS.

- [ ] **Step 5: Run all backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add crates/server/tests/api_integration.rs
git commit -m "test: cover embedded web asset fallback"
```

---

### Task 4: Add release package documentation files

**Files:**
- Create: `docs/release/README.release.md`
- Create: `docs/release/config.example.toml`

- [ ] **Step 1: Create packaged release README**

Create `docs/release/README.release.md` with:

```markdown
# Claude Remote Web Release Package

This package contains a `claude-remote-web` executable for Linux or macOS.

## Run

```bash
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
```

- [ ] **Step 2: Create packaged example config**

Create `docs/release/config.example.toml` with:

```toml
bind = "127.0.0.1:8787"
data_dir = "~/.claude-remote-web"
launcher = ["claude"]
default_permission_mode = "acceptEdits"

# Optional: serve an external frontend build instead of embedded assets.
# web_dir = "/absolute/path/to/web/dist"
```

- [ ] **Step 3: Check the docs render as plain Markdown/TOML**

Run:

```bash
git diff -- docs/release/README.release.md docs/release/config.example.toml
```

Expected: the README includes run, SSH tunnel, config, and macOS unsigned-binary instructions; the TOML example does not change the default loopback bind.

- [ ] **Step 4: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add docs/release/README.release.md docs/release/config.example.toml
git commit -m "docs: add release package instructions"
```

---

### Task 5: Add the GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml` with:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install frontend dependencies
        run: npm --prefix web ci

      - name: Check Rust formatting
        run: cargo fmt --manifest-path Cargo.toml -- --check

      - name: Run backend tests
        run: cargo test --manifest-path Cargo.toml

      - name: Run frontend tests
        run: npm --prefix web test

      - name: Build frontend
        run: npm --prefix web run build

  build:
    name: Build ${{ matrix.asset_name }}
    needs: validate
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            asset_name: linux-x86_64
            bin_path: target/x86_64-unknown-linux-gnu/release/claude-remote-web
            can_run: true
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            asset_name: linux-aarch64
            bin_path: target/aarch64-unknown-linux-gnu/release/claude-remote-web
            can_run: false
          - os: macos-latest
            target: x86_64-apple-darwin
            asset_name: macos-x86_64
            bin_path: target/x86_64-apple-darwin/release/claude-remote-web
            can_run: false
          - os: macos-latest
            target: aarch64-apple-darwin
            asset_name: macos-aarch64
            bin_path: target/aarch64-apple-darwin/release/claude-remote-web
            can_run: false

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Linux arm64 linker
        if: matrix.target == 'aarch64-unknown-linux-gnu'
        run: sudo apt-get update && sudo apt-get install -y gcc-aarch64-linux-gnu

      - name: Install frontend dependencies
        run: npm --prefix web ci

      - name: Build frontend
        run: npm --prefix web run build

      - name: Build release binary
        env:
          CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: aarch64-linux-gnu-gcc
        run: cargo build --release --locked --manifest-path Cargo.toml --bin claude-remote-web --target ${{ matrix.target }}

      - name: Check runnable binary
        if: matrix.can_run == true
        run: ${{ matrix.bin_path }} --check

      - name: Package release asset
        shell: bash
        run: |
          set -euo pipefail
          version="${GITHUB_REF_NAME}"
          package="claude-remote-web-${version}-${{ matrix.asset_name }}"
          mkdir -p "dist/${package}"
          cp "${{ matrix.bin_path }}" "dist/${package}/claude-remote-web"
          cp docs/release/README.release.md "dist/${package}/README.release.md"
          cp docs/release/config.example.toml "dist/${package}/config.example.toml"
          chmod +x "dist/${package}/claude-remote-web"
          tar -C dist -czf "dist/${package}.tar.gz" "${package}"
          tar -tzf "dist/${package}.tar.gz"

      - name: Upload release asset
        uses: softprops/action-gh-release@v2
        with:
          files: dist/claude-remote-web-${{ github.ref_name }}-${{ matrix.asset_name }}.tar.gz
          generate_release_notes: true
          body: |
            macOS artifacts are not signed or notarized. On first launch, right-click Open in Finder or run:

            ```bash
            xattr -dr com.apple.quarantine claude-remote-web
            ```
```

- [ ] **Step 2: Verify workflow syntax enough for review**

Run:

```bash
git diff -- .github/workflows/release.yml
```

Expected: the workflow trigger is `push` tags `v*`, permissions include `contents: write`, validation runs before build, and all four platform assets are listed.

- [ ] **Step 3: Confirm the package command works locally for the native binary**

Run:

```bash
npm --prefix web run build
cargo build --release --manifest-path Cargo.toml --bin claude-remote-web
rm -rf /tmp/claude-remote-web-release-test
mkdir -p /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64
cp target/release/claude-remote-web /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/claude-remote-web
cp docs/release/README.release.md /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/README.release.md
cp docs/release/config.example.toml /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/config.example.toml
chmod +x /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/claude-remote-web
tar -C /tmp/claude-remote-web-release-test -czf /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64.tar.gz claude-remote-web-v0.0.0-linux-x86_64
tar -tzf /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64.tar.gz
```

Expected archive listing contains:

```text
claude-remote-web-v0.0.0-linux-x86_64/claude-remote-web
claude-remote-web-v0.0.0-linux-x86_64/README.release.md
claude-remote-web-v0.0.0-linux-x86_64/config.example.toml
```

- [ ] **Step 4: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub release workflow"
```

---

### Task 6: Update project README for release users

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a release download section**

In `README.md`, insert this section after the existing `## Requirements` section and before `## Build`:

```markdown
## Download a release

GitHub Releases provide ready-to-run packages for:

- Linux x86_64
- Linux arm64
- macOS x86_64
- macOS arm64

Download the package that matches your machine, extract it, and run the binary:

```bash
tar -xzf claude-remote-web-v0.1.0-linux-x86_64.tar.gz
./claude-remote-web --check
./claude-remote-web
```

Release binaries include the Web UI, so `web_dir` is optional. Keep the default `bind = "127.0.0.1:8787"` and use SSH port forwarding when accessing a remote devbox.

macOS binaries are not signed or notarized in the initial release pipeline. If macOS blocks first launch, right-click the binary in Finder and choose Open, or run:

```bash
xattr -dr com.apple.quarantine claude-remote-web
```
```

- [ ] **Step 2: Update config docs to mention embedded assets**

In `README.md`, after the TOML example under `## Configuration`, add:

```markdown
`web_dir` is optional for release binaries because the Web UI is embedded. Set `web_dir` when running from source or when you want to serve a custom frontend build.
```

- [ ] **Step 3: Check the README diff**

Run:

```bash
git diff -- README.md
```

Expected: README explains release packages, `--check`, embedded assets, loopback default, SSH tunnel usage, and macOS unsigned binary handling.

- [ ] **Step 4: Commit checkpoint if authorized**

If commits are authorized, run:

```bash
git add README.md
git commit -m "docs: document release packages"
```

---

### Task 7: Run final verification

**Files:**
- Verify all changed files from prior tasks.

- [ ] **Step 1: Run Rust formatting check**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
```

Expected: PASS.

- [ ] **Step 2: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 4: Build frontend assets**

Run:

```bash
npm --prefix web run build
```

Expected: PASS and `web/dist/index.html` exists locally.

- [ ] **Step 5: Build the release binary with embedded real frontend assets**

Run:

```bash
cargo build --release --manifest-path Cargo.toml --bin claude-remote-web
```

Expected: PASS and `target/release/claude-remote-web` exists.

- [ ] **Step 6: Check the release binary config output**

Run:

```bash
target/release/claude-remote-web --check
```

Expected output contains:

```text
bind = 127.0.0.1:8787
web_dir = <embedded>
default_permission_mode = acceptEdits
```

- [ ] **Step 7: Manually verify the embedded Web UI responds**

Run the server in one terminal:

```bash
CRW_DATA_DIR=/tmp/claude-remote-web-release-verify target/release/claude-remote-web
```

In another terminal, run:

```bash
curl -s http://127.0.0.1:8787/ | grep -E "Claude Remote Web|root"
curl -s http://127.0.0.1:8787/api/sessions
```

Expected:

```text
{"sessions":[]}
```

Stop the daemon after the check.

- [ ] **Step 8: Build and inspect a local tarball**

Run:

```bash
rm -rf /tmp/claude-remote-web-release-test
mkdir -p /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64
cp target/release/claude-remote-web /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/claude-remote-web
cp docs/release/README.release.md /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/README.release.md
cp docs/release/config.example.toml /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/config.example.toml
chmod +x /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64/claude-remote-web
tar -C /tmp/claude-remote-web-release-test -czf /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64.tar.gz claude-remote-web-v0.0.0-linux-x86_64
tar -tzf /tmp/claude-remote-web-release-test/claude-remote-web-v0.0.0-linux-x86_64.tar.gz
```

Expected archive listing contains exactly the package directory with:

```text
claude-remote-web
README.release.md
config.example.toml
```

- [ ] **Step 9: Final commit if authorized**

If commits are authorized and prior checkpoints were not committed, run:

```bash
git status --short
git add crates/server/Cargo.toml crates/server/build.rs crates/server/src/embedded_assets.rs crates/server/src/lib.rs crates/server/src/api.rs crates/server/src/config.rs crates/server/src/main.rs crates/server/tests/api_integration.rs .github/workflows/release.yml docs/release/README.release.md docs/release/config.example.toml README.md docs/superpowers/specs/2026-06-12-github-release-pipeline-design.md docs/superpowers/plans/2026-06-12-github-release-pipeline.md
git commit -m "feat: add GitHub release pipeline"
```

---

## Self-Review Notes

Spec coverage:

- Embedded frontend assets: Tasks 2 and 3.
- `web_dir` priority over embedded assets: Tasks 2 and 3.
- `v*` tag-triggered GitHub Release workflow: Task 5.
- Four supported macOS/Linux targets: Task 5.
- `.tar.gz` package format with binary, README, config: Tasks 4 and 5.
- `--check` release validation: Tasks 1, 5, and 7.
- Release documentation including macOS unsigned binary warning: Tasks 4 and 6.
- Default loopback security posture: Tasks 4, 6, and 7.

Placeholder scan: no task uses TBD/TODO/fill-in language; code and commands are explicit.

Type consistency: the binary is consistently named `claude-remote-web`; the embedded module is consistently `embedded_assets`; the runtime config still exposes `web_dir: Option<PathBuf>` and `launcher: Vec<String>`.
