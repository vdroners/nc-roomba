# NC Roomba: live-mission map, coverage, layout + clipping fixes (v0.9.0)

## Context

Reviewed the app against a **live Roomba 960 mid-clean**. The robot publishes
real pose but the app misrepresents it, and several requested capabilities are
missing. Ground truth captured from the bridge `/state` while cleaning:

- **Pose is live, in centimetres, dock-relative**: x 96–329, y 222–367, theta
  full −179…+174°. `has_pose: true`.
- **`pose_trail` is always `null`** — the bridge never accumulates a trail from
  successive poses (confirmed: no trail code in `bridge/`). So the map has only
  a lone marker and **no cleaned-floor footprint**.
- **`mission.sqft` and `mssn_m` are `0`** for a 7+ min mission — the 960 doesn't
  populate them live; the bridge forwards the raw 0. But `mission.started_at`
  IS present.
- **Map heading/position wrong**: `MissionStage.vue`/`LocationView.vue` render
  `translate(x, -y) rotate(theta)` — Y is flipped but theta isn't negated
  (heading points wrong), and a fixed `viewBox -500..500` with `clamp(±480)`
  means real motion barely reads.
- **Metric boxes clip** (Mission/Coverage/Battery/Cycle) — big values overflow
  the fixed box and get cut by the stage's `overflow:hidden`.
- **Dashboard wastes space** on wide screens — single 1100px column of stacked
  zones; the 7-button Controls panel leaves a tall empty column beside the
  mission stage.
- PHP `getEnrichedState` **spreads the bridge DTO** (no whitelist), so new DTO
  fields reach the frontend with **no PHP change**.

The robot does NOT publish an occupancy map, carpet map, or located
cliff/stuck events over local MQTT — `bbrun` cliff/stuck counts are lifetime,
unlocated. The plan is honest about this: the "floor footprint" is **built
client-visible from the pose trail we start accumulating**, not a map the robot
provides.

## Part 1 — Bridge: accumulate a pose trail + derive coverage/duration

`bridge/lib/robotManager.js` (stateful owner; `normalizeState` is pure):
- Add a mission-scoped ring buffer + covered-cell map on the instance:
  `this.poseTrail = []`, `this.coveredCells = new Map()`; constants
  `TRAIL_MAX=2000`, `TRAIL_MIN_MOVE_CM=5`, `CELL_CM=25`.
- In `#trackMission()`: **reset** trail+cells when a new mission starts (the
  existing `running && !missionStartedAt` edge); **append** the current pose
  each running sample via a new `#appendPose()` (reads `raw.pose.point.{x,y}` +
  `raw.pose.theta`, min-distance decimation, ring cap, quantize into
  `coveredCells` keyed by 25 cm grid with a dwell count).
- `getState()` passes `pose_trail` + `covered_cells` into the `meta` arg (like
  `mission_started_at` already is).

`bridge/lib/stateNormalizer.js`:
- Emit `pose_trail: [{x,y,theta,ts}]` and `covered_cells: [{x,y,n}]` (cell centre
  in cm + dwell count) in the DTO.
- `normalizeMission(...)` gains derivations (keep raw `sqft`/`mssn_m` untouched):
  - `mission_m_est = round((updated_at − started_at)/60000)`.
  - `sqft_est = round(cellCount × 0.0625 m² × 10.7639)` — unique-cell area
    (dedupes the Roomba's constant re-covering; honest "area cleaned").
- Keep new params optional (defaults) so existing bridge tests stay green.

## Part 2 — Map rendering (`MissionStage.vue` + `LocationView.vue`, same edits)

- **Heading fix:** `rotate(-(theta) - 90)` — negate theta because Y is flipped;
  the −90 aligns the up-pointing marker art with robot-forward (confirm the
  constant offset live, Part 6; the sign is the load-bearing fix).
- **Auto-fit viewBox:** replace the fixed `viewBox` with a computed one that
  bounding-boxes the dock(0,0) + trail + current pose with padding, kept square.
  Real motion now fills the frame. Relax the ±480 clamp to an outlier guard.
- **Floor footprint layers** (Z order: grid → swept band/cells → crisp trail →
  robot marker):
  - swept-area = translucent round-joined thick polyline (~34 cm stroke =
    robot width) and/or `covered_cells` rendered as translucent 25 cm `<rect>`s;
  - crisp trail = existing `trailPoints` polyline;
  - faint SVG `<pattern>` grid via a full-bleed rect.
- **Coverage/duration text** (`MissionStage`): prefer raw, else show estimate
  with an explicit "est." suffix; `—` when neither.

## Part 3 — "Problem areas / carpet edges": honest derivation

The robot gives no located edge/stuck data over local MQTT — do not fabricate.
Ship what IS real from the trail:
- **Dwell heatmap** from `covered_cells[].n` (opacity ∝ dwell), labelled
  "Dwell — bright = revisited most; often walls/obstacles."
- Optional **phase-change pins**: when `phaseEvents` flips to `stuck`/return
  mid-run, drop a marker at the nearest-timestamp trail point ("interrupted
  here"). Real, per-mission, located.
- UI copy states plainly that a full carpet/edge map isn't published by the 960.
- Note for later: a true room map (as the iRobot phone app shows) would require
  the iRobot **cloud** API — a separate future integration, out of scope for the
  local-MQTT path this app uses. Document this in the Location copy / CHANGELOG.

## Part 4 — Metric-box clipping (`css/style.scss`)

`.nc-roomba-stage__metric`: add `overflow:hidden` (clip inside the rounded box,
not against the stage edge); `dt` → `letter-spacing:0.02em` + wrap; `dd` →
`font-size: clamp(0.95rem, 3.2vw, 1.25rem)` + `word-break` so long values (now
longer with "est.") scale down instead of overflowing.

## Part 5 — Dashboard layout density (`DashboardView.vue` + SCSS)

Reduce wasted space on wide screens without harming mobile:
- Widen the dashboard container on large viewports (raise/relax the 1100px cap,
  e.g. `max-width` up to ~1400px at ≥1200px) so the content uses the monitor.
- Reflow zones into a denser grid ≥1000px: put **Controls beside the Status
  hero** (the 7 buttons are short — they shouldn't own a tall column next to the
  big MissionStage). Candidate layout: Row1 = Hero (wide) + Controls (narrow);
  Row2 = MissionStage (large, with the new map) + a right rail stacking
  MissionTimeline + Lifetime; Maintenance/Alfred full-width below. Reuse the
  existing `.nc-roomba-dashboard__split` grid pattern; add a 3-col/rail variant
  at a new ≥1200px breakpoint. Keep single-column on phones.

## Files to change

- `bridge/lib/robotManager.js`, `bridge/lib/stateNormalizer.js` (+ `bridge/test/`
  cases: trail append/decimate/cap, reset-on-new-mission, cell quantize,
  sqft_est/mission_m_est).
- `src/components/MissionStage.vue`, `src/views/LocationView.vue` (heading,
  viewBox, footprint/cells/grid/dwell layers, est. text, honest copy).
- `css/style.scss` (metric clamp/overflow; new `.nc-roomba-map__cell/__footprint/
  __grid/__dwell`; dashboard wide-screen grid + breakpoint).
- `src/views/DashboardView.vue` (zone reflow into the denser grid).
- No PHP change (DTO passes through). Version bump 0.9.0.

## Verification (robot is cleaning now — use it)

1. `cd bridge && npm test` green (new trail/coverage cases + existing pass).
2. `make bridge-up` (rebuild bridge container; `.env` ROOMBA_MOCK=0). Then watch
   the live DTO: `docker exec cloud_app curl -s http://nc_roomba_bridge:8080/state`
   over several samples → `pose_trail` grows, `covered_cells` populates,
   `mission.mission_m_est` climbs with wall-clock, `sqft_est` climbs, raw
   sqft/mssn_m still 0.
3. `make build` + `make deploy RESTART=1`; app reports 0.9.0; both containers
   healthy; 42 vitest + phpunit/bridge/wifi tests green.
4. Browser (hard refresh) on Location + Dashboard while cleaning: trail + swept
   footprint accumulate; viewBox auto-fits; **heading cone points along travel**
   (tune only the −90 offset if constant-off); dwell heatmap brightens where it
   lingered; metric boxes show "MM:SS est." / "N sq ft est." with **no
   clipping** (resize narrow to exercise the clamp); wide-screen dashboard fills
   the width with the denser layout, no big empty column.
5. Mock mode still renders the phase stage with `has_pose:false` (no fake map).
6. Commit per CLAUDE.md (sanitized env, Claude trailer); report push status.

## Guardrails / non-goals

- Honest data only: coverage/duration labelled "est."; dwell heatmap ≠ a
  fabricated carpet map; state plainly what the 960 doesn't publish.
- Reuse existing `formatTrail`/`clamp`/`markerTransform`/`__split` structures —
  modify, don't rewrite.
- No new dependencies. Bridge change requires a container rebuild.
