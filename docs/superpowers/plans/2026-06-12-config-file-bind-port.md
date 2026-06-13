# Config File Bind Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon use the configured bind port from the config file, while preserving dynamic system-assigned ports when no bind is configured.

**Architecture:** `Config::resolve` should resolve bind with the same precedence as other settings: CLI/env overrides file config, and the built-in fallback remains `127.0.0.1:0`. The existing config management UI can continue editing the full bind address string because the backend already validates and writes it.

**Tech Stack:** Rust backend (`clap`, `tokio`, `serde`, `toml`), existing backend unit tests, existing README/CLAUDE docs.

---

## File Structure

- Modify `crates/server/src/config.rs`
  - Responsible for loading TOML config, resolving CLI/file/default precedence, validating managed config saves, and backend config unit tests.
  - Only change bind precedence in `Config::resolve`; do not change launcher, data directory, web directory, worktree, or permission mode behavior.
- Modify `README.md`
  - Responsible for user-facing configuration documentation. Update only if the text implies config-file `bind` is ignored or if examples need to mention dynamic port behavior.
- Modify `CLAUDE.md`
  - Responsible for project instructions. Update supported config behavior if needed after the code change.

---

### Task 1: Add failing config precedence coverage

**Files:**
- Modify: `crates/server/src/config.rs:415-456`
- Test: `crates/server/src/config.rs`

- [ ] **Step 1: Rename the existing bind-file test and change the expected bind**

In `crates/server/src/config.rs`, replace this test name and assertion:

```rust
#[tokio::test]
async fn ignores_config_file_bind_and_expands_home_paths() {
```

with:

```rust
#[tokio::test]
async fn uses_config_file_bind_and_expands_home_paths() {
```

Then replace this assertion inside the same test:

```rust
assert_eq!(resolved.bind, "127.0.0.1:0".parse::<SocketAddr>().unwrap());
```

with:

```rust
assert_eq!(resolved.bind, "127.0.0.1:9999".parse::<SocketAddr>().unwrap());
```

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run:

```bash
cargo test --manifest-path Cargo.toml uses_config_file_bind_and_expands_home_paths
```

Expected: the test fails because `resolved.bind` is still `127.0.0.1:0` instead of `127.0.0.1:9999`.

---

### Task 2: Implement minimal bind precedence change

**Files:**
- Modify: `crates/server/src/config.rs:115-119`
- Test: `crates/server/src/config.rs`

- [ ] **Step 1: Change `Config::resolve` bind precedence**

In `crates/server/src/config.rs`, replace the `bind` field initialization in `Config::resolve`:

```rust
bind: self
    .bind
    .unwrap_or_else(|| "127.0.0.1:0".parse().expect("valid default bind")),
```

with:

```rust
bind: self
    .bind
    .or(file_config.bind)
    .unwrap_or_else(|| "127.0.0.1:0".parse().expect("valid default bind")),
```

- [ ] **Step 2: Run the focused backend test to verify it passes**

Run:

```bash
cargo test --manifest-path Cargo.toml uses_config_file_bind_and_expands_home_paths
```

Expected: the test passes.

- [ ] **Step 3: Run the existing CLI override test to verify CLI/env precedence remains intact**

Run:

```bash
cargo test --manifest-path Cargo.toml cli_values_override_file_values
```

Expected: the test passes and still confirms CLI `bind = 127.0.0.1:7777` overrides file `bind = 127.0.0.1:9999`.

---

### Task 3: Verify default dynamic port behavior remains unchanged

**Files:**
- Test: `crates/server/src/config.rs`

- [ ] **Step 1: Run the built-in default test**

Run:

```bash
cargo test --manifest-path Cargo.toml uses_built_in_defaults_when_config_file_is_empty
```

Expected: the test passes and confirms an empty config file resolves to `127.0.0.1:0`.

- [ ] **Step 2: Run startup usage dynamic-port coverage**

Run:

```bash
cargo test --manifest-path Cargo.toml startup_usage_uses_listener_local_addr
```

Expected: the test passes and confirms startup output uses the actual bound port when configured with port `0`.

---

### Task 4: Review and update documentation only where needed

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `CLAUDE.md`

- [ ] **Step 1: Check README bind wording**

Read the README sections around configuration and startup. If the README already documents `bind = "127.0.0.1:8787"` as a supported config field without saying it is ignored, leave it unchanged. If you update it, use this sentence near the configuration examples:

```markdown
If `bind` is omitted, the daemon falls back to `127.0.0.1:0` and lets the OS choose an available port.
```

- [ ] **Step 2: Check CLAUDE.md bind wording**

Read the supported config fields in `CLAUDE.md`. If it already lists `bind` and says to bind to `127.0.0.1` by default, leave it unchanged. If you update it, add this sentence near the supported fields:

```markdown
When `bind` is omitted, startup uses `127.0.0.1:0` so the OS assigns an available loopback port.
```

---

### Task 5: Run required verification

**Files:**
- Verify: backend config behavior

- [ ] **Step 1: Run backend formatting check**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
```

Expected: command exits 0.

- [ ] **Step 2: Run backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: command exits 0 with all backend tests passing.

- [ ] **Step 3: If docs were changed, check final diff**

Run:

```bash
git diff -- README.md CLAUDE.md crates/server/src/config.rs
```

Expected: diff contains only the bind precedence test, the minimal precedence implementation, and any necessary bind documentation wording.

---

## Self-Review

- Spec coverage: The plan covers config-file `bind` taking effect, CLI/env override precedence, and preserving dynamic OS-assigned ports when no bind is configured.
- Placeholder scan: No placeholders or open-ended implementation steps remain.
- Type consistency: The plan uses existing `SocketAddr`, `Config::resolve`, and `file_config.bind` types already present in `crates/server/src/config.rs`.
