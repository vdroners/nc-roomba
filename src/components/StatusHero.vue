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

		<dl class="nc-roomba-hero__facts">
			<div class="nc-roomba-hero__fact">
				<dt>Battery</dt>
				<dd :class="batteryClass(battery, phase)">{{ batteryLabel(battery, phase) }}</dd>
			</div>
			<div class="nc-roomba-hero__fact">
				<dt>Bin</dt>
				<dd :class="binClass(bin)">{{ binLabel(bin) }}</dd>
			</div>
			<div class="nc-roomba-hero__fact">
				<dt>Wi-Fi</dt>
				<dd :class="rssiClass(rssi)">{{ rssiShort }}</dd>
			</div>
			<div class="nc-roomba-hero__fact">
				<dt>Next clean</dt>
				<dd>{{ nextCleanText }}</dd>
			</div>
		</dl>
	</div>
</template>

<script>
import {
	batteryClass,
	batteryLabel,
	binClass,
	binLabel,
	rssiClass,
} from '../utils/format.js'

/** Phases that mean the robot is actively cleaning. */
const CLEANING = new Set(['run'])
/** Phases that mean the robot is heading home. */
const RETURNING = new Set(['hmMidMsn', 'hmUsrDock', 'hmPostMsn'])
/** Phases that mean the robot is on the dock. */
const DOCKED = new Set(['charge', 'dockend', 'recharge'])

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
			if (!this.state) {
				return { label: 'Connecting…', detail: 'Waiting for the first telemetry sample.', tone: 'idle' }
			}
			const phase = String(this.state.phase || '')
			const cycle = String(this.state.cycle || '')
			const error = Number(this.state.error || 0)
			const notReady = Number(this.state.not_ready || 0)

			if (error !== 0) {
				return { label: 'Attention', detail: 'The robot reported an error — see the alert below.', tone: 'warn' }
			}
			if (CLEANING.has(phase) || cycle === 'clean' || cycle === 'spot') {
				return { label: 'Cleaning', detail: 'On the job — live progress on the mission stage.', tone: 'run' }
			}
			if (RETURNING.has(phase)) {
				return { label: 'Returning', detail: 'Heading back to the dock.', tone: 'run' }
			}
			if (phase === 'pause') {
				return { label: 'Paused', detail: 'Mission paused — resume from the controls.', tone: 'warn' }
			}
			if (DOCKED.has(phase)) {
				return { label: 'Charging', detail: 'Docked and topping up — ready when you are.', tone: 'dock' }
			}
			if (notReady !== 0) {
				return { label: 'Not ready', detail: 'Off the dock or not ready to clean.', tone: 'warn' }
			}
			return { label: 'Ready', detail: 'Idle and ready to clean.', tone: 'ok' }
		},
	},

	methods: { batteryClass, batteryLabel, binClass, binLabel, rssiClass },
}
</script>
