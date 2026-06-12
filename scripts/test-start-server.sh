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

echo "start-server.sh checks passed"
