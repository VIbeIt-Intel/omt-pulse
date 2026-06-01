#!/usr/bin/env bash
# Run on the VPS after git pull (or invoked by GitHub Actions over SSH).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[deploy] OMT Pulse — $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[deploy] directory: $ROOT"

if [[ ! -f .env ]]; then
  echo "[deploy] ERROR: missing .env — copy deploy/env.production.example to .env and fill in values." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[deploy] ERROR: DATABASE_URL not set in .env" >&2
  exit 1
fi

if [[ -z "${SESSION_SECRET:-}" ]]; then
  echo "[deploy] ERROR: SESSION_SECRET not set in .env" >&2
  exit 1
fi

if [[ -z "${VITE_GOOGLE_MAPS_API_KEY:-}" ]]; then
  echo "[deploy] ERROR: VITE_GOOGLE_MAPS_API_KEY not set in .env — maps will break if build continues." >&2
  exit 1
fi

echo "[deploy] installing dependencies..."
# Dev deps (tsx, vite, drizzle-kit) are required for build even when NODE_ENV=production.
npm ci --include=dev

echo "[deploy] building client + server..."
npm run build

echo "[deploy] optional schema sync..."
# Non-interactive: avoid hanging on drizzle-kit truncate prompts over SSH.
timeout 60 npm run db:push < /dev/null || echo "[deploy] db:push skipped or failed (migrations also run at startup)"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files omt-pulse.service >/dev/null 2>&1; then
  echo "[deploy] restarting omt-pulse.service..."
  sudo systemctl restart omt-pulse
  sudo systemctl status omt-pulse --no-pager -l || true
else
  echo "[deploy] omt-pulse.service not installed — run scripts/server-setup.sh first"
fi

echo "[deploy] complete."
