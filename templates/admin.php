<?php
/** @var array $_ */
$robot = is_array($_['robot'] ?? null) ? $_['robot'] : null;
$homeWifi = is_array($_['home_wifi'] ?? null) ? $_['home_wifi'] : null;

// Everything the admin panel needs on first paint, so it renders before the
// GET /api/admin/settings round-trip finishes.
$config = [
	'bridge_url' => (string)($_['bridge_url'] ?? ''),
	'operator_group' => (string)($_['operator_group'] ?? 'roomba-operators'),
	'retention_days' => (int)($_['retention_days'] ?? 365),
	'robot' => $robot,
	'home_wifi' => $homeWifi,
];
?>
<div id="nc-roomba-admin" class="section">
	<h2>NC Roomba</h2>
	<p>
		Factory Soft-AP setup joins a Roomba (960/980 Soft-AP class) to your home Wi‑Fi
		from this host without the iRobot app, then opens local MQTT. Give the robot a
		DHCP reservation — the local API is reached by IP, so a moving lease breaks the bridge.
	</p>

	<!-- Mounted by src/admin-settings.js (js/nc_roomba-admin.js). -->
	<div
		id="nc-roomba-admin-root"
		data-config="<?php p(json_encode($config, JSON_UNESCAPED_SLASHES)); ?>"></div>

	<noscript>
		<p>
			JavaScript is required to configure NC Roomba. The same settings can be set with
			<code>occ config:app:set nc_roomba bridge_url --value=…</code>.
		</p>
	</noscript>

	<p>See <code>docs/OPERATOR.md</code> for Soft-AP factory setup and hold-HOME fallback.</p>
</div>
