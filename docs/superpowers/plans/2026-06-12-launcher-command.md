# Launcher Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support wrapper launchers such as `ttadk claude -m gpt-5.5 --skip-check -a` while keeping native `claude` as the default.

**Architecture:** Replace the single `claude_bin` runtime value with a launcher argv vector. Config resolution produces `launcher: Vec<String>` from CLI `--launcher`, config `launcher`, config `claude_bin`, or default `["claude"]`. `ClaudeProcess` starts `launcher[0]`, applies `launcher[1..]`, then appends native Claude Code stream-json arguments.

**Tech Stack:** Rust 1.95, Clap, Serde/TOML, Tokio process management, existing Rust tests and API integration tests.

---

## File Structure

Modify these files:

```text
crates/server/src/config.rs             # add launcher config and resolution tests
crates/server/src/process.rs            # spawn from launcher argv prefix
crates/server/src/session.rs            # store/pass launcher Vec<String>
crates/server/src/main.rs               # pass resolved launcher to SessionManager
crates/server/tests/api_integration.rs  # verify wrapper args + native args ordering
```

No frontend changes are needed.

---

### Task 1: Resolve launcher config

**Files:**
- Modify: `crates/server/src/config.rs`

- [ ] **Step 1: Write failing launcher config tests**

In `crates/server/src/config.rs`, update types:

```rust
#[derive(Debug, Clone, Parser)]
#[command(name = "claude-remote-web")]
pub struct Config {
    #[arg(long, env = "CRW_CONFIG")]
    pub config: Option<PathBuf>,

    #[arg(long, env = "CRW_BIND")]
    pub bind: Option<SocketAddr>,

    #[arg(long, env = "CRW_DATA_DIR")]
    pub data_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_CLAUDE_BIN")]
    pub claude_bin: Option<PathBuf>,

    #[arg(long = "launcher", env = "CRW_LAUNCHER")]
    pub launcher: Vec<String>,

    #[arg(long, env = "CRW_WEB_DIR")]
    pub web_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_DEFAULT_PERMISSION_MODE")]
    pub default_permission_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub launcher: Vec<String>,
    pub web_dir: Option<PathBuf>,
    pub default_permission_mode: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct FileConfig {
    bind: Option<SocketAddr>,
    data_dir: Option<PathBuf>,
    claude_bin: Option<PathBuf>,
    launcher: Option<Vec<String>>,
    web_dir: Option<PathBuf>,
    default_permission_mode: Option<String>,
}
```

Update every existing `Config { ... }` test literal to include:

```rust
launcher: Vec::new(),
```

Update assertions that read `resolved.claude_bin` to read `resolved.launcher`:

```rust
assert_eq!(resolved.launcher, vec!["claude".to_string()]);
```

Add these tests to `config::tests`:

```rust
#[tokio::test]
async fn claude_bin_maps_to_single_item_launcher() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(&config_path, r#"claude_bin = "~/bin/claude""#).unwrap();

    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: Vec::new(),
        web_dir: None,
        default_permission_mode: None,
    };

    let resolved = config.resolve().await.unwrap();
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

    assert_eq!(resolved.launcher, vec![home.join("bin/claude").to_string_lossy().to_string()]);
}

#[tokio::test]
async fn launcher_overrides_claude_bin_in_config_file() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(&config_path, r#"
claude_bin = "claude"
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
"#).unwrap();

    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: Vec::new(),
        web_dir: None,
        default_permission_mode: None,
    };

    let resolved = config.resolve().await.unwrap();

    assert_eq!(resolved.launcher, vec!["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]);
}

#[tokio::test]
async fn cli_launcher_overrides_file_launcher_and_claude_bin() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("config.toml");
    fs::write(&config_path, r#"
claude_bin = "claude"
launcher = ["from-file"]
"#).unwrap();

    let config = Config {
        config: Some(config_path),
        bind: None,
        data_dir: None,
        claude_bin: None,
        launcher: vec!["ttadk".to_string(), "claude".to_string(), "-a".to_string()],
        web_dir: None,
        default_permission_mode: None,
    };

    let resolved = config.resolve().await.unwrap();

    assert_eq!(resolved.launcher, vec!["ttadk", "claude", "-a"]);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml config::tests -- --nocapture
```

Expected: FAIL because `ResolvedConfig.launcher` is not populated by the resolver yet.

- [ ] **Step 3: Implement launcher resolution**

In `crates/server/src/config.rs`, add helper:

```rust
fn path_to_arg(path: PathBuf) -> String {
    expand_home(path).to_string_lossy().to_string()
}

fn resolve_launcher(cli_launcher: &[String], cli_claude_bin: Option<PathBuf>, file_config: &FileConfig) -> Vec<String> {
    if !cli_launcher.is_empty() {
        return cli_launcher.to_vec();
    }
    if let Some(launcher) = &file_config.launcher {
        if !launcher.is_empty() {
            return launcher.clone();
        }
    }
    if let Some(claude_bin) = cli_claude_bin {
        return vec![path_to_arg(claude_bin)];
    }
    if let Some(claude_bin) = file_config.claude_bin.clone() {
        return vec![path_to_arg(claude_bin)];
    }
    vec!["claude".to_string()]
}
```

In `Config::resolve`, replace the `claude_bin` field construction with:

```rust
launcher: resolve_launcher(&self.launcher, self.claude_bin.clone(), &file_config),
```

Keep other fields unchanged.

- [ ] **Step 4: Run config tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml config::tests -- --nocapture
```

Expected: all config tests pass.

---

### Task 2: Spawn from launcher argv

**Files:**
- Modify: `crates/server/src/process.rs`
- Modify: `crates/server/src/session.rs`
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Write failing process launcher test**

In `crates/server/src/process.rs`, change `ClaudeProcessConfig` to include launcher:

```rust
pub struct ClaudeProcessConfig {
    pub launcher: Vec<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub resume_session_id: Option<String>,
}
```

Update existing process tests from `claude_bin: bin` to:

```rust
launcher: vec![bin.to_string_lossy().to_string()],
```

Add this test:

```rust
#[tokio::test]
async fn appends_native_args_after_launcher_prefix() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("args.log");
    let wrapper = temp.path().join("fake-wrapper.sh");
    {
        let mut file = fs::File::create(&wrapper).unwrap();
        use std::io::Write;
        write!(
            file,
            "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > '{}'\nprintf '{{\"type\":\"system\",\"session_id\":\"wrapped\"}}\\n'\nwhile IFS= read -r line; do exit 0; done\n",
            args_log.display()
        )
        .unwrap();
        file.sync_all().unwrap();
    }
    let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&wrapper, permissions).unwrap();

    let (_process, mut rx) = ClaudeProcess::spawn(
        Uuid::new_v4(),
        ClaudeProcessConfig {
            launcher: vec![
                wrapper.to_string_lossy().to_string(),
                "claude".to_string(),
                "-m".to_string(),
                "gpt-5.5".to_string(),
                "--skip-check".to_string(),
                "-a".to_string(),
            ],
            cwd: temp.path().to_path_buf(),
            permission_mode: "acceptEdits".to_string(),
            resume_session_id: Some("resume-id".to_string()),
        },
    )
    .await
    .unwrap();

    let _ = rx.recv().await;
    let args = fs::read_to_string(args_log).unwrap();
    assert!(args.contains("claude -m gpt-5.5 --skip-check -a --input-format stream-json"));
    assert!(args.contains("--resume resume-id"));
}
```

- [ ] **Step 2: Run process tests to verify they fail**

Run:

```bash
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml process::tests -- --nocapture
```

Expected: FAIL because `ClaudeProcess::spawn` still reads `config.claude_bin`.

- [ ] **Step 3: Implement launcher spawning**

In `ClaudeProcess::spawn`, replace:

```rust
let mut command = Command::new(&config.claude_bin);
```

with:

```rust
let Some((program, launcher_args)) = config.launcher.split_first() else {
    return Err(crate::AppError::InvalidRequest("launcher cannot be empty".to_string()));
};
let mut command = Command::new(program);
command.args(launcher_args);
```

Keep the native Claude args appended after `command.args(launcher_args)`.

- [ ] **Step 4: Update SessionManager to store launcher**

In `crates/server/src/session.rs`, replace `claude_bin: PathBuf` with:

```rust
launcher: Vec<String>,
```

Change constructor to:

```rust
pub fn new(store: EventStore, launcher: Vec<String>, default_permission_mode: String) -> Self {
    Self {
        store,
        launcher,
        default_permission_mode,
        running: Arc::new(Mutex::new(HashMap::new())),
    }
}
```

In `start_process`, replace:

```rust
claude_bin: self.claude_bin.clone(),
```

with:

```rust
launcher: self.launcher.clone(),
```

Update tests from `SessionManager::new(store, bin, ...)` to:

```rust
SessionManager::new(store, vec![bin.to_string_lossy().to_string()], ...)
```

For `PathBuf::from("claude")`, use:

```rust
vec!["claude".to_string()]
```

- [ ] **Step 5: Update main to pass launcher**

In `crates/server/src/main.rs`, replace:

```rust
config.claude_bin.clone(),
```

with:

```rust
config.launcher.clone(),
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml process::tests session::tests -- --nocapture
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
```

Expected: all backend tests pass.

---

### Task 3: Integration test for wrapper launcher

**Files:**
- Modify: `crates/server/tests/api_integration.rs`

- [ ] **Step 1: Update integration app setup**

Change `spawn_app` signature from:

```rust
async fn spawn_app(temp: &tempfile::TempDir, claude_bin: PathBuf) -> SocketAddr
```

to:

```rust
async fn spawn_app(temp: &tempfile::TempDir, launcher: Vec<String>) -> SocketAddr
```

Update `SessionManager::new` call to pass `launcher`.

Update existing callers from:

```rust
let addr = spawn_app(&temp, bin).await;
```

to:

```rust
let addr = spawn_app(&temp, vec![bin.to_string_lossy().to_string()]).await;
```

- [ ] **Step 2: Add wrapper integration test**

Add this test to `crates/server/tests/api_integration.rs`:

```rust
#[tokio::test]
async fn wrapper_launcher_receives_native_args_after_prefix() {
    let temp = tempfile::tempdir().unwrap();
    let args_log = temp.path().join("wrapper-args.log");
    let wrapper = fake_claude_recording_args(temp.path(), &args_log);
    let addr = spawn_app(
        &temp,
        vec![
            wrapper.to_string_lossy().to_string(),
            "claude".to_string(),
            "-m".to_string(),
            "gpt-5.5".to_string(),
            "--skip-check".to_string(),
            "-a".to_string(),
        ],
    )
    .await;
    let client = reqwest::Client::new();

    let created: Value = client
        .post(format!("http://{addr}/api/sessions"))
        .json(&json!({ "cwd": temp.path(), "name": "demo" }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let session_id = created["id"].as_str().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    client
        .post(format!("http://{addr}/api/sessions/{session_id}/restart"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let args = fs::read_to_string(args_log).unwrap();
    assert!(args.contains("claude -m gpt-5.5 --skip-check -a --input-format stream-json"));
    assert!(args.contains("--resume resume-session"));
}
```

- [ ] **Step 3: Run integration tests**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml --test api_integration -- --nocapture
```

Expected: all API integration tests pass.

---

### Task 4: Final verification

**Files:**
- Modify only if verification exposes issues in files touched by Tasks 1-3.

- [ ] **Step 1: Run full verification**

Run:

```bash
cargo fmt --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- --check
cargo test --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web test
npm --prefix /data00/home/fangpin.brave/repos/claude-remote-web/web run build
```

Expected: all commands pass.

- [ ] **Step 2: Verify explicit launcher config startup**

Create a temporary config and start the daemon:

```bash
cat > /tmp/claude-remote-web-launcher-test.toml <<'EOF'
bind = "127.0.0.1:8789"
data_dir = "/tmp/claude-remote-web-launcher-test"
launcher = ["claude"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web/web/dist"
default_permission_mode = "acceptEdits"
EOF
cargo run --manifest-path /data00/home/fangpin.brave/repos/claude-remote-web/Cargo.toml -- --config /tmp/claude-remote-web-launcher-test.toml
```

Expected: server starts on `127.0.0.1:8789`.

In another shell:

```bash
curl -s http://127.0.0.1:8789/api/sessions
```

Expected:

```json
{"sessions":[]}
```

Stop the daemon after this check.

---

## Self-Review

- Spec coverage: Task 1 covers config `launcher`, backward-compatible `claude_bin`, and CLI launcher precedence. Task 2 covers process spawning as `launcher + native args`. Task 3 covers wrapper integration with resume. Task 4 covers full verification and explicit launcher config startup.
- Placeholder scan: no incomplete placeholders or undefined future work remain in implementation steps.
- Type consistency: `ResolvedConfig.launcher`, `SessionManager::new(..., launcher, ...)`, and `ClaudeProcessConfig.launcher` use `Vec<String>` consistently.
