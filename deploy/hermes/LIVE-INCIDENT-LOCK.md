# Live Incident Flow — Verified Lock

**Locked:** 2026-06-10  
**Git tag:** `live-incident-verified-2026-06-10`  
**Commit:** `f356611` (PR #11 merge — production baseline)  
**Service worker:** `omt-v102`  
**Smoke test:** Incident #473 (RED Murder, CVO Skool Pretoria)

## Verified (do not change without hotfix PR)

| Area | Result |
|------|--------|
| Live incident activation + destination | Pass |
| FCM push on incident start | Pass (5/6; Anton device-specific miss) |
| Joiner GPS enforcement (location off → blocked) | Pass |
| Joiner navigation (location on) | Pass |
| Creator GPS tracking + map (native) | Pass |
| Automatic 2-minute push retry | Pass |

## Key commits in this lock

- `e99f8be` — FCM token refresh + dead-token pruning
- `efbeb8f` / `52498e6` — Joiner GPS required before navigate
- `731e7ec` — Native map not hidden when JS API slow (`omt-v102`)

## Out of scope (next work — not regressions)

1. **Creator joiner visibility** — roster, map markers, FCM when joiners join
2. **Anton-class FCM** — always re-register token on app open
3. **Report Incident** and **Panic** — separate smoke tests pending
4. Vernon blank nav map — device-specific

## Hotfix rule

Changes to `live-incident.tsx`, `native-push.ts`, `dispatchLiveIncidentPush`, or `sendFcmBatch` require:

1. Small focused PR
2. Re-test live incident smoke before production deploy
3. New tag if production is updated

## Rollback

```bash
git checkout live-incident-verified-2026-06-10
# deploy that commit to production
```
