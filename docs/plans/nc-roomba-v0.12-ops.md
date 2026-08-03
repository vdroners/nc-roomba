# NC Roomba v0.12.0 — Alfred household ops polish (Phase 3)

## Summary

Phase 3 makes onboarding honest about Soft-AP limits, confirms schedule writes the
same way preferences already do, hides unsupported robot settings, and persists a
mission footprint snapshot for History replay.

## Changes

### Soft-AP demote + diagnose

- **Admin UI:** hold-HOME / Auto discover is the default open path; factory
  Soft-AP wizard lives in a collapsed *Advanced* block.
- **wifi-helper:** `waitSoftApReady` distinguishes *not associated* vs
  *associated but gateway silent* (960 beacon-only class) with an operator-facing
  error pointing at hold-HOME or a full-minute battery pull.
- **wifi-helper:** `POST /wifi/softap/diagnose` reports link, client IP, ARP,
  ping, and TCP :8883 without attempting to fix the 960 silence.
- **Copy:** OPERATOR.md + SetupWizard updated; Spot removed from wizard done step.

### Schedule write confirmation

- After `setWeek`, bridge readbacks `getWeek` and returns `confirmed` (mirrors
  preferences echo). PHP `SettingsController` and Pinia store surface the flag;
  Settings / ScheduleWeekGrid messaging matches preferences.

### Capability-gated Settings

- Settings hides schedule editor and individual preference controls when
  `state.capabilities` reports the robot does not support them.

### Mission map replay

- At mission end, bridge journal + PHP ingest persist `pose_trail` and
  `covered_cells` in `missions.map_json`.
- History detail renders the frozen footprint using shared SVG helpers from
  `src/utils/format.js`.

## Verification

1. **Version:** `grep version appinfo/info.xml` → `0.12.0`.
2. **Unit tests:** `npm test` (vitest) and `make bridge-test` / `make helper-test`.
3. **Admin onboarding:** Administration → NC Roomba — hold-HOME block open by
   default; Soft-AP wizard collapsed under Advanced.
4. **Soft-AP diagnose:** `curl -X POST -H 'x-roomba-helper-token: …' \
   http://127.0.0.1:8091/wifi/softap/diagnose` on a joined Soft-AP (or mock).
5. **Schedule:** change one day in Settings → Save; confirmed message when robot
   echoes; warning when not yet echoed.
6. **Capabilities:** on a 960 mock without schedule cap, schedule section hidden.
7. **History map:** complete a mock mission with pose trail → open History detail
   → footprint SVG visible when `map_snapshot` present.
8. **Build:** `npm run build` exits 0.

## Out of scope

- Fixing Roomba 960 Soft-AP IP/setup silence (diagnose only).
- Spot command revival.
