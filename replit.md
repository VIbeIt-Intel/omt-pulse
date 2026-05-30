# OMT - Occurrence Management Tool

## Overview
Full-stack incident management PWA (Occurrence Book). React + TS + Vite + shadcn/ui frontend, Express + PostgreSQL/Drizzle backend, session-based auth, multi-tenant, Archon-managed subscriptions, Archon super-admin panel.

## Stack
- **Frontend**: React + TypeScript + Vite, shadcn/ui, Tailwind, Leaflet (direct), Google Maps JS API (live nav), recharts
- **Backend**: Express + express-session, bcrypt, multer, web-push, xlsx
- **DB**: PostgreSQL via Drizzle ORM
- **Storage**: Replit App Storage (GCS) for attachments

## Theme
Rolex Green primary `#006039` (HSL `155 100% 19%` light / `155 100% 28%` dark). Black/white/gray neutrals. Dark mode via `ThemeProvider` + localStorage.

## Multi-Tenancy
Every table except `organizations` and `users` carries `organizationId`. **Every storage method accepts and filters by `orgId`** — a query touching `incidents`, `locations`, `categories`, `form_fields`, or `audit_logs` without `where eq(table.organizationId, orgId)` is a bug.

## Auth Flow
- `/login` — single password field, no email/username
- `/register` — first registered user = administrator, organisation created with 48 h trial
- Deactivated users blocked at login. Session via `SESSION_SECRET`.
- Sidebar footer shows user + role + Sign Out.

## Roles
- **Superadmin** (`users.isSuperadmin=true`): everything + Commands management (`/commands`)
- **Administrator**: Occurrence Book, Analytics, Field Admin, User Admin, Audit Trail
- **Supervisor**: Occurrence Book, Analytics, Audit Trail
- **Reporter**: Occurrence Book only

## Subscription
- 48 h trial from org registration
- Subscription status managed via Archon (`isComplimentary`, `subscriptionStatus`, `subscriptionCurrentPeriodEnd`)
- Expired → lock screen. Admin sees contact IntelAfri message. Non-admin sees "contact your administrator"
- Billing icon in header (admin only): green=active, amber=trial, red=expired
- `/billing` — read-only status page for administrators

## Commands (Sub-Orgs)
Sub-organisations within one org — isolated users, incidents, categories, locations.
- Tables: `commands`, `command_users`, `command_visibility_grants`, `command_visibility_requests`
- `commandId` (nullable, additive) on `incidents`, `locations`, `incident_categories`, `form_fields`
- Auto-migrate on startup (`server/migrate-commands.ts`): every org gets a "Central Command", legacy rows backfilled, every user assigned, first admin promoted to superadmin if none exists
- **Scope filtering** via `getCommandScope(req)` in `server/routes.ts` → `{activeCommandId, commandFilter, defaultStampCommandId}`. All scoped reads filter strictly via `commandId IN (...)`. No NULL fallback.
- Wide-access (admin + superadmin) can switch into any command or "All Commands"; supervisors/reporters confined to assigned commands
- Session state: `req.session.activeCommandId` (number | "all" | undefined)
- Visibility grants give read-only switchable access from grantor → grantee org's admins; writes blocked in granted command
- `/commands` (superadmin) — manage commands + members + grants. `/visibility` — request access. `CommandSwitcher` in sidebar.

## Live Incidents + Nav
- Creator dispatches to a destination; responders join via `POST /api/incidents/:id/join-live`
- `watchPosition` in `client/src/pages/live-incident.tsx` PATCHes `/responder-position` or `/joiner-position`
- **GPS lost detection**: poll every 5 s; banner fires after 60 s with no successful PATCH; auto-retries `startTracking()` once after 10 s; manual Retry button always available
- **Nav mode**: in-flow tall map with floating green step banner (large maneuver arrow via `ManeuverIcon` + instruction + distance + step count + ✕), "Then" pill below with next maneuver, action bar at bottom (route summary, speed, Arrived, Leave, Open in Google Maps)
- Tilt + heading-up applied in nav mode; step tracking advances via interval polling `currentStepIndexRef`
- Escalation tier: admin/supervisor "Escalate" on `/live-monitor` → push to all admins+supervisors + map marker pulses red 2× faster

## Panic / SOS
- Panic incidents are **live incidents** (`isLive=true`, panicker GPS as destination). Responders use normal `join-live` flow
- Push fan-out: `getPushSubscriptionsByOrg(orgId)` — ALL roles. SW handles `type:"panic"` with aggressive vibrate + requireInteraction + `/alarm.mp3`
- In-app siren `PanicAlertSiren` in `App.tsx`: polls `/api/panic/recent` every 5 s, plays `/alarm.mp3` (3 loops) on new unacked panics, slim pulsing red top-bar (suppressed on `/`, `/dashboard`, `/occurrence-book` which mount the full `PanicBanner`). Shared `dismissedPanicIds` localStorage key
- `POST /api/incidents/:id/close-panic` (panicker only): clears `panicClosedAt`, ends live, closes responders, keeps as "Panic" category by default
- Banner "Respond Live" → `POST /api/incidents/:panicId/join-live`, stores `omt_panic_target` + `omt_joined_incident_id`, navigates `/live-incident`
- Dismiss button only visible to non-panickers AFTER acknowledgement
- Panicker view (`live-incident.tsx`): if panicker re-opens PWA while own panic active, shows responder panel + close-with-notes dialog (required description, optional category + photos, "Just close" escape)
- `panic_acknowledgers` table created via `safeMigrate` in `server/index.ts` (`UNIQUE(incident_id, user_id)` for idempotent acks)

## Audit Trail
- Tracked: auth.login/logout, incident.create/edit/delete, admin.user_*, profile.update, command.switch_active, command.visibility_*
- `audit_logs` table, JSONB `changes` for field-level diffs
- `GET /api/users/:userId/audit?all=true|since=ISO_DATE` — admin + supervisor only
- `AuditTrailDialog` in User Admin (ScrollText icon), 30-day default + "Show all history" toggle, Excel export via xlsx

## Bulk Import
- Admin-only `/import` — 4-step wizard: Upload → Map → Resolve refs → Validate & commit
- `.xlsx`/`.xls`/`.csv`, ≤25 MB, ≤25 000 rows. Server parsing via `xlsx` (SheetJS)
- Endpoints: `POST /api/imports` (multer), `GET /api/imports/template`, `GET /api/imports`, `GET/DELETE /api/imports/:id`, `POST /api/imports/:id/{mapping,preview-references,validate,commit}`
- Auto-maps headers, date parser handles YYYY-MM-DD / DD/MM/YYYY / ISO / Excel serial. Time HH:mm / HH:mm:ss / H:mm AM/PM
- Commit runs in chunks of 500 in single transaction; status polled by frontend
- Per-batch undo: `DELETE /api/imports/:id` removes incidents + orphaned auto-created categories/locations; status → `rolled_back`

## File Attachments
- 2-step presigned URL flow: `POST /api/uploads/request-url` `{name, size, contentType}` → `{uploadURL, objectUrl}`; client PUTs directly to GCS; record saved with `url = objectUrl` (full HTTPS `/objects/uploads/<uuid>`)
- Served via `GET /objects/*` (Express stream, requires session)
- Backward-compat: old `data:` base64 still renders; old `/uploads/` disk paths return 404
- Files in `server/replit_integrations/object_storage/`
- Env: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`

## OMT Archon (Super-Admin)
- `/archon` — separate from user app (no sidebar, no session wall)
- Auth via `req.session.archonAuthed`; password compared against `ARCHON_PASSWORD`
- Dashboard `/archon/dashboard`: all users across all orgs, per-user activate/deactivate/delete, per-org "Comp" toggle (`isComplimentary=true` bypasses subscription gate)
- Routes: `POST /api/archon/login`, `GET /api/archon/me`, `POST /api/archon/logout`, `GET /api/archon/users`, `PATCH /api/archon/users/:id/status`, `DELETE /api/archon/users/:id`, `PATCH /api/archon/orgs/:orgId/complimentary`

## Analytics
Charts with cross-filtering (clicking any bar in Date/Time/Type/Location filters all others). Heatmap toggle on map panel. Admin-only "Geocode X missing" button batch-geocodes incidents with `locationName` but no coords; auto-geocode also runs on incident save when free-text location typed.

## PWA / SW
- SW: `client/public/sw.js`, current `CACHE_NAME = "omt-v53"`
- Version watcher polls `/api/version` every 60 s + on visibilitychange → "New version available — Refresh now" toast clears caches + unregisters SW + reloads
- Icons: `icon-192.png`, `icon-512.png` (transparent shield)

## File Structure
- `shared/schema.ts` — Drizzle schema + Zod validation
- `server/routes.ts` — REST endpoints
- `server/storage.ts` — DB layer (all methods filter by `orgId`)
- `server/index.ts` — Express, session, `safeMigrate`
- `server/migrate-commands.ts` — Command auto-migration
- `server/replit_integrations/object_storage/` — GCS adapters
- `client/src/pages/` — pages; `client/src/components/` — shared components

## Key Endpoints
- Auth: `GET /api/auth/has-users|me`, `POST /api/auth/login|register|logout`
- Data (auth + org+command scoped): `/api/locations`, `/api/categories`, `/api/incidents`, `/api/form-fields`, `/api/stats`
- Imports (admin): `/api/imports`
- Commands: `/api/commands`, `/api/me/commands`, `/api/me/active-command`
- Live: `/api/panic`, `/api/panic/recent`, `/api/incidents/:id/{close-panic,join-live,escalate}`
- Uploads: `/api/uploads/request-url`, `GET /objects/*`
- Billing: `GET /api/billing/status`
- Archon: `/api/archon/*`

---

## Agent Rules

Rules written to prevent the class of mistake made earlier in this project, where fixes were declared complete without adequate end-to-end verification.

**Footsoldier onboarding is frozen.** The end-to-end flow for adding an individual user to an existing organisation — admin "Add User" in User Admin → invite link generation → WhatsApp/email share message → `/invite?token=...` accept page → password set → first login — is final. Do not modify any code, copy, styling, or behaviour in this flow unless the user explicitly says so in the current request. Includes `client/src/pages/user-admin.tsx` invite/share UI, invite message template, `/invite` route, invite-accept page, and server-side invite token endpoints.

**Logo is sacred.** The OMT Pulse logo (green shield with document + bar-chart icon, canonical `client/src/assets/omt-logo-v2.png`) must never be modified, redrawn, substituted with a Lucide icon (e.g. `ShieldCheck`), rebuilt as inline SVG, or replaced — in any file, in any context. Same applies to `favicon.png`, `icon-192.png`, `icon-512.png`, `omt-logo.jpg`. Render via `<img src={omtLogoV2} />` from `@/assets/omt-logo-v2.png`. Do not "improve", "polish", or "vectorize".

**Live Incident & Nav Mode protocol is frozen.** The end-to-end live incident flow — creator dispatch (`startLive` → severity select → destination set → Navigate), joiner flow (`join-live` → `dispatchJoinerInApp` → nav mode), GPS tracking (`sendPosition` / `watchPosition` / `joiner-position` / `responder-position` endpoints), nav mode map behaviour (zoom guardian listener, `minZoom`, `skipFitBounds`, `preserveViewport`, heading-up tilt, step-tracking interval, voice announcements, off-route rerouting, arrival detection), panic dispatch and push fan-out, escalation, and live monitor — is final. Do not modify any code, copy, timing, map options, GPS logic, or push behaviour in this flow unless the user explicitly says so in the current request. Includes `client/src/pages/live-incident.tsx`, `client/src/pages/live-severity.tsx`, `client/src/pages/live-monitor.tsx`, and all `/api/incidents/:id/(join-live|responder-position|joiner-position|destination|joiner-destination|escalate|close-panic|mark-arrived)` server routes.

**Nothing gets removed without explicit instruction.** Never delete or "clean up" any existing feature, page, route, button, field, column, component, asset, env var, DB table/column, dependency, or UI copy unless the user explicitly asked for that specific removal in the current request. Applies even when a feature looks unused, redundant, legacy, or broken — assume it's intentional. When in doubt: preserve, don't prune.

**Storage/file mechanism changes.** Before marking any storage-related change complete, query production DB to confirm whether existing records use the old format. If they do, the task is not complete until those records are handled (migrated, cleaned up, or gracefully degraded).

**UI fallback and error states.** Every fallback — broken image placeholder, empty state, error toast — must be tested with a real failure, not assumed correct because the code looks right.

**Bug fix verification.** Never mark a bug fix complete without reproducing the original problem first, then confirming it's gone after the change. A user screenshot showing the bug still present is automatic proof the fix was inadequate.

**"Fixed" declarations.** Only say something is fixed after personally observing the correct behaviour. If direct observation isn't possible (e.g. production-only data), state that limitation explicitly.

**Pre-change impact check.** Before modifying any shared file (`server/index.ts`, `server/storage.ts`, `shared/schema.ts`, imports block of `server/routes.ts`), grep for every consumer first.

**API contract preservation.** Never change the shape of an existing API response (rename field, remove field, change URL path) without first searching every frontend call site. Old path must still work or every call site updated in the same commit.

**Middleware must not be reordered or weakened.** `resolveUser`, `express.json`, `express-session` are load-bearing. Any config change requires verifying login + session persistence + org-scoped data access still work.

**Schema changes are additive only.** New columns may be added. Existing names, types, constraints never altered. Rename = new column + data migration.

**Route regression check after any routes.ts edit.** Verify login, incident create, incident list, attachment upload all still return expected status codes.

**Removal check before deleting files or exports.** Full-codebase search for the symbol; only delete if zero outside-file consumers.

**Startup must succeed.** Workflow logs must show "serving on port 5000" after every change.

**Multi-tenancy must not regress.** Any new storage method added to `storage.ts` must accept and filter by `orgId`.

**Nav-mode tilt lock (APK) is frozen.** The 45° heading-up perspective on the native Capacitor map in nav mode depends on three pillars working together: (1) `setGestures({tilt:false, rotate:false})` on nav-mode entry to disable the Android SDK's gesture-settle deceleration, (2) the 200 ms `animateCamera(update, 200, null)` Kotlin patch in `patches/@capacitor+google-maps+8.0.1.patch`, and (3) the 400 ms tilt-keeper interval in `live-incident.tsx`. Removing or weakening any one collapses the tilt back to flat top-down within ~2 s. Do not modify any of the three, the new Kotlin `setGestures` plugin method, the `CapacitorMap.setGestures` wrapper, the `patch-package` postinstall hook, or the patches directory unless the user explicitly says so in the current request.

**Live Monitor map view preservation is frozen.** The admin's pinch / pan / zoom on `/live-monitor` must persist across the 5 s auto-refresh poll. `fitBounds` only re-fires when the set of active incident IDs changes (one starts or ends), gated by `lastFitSignatureRef` in `client/src/pages/live-monitor.tsx`. Do not call `fitBounds` / `setCenter` / `setZoom` from any code path that runs on every poll. Do not modify this gate unless the user explicitly says so in the current request.
