#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
need=(
  appinfo/info.xml
  appinfo/routes.php
  lib/AppInfo/Application.php
  src/main.js
  src/App.vue
  bridge/index.js
  docs/plans/nc-roomba-v0.1.0.md
  knowledge/error_codes.json
)
for f in "${need[@]}"; do
  if [[ ! -e "$ROOT/$f" ]]; then
    echo "FAIL G00 missing $f"
    fail=1
  fi
done

# ---------------------------------------------------------------------------
# G02 dependency caps must not be able to brick the instance.
#
# `occ upgrade` re-validates an app's declared dependencies on every version
# bump. When the Nextcloud image moved to PHP 8.5 while info.xml still said
# max-version="8.4", the next bump failed that check and left the WHOLE instance
# in maintenance mode -- every app, every user -- over a runtime we do not
# control. A PHP upper bound buys nothing here and costs an outage.
# ---------------------------------------------------------------------------
php_cap=$(grep -oE '<php[^/]*max-version[^/]*/>' "$ROOT/appinfo/info.xml" 2>/dev/null || true)
if [ -n "$php_cap" ]; then
	echo "FAIL G02 info.xml pins a PHP upper bound: $php_cap"
	echo "        occ upgrade re-checks this on every bump; a stale cap puts the"
	echo "        entire instance into maintenance mode. Drop max-version."
	fail=1
else
	echo "PASS G02 no PHP upper bound in info.xml"
fi

# The Nextcloud cap is legitimate (a major release can break APIs), but it must
# not be BELOW the version actually running, or the app silently disables.
if command -v docker >/dev/null 2>&1 && [ -n "$(docker ps -q -f name=cloud_app 2>/dev/null)" ]; then
	nc_running=$(docker exec cloud_app sh -c 'curl -s http://localhost/status.php' 2>/dev/null \
		| grep -oE '"versionstring":"[0-9]+' | grep -oE '[0-9]+$' || true)
	nc_cap=$(grep -oE '<nextcloud[^/]*max-version="[0-9]+"' "$ROOT/appinfo/info.xml" 2>/dev/null \
		| grep -oE '[0-9]+"$' | tr -d '"' || true)
	if [ -n "$nc_running" ] && [ -n "$nc_cap" ]; then
		if [ "$nc_cap" -lt "$nc_running" ]; then
			echo "FAIL G03 info.xml caps Nextcloud at $nc_cap but $nc_running is running (app will be disabled)"
			fail=1
		elif [ "$nc_cap" -eq "$nc_running" ]; then
			echo "WARN G03 Nextcloud cap ($nc_cap) equals the running major — the next NC upgrade will disable this app"
		else
			echo "PASS G03 Nextcloud cap $nc_cap >= running $nc_running"
		fi
	fi
fi

v_xml=$(grep -oE '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' "$ROOT/appinfo/info.xml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
v_pkg=$(node -p "require('$ROOT/package.json').version")
v_br=$(node -p "require('$ROOT/bridge/package.json').version")
if [[ "$v_xml" != "$v_pkg" || "$v_xml" != "$v_br" ]]; then
  echo "FAIL G01 version sync xml=$v_xml pkg=$v_pkg bridge=$v_br"
  fail=1
else
  echo "PASS G01 version $v_xml"
fi
[[ $fail -eq 0 ]] && echo "PASS G00 repo layout"
exit $fail
