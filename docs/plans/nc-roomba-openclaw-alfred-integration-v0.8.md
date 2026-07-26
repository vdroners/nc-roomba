# NC Roomba ⇄ OpenClaw "Alfred" integration (optional feature)

## Context

OpenClaw ("Alfred") is the household/ops agent running on this host: a skills
library invoked by `@alfred …` mentions in Nextcloud Talk rooms (family
`9x4f25n3`, ops `jf7zijqp`), plus cron monitors. It deliberately shares the
"Alfred" identity with the Roomba app. There is a direct precedent — the
`forge-print` skill (3D printer) — with a clean, reusable mechanism:

- `~/.openclaw/scripts/talk-post.sh <msg> <room>` — post to a Talk room.
- `forge-dispatch-exec.sh <msg>` — parse `@alfred print …`, return a summary.
- `forge-print-monitor.sh` (cron) — detect state changes, post alerts.
- `load-forge-env.sh` + `FORGE_ENABLED` gate — the optional on/off switch.

The nc_roomba bridge already exposes everything needed (`/state`, `/action`,
`/preferences`, `/schedule` on `http://nc_roomba_bridge:8080`), and the PHP app
has `NotifyService` (native NC notifications) + a REST API.

Decisions (from review): **two-way** (Alfred controls the Roomba AND the app
surfaces Alfred), **full control** (clean/dock/stop/schedule directly),
**nc_roomba app changes are OK** (optional, off by default), **command seam =
through the app's PHP API** (Alfred is a dedicated `alfred` NC user in
`roomba-operators`, so ACL + command audit govern it — no bridge bypass), and
**in-app v1 = Talk deep-link + example commands + a mirror of recent
`[roomba]` alerts**.

## Design — two decoupled halves, joined by the bridge + Talk

### Part A — OpenClaw side: a `roomba` skill (mirrors forge-print)

New files in the OpenClaw workspace (no nc_roomba dependency):

- `~/.openclaw/workspace/skills/roomba/SKILL.md` — Alfred's guidance +
  Talk fast-paths: `@alfred roomba status | clean | spot | pause | resume |
  dock | find | stop | schedule | help`. Full-control policy (stop/clean act
  directly; document that they're real actions).
- `~/.openclaw/scripts/roomba-dispatch-exec.sh <msg>` — parse the command and
  call the Roomba backend, return a one-line summary. Reuses the forge dispatch
  shape. Talks to the app's **PHP API** (session/token) *or* directly to the
  bridge on the Docker network — default to the bridge health/state for reads
  and the PHP action route for writes so ACL/audit still applies.
- `~/.openclaw/scripts/roomba-talk-fast-path.sh` — wrapper that cleans the msg
  and posts the summary via `talk-post.sh` (copy of forge-talk-fast-path.sh).
- `~/.openclaw/scripts/roomba-monitor.sh` + a systemd `alfred-cron-roomba-
  monitor` unit — poll `/state`, detect mission start/complete/error and
  bin-full, post `[roomba] …` alerts to a Talk room; de-dupe via a
  `state/roomba-monitor-last.json` (mirrors forge-monitor-last-alert.json).
- `load-roomba-env.sh` + `ROOMBA_ENABLED` / `ROOMBA_ALERT_TALK_ROOM` /
  `ROOMBA_BRIDGE_URL` / `ROOMBA_APP_URL` — the optional-feature gate + config.

Reuse the existing `talk-post.sh`, the forge dispatch/match libs as templates,
and the env-loader pattern. Nothing here touches the nc_roomba repo.

### Part B — nc_roomba app side: an optional "Alfred" surface

All gated behind an appconfig toggle `alfred_enabled` (default `false`) so the
feature is invisible/inert unless an admin turns it on.

- **Admin config** (AdminSettingsView.vue + SettingsController + appconfig):
  a small "Alfred assistant" section — enable toggle + Talk room token
  (`alfred_talk_room`) + optional Talk deep-link base. Stored via appconfig
  (room token is not a secret; no crypto needed).
- **Store + API**: `alfred` config surfaced in `adminBootstrap()` and the
  page bootstrap so the SPA knows whether the feature is on and the room link.
- **In-app "Ask Alfred" card** (new `AlfredPanel.vue`, shown on the Dashboard
  only when `alfred_enabled`): (1) a button that deep-links to the Talk room
  (`https://<nc>/call/<token>`), (2) a few example `@alfred roomba …` commands,
  and (3) a **mirror of the last few `[roomba]` alerts**. Source the alerts
  from a small tail the monitor writes (e.g. the monitor appends to a log the
  app can read, or drops JSON in a path the app exposes via a read endpoint) —
  keep it a simple read, no Talk API needed in v1.
- **Outbound narration (app → Alfred)**: when a mission completes/errors,
  `NotifyService` also posts to the Talk room (via the same monitor's
  `talk-post.sh` path or an ops `inbox/` drop) so Alfred narrates Roomba events
  in the room. Behind the same toggle; reuse the file-drop bridge
  (`/media/4TB/ops/inbox`) rather than new plumbing.

### The seam / who calls whom

- **Alfred → Roomba (control):** Talk `@alfred roomba clean` →
  roomba-dispatch-exec.sh → nc_roomba PHP API (`POST /api/robots/1/action`)
  → bridge → robot. Goes through PHP so operator-group ACL + command audit
  apply even for full-control. Needs a service account / app token for Alfred
  (documented; a dedicated `alfred` NC user in `roomba-operators`).
- **Roomba → Alfred (narration/alerts):** roomba-monitor.sh polls `/state`
  and posts to the Talk room; optionally the app mirrors mission events too.

## Files to modify / create

OpenClaw workspace (Part A):
- `~/.openclaw/workspace/skills/roomba/SKILL.md` (new)
- `~/.openclaw/scripts/roomba-dispatch-exec.sh`, `roomba-talk-fast-path.sh`,
  `roomba-monitor.sh`, `load-roomba-env.sh` (new; templated from forge-*)
- a `alfred-cron-roomba-monitor.service` systemd unit (new)

nc_roomba app (Part B):
- `lib/Service/RobotService.php` (or a small `AlfredService`) + appconfig keys
  `alfred_enabled`, `alfred_talk_room`, `alfred_app_url`.
- `lib/Controller/SettingsController.php` + `appinfo/routes.php` — admin
  get/set for the Alfred config; expose in `adminBootstrap()`.
- `src/views/AdminSettingsView.vue` — the "Alfred assistant" admin section.
- `src/components/AlfredPanel.vue` (new) + `src/views/DashboardView.vue` —
  render the card only when enabled; `src/store/robot.js` getter for the config.
- `docs/` + CHANGELOG + version bump (minor — new optional feature). Build +
  deploy (frontend + PHP → RESTART). No bridge/sim change.
- A dedicated `alfred` NC user added to `roomba-operators` (documented setup
  step, not code).

## Verification

1. Feature OFF by default: fresh app shows no Alfred card; admin toggle absent
   of a room token keeps it inert. Existing 42 tests still pass; build clean.
2. Turn it on in admin → Dashboard shows the Alfred card linking to the Talk
   room; store bootstrap carries `alfred_enabled/room`.
3. OpenClaw side (dry-run first, `ROOMBA_TALK_DRY_RUN=1`):
   `roomba-talk-fast-path.sh "@alfred roomba status" <room>` prints a real
   status summary from `/state`; `@alfred roomba dock` (live) issues the action
   through the PHP API and the robot reacts; command audit row is written.
4. Monitor: force a state change (or mock) and confirm a `[roomba]` alert posts
   to the Talk room once (de-duped).
5. Guardrails: with `ROOMBA_ENABLED=0` the skill/monitor no-op; `alfred_enabled`
   false hides the app surface.
6. Commit per CLAUDE.md in **each** repo separately (nc_roomba: sanitized-env +
   Claude trailer; OpenClaw workspace: its own conventions). Report push status.

## Guardrails / non-goals

- Off by default; both halves gated (`ROOMBA_ENABLED`, `alfred_enabled`).
- Do NOT stop or reconfigure `openclaw-gateway` or other alfred-cron units.
- Full-control actions still route through the PHP ACL/audit — Alfred is a
  first-class operator, not a bypass.
- No secrets in the repo; the Talk room token is config (appconfig / env), the
  Alfred NC user's app-password stays in OpenClaw's credentials store.
- v1 keeps the in-app surface simple (deep-link + example commands + optional
  alert mirror); richer embedded chat is a later pass.
