use anyhow::Context;
use axum::serve;
use clap::Parser;
use claude_remote_web_server::{
    AppState, Config, ConfigStore, EventStore, SessionManager, build_router,
};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli_config = Config::parse();
    let config_path = cli_config.target_config_path();
    let config = cli_config.resolve().await?;
    let store = EventStore::new(&config.data_dir).await?;
    let manager = SessionManager::new(
        store.clone(),
        config.launcher.clone(),
        config.default_permission_mode.clone(),
    );
    let config_store = ConfigStore::new(config_path, config.clone());
    let state = AppState {
        manager,
        store,
        config: config_store,
    };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}
