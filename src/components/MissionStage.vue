<template>
	<section
		:class="['nc-roomba-stage', `nc-roomba-stage--${mood}`]"
		data-testid="mission-stage"
		:aria-label="`${robotName} mission stage`">
		<header class="nc-roomba-stage__header">
			<h3 class="nc-roomba-stage__title">{{ robotName }}</h3>
			<p class="nc-roomba-stage__phase">{{ phaseText }}</p>
		</header>

		<div class="nc-roomba-stage__canvas">
			<div class="nc-roomba-stage__glyph-wrap" aria-hidden="true">
				<svg class="nc-roomba-stage__svg" viewBox="0 0 100 100">
					<circle class="nc-roomba-stage__pulse" cx="50" cy="50" r="44" />
					<circle class="nc-roomba-stage__ring" cx="50" cy="50" r="40" />
					<circle class="nc-roomba-stage__ring nc-roomba-stage__ring--sweep" cx="50" cy="50" r="40" />
					<circle class="nc-roomba-stage__body" cx="50" cy="50" r="22" />
					<path class="nc-roomba-stage__home" d="M50 36 L62 46 V60 H54 V52 H46 V60 H38 V46 Z" />
					<path class="nc-roomba-stage__bumper" d="M30 64 Q50 74 70 64" />
				</svg>
			</div>

			<dl class="nc-roomba-stage__metrics">
				<div class="nc-roomba-stage__metric">
					<dt>Mission</dt>
					<dd>{{ durationText }}</dd>
				</div>
				<div class="nc-roomba-stage__metric">
					<dt>Coverage</dt>
					<dd>{{ sqftText }}</dd>
				</div>
				<div class="nc-roomba-stage__metric">
					<dt>Battery</dt>
					<dd>{{ batteryText }}</dd>
				</div>
				<div class="nc-roomba-stage__metric">
					<dt>Cycle</dt>
					<dd>{{ cycleText }}</dd>
				</div>
			</dl>

			<div v-if="showMiniMap" class="nc-roomba-stage__mini-map" data-testid="stage-mini-map">
				<svg class="nc-roomba-map__svg" viewBox="-500 -500 1000 1000" role="img" aria-label="Live pose inset">
					<circle class="nc-roomba-map__dock" cx="0" cy="0" r="28" />
					<polyline v-if="trailFade" :points="trailFade" class="nc-roomba-map__trail-fade" />
					<polyline v-if="trailPoints" :points="trailPoints" class="nc-roomba-map__trail" />
					<g class="nc-roomba-map__robot-g" :transform="markerTransform">
						<polygon points="0,-70 36,10 -36,10" class="nc-roomba-map__cone" />
						<circle r="26" class="nc-roomba-map__robot" />
						<polygon points="0,-46 12,-18 -12,-18" class="nc-roomba-map__heading" />
					</g>
				</svg>
			</div>
		</div>

		<p class="nc-roomba-stage__hint">{{ hint }}</p>
	</section>
</template>

<script>
import { durationLabel, phaseLabel } from '../utils/format.js'
import { stageMood } from '../utils/stageMood.js'

const EXTENT = 480

/**
 * Live mission theater for the Dashboard split. Phase-driven motion only —
 * never invents a pose. Mini-map inset appears only when the robot publishes one.
 */
export default {
	name: 'MissionStage',

	props: {
		state: {
			type: Object,
			default: null,
		},
		hasPose: {
			type: Boolean,
			default: false,
		},
		/** Fallback when the robot has not published a name yet. */
		fallbackName: {
			type: String,
			default: 'Roomba',
		},
	},

	computed: {
		robotName() {
			return (this.state && this.state.name) || this.fallbackName
		},
		phase() {
			return (this.state && this.state.phase) || ''
		},
		cycle() {
			return (this.state && this.state.cycle) || 'none'
		},
		mission() {
			return (this.state && this.state.mission) || {}
		},
		pose() {
			return (this.state && this.state.pose) || {}
		},
		phaseText() {
			return phaseLabel(this.state)
		},
		mood() {
			return stageMood(this.state)
		},
		durationText() {
			const m = Number(this.mission.mssn_m) || 0
			return m > 0 ? durationLabel(m * 60) : '—'
		},
		sqftText() {
			const sqft = Number(this.mission.sqft) || 0
			return sqft > 0 ? `${sqft.toLocaleString()} sq ft` : '—'
		},
		batteryText() {
			const pct = this.state ? this.state.battery_pct : null
			return pct === null || pct === undefined ? '—' : `${Math.round(Number(pct))}%`
		},
		cycleText() {
			const c = this.cycle
			if (!c || c === 'none') {
				return 'idle'
			}
			return c
		},
		showMiniMap() {
			return this.hasPose
				&& this.pose.x !== null
				&& this.pose.x !== undefined
		},
		markerTransform() {
			const x = clamp(Number(this.pose.x) || 0)
			const y = -clamp(Number(this.pose.y) || 0)
			const theta = Number(this.pose.theta) || 0
			return `translate(${x} ${y}) rotate(${theta})`
		},
		trailPoints() {
			return formatTrail((this.state && this.state.pose_trail) || [], false)
		},
		trailFade() {
			return formatTrail((this.state && this.state.pose_trail) || [], true)
		},
		hint() {
			if (!this.state) {
				return 'Waiting for the first telemetry sample…'
			}
			if (this.mood === 'run') {
				return 'Cleaning in progress — live telemetry from the local MQTT bridge.'
			}
			if (this.mood === 'dock') {
				return 'Returning to the dock.'
			}
			if (this.mood === 'pause') {
				return 'Paused — resume or dock when ready.'
			}
			if (this.mood === 'fault') {
				return 'Needs attention — see the error panel below.'
			}
			if (this.showMiniMap) {
				return 'Docked / idle. Pose inset updates when the robot moves.'
			}
			return 'Docked / idle. This model may not publish a live floor map over the local API.'
		},
	},
}

/**
 * @param {number} value
 * @returns {number}
 */
function clamp(value) {
	return Math.max(-EXTENT, Math.min(EXTENT, value))
}

/**
 * @param {Array<{x:number,y:number}>} trail
 * @param {boolean} fade use every other point for a soft underlay
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
