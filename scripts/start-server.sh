#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_PATH="${CRW_CONFIG:-}"
SKIP_WEB_BUILD=0
CHECK_ONLY=0
CARGO_BIN="${CARGO_BIN:-cargo}"
NPM_BIN="${NPM_BIN:-npm}"

usage() {
  cat <<'EOF'
Usage: scripts/start-server.sh [options]

Build the Web UI if needed, then start the Claude Remote Web backend daemon.

Options:
  --config <path>       Use an explicit config.toml path. Also available via CRW_CONFIG.
  --skip-web-build      Skip `npm --prefix web run build` before starting the server.
  --check               Print resolved commands without executing them.
  -h, --help            Show this help.

Environment:
  CRW_CONFIG            Default config path when --config is not provided.
  CARGO_BIN             Cargo executable name/path. Default: cargo
  NPM_BIN               npm executable name/path. Default: npm
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      if [[ $# -lt 2 ]]; then
        echo "--config requires a path" >&2
        exit 2
      fi
      CONFIG_PATH="$2"
      shift 2
      ;;
    --skip-web-build)
      SKIP_WEB_BUILD=1
      shift
      ;;
    --check)
      CHECK_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SERVER_CMD=("$CARGO_BIN" run --release --manifest-path "$ROOT_DIR/Cargo.toml")
if [[ -n "$CONFIG_PATH" ]]; then
  SERVER_CMD+=(-- --config "$CONFIG_PATH")
fi

quote_cmd() {
  printf '%q ' "$@" | sed 's/ $//'
}

print_plan() {
  echo "Project root: $ROOT_DIR"
  if [[ -n "$CONFIG_PATH" ]]; then
    echo "Config: $CONFIG_PATH"
  else
    echo "Config: default"
  fi
  if [[ "$SKIP_WEB_BUILD" -eq 1 ]]; then
    echo "Web build: skipped"
  else
    echo "Web build: npm --prefix $ROOT_DIR/web run build"
  fi
  echo "Command: $(quote_cmd "${SERVER_CMD[@]}")"
}

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  print_plan
  exit 0
fi

if [[ "$SKIP_WEB_BUILD" -ne 1 ]]; then
  "$NPM_BIN" --prefix "$ROOT_DIR/web" run build
fi

exec "${SERVER_CMD[@]}"
