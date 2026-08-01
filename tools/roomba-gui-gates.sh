#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

check_file_contains() {
  local g="$1" file="$2" needle="$3"
  if [[ -f "$ROOT/$file" ]] && grep -Fq -- "$needle" "$ROOT/$file"; then
    echo "PASS $g $file"
  else
    echo "FAIL $g missing $needle in $file"
    fail=1
  fi
}

check_file_contains G31 src/components/StatusStrip.vue 'data-field="battery"'
check_file_contains G32 src/components/ControlPad.vue 'stop-confirm'
check_file_contains G33 src/components/ErrorDecoderPanel.vue 'error-decoder'
check_file_contains G34 src/components/MissionTimeline.vue 'mission-timeline'
check_file_contains G35 src/components/ScheduleWeekGrid.vue 'schedule-week'
# G35b: "Auto discover" lives in the ADMIN panel, not operator Settings. It was
# moved there by b73bbb5 ("declutter operator Settings") — discovery, onboarding
# and retention are admin-only. The gate kept asserting the pre-move location and
# had been failing ever since. Assert the real one, plus the signpost that
# replaced it in operator Settings so the split stays deliberate.
check_file_contains G35b src/views/AdminSettingsView.vue 'Auto discover'
check_file_contains G35b2 src/views/SettingsView.vue 'Administration → NC Roomba'
check_file_contains G35c src/components/MissionStage.vue 'data-testid="mission-stage"'
check_file_contains G35d src/views/DashboardView.vue 'MissionStage'
check_file_contains G35e css/style.scss 'nc-roomba-stage'
check_file_contains G35f img/app.svg 'NC Roomba'
check_file_contains G36 src/components/MaintenanceHints.vue 'maintenance-hints'
check_file_contains G37 src/components/ConnectionHealthDrawer.vue 'Recovery checklist'
check_file_contains G38 css/style.scss 'color-main-background'
check_file_contains G39 css/style.scss '--nc-app-accent: #c4a574'

# G40: Nextcloud core styles a bare `dt` as a fixed 130px inline-block, which
# clips or overspills every tile narrower than that. One app-wide reset owns it.
check_file_contains G40 css/style.scss '#nc-roomba-root dt,'
# G41: brass fails WCAG on a light theme; text/graphics must go through the ink
# tokens, and the light override has to exist.
check_file_contains G41 css/style.scss '--nc-roomba-ink:'
check_file_contains G41b css/style.scss 'body[data-theme-light]'
# G42: a failed command survives the 3–6 s poll and needs an explicit dismiss.
check_file_contains G42 src/store/robot.js 'dismissActionError'
check_file_contains G42b src/components/AppShell.vue 'data-testid="action-error"'
# G43: reduced motion must silence transitions, not only animations.
check_file_contains G43 css/style.scss 'transition-duration: 0.01ms !important'

# G44: this app must not inject a stylesheet into every Nextcloud page.
if [[ -f "$ROOT/css/nc-roomba-theme.css" ]]; then
  echo "FAIL G44 css/nc-roomba-theme.css is back (global stylesheet leak)"; fail=1
elif grep -Eq '^[[:space:]]*[^*/[:space:]].*addStyle' "$ROOT/lib/AppInfo/Application.php"; then
  echo "FAIL G44 Application::boot() adds a style again"; fail=1
else
  echo "PASS G44 no global stylesheet injection"
fi

# Catalog + thresholds for decoder/maintenance
if jq -e '[.errors // {} | to_entries[] | select(.value.title|tostring|test("bin full";"i"))] | length > 0' "$ROOT/knowledge/error_codes.json" >/dev/null \
  && jq -e '.errors["18"]' "$ROOT/knowledge/error_codes.json" >/dev/null; then
  echo "PASS G33 catalog bin full (code 18)"
else
  echo "FAIL G33 catalog"; fail=1
fi
if jq -e '.thresholds[0].id // .stuck_per_100h.warn' "$ROOT/knowledge/maintenance_thresholds.json" >/dev/null; then
  echo "PASS G36 thresholds"
else
  echo "FAIL G36 thresholds"; fail=1
fi

exit $fail
