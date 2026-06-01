# Hermes Agent on OMT Pulse VPS

Self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) for autonomous dev work on `omt-pulse`.

## Layout on server

| Path | Purpose |
|------|---------|
| `/opt/hermes/` | `HERMES_HOME` — config, memory, sessions |
| `/opt/hermes-workspace/omt-pulse/` | Git workspace (not production) |
| `/opt/omt-pulse/` | **Production** — Hermes must not write here |

## Resume a session from the shell (operator)

`sudo -u hermes` alone can leave `HOME=/home/ubuntu` and break the terminal tool. Use:

```bash
sudo bash /opt/hermes-workspace/omt-pulse/deploy/hermes/run-cli.sh chat --resume SESSION_ID -q "Continue…" -Q
```

Or message the bot on Telegram (gateway already sets `HOME=/home/hermes` in systemd).

## Logs

```bash
sudo journalctl -u hermes-gateway -f
```

See also `AGENTS.md` in the repo root for agent rules and git workflow.
