use axum::{
    body::Body,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use include_dir::{Dir, include_dir};

static WEB_DIST: Dir<'_> = include_dir!("$CRW_EMBED_WEB_DIR");

pub async fn serve(uri: Uri) -> Response {
    let request_path = asset_path(uri.path());

    if let Some(file) = WEB_DIST.get_file(&request_path) {
        return asset_response(&request_path, file.contents());
    }

    if let Some(index) = WEB_DIST.get_file("index.html") {
        return asset_response("index.html", index.contents());
    }

    (StatusCode::NOT_FOUND, "embedded web assets are unavailable").into_response()
}

fn asset_path(uri_path: &str) -> String {
    let trimmed = uri_path.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

fn asset_response(path: &str, contents: &[u8]) -> Response {
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(contents.to_vec()))
        .expect("embedded asset response is valid")
}
