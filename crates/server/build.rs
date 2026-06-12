use std::{env, fs, path::PathBuf};

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
  <head><meta charset="utf-8"><title>Claude Remote Web</title></head>
  <body><div id="root">Claude Remote Web embedded fallback</div></body>
</html>
"#,
        )
        .expect("write embedded web fallback index");
        fallback_dir
    };

    println!("cargo:rustc-env=CRW_EMBED_WEB_DIR={}", embed_dir.display());
}
