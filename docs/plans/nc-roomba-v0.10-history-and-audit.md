# nc-roomba v0.10.0 — mission History repair + full audit remediation

Plan-First record (19labs AI-assist guideline #5) for the 0.10.0 change.

## Why

The operator reported that **mission History never populates**. Investigation
found a defect dating to the **initial commit** — History has never worked in
any released version — and the surrounding audit found a good deal more.

Three parallel adversarial audits (history pipeline, backend/bridge, frontend)
plus direct investigation produced: **two blockers, one safety hazard, eleven
majors and around twenty-five minors**. A useful frame: nc-litter was cloned
from this codebase, and an audit of that clone had just confirmed a specific bug
list. Nine of the ten checked were still present here, in the parent.

## The reported bug

`lib/BackgroundJob/TelemetrySampleJob.php` passed the bridge's response
*envelope* into `MissionService::ingestState()`, which expects the unwrapped DTO.

`/state` answers `{ok, needs_attention, state:{phase, cycle, battery_pct, …}}`.
Unwrapping was every caller's job; `RobotService::getEnrichedState()` did it (with
a comment naming the hazard), the sampler did not. So `$phase` resolved to `''`,
`$cycle` fell to its `?? 'none'` default, the "is a mission running?" test was
permanently false, and **no mission row was ever created**. Every mission
notification and Activity entry lived behind the same dead branch.

Evidence at the time of diagnosis:

```
nc_roomba_missions              0 rows    AUTO_INCREMENT = 1 (never inserted)
nc_roomba_mission_phase_events  0 rows    AUTO_INCREMENT = 1
nc_roomba_telemetry_samples   521 rows    phase/battery/rssi/pose ALL NULL
```

A second, independent blocker was hiding behind it: **`cloud_cron` could not
resolve either bridge**. Background jobs run in the cron container, `bridge-up`
only attached `cloud_app`, and `getent hosts nc_roomba_bridge` returned NO_DNS.
The same omission was silently breaking nc-litter.

## What was done

**Blockers.** The unwrap moved into `BridgeClient::getState()` so no caller can
get it wrong again — the routes nest inconsistently (`/health` flat, `/state`
under `state`, `/schedule` under `week`), which is what made the mistake
possible. The sampler's useless `is_array()` guard (the envelope *is* an array)
became a real contract check that logs loudly when a payload arrives without a
`phase`, and the bridge-unreachable case was raised from `debug` to `warning`.
`bridge-up` now attaches the cron container too, and a new `make
bridge-net-check` fails if any required container cannot reach the bridge.

**Safety.** `tools/roomba-live-gates.sh` read `ROOMBA_MOCK`, echoed it, and never
used it in a conditional — while defaulting to the live bridge. Running
`make gate-live` against the real robot would have started a cleaning mission and
overwritten the weekly schedule. It now reads mocked-ness from the bridge itself
and skips every mutating gate unless the bridge really is a mock, or the operator
opts in explicitly.

**Mission recording, three layers.** Fixing the unwrap alone was not enough:
Nextcloud cron samples with a measured median gap of 15 minutes and a maximum of
110, against a 28-minute average mission.

1. *The bridge is the authority.* It watches MQTT continuously, so it now
   journals every completed mission — precise start and end, cycle, outcome,
   battery, area, footprint size — to a persisted ring buffer, exposed as
   `GET /missions?since=<seq>`. Nextcloud drains it and can be slow, restarted,
   or offline for a day without losing one. The journal lives on a volume
   because an in-memory buffer would be emptied by `up --build`, which is
   exactly when history is most likely to be lost.
2. *Odometer safety net.* The robot counts its own missions. If `bbmssn.nMssn`
   advances further than the missions recorded, a run happened that nobody
   witnessed; it is stored as `source: odometer` with null boundaries, rather
   than inventing a start time.
3. *Sampling* still runs, now with correct data, and opens a mission on any
   cycle other than `none` — the old list was `['clean','spot']` and missed
   `quick`, which is what this robot actually reports.

Missions also fall back to the bridge's `sqft_est` / `mission_m_est` when the
robot reports 0 (this 960 always does), so History stops saying "0 sq ft".

**Data.** A repair step purged 518 all-null telemetry rows and recorded a
lifetime baseline (1,803 missions, 925 hours) so stats and streak achievements
score from a known point. The ~1,800 prior missions are unrecoverable as
per-mission detail — the bridge kept history only in memory and the robot stores
just aggregates — and the baseline is the honest substitute rather than
fabricating rows.

**Security.** The one route with no permission check (`/api/alfred/alerts`,
readable by all ~130 users) is gated, and its admin-configured log path is now
confined. Robot-scoped routes 404 on an unknown id instead of returning the real
robot's telemetry under a bogus one. `AdminSecretCrypto::decrypt()` throws
instead of returning the ciphertext, which would otherwise be sent to the robot
as its password after a key rotation. The retention cutoff can no longer land in
the future, telemetry belonging to retained or open missions is protected, and
the batch caps are consistent. The Soft-AP provision stops reporting success it
has not verified, and the wifi-helper fails closed. The robot's MQTT password is
no longer served from the Soft-AP status endpoint.

**Correctness.** The SSE route was broken four ways — body written before the
headers so the Content-Type stayed `text/html`, a single-quoted `\n` reaching
the wire as a literal backslash-n, a 25-second worker-pinning timeout on every
call, and two different DTO shapes in one stream. It is now one well-formed
enriched frame with a `retry:` hint. `spot` was removed: dorita980 implements
neither `spot` nor `cleanSpot`, so the real robot answered 501 to it for the life
of the project.

**Frontend.** One app-wide `dt` reset fixes the label clipping caused by
Nextcloud's `core/css/server.css` forcing a fixed 130px width on bare `dt`.
Measured: 6 spilling tiles at 1600px, 9 at 750px and 4 at 390px (the hero
"Battery" label overflowed its 43px box by 87px) — all now zero. The store
merges state instead of replacing it, tolerates a normal SSE close, and keeps
action failures visible instead of letting the 3-second poll erase them. A
stylesheet that was a near-copy of the NC-GCS theme — and was being injected into
every Nextcloud page for tokens this app never read — is gone.

**Contrast.** Brass `#c4a574` measures 2.34:1 on white, and the active theme
here is light. The accent was split into three roles — decorative, text ink, and
meaningful-graphic — with a light-theme-only override. Six failures fixed,
including the battery ring (2.14 → 3.60), the donut (1.99 → 3.34) and the chip
text (2.77 → 4.58); the "New!" achievement pill was white-on-brass at 2.34 in
*both* themes because its `#1a1a1c` fallback never applied, and is now 7.43. The
dark path already passed and is unchanged. Purely decorative container borders
are deliberately left below 3:1 — 1.4.11 exempts them, and darkening them would
make the app look like a wireframe.

**`make gate-gui` was failing and nothing ran it.** The gate was stale, not the
UI: a previous commit deliberately moved discovery and onboarding to the admin
panel and the gate still looked for them in operator Settings. Fixed, extended
to guard this work (the `dt` reset, the ink tokens, the sticky action error,
reduced-motion coverage, and a check that the global stylesheet never returns),
and wired into `ship` so it cannot rot again.

**Operations.** Neither app's Alfred monitor had ever been scheduled: the scripts
existed, nothing ran them, and the in-app alert card was permanently empty. Both
now run from `alfred-cron-*-monitor.timer` on the same five-minute pattern as the
other Alfred jobs.

## The root cause worth naming

Every one of these survived a green test suite, because the tests asserted the
code's assumptions rather than the device's behaviour:

- There was **no test of `BridgeClient`, no test of `MissionService`, and no test
  of either background job**. A two-line test would have caught the blocker.
- The action-contract test asserted `candidates.length > 0` — tautologically
  true — and so certified `spot`, while the mock, which *did* implement spot,
  kept everything green.

So the fixes are paired with tests bound to reality: a regression test that fails
on the envelope shape, an action test that reads the *installed* dorita980
source and fails if a command we advertise is not there (and fails again if
`spot` ever becomes available, as a prompt to re-enable it), the retention
arithmetic pinned directly, and journal tests covering restart, corruption and
idempotent draining.

## Verification

| Suite | Before | After |
|---|---|---|
| phpunit | 15 | 37 |
| bridge (`node --test`) | 28 | 36 |
| wifi-helper | 8 | 18 |
| vitest | 42 | 47 |

Live, against the real robot: telemetry rows now carry real
`phase`/`battery_pct`/`rssi`/`pose`; the journal drain records missions
end-to-end, is idempotent across repeated drains, and re-syncs if the journal is
reset; `/stream` returns `text/event-stream` with real newlines and no
"headers already sent"; destructive gates skip against a live robot; both Alfred
monitor timers fire on schedule.

## Known limitations

- The ~1,800 pre-existing missions cannot be recovered as detail.
- Cron attachment via `docker network connect` does not survive a container
  recreate; `make bridge-up` re-establishes it and `bridge-net-check` will fail
  loudly if it is missing. The durable home for it is the cloud compose file.
- A real end-to-end mission recording has been proven with a seeded journal
  entry rather than by commandeering the operator's vacuum; the first genuine
  clean cycle will confirm it in the field.
