#!/usr/bin/env bash
# Deploy larger/more reliable collapsed radio Hold button.
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
sudo systemctl restart omt-pulse || sudo -n systemctl restart omt-pulse || true
systemctl is-active omt-pulse && echo "=== omt-pulse is active ==="
