use crate::{AppError, AppResult};
use clap::Parser;
use serde::{Deserialize, Serialize};
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValues {
    pub bind: String,
    pub data_dir: String,
    pub launcher: Vec<String>,
    pub web_dir: Option<String>,
    pub default_permission_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedConfigResponse {
    pub path: PathBuf,
    pub exists: bool,
    pub current: ConfigValues,
    pub file: ConfigValues,
    pub restart_required: bool,
}

#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: PathBuf,
    current: ResolvedConfig,
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
        })
    }

    pub fn target_config_path(&self) -> PathBuf {
        self.config.clone().unwrap_or_else(default_config_path)
    }
}

impl ConfigStore {
    pub fn new(path: PathBuf, current: ResolvedConfig) -> Self {
        Self { path, current }
    }

    pub async fn get(&self) -> AppResult<ManagedConfigResponse> {
        let exists = tokio::fs::try_exists(&self.path).await?;
        let file = if exists {
            let file_config = load_file_config(Some(&self.path)).await?;
            values_from_file_config(file_config, &self.current)
        } else {
            ConfigValues::from(&self.current)
        };

        Ok(ManagedConfigResponse {
            path: self.path.clone(),
            exists,
            current: ConfigValues::from(&self.current),
            file,
            restart_required: false,
        })
    }

    pub async fn save(&self, values: ConfigValues) -> AppResult<ManagedConfigResponse> {
        validate_config_values(&values)?;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let content = normalized_toml(&values);
        tokio::fs::write(&self.path, content).await?;

        Ok(ManagedConfigResponse {
            path: self.path.clone(),
            exists: true,
            current: ConfigValues::from(&self.current),
            file: values,
            restart_required: true,
        })
    }
}

impl From<&ResolvedConfig> for ConfigValues {
    fn from(config: &ResolvedConfig) -> Self {
        Self {
            bind: config.bind.to_string(),
            data_dir: config.data_dir.to_string_lossy().to_string(),
            launcher: config.launcher.clone(),
            web_dir: config
                .web_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            default_permission_mode: config.default_permission_mode.clone(),
        }
    }
}

fn values_from_file_config(file_config: FileConfig, current: &ResolvedConfig) -> ConfigValues {
    ConfigValues {
        bind: file_config
            .bind
            .map(|bind| bind.to_string())
            .unwrap_or_else(|| current.bind.to_string()),
        data_dir: file_config
            .data_dir
            .map(expand_home)
            .unwrap_or_else(|| current.data_dir.clone())
            .to_string_lossy()
            .to_string(),
        launcher: file_config
            .launcher
            .unwrap_or_else(|| current.launcher.clone()),
        web_dir: file_config
            .web_dir
            .map(expand_home)
            .or_else(|| current.web_dir.clone())
            .map(|path| path.to_string_lossy().to_string()),
        default_permission_mode: file_config
            .default_permission_mode
            .unwrap_or_else(|| current.default_permission_mode.clone()),
    }
}

fn validate_config_values(values: &ConfigValues) -> AppResult<()> {
    values
        .bind
        .parse::<SocketAddr>()
        .map_err(|err| AppError::InvalidRequest(format!("invalid bind address: {err}")))?;
    if values.launcher.is_empty() || values.launcher.iter().any(|value| value.trim().is_empty()) {
        return Err(AppError::InvalidRequest(
            "launcher must contain at least one value".to_string(),
        ));
    }
    if values.data_dir.trim().is_empty() {
        return Err(AppError::InvalidRequest("dataDir is empty".to_string()));
    }
    if values.default_permission_mode.trim().is_empty() {
        return Err(AppError::InvalidRequest(
            "defaultPermissionMode is empty".to_string(),
        ));
    }
    Ok(())
}

fn normalized_toml(values: &ConfigValues) -> String {
    let mut content = String::new();
    content.push_str(&format!("bind = {}\n", toml_string(&values.bind)));
    content.push_str(&format!("data_dir = {}\n", toml_string(&values.data_dir)));
    content.push_str("launcher = [");
    content.push_str(
        &values
            .launcher
            .iter()
            .map(|value| toml_string(value))
            .collect::<Vec<_>>()
            .join(", "),
    );
    content.push_str("]\n");
    if let Some(web_dir) = &values.web_dir
        && !web_dir.trim().is_empty()
    {
        content.push_str(&format!("web_dir = {}\n", toml_string(web_dir)));
    }
    content.push_str(&format!(
        "default_permission_mode = {}\n",
        toml_string(&values.default_permission_mode)
    ));
    content
}

fn toml_string(value: &str) -> String {
    toml::Value::String(value.to_string()).to_string()
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
        };

        let resolved = config.resolve().await.unwrap();

        assert_eq!(resolved.launcher, vec!["ttadk", "claude", "-a"]);
    }

    #[tokio::test]
    async fn config_store_returns_current_values_when_file_is_missing() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("missing-config.toml");
        let current = ResolvedConfig {
            bind: "127.0.0.1:8787".parse().unwrap(),
            data_dir: temp.path().join("data"),
            launcher: vec!["claude".to_string()],
            web_dir: None,
            default_permission_mode: "acceptEdits".to_string(),
        };
        let store = ConfigStore::new(path.clone(), current);

        let response = store.get().await.unwrap();

        assert_eq!(response.path, path);
        assert!(!response.exists);
        assert!(!response.restart_required);
        assert_eq!(response.file.bind, "127.0.0.1:8787");
        assert_eq!(response.file.launcher, vec!["claude".to_string()]);
        assert_eq!(response.file.default_permission_mode, "acceptEdits");
    }

    #[tokio::test]
    async fn config_store_writes_normalized_toml() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("nested").join("config.toml");
        let current = ResolvedConfig {
            bind: "127.0.0.1:8787".parse().unwrap(),
            data_dir: temp.path().join("data"),
            launcher: vec!["claude".to_string()],
            web_dir: None,
            default_permission_mode: "acceptEdits".to_string(),
        };
        let store = ConfigStore::new(path.clone(), current);

        let saved = store
            .save(ConfigValues {
                bind: "127.0.0.1:9999".to_string(),
                data_dir: "/tmp/crw-data".to_string(),
                launcher: vec!["ttadk".to_string(), "claude".to_string(), "-a".to_string()],
                web_dir: Some("/tmp/crw-web".to_string()),
                default_permission_mode: "auto".to_string(),
            })
            .await
            .unwrap();

        assert!(saved.exists);
        assert!(saved.restart_required);
        assert_eq!(saved.file.bind, "127.0.0.1:9999");
        let written = fs::read_to_string(path).unwrap();
        assert_eq!(
            written,
            "bind = \"127.0.0.1:9999\"\ndata_dir = \"/tmp/crw-data\"\nlauncher = [\"ttadk\", \"claude\", \"-a\"]\nweb_dir = \"/tmp/crw-web\"\ndefault_permission_mode = \"auto\"\n"
        );
    }

    #[tokio::test]
    async fn config_store_rejects_invalid_bind() {
        let temp = tempfile::tempdir().unwrap();
        let current = ResolvedConfig {
            bind: "127.0.0.1:8787".parse().unwrap(),
            data_dir: temp.path().join("data"),
            launcher: vec!["claude".to_string()],
            web_dir: None,
            default_permission_mode: "acceptEdits".to_string(),
        };
        let store = ConfigStore::new(temp.path().join("config.toml"), current);

        let err = store
            .save(ConfigValues {
                bind: "not-a-socket".to_string(),
                data_dir: "/tmp/crw-data".to_string(),
                launcher: vec!["claude".to_string()],
                web_dir: None,
                default_permission_mode: "acceptEdits".to_string(),
            })
            .await
            .unwrap_err();

        assert!(err.to_string().contains("invalid bind address"));
    }

    #[tokio::test]
    async fn config_store_rejects_empty_launcher() {
        let temp = tempfile::tempdir().unwrap();
        let current = ResolvedConfig {
            bind: "127.0.0.1:8787".parse().unwrap(),
            data_dir: temp.path().join("data"),
            launcher: vec!["claude".to_string()],
            web_dir: None,
            default_permission_mode: "acceptEdits".to_string(),
        };
        let store = ConfigStore::new(temp.path().join("config.toml"), current);

        let err = store
            .save(ConfigValues {
                bind: "127.0.0.1:8787".to_string(),
                data_dir: "/tmp/crw-data".to_string(),
                launcher: Vec::new(),
                web_dir: None,
                default_permission_mode: "acceptEdits".to_string(),
            })
            .await
            .unwrap_err();

        assert!(
            err.to_string()
                .contains("launcher must contain at least one value")
        );
    }
}
