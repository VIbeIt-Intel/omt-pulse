#!/usr/bin/env bash
# Run Hermes CLI as the hermes user with a correct HOME (sudo -u alone leaves HOME=/root or /home/ubuntu).
# Usage: sudo bash deploy/hermes/run-cli.sh chat --resume SESSION_ID -q "..." -Q
set -euo pipefail
export HERMES_HOME=/opt/hermes
export HOME=/home/hermes
export PATH="/opt/hermes/hermes-agent/venv/bin:/opt/hermes/bin:/home/hermes/.local/bin:/usr/bin:/bin"
exec sudo -u hermes env HOME="$HOME" HERMES_HOME="$HERMES_HOME" PATH="$PATH" \
  /opt/hermes/hermes-agent/venv/bin/python -m hermes_cli.main "$@"
