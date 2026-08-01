#!/usr/bin/env bash
#
# Live bridge gates for nc-roomba.
#
#   tools/roomba-live-gates.sh                 # safe: refuses a real robot
#   ROOMBA_ALLOW_LIVE_ROBOT=1 tools/…          # opt in to the destructive gates
#
# SAFETY
# ------
# This script commands the robot. Earlier revisions read `ROOMBA_MOCK`, echoed
# it, and then *never used it in a conditional* -- while `BASE` defaulted to the
# live bridge. Running `make gate-live` against the real 960 would therefore
# POST /action/clean (starting an actual cleaning mission) and overwrite the
# robot's real weekly schedule with a test week. `make gate-live` even sets
# ROOMBA_MOCK=1, which the script ignored.
#
# Now the mocked-ness is read from the bridge itself (`/health .mock`) rather
# than trusted from the environment, and every mutating gate is skipped unless
# the bridge really is a mock -- or the operator explicitly opts in.
set -uo pipefail

BASE="${BRIDGE_URL:-http://127.0.0.1:18791}"
ALLOW_LIVE="${ROOMBA_ALLOW_LIVE_ROBOT:-0}"
fail=0

pass() { printf 'PASS %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; fail=1; }
skip() { printf 'SKIP %s\n' "$*"; }

echo "Using bridge $BASE"

# ---------------------------------------------------------------------------
# G06 health -- and establish, from the bridge itself, whether this is a mock.
# ---------------------------------------------------------------------------
health=$(curl -sS -m 5 "$BASE/health" || true)
if echo "$health" | grep -q '"ok":true'; then
	pass "G06 bridge health"
else
	bad "G06 bridge health: ${health:-<no response>}"
fi

is_mock=$(printf '%s' "$health" | python3 -c '
import json, sys
try:
    print("yes" if json.load(sys.stdin).get("mock") is True else "no")
except Exception:
    print("unknown")
' 2>/dev/null || echo unknown)

case "$is_mock" in
	yes) mutating_ok=1; echo "     bridge reports mock=true -- destructive gates enabled" ;;
	no)
		if [[ "$ALLOW_LIVE" == "1" ]]; then
			mutating_ok=1
			echo "     bridge is a REAL ROBOT and ROOMBA_ALLOW_LIVE_ROBOT=1 -- destructive gates enabled ON PURPOSE"
		else
			mutating_ok=0
			echo "     bridge reports mock=false (REAL ROBOT) -- destructive gates will be skipped"
			echo "     set ROOMBA_ALLOW_LIVE_ROBOT=1 to run them anyway (starts a real mission, rewrites the schedule)"
		fi
		;;
	*)
		mutating_ok=0
		echo "     could not determine mock state -- treating as a real robot and skipping destructive gates"
		;;
esac

# ---------------------------------------------------------------------------
# G07 the bridge must not be published on a public interface.
#     The wifi-helper is checked too: it is a root service and the one thing in
#     this stack that actually does bind 0.0.0.0.
# ---------------------------------------------------------------------------
if docker port nc_roomba_bridge 2>/dev/null | grep -q '0\.0\.0\.0'; then
	bad "G07 bridge published on 0.0.0.0"
else
	pass "G07 bridge bind is loopback/docker-network only"
fi

if ss -ltn 2>/dev/null | grep -qE '0\.0\.0\.0:8091'; then
	helper_health=$(curl -sS -m 4 http://127.0.0.1:8091/health 2>/dev/null || true)
	if printf '%s' "$helper_health" | grep -q '"token_required":true'; then
		echo "WARN G07b wifi-helper is bound to 0.0.0.0 (token IS enforced, but it is a root service)"
	else
		bad "G07b wifi-helper is bound to 0.0.0.0 AND its token is not enforced"
	fi
else
	pass "G07b wifi-helper is not publicly bound"
fi

# ---------------------------------------------------------------------------
# G17 state payload
# ---------------------------------------------------------------------------
state=$(curl -sS -m 5 "$BASE/state" || true)
if printf '%s' "$state" | grep -q 'battery_pct\|phase'; then
	pass "G17 state payload"
else
	bad "G17 state: ${state:0:200}"
fi

# The DTO nests under `state`. This is the shape the PHP ingest job got wrong
# for the entire life of the project, writing 516 all-null telemetry rows and
# never recording a single mission -- so the contract is gated explicitly.
if printf '%s' "$state" | python3 -c '
import json, sys
d = json.load(sys.stdin)
s = d.get("state")
sys.exit(0 if isinstance(s, dict) and "phase" in s and "battery_pct" in s else 1)
' 2>/dev/null; then
	pass "G17b /state nests the DTO under .state with phase + battery_pct"
else
	bad "G17b /state envelope shape changed -- the PHP ingest unwrap must be updated in step"
fi

# ---------------------------------------------------------------------------
# G16 actions round-trip -- DESTRUCTIVE, mock only
# ---------------------------------------------------------------------------
if [[ "$mutating_ok" == "1" ]]; then
	act_fail=0
	for action in clean pause resume dock; do
		code=$(curl -sS -m 5 -o /tmp/rr.json -w '%{http_code}' -X POST "$BASE/action/$action" || echo 000)
		if [[ "$code" != "200" ]]; then
			bad "G16 action $action http $code $(cat /tmp/rr.json 2>/dev/null || true)"
			act_fail=1
		fi
	done
	[[ $act_fail -eq 0 ]] && pass "G16 actions round-trip"
	rm -f /tmp/rr.json
else
	skip "G16 actions round-trip (would start a real cleaning mission)"
fi

# ---------------------------------------------------------------------------
# G20 schedule -- read is safe, write is DESTRUCTIVE
# ---------------------------------------------------------------------------
sched=$(curl -sS -m 5 "$BASE/schedule" || true)
if printf '%s' "$sched" | grep -q 'cycle'; then
	pass "G20 schedule get"
else
	bad "G20 schedule get"
fi

if [[ "$mutating_ok" == "1" ]]; then
	week='{"cycle":["none","start","none","none","none","none","none"],"h":[9,15,9,9,9,9,9],"m":[0,0,0,0,0,0,0]}'
	curl -sS -m 5 -X POST -H 'Content-Type: application/json' -d "$week" "$BASE/schedule" >/tmp/ws.json 2>/dev/null || true
	if grep -q 'start' /tmp/ws.json 2>/dev/null; then
		pass "G20b schedule set"
	else
		bad "G20b schedule set"
	fi
	rm -f /tmp/ws.json
else
	skip "G20b schedule set (would overwrite the robot's real weekly schedule)"
fi

# ---------------------------------------------------------------------------
# G18 / G28
# ---------------------------------------------------------------------------
if printf '%s' "$state" | grep -q '"has_pose"'; then
	pass "G18 pose capability field present"
else
	bad "G18 has_pose missing"
fi

if docker ps --format '{{.Names}}' | grep -qx 'nc_roomba_bridge'; then
	pass "G28 bridge container running"
else
	bad "G28 bridge container missing"
fi

if systemctl --user is-active openclaw-gateway >/dev/null 2>&1 || pgrep -af openclaw-gateway >/dev/null 2>&1; then
	pass "G28b openclaw-gateway untouched/active-or-present"
fi

echo
if [[ $fail -eq 0 ]]; then
	echo "LIVE GATES PASS"
else
	echo "LIVE GATES FAILED"
fi
exit $fail
