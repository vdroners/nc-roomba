<template>
	<div class="nc-roomba-view">
		<header class="nc-roomba-view__header">
			<h2>History</h2>
			<p class="nc-roomba-muted">
				Missions recorded locally since install. Nothing is imported from the
				iRobot cloud.
			</p>
		</header>

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
			<p v-if="!missions.length" class="nc-roomba-muted">
				No missions yet. Start a clean from the Dashboard and it will appear here.
			</p>
			<ul v-else class="nc-roomba-list">
				<li v-for="mission in missions" :key="mission.id">
					<button
						:class="{ active: selectedId === mission.id }"
						:data-mission="mission.id"
						type="button"
						@click="select(mission.id)">
						<span class="nc-roomba-list__title">{{ missionTitle(mission) }}</span>
						<span class="nc-roomba-list__meta">{{ missionMeta(mission) }}</span>
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

import MissionTimeline from '../components/MissionTimeline.vue'
import { exportMissionsUrl } from '../services/api.js'
import { useRobotStore } from '../store/robot.js'
import { durationLabel, timestampLabel } from '../utils/format.js'

export default {
	name: 'HistoryView',

	components: { MissionTimeline, NcButton },

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
		detailStats() {
			const mission = this.selected || {}
			const rows = [
				{ label: 'Started', value: timestampLabel(mission.started_at) || '—' },
				{ label: 'Ended', value: timestampLabel(mission.ended_at) || 'in progress' },
			]
			if (mission.started_at && mission.ended_at) {
				rows.push({ label: 'Duration', value: durationLabel(Number(mission.ended_at) - Number(mission.started_at)) })
			}
			if (mission.sqft !== undefined && mission.sqft !== null) {
				rows.push({ label: 'Area', value: `${Number(mission.sqft).toLocaleString()} sq ft` })
			}
			if (mission.error) {
				rows.push({ label: 'Error', value: String(mission.error) })
			}
			rows.push({ label: 'Outcome', value: mission.result || mission.outcome || 'unknown' })
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
		 * @returns {string} headline
		 */
		missionTitle(mission) {
			const cycle = mission.cycle && mission.cycle !== 'none' ? mission.cycle : 'mission'
			return `#${mission.id} · ${cycle}`
		},

		/**
		 * @param {object} mission history row
		 * @returns {string} secondary line
		 */
		missionMeta(mission) {
			const parts = [timestampLabel(mission.started_at)]
			if (mission.started_at && mission.ended_at) {
				parts.push(durationLabel(Number(mission.ended_at) - Number(mission.started_at)))
			}
			const outcome = mission.result || mission.outcome
			if (outcome) {
				parts.push(outcome)
			}
			return parts.filter(Boolean).join(' · ')
		},
	},
}
</script>
