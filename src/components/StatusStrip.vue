<template>
	<div class="nc-roomba-status-strip" data-testid="status-strip">
		<span class="nc-roomba-chip nc-roomba-chip--name">{{ name }}</span>
		<span
			v-if="isMock"
			class="nc-roomba-chip warn"
			data-field="mock"
			title="Bridge is in ROOMBA_MOCK=1 — buttons do not touch the real robot">
			MOCK
		</span>
		<span :class="['nc-roomba-chip', batteryClass(battery)]" data-field="battery" :title="batteryTitle">
			{{ batteryLabel(battery) }}
		</span>
		<span :class="['nc-roomba-chip', binClass(bin)]" data-field="bin">{{ binLabel(bin) }}</span>
		<span :class="['nc-roomba-chip', rssiClass(rssi)]" data-field="rssi">{{ rssiLabel(rssi) }}</span>
		<span class="nc-roomba-chip" data-field="phase">{{ phaseLabel(state) }}</span>
		<span :class="['nc-roomba-chip', stale ? 'warn' : '']" data-field="last-seen">
			Last seen {{ lastSeenLabel(ageS, hasSample) }}
		</span>
		<button
			:class="['nc-roomba-chip', 'nc-roomba-chip--button', connectionClass]"
			data-field="connection"
			type="button"
			@click="$emit('open-drawer')">
			{{ connectionLabel }}
		</button>
	</div>
</template>

<script>
import {
	batteryClass,
	batteryLabel,
	binClass,
	binLabel,
	lastSeenLabel,
	phaseLabel,
	rssiClass,
	rssiLabel,
} from '../utils/format.js'

/**
 * UI-1: sticky always-on strip. Presentational only — it reads the state the
 * store already keeps fresh, and the parent ticks `ageS` once a second so the
 * relative "last seen" text stays honest without extra requests.
 */
export default {
	name: 'StatusStrip',

	props: {
		state: {
			type: Object,
			default: null,
		},
		ageS: {
			type: Number,
			default: 0,
		},
		connected: {
			type: Boolean,
			default: false,
		},
		conflict: {
			type: [Boolean, String],
			default: false,
		},
		stale: {
			type: Boolean,
			default: false,
		},
	},

	computed: {
		name() {
			return (this.state && this.state.name) || 'Roomba'
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
		hasSample() {
			return Boolean(this.state && this.state.updated_at)
		},
		batteryTitle() {
			return this.state && this.state.mission && this.state.mission.sqft
				? `${this.state.mission.sqft} sq ft this mission`
				: 'Battery'
		},
		isMock() {
			return Boolean(this.state && this.state.mock)
		},
		connectionLabel() {
			if (this.isMock) {
				return 'Mock (not real)'
			}
			if (this.conflict) {
				return 'MQTT conflict'
			}
			return this.connected ? 'MQTT up' : 'MQTT down'
		},
		connectionClass() {
			if (this.isMock) {
				return 'warn'
			}
			if (this.conflict) {
				return 'warn'
			}
			return this.connected ? 'ok' : 'danger'
		},
	},

	methods: {
		batteryClass,
		batteryLabel,
		binClass,
		binLabel,
		lastSeenLabel,
		phaseLabel,
		rssiClass,
		rssiLabel,
	},
}
</script>
