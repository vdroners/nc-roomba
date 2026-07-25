<template>
	<div class="nc-roomba-view">
		<header class="nc-roomba-view__header">
			<div>
				<h2>Location</h2>
				<p class="nc-roomba-muted">
					{{ hasPose
						? `Live pose from ${robotName} (relative to the dock).`
						: `${robotName} does not publish pose over the local API — showing the live mission theater instead.` }}
				</p>
			</div>
		</header>

		<div v-if="hasPose" class="nc-roomba-panel" data-testid="location-map">
			<div class="nc-roomba-map" :style="floorplanStyle">
				<svg class="nc-roomba-map__svg" viewBox="-500 -500 1000 1000" role="img" aria-label="Robot position">
					<line x1="-500" y1="0" x2="500" y2="0" class="nc-roomba-map__axis" />
					<line x1="0" y1="-500" x2="0" y2="500" class="nc-roomba-map__axis" />
					<!-- Dock origin -->
					<circle class="nc-roomba-map__dock" cx="0" cy="0" r="34" />
					<text class="nc-roomba-map__dock-label" x="0" y="8" text-anchor="middle">dock</text>
					<polyline v-if="trailFade" :points="trailFade" class="nc-roomba-map__trail-fade" />
					<polyline v-if="trailPoints" :points="trailPoints" class="nc-roomba-map__trail" />
					<g class="nc-roomba-map__robot-g" :transform="markerTransform">
						<polygon points="0,-78 40,14 -40,14" class="nc-roomba-map__cone" />
						<circle r="28" class="nc-roomba-map__robot" />
						<polygon points="0,-50 13,-18 -13,-18" class="nc-roomba-map__heading" />
					</g>
				</svg>
			</div>
			<dl class="nc-roomba-stats">
				<div class="nc-roomba-stats__item">
					<dt>x</dt>
					<dd>{{ pose.x }}</dd>
				</div>
				<div class="nc-roomba-stats__item">
					<dt>y</dt>
					<dd>{{ pose.y }}</dd>
				</div>
				<div class="nc-roomba-stats__item">
					<dt>heading</dt>
					<dd>{{ pose.theta }}°</dd>
				</div>
				<div class="nc-roomba-stats__item">
					<dt>phase</dt>
					<dd>{{ phaseText }}</dd>
				</div>
			</dl>
			<p class="nc-roomba-muted">
				Coordinates are centimetres from the dock, in the robot's own frame —
				they do not survive a re-dock, so treat the plot as relative.
			</p>
		</div>

		<div v-else class="nc-roomba-panel" data-testid="location-fallback">
			<div class="nc-roomba-map-fallback">
				<MissionStage
					:state="store.state"
					:has-pose="false"
					:fallback-name="robotName" />
				<div class="nc-roomba-map-fallback__body">
					<p><strong>Live floor map unavailable</strong></p>
					<p>{{ fallbackReason }}</p>
					<p data-field="fallback-phase">Phase: {{ phaseText }}</p>
					<p v-if="lastSeen" class="nc-roomba-muted">Last known state {{ lastSeen }}</p>
				</div>
			</div>
			<p v-if="floorplan" class="nc-roomba-muted">
				Floorplan <code>{{ floorplan }}</code> is configured and will back the
				pose marker if a future firmware starts publishing one.
			</p>
			<p v-else class="nc-roomba-muted">
				An administrator can upload a floorplan image in the app settings to
				give this view a backdrop when pose becomes available.
			</p>
		</div>
	</div>
</template>

<script>
import MissionStage from '../components/MissionStage.vue'
import { useRobotStore } from '../store/robot.js'
import { lastSeenLabel, phaseLabel } from '../utils/format.js'

/** Robot pose is in cm; clamp to the SVG viewBox so a far room stays on screen. */
const EXTENT = 480

export default {
	name: 'LocationView',

	components: { MissionStage },

	computed: {
		store() {
			return useRobotStore()
		},
		robotName() {
			const boot = this.store.bootstrap || {}
			return (this.store.state && this.store.state.name)
				|| (boot.robot && boot.robot.name)
				|| 'Roomba'
		},
		hasPose() {
			return this.store.hasPose && this.pose.x !== null && this.pose.x !== undefined
		},
		pose() {
			return (this.store.state && this.store.state.pose) || {}
		},
		phaseText() {
			return phaseLabel(this.store.state)
		},
		lastSeen() {
			return this.store.hasSample ? lastSeenLabel(this.store.lastSeenAgeS, true) : ''
		},
		floorplan() {
			return (this.store.state && this.store.state.floorplan_path) || ''
		},
		floorplanStyle() {
			return this.floorplan ? { backgroundImage: `url(${this.floorplan})` } : {}
		},
		fallbackReason() {
			if (!this.store.hasSample) {
				return 'No state sample yet — check the connection health drawer.'
			}
			return 'Many 900-series models do not advertise pose over the local MQTT API. The mission stage above still tracks phase, battery, and coverage in real time.'
		},
		markerTransform() {
			const x = clamp(Number(this.pose.x) || 0)
			// SVG y grows downward; the robot frame grows "up", so flip it.
			const y = -clamp(Number(this.pose.y) || 0)
			const theta = Number(this.pose.theta) || 0
			return `translate(${x} ${y}) rotate(${theta})`
		},
		trailPoints() {
			return formatTrail((this.store.state && this.store.state.pose_trail) || [], false)
		},
		trailFade() {
			return formatTrail((this.store.state && this.store.state.pose_trail) || [], true)
		},
	},
}

/**
 * @param {number} value centimetres from the dock
 * @returns {number} value clamped to the drawable extent
 */
function clamp(value) {
	return Math.max(-EXTENT, Math.min(EXTENT, value))
}

/**
 * @param {Array<{x:number,y:number}>} trail
 * @param {boolean} fade
 * @returns {string}
 */
function formatTrail(trail, fade) {
	if (!Array.isArray(trail) || trail.length < 2) {
		return ''
	}
	const points = fade ? trail.filter((_, i) => i % 2 === 0) : trail
	if (points.length < 2) {
		return ''
	}
	return points
		.map((point) => `${clamp(Number(point.x) || 0)},${-clamp(Number(point.y) || 0)}`)
		.join(' ')
}
</script>
