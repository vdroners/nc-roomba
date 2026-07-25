<template>
	<div class="nc-roomba-view">
		<header class="nc-roomba-view__header">
			<h2>Location</h2>
			<p class="nc-roomba-muted">
				{{ hasPose ? 'Live pose reported by the robot.' : 'This robot does not publish pose locally.' }}
			</p>
		</header>

		<!-- Capability-detected: only draw a map when the robot actually reports
		     a pose. Otherwise say so instead of inventing a position. -->
		<div v-if="hasPose" class="nc-roomba-panel" data-testid="location-map">
			<div class="nc-roomba-map" :style="floorplanStyle">
				<svg class="nc-roomba-map__svg" viewBox="-500 -500 1000 1000" role="img" aria-label="Robot position">
					<line x1="-500" y1="0" x2="500" y2="0" class="nc-roomba-map__axis" />
					<line x1="0" y1="-500" x2="0" y2="500" class="nc-roomba-map__axis" />
					<polyline v-if="trailPoints" :points="trailPoints" class="nc-roomba-map__trail" />
					<g :transform="markerTransform">
						<circle r="26" class="nc-roomba-map__robot" />
						<polygon points="0,-46 14,-16 -14,-16" class="nc-roomba-map__heading" />
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
			</dl>
			<p class="nc-roomba-muted">
				Coordinates are centimetres from the dock, in the robot's own frame —
				they do not survive a re-dock, so treat the plot as relative.
			</p>
		</div>

		<div v-else class="nc-roomba-panel" data-testid="location-fallback">
			<div class="nc-roomba-map-fallback">
				<div>
					<p><strong>Live map unavailable</strong></p>
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
				give this view a backdrop.
			</p>
		</div>
	</div>
</template>

<script>
import { useRobotStore } from '../store/robot.js'
import { lastSeenLabel, phaseLabel } from '../utils/format.js'

/** Robot pose is in cm; clamp to the SVG viewBox so a far room stays on screen. */
const EXTENT = 480

export default {
	name: 'LocationView',

	computed: {
		store() {
			return useRobotStore()
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
			return 'The Roomba 960 does not advertise the pose capability over the local API, so there is no position to draw. Phase and last-known status are shown instead.'
		},
		markerTransform() {
			const x = clamp(Number(this.pose.x) || 0)
			// SVG y grows downward; the robot frame grows "up", so flip it.
			const y = -clamp(Number(this.pose.y) || 0)
			const theta = Number(this.pose.theta) || 0
			return `translate(${x} ${y}) rotate(${theta})`
		},
		trailPoints() {
			const trail = (this.store.state && this.store.state.pose_trail) || []
			if (!Array.isArray(trail) || trail.length < 2) {
				return ''
			}
			return trail
				.map((point) => `${clamp(Number(point.x) || 0)},${-clamp(Number(point.y) || 0)}`)
				.join(' ')
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
</script>
