use anyhow::Context;
use axum::serve;
use clap::Parser;
use claude_remote_web_server::{
    AppState, Config, ConfigStore, EventStore, SessionManager, build_router,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Config::parse();
    let check = cli.check;
    let config_path = cli.target_config_path();
    let config = cli.resolve().await?;

    if check {
        println!("bind = {}", config.bind);
        println!("data_dir = {}", config.data_dir.display());
        println!("launcher = {:?}", config.launcher);
        println!(
            "web_dir = {}",
            config
                .web_dir
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<embedded>".to_string())
        );
        println!(
            "default_permission_mode = {}",
            config.default_permission_mode
        );
        return Ok(());
    }

    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.launcher.clone(),
        config.default_permission_mode.clone(),
        config.worktree.clone(),
    );
    manager.restore_active_sessions().await?;
    let config_store = ConfigStore::new(config_path, config.clone());
    let state = AppState {
        manager,
        store,
        config: config_store,
    };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;
    let bound_addr = startup_usage_bind(&listener)?;
    println!("{}", startup_usage(bound_addr));

    tracing::info!(bind = %bound_addr, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}

fn startup_usage_bind(listener: &TcpListener) -> std::io::Result<SocketAddr> {
    listener.local_addr()
}

fn startup_usage(bind: SocketAddr) -> String {
    let port = bind.port();
    let ssh_target_host = ssh_target_host(bind);

    format!(
        "Claude Remote Web is running.\n\nRemote bind: {bind}\n\nFrom your local machine, open an SSH tunnel:\n  ssh -N -L {port}:{ssh_target_host}:{port} <devbox>\n\nThen open in your browser:\n  http://127.0.0.1:{port}"
    )
}

fn ssh_target_host(bind: SocketAddr) -> String {
    match bind {
        SocketAddr::V4(addr) => addr.ip().to_string(),
        SocketAddr::V6(addr) => format!("[{}]", addr.ip()),
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    #[test]
    fn startup_usage_uses_resolved_bind_port() {
        let bind = "127.0.0.1:8787".parse::<SocketAddr>().unwrap();

        let usage = super::startup_usage(bind);

        assert!(usage.contains("Remote bind: 127.0.0.1:8787"));
        assert!(usage.contains("ssh -N -L 8787:127.0.0.1:8787 <devbox>"));
        assert!(usage.contains("http://127.0.0.1:8787"));
    }

    #[test]
    fn startup_usage_uses_custom_bind_port() {
        let bind = "127.0.0.1:9898".parse::<SocketAddr>().unwrap();

        let usage = super::startup_usage(bind);

        assert!(usage.contains("Remote bind: 127.0.0.1:9898"));
        assert!(usage.contains("ssh -N -L 9898:127.0.0.1:9898 <devbox>"));
        assert!(usage.contains("http://127.0.0.1:9898"));
    }

    #[test]
    fn startup_usage_brackets_ipv6_ssh_target() {
        let bind = "[::1]:8787".parse::<SocketAddr>().unwrap();

        let usage = super::startup_usage(bind);

        assert!(usage.contains("Remote bind: [::1]:8787"));
        assert!(usage.contains("ssh -N -L 8787:[::1]:8787 <devbox>"));
        assert!(usage.contains("http://127.0.0.1:8787"));
    }

    #[tokio::test]
    async fn startup_usage_uses_listener_local_addr() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let bind = super::startup_usage_bind(&listener).unwrap();

        let usage = super::startup_usage(bind);

        assert_ne!(bind.port(), 0);
        assert!(usage.contains(&format!("Remote bind: {bind}")));
        assert!(usage.contains(&format!(
            "ssh -N -L {}:127.0.0.1:{} <devbox>",
            bind.port(),
            bind.port()
        )));
        assert!(usage.contains(&format!("http://127.0.0.1:{}", bind.port())));
    }
}
