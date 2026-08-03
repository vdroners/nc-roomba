<template>
	<div class="nc-roomba-view">
		<header class="nc-roomba-view__header">
			<h2>History</h2>
			<p class="nc-roomba-muted">
				Missions recorded locally since install. Nothing is imported from the
				iRobot cloud.
			</p>
		</header>

		<!-- Lifetime rollup — informative even before the first NC-recorded mission -->
		<section class="nc-roomba-panel" data-testid="lifetime">
			<h3>Lifetime service</h3>
			<LifetimeStats
				:bbrun="store.bbrun"
				:bbmssn="store.bbmssn"
				:sku="store.sku"
				:software-version="store.softwareVersion"
				:robot-name="robotName" />
		</section>

		<Achievements
			:bbrun="store.bbrun"
			:bbmssn="store.bbmssn"
			:missions="missions"
			:baseline="store.missionBaseline"
			:local-offset-min="store.localOffsetMin" />

		<div class="nc-roomba-actions">
			<NcButton type="secondary" :href="exportUrl('csv')" download data-testid="export-csv">
				Export CSV
			</NcButton>
			<NcButton type="secondary" :href="exportUrl('json')" download data-testid="export-json">
				Export JSON
			</NcButton>
			<NcButton @click="reload">Refresh</NcButton>
		</div>

		<div class="nc-roomba-panel" data-testid="mission-list">
			<h3>Missions</h3>

			<div v-if="!missions.length" class="nc-roomba-empty">
				<span class="nc-roomba-empty__icon" aria-hidden="true">🧹</span>
				<p class="nc-roomba-empty__title">No cleaning missions recorded yet</p>
				<p class="nc-roomba-muted">
					When {{ robotName }} runs a clean it appears here with a coverage figure,
					duration and a phase timeline. Lifetime totals above come straight from
					the robot.
				</p>
				<div v-if="store.canOperate" class="nc-roomba-actions">
					<NcButton type="primary" :disabled="!!store.actionPending" @click="cleanNow">
						{{ store.actionPending === 'clean' ? 'Starting…' : 'Clean now' }}
					</NcButton>
				</div>
			</div>

			<ul v-else class="nc-roomba-history">
				<li v-for="mission in missions" :key="mission.id">
					<button
						:class="['nc-roomba-history__row', { active: selectedId === mission.id }]"
						:data-mission="mission.id"
						type="button"
						@click="select(mission.id)">
						<span class="nc-roomba-history__head">
							<span class="nc-roomba-badge" :class="`is-${outcomeTone(mission)}`">{{ outcomeLabel(mission) }}</span>
							<span class="nc-roomba-history__when">{{ whenLabel(mission) }}</span>
						</span>
						<span class="nc-roomba-history__facts">
							<span>{{ cycleLabel(mission) }}</span>
							<span v-if="durationOf(mission)">· {{ durationOf(mission) }}</span>
							<span v-if="mission.sqft">· {{ Number(mission.sqft).toLocaleString() }} sq ft</span>
							<span v-if="batteryUsed(mission)">· {{ batteryUsed(mission) }}</span>
							<span v-if="sourceNote(mission)" class="nc-roomba-history__source">· {{ sourceNote(mission) }}</span>
						</span>
					</button>
				</li>
			</ul>
		</div>

		<div v-if="selected" class="nc-roomba-panel" data-testid="mission-detail">
			<div class="nc-roomba-view__header">
				<h3>{{ missionTitle(selected) }}</h3>
				<NcButton type="tertiary" @click="clear">Close</NcButton>
			</div>
			<dl class="nc-roomba-stats">
				<div v-for="stat in detailStats" :key="stat.label" class="nc-roomba-stats__item">
					<dt>{{ stat.label }}</dt>
					<dd>{{ stat.value }}</dd>
				</div>
			</dl>
			<MissionTimeline
				:phases="selectedPhases"
				:end-ts="selected.ended_at || null"
				title="Phase bands" />
		</div>
	</div>
</template>

<script>
import { NcButton } from '@nextcloud/vue'

import Achievements from '../components/Achievements.vue'
import LifetimeStats from '../components/LifetimeStats.vue'
import MissionTimeline from '../components/MissionTimeline.vue'
import { exportMissionsUrl } from '../services/api.js'
import { useRobotStore } from '../store/robot.js'
import { durationLabel, timeLabel, timestampLabel } from '../utils/format.js'

export default {
	name: 'HistoryView',

	components: { Achievements, LifetimeStats, MissionTimeline, NcButton },

	data() {
		return { selectedId: null }
	},

	computed: {
		store() {
			return useRobotStore()
		},
		missions() {
			return this.store.missions
		},
		robotName() {
			return (this.store.state && this.store.state.name)
				|| (this.store.bootstrap.robot && this.store.bootstrap.robot.name)
				|| 'the robot'
		},
		selected() {
			return this.store.selectedMission
		},
		selectedPhases() {
			const mission = this.selected
			if (!mission) {
				return []
			}
			return mission.phases || mission.phase_events || []
		},
		/**
		 * Detail rows, keyed to the columns `nc_roomba_missions` actually has
		 * (see `Mission::jsonSerialize`): started_at, ended_at, cycle, sqft,
		 * mssn_m, result, error_code, battery_start/end, source.
		 *
		 * @returns {Array<{label: string, value: string}>}
		 */
		detailStats() {
			const mission = this.selected || {}
			const rows = [
				{ label: 'Started', value: timestampLabel(mission.started_at) || '—' },
				{ label: 'Ended', value: timestampLabel(mission.ended_at) || 'in progress' },
			]
			const duration = this.durationOf(mission)
			if (duration) {
				rows.push({ label: 'Duration', value: duration })
			}
			// The robot reports 0 sq ft on this generation; the bridge substitutes
			// an estimate, and 0 here means "never reported", not "cleaned nothing".
			if (Number(mission.sqft) > 0) {
				rows.push({ label: 'Area', value: `${Number(mission.sqft).toLocaleString()} sq ft` })
			}
			if (Number.isFinite(Number(mission.battery_start)) && mission.battery_start !== null) {
				const end = mission.battery_end
				rows.push({
					label: 'Battery',
					value: end === null || end === undefined
						? `${mission.battery_start}%`
						: `${mission.battery_start}% → ${end}%`,
				})
			}
			// The column is `error_code`; `mission.error` never existed on a row,
			// so this panel could not show a fault even on a failed mission.
			const code = Number(mission.error_code || 0)
			if (code !== 0) {
				const decoded = mission.decoded_error || {}
				rows.push({ label: 'Error', value: decoded.title ? `${code} — ${decoded.title}` : String(code) })
			}
			rows.push({ label: 'Outcome', value: mission.result || mission.outcome || 'unknown' })
			const source = this.sourceNote(mission)
			if (source) {
				rows.push({ label: 'Recorded', value: source })
			}
			return rows
		},
	},

	async mounted() {
		await this.store.loadMissions()
	},

	methods: {
		/**
		 * @param {'csv'|'json'} format
		 * @returns {string} download URL
		 */
		exportUrl(format) {
			return exportMissionsUrl(format, this.store.robotId)
		},

		async reload() {
			await this.store.loadMissions()
		},

		async cleanNow() {
			await this.store.doAction('clean')
		},

		/**
		 * @param {number} id mission id
		 */
		async select(id) {
			this.selectedId = id
			await this.store.loadMission(id)
		},

		clear() {
			this.selectedId = null
			this.store.clearMission()
		},

		/**
		 * @param {object} mission history row
		 * @returns {'complete'|'error'|'open'} outcome bucket
		 */
		outcome(mission) {
			if (Number(mission.error_code || mission.error || 0) !== 0) {
				return 'error'
			}
			if (!mission.ended_at) {
				return 'open'
			}
			// MissionService writes exactly 'open' | 'complete' | 'error'.
			const result = String(mission.result || mission.outcome || '')
			return result === 'error' ? 'error' : 'complete'
		},

		/** @param {object} mission */
		outcomeTone(mission) {
			const o = this.outcome(mission)
			return o === 'complete' ? 'ok' : (o === 'error' ? 'danger' : 'run')
		},

		/** @param {object} mission */
		outcomeLabel(mission) {
			const o = this.outcome(mission)
			return o === 'complete' ? 'Complete' : (o === 'error' ? 'Error' : 'In progress')
		},

		/** @param {object} mission */
		cycleLabel(mission) {
			return mission.cycle && mission.cycle !== 'none' ? mission.cycle : 'mission'
		},

		/**
		 * Prefer the robot's own mission-minutes counter over the wall clock
		 * between our first and last sample: a telemetry-reconstructed row can
		 * be minutes out at either edge, and `mssn_m` is what the robot measured.
		 *
		 * @param {object} mission
		 * @returns {string}
		 */
		durationOf(mission) {
			const minutes = Number(mission.mssn_m)
			if (Number.isFinite(minutes) && minutes > 0) {
				return durationLabel(minutes * 60)
			}
			if (mission.started_at && mission.ended_at) {
				return durationLabel(Number(mission.ended_at) - Number(mission.started_at))
			}
			return ''
		},

		/**
		 * @param {object} mission
		 * @returns {string} e.g. "18% battery", or '' when either edge is missing
		 */
		batteryUsed(mission) {
			const start = Number(mission.battery_start)
			const end = Number(mission.battery_end)
			if (!Number.isFinite(start) || !Number.isFinite(end)) {
				return ''
			}
			const used = start - end
			return used > 0 ? `${used}% battery` : ''
		},

		/**
		 * How the row was obtained. `bridge` rows saw both edges over MQTT and
		 * need no caveat; the other two are reconstructions and should say so
		 * rather than presenting inferred times as measurements.
		 *
		 * @param {object} mission
		 * @returns {string}
		 */
		sourceNote(mission) {
			return {
				telemetry: 'times sampled',
				odometer: 'times inferred',
			}[String(mission.source || '')] || ''
		},

		/**
		 * Relative-ish date: "Today 14:20" / "Yesterday 09:00" / full timestamp.
		 *
		 * @param {object} mission
		 * @returns {string}
		 */
		whenLabel(mission) {
			const ts = Number(mission.started_at)
			if (!Number.isFinite(ts) || ts <= 0) {
				return '—'
			}
			const date = new Date(ts * 1000)
			const today = new Date()
			const sameDay = (a, b) => a.toDateString() === b.toDateString()
			const yesterday = new Date(today.getTime() - 86400000)
			if (sameDay(date, today)) {
				return `Today ${timeLabel(ts)}`
			}
			if (sameDay(date, yesterday)) {
				return `Yesterday ${timeLabel(ts)}`
			}
			return timestampLabel(ts)
		},

		/**
		 * @param {object} mission history row
		 * @returns {string} detail headline
		 */
		missionTitle(mission) {
			const cycle = mission.cycle && mission.cycle !== 'none' ? mission.cycle : 'mission'
			return `#${mission.id} · ${cycle}`
		},
	},
}
</script>
