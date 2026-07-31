#!/usr/bin/env bash
# Deploy POPIA retention + privacy updates on fix/live-monitor-hide-side-panels.
set -eu
cd /opt/omt-pulse
BRANCH="fix/live-monitor-hide-side-panels"

echo "=== backup secrets ==="
if [ -d secrets ] && [ -n "$(ls -A secrets 2>/dev/null)" ]; then
  sudo rm -rf /opt/omt-pulse-secrets-backup
  sudo cp -a secrets /opt/omt-pulse-secrets-backup
  sudo chown -R omt:omt /opt/omt-pulse-secrets-backup
fi

echo "=== git: fetch branch (force) ==="
sudo -u omt git fetch origin
sudo -u omt git fetch https://github.com/VIbeIt-Intel/omt-pulse.git "+${BRANCH}:${BRANCH}"
sudo -u omt git reset --hard "${BRANCH}"
sudo -u omt git log -1 --oneline

echo "=== build ==="
sudo -u omt bash scripts/deploy.sh || echo "deploy.sh non-zero; continuing restart"

echo "=== restart ==="
sudo systemctl restart omt-pulse
systemctl is-active omt-pulse && echo "=== omt-pulse is active ==="

echo "=== verify retention files ==="
test -f /opt/omt-pulse/shared/retention.ts && echo "shared/retention.ts OK"
test -d /opt/omt-pulse/server/retention && echo "server/retention/ OK"
sudo journalctl -u omt-pulse -n 40 --no-pager | grep -E "retention|serving on port|error" || true
