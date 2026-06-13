#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCRIPT="$ROOT_DIR/scripts/start-server.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "start-server.sh must exist and be executable" >&2
  exit 1
fi

help_output=$("$SCRIPT" --help)
[[ "$help_output" == *"Usage:"* ]]
[[ "$help_output" == *"--config"* ]]
[[ "$help_output" == *"--skip-web-build"* ]]
[[ "$help_output" == *"CRW_CONFIG"* ]]

check_output=$("$SCRIPT" --check --skip-web-build --config /tmp/example.toml)
[[ "$check_output" == *"Project root: $ROOT_DIR"* ]]
[[ "$check_output" == *"Config: /tmp/example.toml"* ]]
[[ "$check_output" == *"Web build: skipped"* ]]
[[ "$check_output" == *"Command: cargo run --release --manifest-path $ROOT_DIR/Cargo.toml -- --config /tmp/example.toml"* ]]

default_output=$("$SCRIPT" --check --skip-web-build)
[[ "$default_output" == *"Config: default"* ]]
[[ "$default_output" == *"Command: cargo run --release --manifest-path $ROOT_DIR/Cargo.toml"* ]]

missing_deps_root=$(mktemp -d)
trap 'rm -rf "$missing_deps_root"' EXIT
mkdir -p "$missing_deps_root/scripts" "$missing_deps_root/web"
cp "$SCRIPT" "$missing_deps_root/scripts/start-server.sh"
chmod +x "$missing_deps_root/scripts/start-server.sh"

set +e
missing_deps_output=$(NPM_BIN=/usr/bin/true CARGO_BIN=/usr/bin/true "$missing_deps_root/scripts/start-server.sh" 2>&1)
missing_deps_status=$?
set -e

if [[ "$missing_deps_status" -eq 0 ]]; then
  echo "start-server.sh should fail when web dependencies are missing" >&2
  exit 1
fi

if [[ "$missing_deps_output" != *"Web dependencies are not installed"* ]]; then
  echo "missing web dependency error should explain the problem" >&2
  echo "$missing_deps_output" >&2
  exit 1
fi

if [[ "$missing_deps_output" != *"npm --prefix web install"* ]]; then
  echo "missing web dependency error should suggest npm --prefix web install" >&2
  echo "$missing_deps_output" >&2
  exit 1
fi

echo "start-server.sh checks passed"
