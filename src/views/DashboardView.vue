<template>
	<div class="nc-roomba-view">
		<header class="nc-roomba-view__header">
			<h2>{{ name }}</h2>
			<p class="nc-roomba-muted">{{ headline }}</p>
		</header>

		<ControlPad
			:disabled="!store.canOperate"
			:pending="store.actionPending"
			@action="onAction" />

		<ErrorDecoderPanel
			:decoded="store.decodedError"
			:conflict="store.conflict"
			@open-drawer="$emit('open-drawer')" />

		<MissionTimeline :phases="store.livePhases" title="Current mission" />

		<MaintenanceHints :hints="store.hints" :bbrun="store.bbrun" :bbmssn="store.bbmssn" />
	</div>
</template>

<script>
import ControlPad from '../components/ControlPad.vue'
import ErrorDecoderPanel from '../components/ErrorDecoderPanel.vue'
import MaintenanceHints from '../components/MaintenanceHints.vue'
import MissionTimeline from '../components/MissionTimeline.vue'
import { useRobotStore } from '../store/robot.js'
import { durationLabel, phaseLabel } from '../utils/format.js'

export default {
	name: 'DashboardView',

	components: { ControlPad, ErrorDecoderPanel, MaintenanceHints, MissionTimeline },

	computed: {
		store() {
			return useRobotStore()
		},
		name() {
			return (this.store.state && this.store.state.name) || 'Alfred'
		},
		headline() {
			const state = this.store.state
			if (!state) {
				return 'Waiting for the first state sample…'
			}
			const parts = [phaseLabel(state)]
			const mission = state.mission || {}
			if (Number(mission.mssn_m) > 0) {
				parts.push(`running ${durationLabel(Number(mission.mssn_m) * 60)}`)
			}
			if (Number(mission.sqft) > 0) {
				parts.push(`${Number(mission.sqft).toLocaleString()} sq ft`)
			}
			if (state.next_scheduled && state.next_scheduled.day) {
				parts.push(`next start ${state.next_scheduled.day} ${state.next_scheduled.local_time}`)
			}
			return parts.join(' · ')
		},
	},

	methods: {
		/**
		 * @param {string} action command name from the pad
		 */
		async onAction(action) {
			await this.store.doAction(action)
		},
	},
}
</script>
