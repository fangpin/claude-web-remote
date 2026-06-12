use crate::{AppResult, UiEvent, normalize_claude_stdout};
use std::{
    io::ErrorKind,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{Mutex, mpsc},
};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ClaudeProcessConfig {
    pub launcher: Vec<String>,
    pub cwd: PathBuf,
    pub permission_mode: String,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ProcessEvent {
    StdoutLine(String),
    StderrLine(String),
    UiEvent(UiEvent),
    Exited(Option<i32>),
}

pub struct ClaudeProcess {
    child_id: Option<u32>,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
}

impl ClaudeProcess {
    pub async fn spawn(
        session_id: Uuid,
        config: ClaudeProcessConfig,
    ) -> AppResult<(Self, mpsc::Receiver<ProcessEvent>)> {
        let Some((program, launcher_args)) = config.launcher.split_first() else {
            return Err(crate::AppError::InvalidRequest(
                "launcher cannot be empty".to_string(),
            ));
        };
        let mut command = Command::new(program);
        command.args(launcher_args);
        command
            .current_dir(&config.cwd)
            .arg("--input-format")
            .arg("stream-json")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--permission-mode")
            .arg(&config.permission_mode)
            .arg("--verbose")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(resume_session_id) = &config.resume_session_id {
            command.arg("--resume").arg(resume_session_id);
        }

        let mut child = spawn_with_retry(command).await?;
        let child_id = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| crate::AppError::Process("missing child stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| crate::AppError::Process("missing child stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| crate::AppError::Process("missing child stderr".to_string()))?;

        let (tx, rx) = mpsc::channel(256);
        let event_id = Arc::new(AtomicU64::new(1));

        spawn_stdout_reader(session_id, stdout, tx.clone(), event_id.clone());
        spawn_stderr_reader(stderr, tx.clone());
        spawn_waiter(child, tx);

        Ok((
            Self {
                child_id,
                stdin: Arc::new(Mutex::new(stdin)),
            },
            rx,
        ))
    }

    pub async fn send_input(&self, text: &str) -> AppResult<()> {
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{ "type": "text", "text": text }]
            }
        })
        .to_string();
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn kill(&self) -> AppResult<()> {
        if let Some(child_id) = self.child_id {
            unsafe {
                libc::kill(child_id as i32, libc::SIGKILL);
            }
        }
        Ok(())
    }
}

async fn spawn_with_retry(mut command: Command) -> AppResult<Child> {
    let mut last_error = None;
    for _ in 0..5 {
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(err) if err.kind() == ErrorKind::ExecutableFileBusy => {
                last_error = Some(err);
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(err) => return Err(err.into()),
        }
    }
    Err(last_error
        .expect("retry loop should record an error")
        .into())
}

fn spawn_stdout_reader(
    session_id: Uuid,
    stdout: tokio::process::ChildStdout,
    tx: mpsc::Sender<ProcessEvent>,
    event_id: Arc<AtomicU64>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let id = event_id.fetch_add(1, Ordering::SeqCst);
            let event = normalize_claude_stdout(id, session_id, &line);
            let _ = tx.send(ProcessEvent::StdoutLine(line)).await;
            let _ = tx.send(ProcessEvent::UiEvent(event)).await;
        }
    });
}

fn spawn_stderr_reader(stderr: tokio::process::ChildStderr, tx: mpsc::Sender<ProcessEvent>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = tx.send(ProcessEvent::StderrLine(line)).await;
        }
    });
}

fn spawn_waiter(mut child: Child, tx: mpsc::Sender<ProcessEvent>) {
    tokio::spawn(async move {
        let status = child.wait().await;
        let code = status.ok().and_then(|status| status.code());
        let _ = tx.send(ProcessEvent::Exited(code)).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventKind;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn fake_claude(dir: &std::path::Path) -> PathBuf {
        let path = dir.join(format!("fake-claude-{}.sh", Uuid::new_v4()));
        {
            let mut file = fs::File::create(&path).unwrap();
            use std::io::Write;
            file.write_all(
                br#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session"}\n'
while IFS= read -r line; do
  text=$(python3 -c 'import json,sys; msg=json.loads(sys.argv[1]); print(msg["message"]["content"][0]["text"])' "$line")
  printf '{"type":"assistant","message":"ack:%s"}\n' "$text"
  if [[ "$text" == "exit" ]]; then
    printf 'bye\n' >&2
    exit 0
  fi
done
"#,
            )
            .unwrap();
            file.sync_all().unwrap();
        }
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[tokio::test]
    async fn starts_process_writes_input_and_streams_events() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let (process, mut rx) = ClaudeProcess::spawn(
            Uuid::new_v4(),
            ClaudeProcessConfig {
                launcher: vec![bin.to_string_lossy().to_string()],
                cwd: temp.path().to_path_buf(),
                permission_mode: "acceptEdits".to_string(),
                resume_session_id: None,
            },
        )
        .await
        .unwrap();

        process.send_input("hello").await.unwrap();

        let mut saw_ack = false;
        for _ in 0..4 {
            if let Some(ProcessEvent::UiEvent(event)) = rx.recv().await
                && event.kind == EventKind::Assistant
                && event.payload.to_string().contains("ack:hello")
            {
                saw_ack = true;
                break;
            }
        }

        assert!(saw_ack);
        process.send_input("exit").await.unwrap();

        let mut saw_exit = false;
        for _ in 0..8 {
            if let Some(ProcessEvent::Exited(Some(0))) = rx.recv().await {
                saw_exit = true;
                break;
            }
        }
        assert!(saw_exit);
    }

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

    #[tokio::test]
    async fn emits_exit_event() {
        let temp = tempfile::tempdir().unwrap();
        let bin = fake_claude(temp.path());
        let (process, mut rx) = ClaudeProcess::spawn(
            Uuid::new_v4(),
            ClaudeProcessConfig {
                launcher: vec![bin.to_string_lossy().to_string()],
                cwd: temp.path().to_path_buf(),
                permission_mode: "acceptEdits".to_string(),
                resume_session_id: None,
            },
        )
        .await
        .unwrap();

        process.send_input("exit").await.unwrap();

        let mut saw_exit = false;
        for _ in 0..8 {
            if let Some(ProcessEvent::Exited(Some(0))) = rx.recv().await {
                saw_exit = true;
                break;
            }
        }

        assert!(saw_exit);
    }
}
