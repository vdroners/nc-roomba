<template>
	<div class="nc-roomba-view nc-roomba-dashboard nc-roomba-dashboard--grid">
		<!-- Alert first (full width) when there's something to see -->
		<ErrorDecoderPanel
			class="nc-roomba-dashboard__alert"
			:decoded="store.decodedError"
			:conflict="store.conflict"
			@open-drawer="$emit('open-drawer')" />

		<!-- At-a-glance hero -->
		<StatusHero class="nc-roomba-dashboard__hero" :state="store.state" :next-scheduled="store.nextScheduled" />

		<!-- Controls -->
		<section class="nc-roomba-panel nc-roomba-dashboard__controls" style="margin: 0">
			<h3>Controls</h3>
			<ControlPad
				:disabled="!store.canOperate"
				:pending="store.actionPending"
				@action="onAction" />
		</section>

		<!-- Live theater + map (the visual centrepiece) -->
		<MissionStage
			class="nc-roomba-dashboard__stage"
			:state="store.state"
			:has-pose="store.hasPose"
			:fallback-name="fallbackName" />

		<!-- Current-mission timeline -->
		<MissionTimeline class="nc-roomba-dashboard__timeline" :phases="store.livePhases" title="Current mission" />

		<!-- Lifetime + achievements -->
		<section class="nc-roomba-panel nc-roomba-dashboard__lifetime" style="margin: 0">
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

		<MaintenanceHints v-if="store.hints && store.hints.length" class="nc-roomba-dashboard__wide" :hints="store.hints" />

		<AlfredPanel v-if="store.alfred && store.alfred.enabled" class="nc-roomba-dashboard__wide" :config="store.alfred" :robot-name="name" />
	</div>
</template>

<script>
import AlfredPanel from '../components/AlfredPanel.vue'
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
		AlfredPanel,
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
				baseline: this.store.missionBaseline,
				localOffsetMin: this.store.localOffsetMin,
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
