use std::{env, fs, path::PathBuf};

const FAVICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#16171a"/>
  <path d="M14 22c0-4.4 3.6-8 8-8h20c4.4 0 8 3.6 8 8v13c0 4.4-3.6 8-8 8H29l-10 7v-7c-2.9-1.1-5-4-5-7.4V22Z" fill="#f4f1ea"/>
  <path d="M22 25h20M22 32h16" stroke="#16171a" stroke-width="4" stroke-linecap="round"/>
  <circle cx="47" cy="47" r="8" fill="#d97706"/>
  <path d="M43.5 47h7M47 43.5v7" stroke="#fff7ed" stroke-width="2.5" stroke-linecap="round"/>
</svg>
"##;

fn main() {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let web_dist = manifest_dir.join("../../web/dist");
    println!("cargo:rerun-if-changed={}", web_dist.display());

    let index_html = web_dist.join("index.html");
    let embed_dir = if index_html.exists() {
        web_dist
    } else if env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "release build requires {}; run `npm --prefix web run build` before `cargo build --release`",
            index_html.display()
        );
    } else {
        let fallback_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"))
            .join("embedded-web-fallback");
        fs::create_dir_all(&fallback_dir).expect("create embedded web fallback dir");
        fs::write(
            fallback_dir.join("index.html"),
            r#"<!doctype html>
<html>
  <head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>Claude Remote Web</title></head>
  <body><div id="root">Claude Remote Web embedded fallback</div></body>
</html>
"#,
        )
        .expect("write embedded web fallback index");
        fs::write(fallback_dir.join("favicon.svg"), FAVICON_SVG)
            .expect("write embedded web fallback favicon");
        fallback_dir
    };

    println!("cargo:rustc-env=CRW_EMBED_WEB_DIR={}", embed_dir.display());
}
