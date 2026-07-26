<template>
	<div class="nc-roomba-view nc-roomba-dashboard">
		<!-- Zone A: at-a-glance -->
		<StatusHero :state="store.state" :next-scheduled="store.nextScheduled" />

		<!-- Zone B: controls + live theater (with any active alert folded in) -->
		<section class="nc-roomba-dashboard__zone">
			<ErrorDecoderPanel
				:decoded="store.decodedError"
				:conflict="store.conflict"
				@open-drawer="$emit('open-drawer')" />

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
		</section>

		<!-- Zone C: activity + health -->
		<div class="nc-roomba-dashboard__split nc-roomba-dashboard__review">
			<MissionTimeline :phases="store.livePhases" title="Current mission" />

			<section class="nc-roomba-panel" style="margin: 0">
				<div class="nc-roomba-view__header">
					<h3>Lifetime</h3>
					<span class="nc-roomba-muted">{{ achv.unlocked }} / {{ achv.total }} achievements</span>
				</div>
				<LifetimeStats
					:bbrun="store.bbrun"
					:bbmssn="store.bbmssn"
					:sku="store.sku"
					:software-version="store.softwareVersion"
					:robot-name="name" />
			</section>
		</div>

		<MaintenanceHints v-if="store.hints && store.hints.length" :hints="store.hints" />
	</div>
</template>

<script>
import ControlPad from '../components/ControlPad.vue'
import ErrorDecoderPanel from '../components/ErrorDecoderPanel.vue'
import LifetimeStats from '../components/LifetimeStats.vue'
import MaintenanceHints from '../components/MaintenanceHints.vue'
import MissionStage from '../components/MissionStage.vue'
import MissionTimeline from '../components/MissionTimeline.vue'
import StatusHero from '../components/StatusHero.vue'
import { useRobotStore } from '../store/robot.js'
import { achievementSummary, evaluateAchievements } from '../utils/achievements.js'

export default {
	name: 'DashboardView',

	components: {
		ControlPad,
		ErrorDecoderPanel,
		LifetimeStats,
		MaintenanceHints,
		MissionStage,
		MissionTimeline,
		StatusHero,
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
		achv() {
			return achievementSummary(evaluateAchievements({
				bbrun: this.store.bbrun,
				bbmssn: this.store.bbmssn,
				missions: this.store.missions,
			}))
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
