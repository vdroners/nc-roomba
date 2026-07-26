# NC Roomba: reorganize Dashboard + make History useful (v0.6.0)

## Context

Using the app on Alfred (Roomba 960), the operator finds the Dashboard
disorganized/not integrated, and the History tab "shows nothing" and feels
boring. Investigation established:

- **History is NOT broken.** The `TelemetrySampleJob` runs every 30s (confirmed
  last-run today, cron mode active) and records a mission row the moment Alfred
  enters a cleaning cycle. `nc_roomba_missions` has 0 rows simply because Alfred
  hasn't run a clean since onboarding. The empty state is a bare one-liner, and
  there is nothing to look at pre-first-mission — even though the robot already
  reports rich lifetime data (`bbrun`: 922 run-hrs, 2816 sqft; `bbmssn`: 1792
  missions) that History ignores.
- **Dashboard** (`src/views/DashboardView.vue`) is a desktop two-column split
  (ControlPad | MissionStage) then three stacked panels (ErrorDecoder,
  MissionTimeline, MaintenanceHints). It scatters related info, has no
  at-a-glance "is Alfred OK / ready" summary, and buries the identity/stats.

Goal: a cleaner, integrated Dashboard with a clear hierarchy, and a History tab
that is informative and engaging even before/along with per-mission rows.

## Reuse (do not reinvent)

- Layout: `.nc-roomba-dashboard__split`, `.nc-roomba-panel`, `.nc-roomba-stats`
  / `--identity`, `.nc-roomba-hints__chip`, `.nc-roomba-actions`, the
  `.nc-roomba-stage` theater — all in `css/style.scss`.
- Data already in the store (`src/store/robot.js` getters): `bbrun`, `bbmssn`,
  `softwareVersion`, `sku`, `nextScheduled`, `hints`, `livePhases`,
  `connectionHealth`, plus phase-aware `batteryLabel`/dock chip from format.js.
- History plumbing exists end-to-end: `store.loadMissions/loadMission`,
  `MissionController` → `MissionService`, `MissionTimeline.vue`.

## 1. Dashboard reorganization (`src/views/DashboardView.vue` + SCSS)

Reorder into three clear zones, top → bottom, each a `.nc-roomba-panel`:

**Zone A — "At a glance" hero (new, compact).** A single integrated row/card:
robot name + a **Ready / Cleaning / Charging / Attention** status pill (derived
from phase + `not_ready` + error, reusing the dock-chip logic), battery, Wi-Fi,
bin, and "next scheduled clean" — the answers to "is Alfred fine and what's it
doing". Replaces info currently scattered across the header + stage + strip.

**Zone B — Controls + live theater split (keep the good part).** Retain the
`__split` (ControlPad left, MissionStage right) since it tests well. Fold the
**ErrorDecoderPanel** up to render *inside/above* this zone only when
`decoded.show` (so alerts sit with the controls, not floating mid-page).

**Zone C — Activity + health (integrated).** A two-column group: left =
**MissionTimeline** (current mission phases); right = a compact **lifetime
summary** (run time, missions, success rate) + the **identity** card (model /
firmware) — pulled out of the heavy MaintenanceHints block. MaintenanceHints
advisories (the wear chips) stay but demoted to the bottom, shown only when
there are hints.

Net effect: glance → act → review, one column of well-grouped panels; the split
stays for desktop but the page reads as three intentional sections instead of
five stacked widgets. All responsive via existing grid classes.

## 2. History: useful + engaging (`src/views/HistoryView.vue` + maybe store/API)

**2a. Lifetime summary header (new).** Above the mission list, a stats band from
`bbrun`/`bbmssn` the robot already reports — total missions, run time, area
cleaned lifetime, success rate, avg mission length. This makes History
informative on day one, before any NC-recorded mission. Reuses
`.nc-roomba-stats`.

**2b. Real empty state.** Replace the one-liner with an inviting card: an icon,
"No cleaning missions recorded yet — when Alfred runs a clean it'll appear here
with a timeline and coverage," and a **Clean now** button (dispatches the clean
action via the store) so the tab isn't a dead end. Show the lifetime band above
it regardless.

**2c. Engaging mission rows.** Upgrade each list row from `#id · cycle` to a
richer card: outcome badge (complete=green / error=red / in-progress), relative
date ("Today 14:20"), duration, coverage, and a **mini phase-bar** (reuse
`MissionTimeline` in a compact inline mode) so the list itself is scannable and
visual, not just text.

**2d. Keep** export + detail drawer; detail already shows stats + phase bands.

Optional stretch (flag in plan, only if cheap): a tiny 7-day activity sparkline
of missions/coverage from the mission list.

## 3. Achievements (new, fun) — `src/components/Achievements.vue` + util

A playful, purely-derived achievement system (no new DB — computed live from
data we already have: `bbrun`, `bbmssn`, recorded missions, streaks). Because
Alfred is a veteran (1793 missions, 922 run-hrs, 2816 sqft, 12,641 cliff-picks),
many unlock immediately, which makes the feature satisfying on first view.

- **A pure util** `src/utils/achievements.js`: takes `{ bbrun, bbmssn, missions }`
  and returns a list `{ id, title, blurb, icon, tier, unlocked, progress }`.
  Deterministic + unit-testable (mirrors the format.js/errorDecoder.js pattern).
- **Tiered, butler-themed catalogue** (~12–16), e.g.:
  - *First Sweep* (1 mission), *Century Club* (100), *Marathon Maid* (1000
    missions) — Alfred hits these.
  - *Ten Hours of Service* / *Day of Duty* (24h) / *Fortnight Footman* (run
    hours), *Acreage* tiers on lifetime sqft.
  - *Sure-Footed* (low stuck-rate), *Cliff Diver Averted* (cliff sensors fired
    N times), *Clean Sweep* (a mission completing with no error), *Comeback*
    (error mission followed by a clean one), *Streak* (N days with a clean —
    from mission timestamps).
  - Locked ones show a progress bar ("742 / 1000 missions") so there's a goal.
- **UI**: a compact "Achievements" card — earned badges brass/gold, locked ones
  greyed with progress. Lives on the **History** tab (fits the "review/stats"
  theme) with a small teaser count on the Dashboard lifetime area ("9/15
  unlocked"). Reuses `.nc-roomba-stats`/chip styling; no new color system.
- Newly-unlocked (vs last-seen set in `localStorage`) get a subtle "New!" tag —
  no server writes, no notifications spam.

Kept intentionally lightweight: derived-only, testable, no schema/migration.

## Files to modify

- `src/views/DashboardView.vue` — reorder into zones A/B/C; move ErrorDecoder
  into the controls zone; split MaintenanceHints into lifetime-summary + demoted
  advisories.
- `src/views/HistoryView.vue` — lifetime band, rich empty state + Clean-now,
  richer rows with inline phase bars.
- `src/components/` — small new `StatusHero.vue` (Zone A), `LifetimeStats.vue`
  extracted from MaintenanceHints (reused by Dashboard + History), and
  `Achievements.vue`. Reuse `MissionTimeline.vue` compact mode.
- `src/utils/achievements.js` (new, pure + unit-tested) — the achievement
  catalogue + evaluation from `bbrun`/`bbmssn`/`missions`.
- `css/style.scss` — new zone/hero/history-row/achievement classes built on
  existing tokens; no new color system.
- `src/store/robot.js` — only if History needs a `cleanNow` convenience or a
  lifetime getter alias (bbrun/bbmssn getters already exist).
- `src/__tests__/achievements.spec.js` (new) — assert Alfred's veteran counters
  unlock the expected tiers and that locked ones report correct progress.
- Version bump 0.6.0 (feature), CHANGELOG, README badge; `make build` +
  `make deploy RESTART=1`. No bridge/PHP change expected (data already flows).

## Verification

1. `make build` exits 0; `npx vitest run` green (add/adjust component tests for
   any extracted component + the status-pill logic).
2. Deploy; app reports 0.6.0; both containers healthy; Alfred still connected.
3. Dashboard: three clean zones; status pill reflects real phase (Charging now);
   alert only shows on error; nothing clips; scrolls fine (0.5.x fixes intact).
4. History: lifetime band shows Alfred's real totals (1793 missions, 922 hrs)
   even with 0 recorded missions; empty state is inviting. (No live clean this
   round — per decision; the first real mission will populate naturally.)
5. Achievements: with Alfred's counters, the veteran tiers (First Sweep, Century
   Club, Marathon Maid, run-hour + acreage tiers) show unlocked; locked ones
   show correct progress bars. Unit tests cover the evaluation.
6. Commit per CLAUDE.md (sanitized env, Claude trailer); report push status
   (this stacks on the 5 unpushed commits 0.3.2→0.5.2).

## Non-goals

- No iRobot cloud history import (local-only by design).
- No change to the recording pipeline (verified working).
- Location tab untouched.
