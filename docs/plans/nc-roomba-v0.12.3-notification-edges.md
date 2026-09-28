# nc-roomba 0.12.3 — stop notification spam

## Problem

Operators got a "bin full" notification every 5 minutes, per user, for as
long as the bin stayed full: 7,513 unread `bin_full` notifications between
2026-08-03 and 2026-09-28 (1,148/day across 4 recipients while the bin sat
full 09-23 → 09-28). `low_battery` (1,656) had the same defect, and
`mission_complete` fired twice for most bridge-journalled runs.

## Root cause

- `MissionService::ingestState()` latched bin-full / low-battery in PHP
  `static` arrays. `TelemetrySampleJob` runs in a fresh cron process each
  tick, so the latch was always empty and every full/low sample notified.
- A single run is recorded by both the telemetry sampler (closes the open
  mission → notify) and the bridge journal (`recordBridgeMission` → notify,
  then supersedes the sampled row), so two `mission_complete` go out.

## Change

1. Bin-full and low-battery notify on the **confirmed rising edge** judged
   from stored telemetry samples (same pattern nc-litter 0.4.0 uses): the
   condition must hold for the current and previous sample and not for the
   one before. Re-arms automatically once the bin reads `ok` / battery
   recovers.
2. Low battery is not raised while the robot is on the dock charging
   (`phase = charge`) — nothing for the operator to do.
3. `mission_complete` / `mission_error` are claimed per robot through an
   appconfig key holding the last notified end time; a second recorder
   reporting the same run within `OVERLAP_TOLERANCE_S` (15 min) is skipped.
4. `make run-phpunit` always uses `php:8.2-cli` (host `php` is a stub).

## Verification

- New unit tests for the edge predicates (`AlertEdgesTest`).
- `make gate-preflight`, deploy, then confirm in `oc_notifications` that no
  new `bin_full` rows appear on subsequent cron ticks while the bin stays
  full.
