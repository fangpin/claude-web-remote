use anyhow::Context;
use axum::serve;
use clap::Parser;
use claude_remote_web_server::{AppState, Config, EventStore, SessionManager, build_router};
use std::net::SocketAddr;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::parse().resolve().await?;
    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.launcher.clone(),
        config.default_permission_mode.clone(),
    );
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;
    println!("{}", startup_usage(config.bind));

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}

fn startup_usage(bind: SocketAddr) -> String {
    let port = bind.port();

    format!(
        "Claude Remote Web is running.\n\nRemote bind: {bind}\n\nFrom your local machine, open an SSH tunnel:\n  ssh -N -L {port}:127.0.0.1:{port} <devbox>\n\nThen open in your browser:\n  http://127.0.0.1:{port}"
    )
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
}
