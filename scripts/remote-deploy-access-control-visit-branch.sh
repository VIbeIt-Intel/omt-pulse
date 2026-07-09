#!/usr/bin/env bash
# Deploy fix/licence-front-ocr-v121 (patrol API + UI, omt-v164).
set -eu
cd /opt/omt-pulse
BRANCH="fix/licence-front-ocr-v121"

echo "=== backup secrets ==="
if [ -d secrets ] && [ -n "$(ls -A secrets 2>/dev/null)" ]; then
  sudo rm -rf /opt/omt-pulse-secrets-backup
  sudo cp -a secrets /opt/omt-pulse-secrets-backup
  sudo chown -R omt:omt /opt/omt-pulse-secrets-backup
fi

echo "=== git: fetch ${BRANCH} ==="
sudo -u omt git fetch origin
sudo -u omt git fetch https://github.com/VIbeIt-Intel/omt-pulse.git "${BRANCH}:${BRANCH}"
sudo -u omt git reset --hard "${BRANCH}"
sudo -u omt git log -1 --oneline

echo "=== build ==="
sudo -u omt bash scripts/deploy.sh || echo "deploy.sh non-zero; continuing restart"

echo "=== restart ==="
sudo systemctl restart omt-pulse
systemctl is-active omt-pulse && echo "=== omt-pulse is active ==="
