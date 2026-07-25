<template>
	<div class="nc-roomba-panel" data-testid="maintenance-hints">
		<h3>Maintenance</h3>

		<ul v-if="hintList.length" class="nc-roomba-hints">
			<li v-for="hint in hintList" :key="hint.key" :class="['nc-roomba-hints__chip', 'is-' + hint.level]">
				<strong v-if="hint.title">{{ hint.title }}</strong>
				<span>{{ hint.message }}</span>
			</li>
		</ul>
		<p v-else class="nc-roomba-muted">
			No advisories. Counters look normal for the hours logged.
		</p>

		<dl v-if="stats.length" class="nc-roomba-stats">
			<div v-for="stat in stats" :key="stat.label" class="nc-roomba-stats__item">
				<dt>{{ stat.label }}</dt>
				<dd>{{ stat.value }}</dd>
			</div>
		</dl>

		<p class="nc-roomba-muted">
			Advisory only — these are local `bbrun` counters, not iRobot's cloud
			brush-life estimates, and they never block a mission.
		</p>
	</div>
</template>

<script>
import { durationLabel } from '../utils/format.js'

/**
 * UI-6: soft wear advisories. Thresholds are applied server-side by
 * `MaintenanceHintService` from `knowledge/maintenance_thresholds.yaml`; this
 * component only renders the chips plus the lifetime counters they came from.
 */
export default {
	name: 'MaintenanceHints',

	props: {
		hints: {
			type: Array,
			default: () => [],
		},
		/** Raw lifetime run counters. */
		bbrun: {
			type: Object,
			default: () => ({}),
		},
		/** Raw lifetime mission counters. */
		bbmssn: {
			type: Object,
			default: () => ({}),
		},
	},

	computed: {
		hintList() {
			return (this.hints || [])
				.map((hint, index) => ({
					key: hint.id || `${hint.title || 'hint'}-${index}`,
					level: hint.level || hint.severity || 'info',
					title: hint.title || '',
					message: hint.message || hint.detail || hint.action || '',
				}))
				.filter((hint) => hint.title || hint.message)
		},

		stats() {
			const run = this.bbrun || {}
			const mssn = this.bbmssn || {}
			const rows = []
			if (Number.isFinite(Number(run.hr)) || Number.isFinite(Number(run.min))) {
				rows.push({ label: 'Run time', value: durationLabel((Number(run.hr) || 0) * 3600 + (Number(run.min) || 0) * 60) })
			}
			if (Number.isFinite(Number(run.sqft))) {
				rows.push({ label: 'Area cleaned', value: `${Number(run.sqft).toLocaleString()} sq ft` })
			}
			if (Number.isFinite(Number(run.nStuck))) {
				rows.push({ label: 'Times stuck', value: String(run.nStuck) })
			}
			if (Number.isFinite(Number(run.nScrubs))) {
				rows.push({ label: 'Scrubs', value: String(run.nScrubs) })
			}
			if (Number.isFinite(Number(mssn.nMssn))) {
				rows.push({ label: 'Missions', value: String(mssn.nMssn) })
			}
			if (Number.isFinite(Number(mssn.nMssnOk))) {
				rows.push({ label: 'Completed', value: String(mssn.nMssnOk) })
			}
			return rows
		},
	},
}
</script>
