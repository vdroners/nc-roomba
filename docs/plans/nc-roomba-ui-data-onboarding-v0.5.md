# NC Roomba: fix scroll, correct/enrich tab data, harden onboarding (v0.5.0)

## Context

Alfred (Roomba 960) is now onboarded and controllable, but a hands-on review
surfaced three problems the user wants fixed before a fresh onboarding test next
week:

1. **Can't scroll the web GUI** — tab content is cut off with no scrollbar, so
   items below the fold are unreachable.
2. **Data correctness** — with Alfred charging, the app shows a red **0%**
   battery. The robot genuinely reports `batPct: 0` right after a battery pull
   (BMS recalibrates over the first charge cycle), so the *data* is faithful but
   the *presentation* is wrong (0% while charging should not read as critical).
   Separately, several useful fields the robot sends are never shown
   (`software_version`, `sku`, and most `bbrun`/`bbmssn` lifetime stats).
3. **Onboarding readiness** — the reliable hold-HOME path works, but has rough
   edges that will bite a fresh test: it defaults the robot name to "Alfred"
   even though the robot reports its real name/sku, and get-password failures
   give a generic message.

Live ground truth used for this plan (bridge `/state`): `phase: charge`,
`battery_pct: 0`, `not_ready: 15`, `rssi: -30`, `software_version:
v2.4.17-138`, `sku: R960020`, rich `bbrun`/`bbmssn` present.

## 1. Scroll fix (the blocker)

Root cause: the main content container is a flex child that grows but never
scrolls. In [css/style.scss](css/style.scss):

- `.nc-roomba-main` (~lines 136-143): `flex: 1` with **no `overflow-y`** →
  content taller than the viewport overflows invisibly.
- `.nc-roomba-app-shell` (~lines 32-48): `display:flex; flex-direction:column;
  min-height:100%`.

Fix: give the scroll to `.nc-roomba-main` with `overflow-y: auto` and a bounded
height so it actually scrolls inside the Nextcloud `#app-content` frame
(`min-height: 0` on the flex child so it can shrink below content size; the
shell already establishes the column). Concretely:
- Add `min-height: 0;` to the flex column context and `overflow-y: auto;` +
  `min-height: 0;` to `.nc-roomba-main`.
- Verify the sticky `.nc-roomba-status-strip` (top:0) still pins correctly once
  the scroll owner moves to `.nc-roomba-main` (if the strip must stay pinned
  across scroll, keep the strip outside the scrolling `<main>` — confirm in
  [src/components/AppShell.vue](src/components/AppShell.vue) markup and, if
  needed, make the strip a sibling above `<main>` rather than inside it).

Test at a narrow/short viewport that content below the fold is reachable on
every tab (Dashboard is the tallest — StatusStrip + ControlPad + MissionStage +
ErrorDecoder + MissionTimeline + MaintenanceHints).

## 2. Data correctness + enrichment

### 2a. Battery-while-charging presentation
In [src/utils/format.js](src/utils/format.js) `batteryClass()` (line 46) and
`batteryLabel()` (line 38) only take `pct`. The misleading case is `pct === 0`
while charging. Fix with minimal blast radius:
- Add an optional `phase` arg to `batteryClass`/`batteryLabel` (default
  undefined so existing callers/tests are unaffected), and when
  `pct === 0 && phase === 'charge'` return class `''`/`ok` and label
  `Charging…` (or `—`) instead of red `0%`.
- Update the two call sites in
  [src/components/StatusStrip.vue](src/components/StatusStrip.vue) (lines 11-12)
  and [src/components/MissionStage.vue](src/components/MissionStage.vue) (battery
  render ~line 120) to pass `state.phase`.
- Add/extend unit tests in `src/__tests__` (there is an existing
  `missionStage.spec.js`) covering `batteryClass(0,'charge') === ''` and normal
  buckets unchanged.

### 2b. Surface hidden fields
- **Lifetime stats** — extend the `stats` computed in
  [src/components/MaintenanceHints.vue](src/components/MaintenanceHints.vue)
  (lines 69-92) to add rows from data already passed in: mission success rate
  (`bbmssn.nMssnOk/nMssn`), avg mission minutes (`bbmssn.aMssnM`), and pick/panic
  counts (`bbrun.nPicks`, `bbrun.nPanics`). Pure additive rows, no new props.
- **Firmware / model** — show `software_version` and `sku`. Cleanest home is the
  ConnectionHealthDrawer (already the "about this robot/bridge" surface) or a
  small line in MaintenanceHints. Add them to the normalized DTO passthrough if
  not already present — they ARE in `/state` (`stateNormalizer.js` already emits
  `sku`/`software_version`? verify at
  [bridge/lib/stateNormalizer.js](bridge/lib/stateNormalizer.js); if not emitted,
  add `sku: state.sku` / `software_version: state.softwareVer` there) and render
  in [src/components/ConnectionHealthDrawer.vue](src/components/ConnectionHealthDrawer.vue).

No change to bin/rssi/phase/pose handling — exploration confirmed those are
correct.

### 2c. Extra end-user-useful UI additions (my picks)
Small, high-value additions built only from data we already have — no new robot
plumbing, so low risk:
- **"Charging — battery calibrating after power-cycle" hint.** When
  `phase==='charge' && battery_pct===0 && not_ready!==0`, show a one-line info
  note (in MissionStage or ErrorDecoderPanel) explaining it's expected and will
  self-correct — directly answers the confusion this review started from.
- **Dock / ready state chip.** Decode `not_ready` into a friendly "On dock /
  Off dock / Not ready to clean" indicator in the StatusStrip (we already have
  the value and an errorDecoder that reads it). Turns the cryptic `not_ready:15`
  into something an operator understands.
- **Bin-full & maintenance-due callouts.** We already have `bin` and lifetime
  wear counts; surface a gentle "empty the bin" / "brush check due" nudge in
  MaintenanceHints when thresholds (knowledge/maintenance_thresholds.json) trip
  — the thresholds file exists but verify it's wired to the hints.
- **Last command feedback.** `health.last_command` (action/result/at) is only in
  the drawer; a subtle toast/label after pressing a control ("Clean — sent")
  reassures the operator the command reached the robot. Only if cheap; otherwise
  defer.
- **Firmware/model in an "About Alfred" mini-panel** (folds in 2b): name, model
  (`sku`), firmware (`software_version`), IP, BLID(masked), signal — a single
  at-a-glance identity card, useful for support and for confirming the right
  robot after onboarding.

These are additive and optional per-item; if any proves fiddly it's dropped
rather than blocking the release. Nothing here invents data the robot doesn't
already send.

## 3. Onboarding hardening (for next week's test)

Path A (hold-HOME LAN takeover) is the one to make bulletproof. In
[lib/Service/RobotService.php](lib/Service/RobotService.php) `onboard()`
(lines 347-380):
- **Auto-fill real name/sku**: the bridge get-password response already returns
  `robotname` and `sku` (bridge/lib/robotManager.js:981-987). Use
  `body['robotname']` as the name when the caller didn't set one, instead of
  hardcoding `'Alfred'` (line 361). Persist `sku` if the Robot entity/settings
  can hold it (store in `settings_json` if no column).
- **Clearer errors**: when `getPassword` fails, map the bridge error to an
  actionable message (timeout → "hold HOME until it beeps, then retry within
  60s"; ECONNREFUSED → "robot busy/another MQTT client — close the iRobot app";
  not-in-onboarding → keep). The bridge already produces these strings
  (robotManager.js:931,954,959); ensure they propagate through
  [lib/Service/BridgeClient.php](lib/Service/BridgeClient.php) and
  SettingsController::onboard (lines 135-149) to the UI instead of a generic
  `get_password_failed`.

Verification is the priority (the user said "ensure it will work"):
- Dry-run **discover** now against the live LAN (read-only): bridge `/discover`
  should list Alfred at 10.0.0.242 with blid+sku.
- Confirm creds already persist encrypted: check the `nc_roomba_robots` row has
  `password_enc` starting `enc:v1:` (via occ or the app). If Alfred's DB row is
  not yet written (creds currently only in `.env`), do one admin-UI onboard
  (hold HOME) so the encrypted DB row exists — this is the belt-and-suspenders
  the user was told about.
- Document the exact click-path for next week in
  [docs/OPERATOR.md](docs/OPERATOR.md) (already leads with hold-HOME after v0.4.0
  — just confirm it matches the hardened behavior).

## Files to modify

- `css/style.scss` — scroll fix (`.nc-roomba-main`, shell flex `min-height:0`).
- `src/components/AppShell.vue` — only if the sticky strip must move out of the
  scroll container.
- `src/utils/format.js` — battery phase-aware class/label.
- `src/components/StatusStrip.vue`, `src/components/MissionStage.vue` — pass phase.
- `src/components/MaintenanceHints.vue` — extra lifetime-stat rows + maintenance
  callouts.
- `src/components/ConnectionHealthDrawer.vue` — firmware/sku line.
- Additions from 2c: charging hint + dock-state chip (StatusStrip /
  ErrorDecoderPanel / MissionStage), optional "About Alfred" identity card,
  optional last-command feedback. Verify
  `knowledge/maintenance_thresholds.json` is wired to the hints.
- `bridge/lib/stateNormalizer.js` — emit `sku`/`software_version` if missing.
- `lib/Service/RobotService.php`, `lib/Service/BridgeClient.php`,
  `lib/Controller/SettingsController.php` — onboarding name/sku + error mapping.
- `src/__tests__/` — battery unit test.
- Version bump to **0.5.0** across the three synced files + CHANGELOG + README
  badge (per CLAUDE.md; use `make bump-minor`). Frontend+PHP change →
  `make build` then `make deploy RESTART=1`. Bridge change (stateNormalizer) →
  rebuild the bridge container (`docker compose -f docker-compose.bridge.yml up
  -d --build`).

## Verification (end-to-end)

1. `make build` exits 0; unit tests pass (`npm test` / vitest).
2. Deploy; container reports the new version; both containers healthy; Alfred
   still `connected: true` after restart.
3. **Scroll**: in the browser at a short viewport, every tab scrolls to its
   last element (Dashboard especially).
4. **Battery**: with Alfred charging, the strip shows "Charging…"/neutral, not
   red 0%. When Alfred reports a real pct later, buckets behave normally.
5. **Enriched data**: Maintenance shows the new lifetime rows; drawer shows
   `v2.4.17-138` / `R960020`.
6. **Onboarding**: `/discover` lists Alfred; a fresh `onboard` names the robot
   from `robotname` (not hardcoded Alfred) and a forced failure yields the
   actionable message; `nc_roomba_robots.password_enc` is `enc:v1:…`.
7. Commit per CLAUDE.md (sanitized-env, Claude trailer). Do NOT push until the
   user OKs (also the two prior commits 0.3.2 + 0.4.0 are awaiting the same OK).

## Notes / non-goals

- The `battery_pct: 0` will self-correct after a full charge cycle — the fix is
  purely so the UI doesn't misrepresent a charging robot as critical.
- `.env` holds the working creds and is gitignored; never commit it.
- Do not touch unrelated services (openclaw-gateway etc.).
