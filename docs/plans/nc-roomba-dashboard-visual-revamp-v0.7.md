# NC Roomba: Dashboard visual "next level" revamp (v0.7.0)

## Context

The app works and is well-organized (0.6.0 three-zone dashboard), but the
styling has hit its ceiling: it reads *flat and utilitarian* rather than
polished. A designer's audit of `css/style.scss` + `css/nc-roomba-theme.css`
found the concrete reasons, and the goal here is to elevate the visual quality
of the Dashboard (and the shared surfaces it uses) without changing behavior.

Established facts that shape the plan:
- **Brass IS the live accent.** Load order is `nc-roomba-theme` (teal
  `#2bbbad`) then `style` (brass `#c4a574`) on both PageController and
  AdminSettings, so `style.css`'s `:root` wins. The teal `:root` at the end of
  `nc-roomba-theme.css` is dead weight to remove.
- **All styling is centralized** in `css/style.scss` (no component `<style>`
  blocks) — so a token-driven revamp is low-risk and lands in one place.
- **Rich data is shown as plain text.** battery_pct, mission.sqft, bbmssn
  success rate, rssi — all begging for rings/gauges. Data already flows; no
  bridge/PHP change needed.
- **Controls are text-only** NcButtons (no icons); the only icon vocabulary in
  the app is emoji (achievements). Nextcloud Vue ships `NcProgressBar`,
  `NcIconSvgWrapper`, etc.

### The ceiling (what a designer flags)
1. **No elevation system** — only 3 shadows total, 2 near-invisible; cards are
   flat color-mix tints.
2. **Ad-hoc scales** — 15 distinct font-sizes, ~17 spacing values, 4 radii
   (8/10/12/14px) used as magic numbers.
3. **Hardcoded state colors** — pause/dock/fault live as literal hex/rgba in
   several places instead of tokens; the dark stage's `rgba(0,0,0,0.28)` breaks
   in light theme.
4. **Flat data** — key numbers are text in boxes; no gauges/rings/progress.
5. **No focus-ring/skeleton/entrance polish.**

## Confirmed direction (from review)

- **Elevate the butler theme** — keep brass/charcoal/cream, add depth (not a
  glass or minimal redesign).
- **Data-viz scope = gauges + icons**: hero battery ring + Wi-Fi bars + bin
  glyph, success-rate donut, and control-button icons. (Not the full
  instrument panel — reliability/run-hour meters are a possible later pass.)
- **Control icons = inline SVG paths** via `NcIconSvgWrapper`, no new npm
  dependency (matches the app's no-@mdi, emoji-first reality).

## Approach — token-first, then targeted hero visuals

### 1. Establish a real design-token layer (top of `css/style.scss`)
Add to `:root` (reusing NC vars where sensible), then refactor the file to use
them — this alone lifts consistency dramatically:
- **Elevation scale**: `--nc-roomba-shadow-sm/md/lg` (soft, layered, brass-free
  neutral shadows) + a `--nc-roomba-shadow-glow` for the brass accent glow.
- **Radius scale**: `--r-sm: 8px; --r-md: 10px; --r-lg: 12px; --r-pill: 999px`
  and replace the magic 8/10/12/14 usages.
- **Spacing scale**: `--sp-1…--sp-6` on a 4px base (4/8/12/16/24/32) and migrate
  the worst ad-hoc gaps in dashboard surfaces (not a full-app sweep — focus on
  Dashboard components to keep the diff reviewable).
- **State-color tokens**: promote pause/dock/fault (and their text colors) to
  `--nc-roomba-state-*` vars; replace the hardcoded `#ffb74d/#90caf9/#ef9a9a`
  and `rgba(0,0,0,0.28)` so light theme works.
- Remove the dead teal `:root` from `nc-roomba-theme.css` (or make it a proper
  fallback that brass overrides intentionally, documented).

### 2. Lift the surfaces (panels, hero, cards)
- Give `.nc-roomba-panel` a subtle **elevation** (`--shadow-sm`) + a hairline
  top highlight so cards feel layered, not painted-on.
- **Hover/active elevation** on interactive surfaces (history rows, achievement
  tiles, control buttons): lift + border-brass on hover using the shadow scale
  and a 150ms transition (respecting `prefers-reduced-motion`).
- Consistent radii + spacing via the new tokens; tighten the hero into a more
  balanced card.

### 3. Hero data-visualization (the "next level" centerpiece)
Turn the StatusHero facts from flat text into compact **visual gauges**, all
driven by existing data — no fake charts:
- **Battery ring** — an SVG donut around the battery %, colored by level
  (brass/charge-aware, reuses the phase-aware logic from `format.js`).
- **Wi-Fi signal bars** — 4-bar strength from `rssi` dBm buckets (reuse
  `rssiClass` thresholds).
- **Bin indicator** — a small fill glyph (ok/full/missing).
- Keep the status pill but restyle with the new tokens + a soft glow in the
  active (cleaning) tone.
Implement as tiny presentational sub-pieces (inline SVG in StatusHero, or a
`Gauge.vue`/`SignalBars.vue` if cleaner). Pure, testable helpers for
bucket→level go in `format.js` (reuse existing `rssiClass`/`batteryClass`).

### 4. Iconify the controls
Give `ControlPad` buttons **leading icons** so the pad reads at a glance. Use
`NcIconSvgWrapper` with inline MDI-style path strings kept in a small local map
(no new npm dep — matches the "no @mdi import" reality and the emoji-first
precedent). Clean/Spot/Pause/Resume/Dock/Find/Stop each get a glyph; text stays
for clarity.

### 5. Lifetime + achievements polish
- Success-rate as a small **donut** in LifetimeStats (reuse the battery-ring SVG
  primitive) alongside the numeric stats.
- Achievement tiles: elevation + a subtle unlocked "shine", tier-colored ring
  on the icon; locked tiles keep the greyed treatment. Emoji stays.

### 6. Motion & finish
- A gentle **entrance fade/slide** for dashboard panels on first mount (CSS,
  reduced-motion aware).
- Standardize easing into 2–3 tokens and apply to the new hover/lift
  transitions.
- Keep the existing mission-stage pulse/sweep (already good) but wire its glow
  to the new `--shadow-glow` token for cohesion.

## Files to modify

- `css/style.scss` — the bulk: token layer, elevation, radii/spacing migration
  on dashboard surfaces, hero gauge styles, control-icon styles, achievement
  polish, entrance motion.
- `css/nc-roomba-theme.css` — remove/neutralize the dead teal `:root` override.
- `src/components/StatusHero.vue` — battery ring + signal bars + bin glyph
  (inline SVG or small sub-components).
- `src/components/ControlPad.vue` — add icon glyphs to the command map + render
  via `NcIconSvgWrapper`.
- `src/components/LifetimeStats.vue` — success-rate donut.
- `src/components/Achievements.vue` — tile polish (mostly class/markup tweaks).
- Possibly new `src/components/Gauge.vue` + `src/components/SignalBars.vue`
  (small, reusable, presentational) and icon path constants in a util.
- `src/utils/format.js` — pure `signalBars(rssi)` / `batteryRing(pct,phase)`
  level helpers + unit tests in `src/__tests__/`.
- Version bump 0.7.0 (feature/visual), CHANGELOG, README badge; `make build` +
  `make deploy RESTART=1`. No bridge/PHP change.

## Verification

1. `make build` exits 0; `npx vitest run` green (new gauge/signal helper tests +
   existing 40 still pass).
2. Deploy; app reports 0.7.0; both containers healthy; Alfred still connected.
3. Visual pass in the browser (hard refresh): hero shows a battery ring at ~real
   %, Wi-Fi bars from real rssi, bin glyph; panels have gentle elevation + hover
   lift; control buttons show icons; success-rate donut renders; achievements
   look richer; nothing clips (0.5.x fixes intact) and it still scrolls.
4. Light-theme sanity: toggle NC to light and confirm the stage/metrics/gauges
   don't wash out (the point of tokenizing the hardcoded colors).
5. Reduced-motion: entrance/hover animations disabled under
   `prefers-reduced-motion`.
6. Commit per CLAUDE.md (sanitized env, Claude trailer); report push status.

## Non-goals / guardrails

- No behavior/logic changes to controls, onboarding, history recording, or the
  live-refresh pipeline — visual only.
- No new heavy dependencies (no @mdi package, no charting lib, no Lottie); SVG +
  inline paths + existing NC Vue components only.
- Not a full-app spacing sweep — migrate Dashboard surfaces + shared tokens;
  leave Settings/Location/History-internals visually consistent but don't
  rewrite them.
- Keep the butler brass/charcoal/cream identity — elevate it, don't replace it.
