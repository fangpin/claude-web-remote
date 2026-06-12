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
    );
    let state = AppState { manager, store };
    let app = build_router(state, config.web_dir.clone());
    let listener = TcpListener::bind(config.bind).await?;

    tracing::info!(bind = %config.bind, data_dir = %config.data_dir.display(), "serving claude remote web");
    serve(listener, app).await.context("server failed")
}
