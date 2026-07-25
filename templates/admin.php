<?php
/** @var array $_ */
$robot = $_['robot'] ?? null;
?>
<div id="nc-roomba-admin" class="section" data-save-url="<?php p($_['save_url']); ?>" data-onboard-url="<?php p($_['onboard_url']); ?>">
	<h2>NC Roomba</h2>
	<p>Configure the private bridge URL, operator group, retention, and onboard Alfred (Roomba 960).</p>

	<form id="nc-roomba-admin-form">
		<p>
			<label for="nc-roomba-bridge-url">Bridge URL (Docker DNS)</label><br>
			<input type="text" id="nc-roomba-bridge-url" name="bridge_url" style="width:100%;max-width:36em"
				value="<?php p($_['bridge_url'] ?? 'http://nc-roomba-bridge:8080'); ?>">
		</p>
		<p>
			<label for="nc-roomba-operator-group">Operator group</label><br>
			<input type="text" id="nc-roomba-operator-group" name="operator_group" style="width:100%;max-width:36em"
				value="<?php p($_['operator_group'] ?? 'roomba-operators'); ?>">
		</p>
		<p>
			<label for="nc-roomba-retention">Retention days</label><br>
			<input type="number" id="nc-roomba-retention" name="retention_days" min="0"
				value="<?php p((string)($_['retention_days'] ?? 365)); ?>">
		</p>
		<?php if (is_array($robot)): ?>
			<p><strong>Configured robot:</strong> <?php p($robot['name'] ?? 'Alfred'); ?>
				(<?php p($robot['host'] ?? ''); ?>)</p>
		<?php else: ?>
			<p><em>No robot onboarded yet. Use hold-HOME onboarding below.</em></p>
		<?php endif; ?>
		<p>
			<label for="nc-roomba-onboard-ip">Alfred IP (DHCP reservation)</label><br>
			<input type="text" id="nc-roomba-onboard-ip" name="ip" placeholder="192.168.x.x" style="width:100%;max-width:20em">
		</p>
		<p>
			<button type="submit" class="button primary">Save settings</button>
			<button type="button" class="button" id="nc-roomba-onboard-btn">Onboard (hold HOME)</button>
		</p>
	</form>
	<p>See <code>docs/OPERATOR.md</code> for DHCP reservation and hold-HOME steps.</p>
	<script>
	(function () {
		const root = document.getElementById('nc-roomba-admin');
		const form = document.getElementById('nc-roomba-admin-form');
		if (!root || !form) return;
		const token = document.querySelector('head > meta[name="requesttoken"]')?.content || '';
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const body = {
				bridge_url: document.getElementById('nc-roomba-bridge-url').value,
				operator_group: document.getElementById('nc-roomba-operator-group').value,
				retention_days: Number(document.getElementById('nc-roomba-retention').value || 365),
			};
			const res = await fetch(root.dataset.saveUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'requesttoken': token },
				body: JSON.stringify(body),
			});
			alert(res.ok ? 'Saved' : 'Save failed');
		});
		document.getElementById('nc-roomba-onboard-btn')?.addEventListener('click', async () => {
			const ip = document.getElementById('nc-roomba-onboard-ip').value.trim();
			if (!ip) { alert('Enter Alfred IP'); return; }
			alert('Press and hold HOME on Alfred until it beeps, then wait…');
			const res = await fetch(root.dataset.onboardUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'requesttoken': token },
				body: JSON.stringify({ ip, name: 'Alfred' }),
			});
			const data = await res.json().catch(() => ({}));
			alert(res.ok ? 'Onboarded' : ('Onboard failed: ' + (data.error || res.status)));
			if (res.ok) location.reload();
		});
	})();
	</script>
</div>
