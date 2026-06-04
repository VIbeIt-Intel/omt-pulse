# OMT Pulse — tester smoke checklist (after Phase 1 deploy)

Use this **after** production is updated at https://omtpulse.com. No new Play Store APK required — force-close the app and reopen first.

**Date / build:** _______________  
**Tester name:** _______________  
**Phone model:** _______________  
**App:** ☐ Play APK  ☐ Browser/PWA  

---

## Before you start (both phones)

1. Open **Settings → Apps → OMT Pulse → Permissions**
   - **Location:** Allow (While using the app, or Always)
   - **Notifications:** Allow
2. Phone **Location / GPS** toggle: **ON**
3. Force-close OMT Pulse, then open again and log in.

---

## Test A — Panic with GPS (2 people)

| Step | Who | Pass? | Notes |
|------|-----|-------|-------|
| A1 | **Person A** — Open Command Dashboard or Occurrence Book, tap red **SOS**, confirm send. Wait up to ~20s if it feels slow (GPS acquiring). | ☐ | Toast should **not** say “location unavailable” if GPS worked. |
| A2 | **Person B** — Hear alarm / see panic banner or push. Tap **Acknowledge**, then **Respond Live** or open **Live Monitor**. | ☐ | |
| A3 | **Person B** — On Live Monitor, see **Person A’s pin** near your real area (not empty map). | ☐ | |
| A4 | **Person A** — Close panic (panicker flow) or ask admin to confirm incident closed. | ☐ | |

**Fail if:** Person B never gets alert, or pin is missing while Person A had Location allowed and toast did not warn about GPS.

---

## Test B — Panic without location (optional, 1 person)

| Step | Who | Pass? | Notes |
|------|-----|-------|-------|
| B1 | Turn **Location OFF** for OMT Pulse (or deny permission), send SOS once. | ☐ | Alert should still send. |
| B2 | Read the toast after send. | ☐ | Should mention location not shared / turn on Location. |
| B3 | Turn Location back **ON** after test. | ☐ | |

---

## Test C — Chat push (2 people, APK preferred)

| Step | Who | Pass? | Notes |
|------|-----|-------|-------|
| C1 | **Person A** — Send a **direct message** to Person B. Person B app in background or locked. | ☐ | Push notification appears. |
| C2 | Tap notification — opens **chat** with that thread. | ☐ | |
| C3 | Repeat with **group / org chat** if you use it. | ☐ | |

**Fail if:** Person B gets live/panic push but never chat push (report both phones).

---

## Test D — Occurrence book (1 person, admin/supervisor)

| Step | Pass? | Notes |
|------|-------|-------|
| D1 | Open **Occurrence Book**, find today’s **Panic** or **live** row from Test A. | ☐ | |
| D2 | Open row details — check **destination**, **closed by**, **responder last GPS** if shown. | ☐ | No placeholder “Live Incident” only for destination. |

---

## Test E — Normal live incident (sanity, 1 person)

Confirm we did **not** break the usual live flow:

| Step | Pass? | Notes |
|------|-------|-------|
| E1 | **Start Live Incident** (not SOS), set a destination, confirm GPS line updates. | ☐ | |
| E2 | End / close incident normally. | ☐ | |

---

## Report back to IntelAfri

Copy this block into WhatsApp/email:

```
SMOKE TEST — Phase 1
Tester:
Phone / APK or browser:
Deploy date:

A Panic+GPS: PASS / FAIL —
B Panic no GPS: PASS / FAIL / SKIPPED —
C Chat push: PASS / FAIL —
D Occurrence book: PASS / FAIL —
E Live incident: PASS / FAIL —

Issues (screenshots welcome):
```

---

## Troubleshooting

| Problem | Try |
|---------|-----|
| Old behaviour after deploy | Force-close app, reopen; clear cache only if still stale. |
| No GPS on panic | Settings → Location ON; OMT Pulse → Location Allow; wait 10s outdoors, SOS again. |
| No push | Settings → Notifications Allow; reopen app once while logged in. |
| “Respond Live” greyed / no location | Panic was sent without GPS — expected until panicker allows Location. |
