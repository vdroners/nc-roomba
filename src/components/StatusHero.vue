<template>
	<div class="nc-roomba-panel nc-roomba-hero" :class="`nc-roomba-hero--${status.tone}`" data-testid="status-hero">
		<div class="nc-roomba-hero__lead">
			<span class="nc-roomba-hero__pill" :class="`is-${status.tone}`">
				<span class="nc-roomba-hero__dot" aria-hidden="true" />
				{{ status.label }}
			</span>
			<h2 class="nc-roomba-hero__name">{{ name }}</h2>
			<p class="nc-roomba-hero__sub">{{ status.detail }}</p>
		</div>

		<div class="nc-roomba-hero__facts">
			<!-- Battery ring -->
			<div class="nc-roomba-hero__fact nc-roomba-hero__fact--gauge">
				<svg class="nc-roomba-ring" :class="`is-${batteryLevel(battery, phase)}`" viewBox="0 0 40 40" :aria-label="`Battery ${batteryLabel(battery, phase)}`" role="img">
					<circle class="nc-roomba-ring__track" cx="20" cy="20" r="16" />
					<circle
						class="nc-roomba-ring__value"
						cx="20"
						cy="20"
						r="16"
						:stroke-dasharray="ringCirc"
						:stroke-dashoffset="ringOffset"
						transform="rotate(-90 20 20)" />
					<text class="nc-roomba-ring__pct" x="20" y="20" dominant-baseline="central" text-anchor="middle">{{ ringPctLabel }}</text>
				</svg>
				<div class="nc-roomba-hero__gaugetext">
					<dt>Battery</dt>
					<dd :class="batteryClass(battery, phase)">{{ batteryLabel(battery, phase) }}</dd>
				</div>
			</div>

			<!-- Wi-Fi signal bars -->
			<div class="nc-roomba-hero__fact nc-roomba-hero__fact--gauge">
				<span class="nc-roomba-bars" :class="rssiClass(rssi)" :title="rssiShort" aria-hidden="true">
					<i v-for="n in 4" :key="n" :class="{ on: n <= bars }" />
				</span>
				<div class="nc-roomba-hero__gaugetext">
					<dt>Wi-Fi</dt>
					<dd :class="rssiClass(rssi)">{{ rssiShort }}</dd>
				</div>
			</div>

			<!-- Bin fill glyph -->
			<div class="nc-roomba-hero__fact nc-roomba-hero__fact--gauge">
				<span class="nc-roomba-bin" :class="binClass(bin)" aria-hidden="true">
					<i class="nc-roomba-bin__fill" :class="`is-${bin}`" />
				</span>
				<div class="nc-roomba-hero__gaugetext">
					<dt>Bin</dt>
					<dd :class="binClass(bin)">{{ binLabel(bin) }}</dd>
				</div>
			</div>

			<div class="nc-roomba-hero__fact">
				<dt>Next clean</dt>
				<dd>{{ nextCleanText }}</dd>
			</div>
		</div>
	</div>
</template>

<script>
import {
	batteryClass,
	batteryLabel,
	batteryLevel,
	binClass,
	binLabel,
	rssiClass,
	signalBars,
} from '../utils/format.js'
import { heroStatus } from '../utils/heroStatus.js'

/** SVG ring geometry: r=16 → circumference 2πr. */
const RING_CIRC = 2 * Math.PI * 16

/**
 * Zone-A "at a glance" hero: one integrated card answering "is the robot OK and
 * what is it doing" — a single status pill plus the four facts an operator
 * checks most. Purely presentational; reads the store state passed in.
 */
export default {
	name: 'StatusHero',

	props: {
		state: {
			type: Object,
			default: null,
		},
		nextScheduled: {
			type: Object,
			default: null,
		},
		/** True for a while after a full bin cleared (store `binEmptied`). */
		binEmptied: {
			type: Boolean,
			default: false,
		},
	},

	computed: {
		name() {
			return (this.state && this.state.name) || 'Roomba'
		},
		phase() {
			return this.state ? this.state.phase : null
		},
		battery() {
			return this.state ? this.state.battery_pct : null
		},
		bin() {
			return this.state ? this.state.bin : 'unknown'
		},
		rssi() {
			return this.state ? this.state.rssi : null
		},
		rssiShort() {
			if (this.rssi === null || this.rssi === undefined) {
				return '—'
			}
			return `${this.rssi} dBm`
		},
		bars() {
			return signalBars(this.rssi)
		},
		ringCirc() {
			return RING_CIRC.toFixed(2)
		},
		/** Compact label for the ring centre: number only, or ⚡ while calibrating. */
		ringPctLabel() {
			const pct = Number(this.battery)
			if (!Number.isFinite(pct)) {
				return '—'
			}
			if (pct === 0 && this.phase === 'charge') {
				return '⚡'
			}
			return `${Math.round(pct)}`
		},
		/** Dash offset draws the arc for the current battery %. Charging 0% shows a token 6%. */
		ringOffset() {
			let pct = Number(this.battery)
			if (!Number.isFinite(pct)) {
				pct = 0
			}
			if (pct === 0 && this.phase === 'charge') {
				pct = 6
			}
			const frac = Math.max(0, Math.min(1, pct / 100))
			return (RING_CIRC * (1 - frac)).toFixed(2)
		},
		nextCleanText() {
			const n = this.nextScheduled
			if (n && (n.day || n.local_time)) {
				return `${n.day || ''} ${n.local_time || ''}`.trim()
			}
			return 'Not scheduled'
		},

		/**
		 * Single overall status derived from phase + fault flags.
		 *
		 * @returns {{label:string,detail:string,tone:'ok'|'run'|'dock'|'warn'|'idle'}}
		 */
		status() {
			return heroStatus(this.state, { binEmptied: this.binEmptied })
		},
	},

	methods: { batteryClass, batteryLabel, batteryLevel, binClass, binLabel, rssiClass },
}
</script>
