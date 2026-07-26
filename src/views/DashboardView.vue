<template>
	<div class="nc-roomba-view nc-roomba-dashboard">
		<header class="nc-roomba-view__header">
			<div>
				<h2>{{ name }}</h2>
				<p class="nc-roomba-muted">{{ headline }}</p>
			</div>
		</header>

		<div class="nc-roomba-dashboard__split">
			<section class="nc-roomba-panel" style="margin: 0">
				<h3>Controls</h3>
				<ControlPad
					:disabled="!store.canOperate"
					:pending="store.actionPending"
					@action="onAction" />
			</section>

			<MissionStage
				:state="store.state"
				:has-pose="store.hasPose"
				:fallback-name="fallbackName" />
		</div>

		<ErrorDecoderPanel
			:decoded="store.decodedError"
			:conflict="store.conflict"
			@open-drawer="$emit('open-drawer')" />

		<MissionTimeline :phases="store.livePhases" title="Current mission" />

		<MaintenanceHints
			:hints="store.hints"
			:bbrun="store.bbrun"
			:bbmssn="store.bbmssn"
			:software-version="store.softwareVersion"
			:sku="store.sku" />
	</div>
</template>

<script>
import ControlPad from '../components/ControlPad.vue'
import ErrorDecoderPanel from '../components/ErrorDecoderPanel.vue'
import MaintenanceHints from '../components/MaintenanceHints.vue'
import MissionStage from '../components/MissionStage.vue'
import MissionTimeline from '../components/MissionTimeline.vue'
import { useRobotStore } from '../store/robot.js'
import { durationLabel, phaseLabel } from '../utils/format.js'

export default {
	name: 'DashboardView',

	components: {
		ControlPad,
		ErrorDecoderPanel,
		MaintenanceHints,
		MissionStage,
		MissionTimeline,
	},

	computed: {
		store() {
			return useRobotStore()
		},
		fallbackName() {
			const boot = this.store.bootstrap || {}
			return (boot.robot && boot.robot.name) || 'Roomba'
		},
		name() {
			return (this.store.state && this.store.state.name) || this.fallbackName
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
