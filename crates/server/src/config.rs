use crate::{AppError, AppResult};
use clap::{Parser, ValueEnum};
use serde::Deserialize;
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
};

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

    #[arg(long = "launcher", env = "CRW_LAUNCHER", allow_hyphen_values = true)]
    pub launcher: Vec<String>,

    #[arg(long, env = "CRW_WEB_DIR")]
    pub web_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_DEFAULT_PERMISSION_MODE")]
    pub default_permission_mode: Option<String>,

    #[arg(long, env = "CRW_WORKTREES_DIR")]
    pub worktrees_dir: Option<PathBuf>,

    #[arg(long, env = "CRW_WORKTREE_BRANCH_PREFIX")]
    pub worktree_branch_prefix: Option<String>,

    #[arg(long, env = "CRW_WORKTREE_BASE_REF")]
    pub worktree_base_ref: Option<WorktreeBaseRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub launcher: Vec<String>,
    pub web_dir: Option<PathBuf>,
    pub default_permission_mode: String,
    pub worktree: WorktreeConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ValueEnum)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeBaseRef {
    Fresh,
    Head,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeConfig {
    pub worktrees_dir: Option<PathBuf>,
    pub branch_prefix: String,
    pub base_ref: WorktreeBaseRef,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct FileConfig {
    bind: Option<SocketAddr>,
    data_dir: Option<PathBuf>,
    claude_bin: Option<PathBuf>,
    launcher: Option<Vec<String>>,
    web_dir: Option<PathBuf>,
    default_permission_mode: Option<String>,
    worktrees_dir: Option<PathBuf>,
    worktree_branch_prefix: Option<String>,
    worktree_base_ref: Option<WorktreeBaseRef>,
}

impl Config {
    pub async fn resolve(&self) -> AppResult<ResolvedConfig> {
        let file_config = load_file_config(self.config.as_deref()).await?;

        Ok(ResolvedConfig {
            bind: self
                .bind
                .or(file_config.bind)
                .unwrap_or_else(|| "127.0.0.1:8787".parse().expect("valid default bind")),
            data_dir: self
                .data_dir
                .clone()
                .or(file_config.data_dir.clone())
                .map(expand_home)
                .unwrap_or_else(default_data_dir),
            launcher: resolve_launcher(&self.launcher, self.claude_bin.clone(), &file_config),
            web_dir: self
                .web_dir
                .clone()
                .or(file_config.web_dir)
                .map(expand_home),
            default_permission_mode: self
                .default_permission_mode
                .clone()
                .or(file_config.default_permission_mode)
                .unwrap_or_else(|| "acceptEdits".to_string()),
            worktree: WorktreeConfig {
                worktrees_dir: self
                    .worktrees_dir
                    .clone()
                    .or(file_config.worktrees_dir)
                    .map(expand_home),
                branch_prefix: self
                    .worktree_branch_prefix
                    .clone()
                    .or(file_config.worktree_branch_prefix)
                    .unwrap_or_else(|| "pin".to_string()),
                base_ref: self
                    .worktree_base_ref
                    .clone()
                    .or(file_config.worktree_base_ref)
                    .unwrap_or(WorktreeBaseRef::Fresh),
            },
        })
    }
}

async fn load_file_config(explicit_path: Option<&Path>) -> AppResult<FileConfig> {
    let path = explicit_path
        .map(PathBuf::from)
        .unwrap_or_else(default_config_path);
    let exists = tokio::fs::try_exists(&path).await?;
    if !exists {
        if explicit_path.is_some() {
            return Err(AppError::InvalidRequest(format!(
                "config file does not exist: {}",
                path.display()
            )));
        }
        return Ok(FileConfig::default());
    }

    let content = tokio::fs::read_to_string(&path).await?;
    toml::from_str(&content).map_err(|err| {
        AppError::InvalidRequest(format!("failed to parse config {}: {err}", path.display()))
    })
}

fn path_to_arg(path: PathBuf) -> String {
    expand_home(path).to_string_lossy().to_string()
}

fn resolve_launcher(
    cli_launcher: &[String],
    cli_claude_bin: Option<PathBuf>,
    file_config: &FileConfig,
) -> Vec<String> {
    if !cli_launcher.is_empty() {
        return cli_launcher.to_vec();
    }
    if let Some(launcher) = &file_config.launcher
        && !launcher.is_empty()
    {
        return launcher.clone();
    }
    if let Some(claude_bin) = cli_claude_bin {
        return vec![path_to_arg(claude_bin)];
    }
    if let Some(claude_bin) = file_config.claude_bin.clone() {
        return vec![path_to_arg(claude_bin)];
    }
    vec!["claude".to_string()]
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-remote-web")
}

fn default_config_path() -> PathBuf {
    default_data_dir().join("config.toml")
}

fn expand_home(path: PathBuf) -> PathBuf {
    let Some(path_str) = path.to_str() else {
        return path;
    };
    if path_str == "~" {
        return std::env::var_os("HOME").map(PathBuf::from).unwrap_or(path);
    }
    if let Some(rest) = path_str.strip_prefix("~/")
        && let Some(home) = std::env::var_os("HOME")
    {
        return PathBuf::from(home).join(rest);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn uses_built_in_defaults_when_config_file_is_empty() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(&config_path, "").unwrap();
        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(
            resolved.bind,
            "127.0.0.1:8787".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(resolved.launcher, vec!["claude".to_string()]);
        assert_eq!(resolved.default_permission_mode, "acceptEdits");
        assert!(resolved.data_dir.ends_with(".claude-remote-web"));
        assert_eq!(resolved.web_dir, None);
    }

    #[tokio::test]
    async fn loads_explicit_config_file_and_expands_home_paths() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
bind = "127.0.0.1:9999"
data_dir = "~/custom-data"
claude_bin = "~/bin/claude"
web_dir = "~/web-dist"
default_permission_mode = "auto"
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

        assert_eq!(
            resolved.bind,
            "127.0.0.1:9999".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(resolved.data_dir, home.join("custom-data"));
        assert_eq!(
            resolved.launcher,
            vec![home.join("bin/claude").to_string_lossy().to_string()]
        );
        assert_eq!(resolved.web_dir, Some(home.join("web-dist")));
        assert_eq!(resolved.default_permission_mode, "auto");
    }

    #[tokio::test]
    async fn cli_values_override_file_values() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
bind = "127.0.0.1:9999"
default_permission_mode = "auto"
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: Some("127.0.0.1:7777".parse().unwrap()),
            data_dir: Some(temp.path().join("data")),
            claude_bin: Some(PathBuf::from("custom-claude")),
            launcher: Vec::new(),
            web_dir: Some(temp.path().join("web")),
            default_permission_mode: Some("default".to_string()),
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(
            resolved.bind,
            "127.0.0.1:7777".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(resolved.data_dir, temp.path().join("data"));
        assert_eq!(resolved.launcher, vec!["custom-claude".to_string()]);
        assert_eq!(resolved.web_dir, Some(temp.path().join("web")));
        assert_eq!(resolved.default_permission_mode, "default");
    }

    #[tokio::test]
    async fn uses_default_worktree_config() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(&config_path, "").unwrap();
        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(resolved.worktree.branch_prefix, "pin");
        assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Fresh);
        assert_eq!(resolved.worktree.worktrees_dir, None);
    }

    #[tokio::test]
    async fn loads_worktree_config_and_expands_home() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
worktrees_dir = "~/worktrees"
worktree_branch_prefix = "crw"
worktree_base_ref = "head"
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

        assert_eq!(
            resolved.worktree.worktrees_dir,
            Some(home.join("worktrees"))
        );
        assert_eq!(resolved.worktree.branch_prefix, "crw");
        assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Head);
    }

    #[tokio::test]
    async fn cli_worktree_values_override_file_values() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
worktrees_dir = "/from-file"
worktree_branch_prefix = "file"
worktree_base_ref = "fresh"
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: Some(temp.path().join("from-cli")),
            worktree_branch_prefix: Some("cli".to_string()),
            worktree_base_ref: Some(WorktreeBaseRef::Head),
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(
            resolved.worktree.worktrees_dir,
            Some(temp.path().join("from-cli"))
        );
        assert_eq!(resolved.worktree.branch_prefix, "cli");
        assert_eq!(resolved.worktree.base_ref, WorktreeBaseRef::Head);
    }

    #[tokio::test]
    async fn explicit_missing_config_path_is_an_error() {
        let temp = tempfile::tempdir().unwrap();
        let config = Config {
            config: Some(temp.path().join("missing.toml")),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let err = config.resolve().await.unwrap_err();
        assert!(err.to_string().contains("config file does not exist"));
    }

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
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();

        assert_eq!(
            resolved.launcher,
            vec![home.join("bin/claude").to_string_lossy().to_string()]
        );
    }

    #[tokio::test]
    async fn launcher_overrides_claude_bin_in_config_file() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
claude_bin = "claude"
launcher = ["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: Vec::new(),
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(
            resolved.launcher,
            vec!["ttadk", "claude", "-m", "gpt-5.5", "--skip-check", "-a"]
        );
    }

    #[tokio::test]
    async fn cli_launcher_overrides_file_launcher_and_claude_bin() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
claude_bin = "claude"
launcher = ["from-file"]
"#,
        )
        .unwrap();

        let config = Config {
            config: Some(config_path),
            bind: None,
            data_dir: None,
            claude_bin: None,
            launcher: vec!["ttadk".to_string(), "claude".to_string(), "-a".to_string()],
            web_dir: None,
            default_permission_mode: None,
            worktrees_dir: None,
            worktree_branch_prefix: None,
            worktree_base_ref: None,
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(resolved.launcher, vec!["ttadk", "claude", "-a"]);
    }
}
