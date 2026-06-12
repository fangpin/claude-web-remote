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

    let config = Config::parse().resolve().await?;
    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.launcher.clone(),
        config.default_permission_mode.clone(),
    );
    manager.restore_active_sessions().await?;
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}
