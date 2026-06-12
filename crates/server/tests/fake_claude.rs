use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

pub fn write_fake_claude(dir: &Path) -> PathBuf {
    let path = dir.join("fake-claude.sh");
    fs::write(
        &path,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '{"type":"system","session_id":"fake-session","message":"started"}\n'
while IFS= read -r line; do
  printf '{"type":"user","message":%s}\n' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$line")"
  printf '{"type":"assistant","message":"ack:%s"}\n' "$line"
  if [[ "$line" == "exit" ]]; then
    printf 'fake stderr line\n' >&2
    exit 0
  fi
done
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}
