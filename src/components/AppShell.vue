<template>
	<div :class="['nc-roomba-app-shell', { 'is-cleaning': isCleaning }]">
		<StatusStrip
			:state="state"
			:age-s="ageS"
			:connected="connected"
			:conflict="conflict"
			:stale="stale"
			@open-drawer="$emit('open-drawer')" />

		<nav class="nc-roomba-nav" aria-label="NC Roomba sections">
			<button
				v-for="item in tabs"
				:key="item.id"
				:class="{ active: tab === item.id }"
				:aria-current="tab === item.id ? 'page' : null"
				:data-tab="item.id"
				type="button"
				@click="$emit('update:tab', item.id)">
				{{ item.label }}
			</button>
		</nav>

		<main class="nc-roomba-main">
			<!-- A failed command is sticky: the 3–6 s poll must not be able to
			     scroll it away before the operator has read it, so it clears only
			     on this dismiss (or when the next command supersedes it). -->
			<NcNoteCard
				v-if="actionError"
				type="error"
				:heading="actionErrorHeading"
				data-testid="action-error">
				<div class="nc-roomba-action-error">
					<span class="nc-roomba-action-error__text">{{ actionError }}</span>
					<NcButton
						type="tertiary"
						data-testid="action-error-dismiss"
						aria-label="Dismiss this command failure"
						@click="$emit('dismiss-action-error')">
						Dismiss
					</NcButton>
				</div>
			</NcNoteCard>

			<!-- Nextcloud cannot reach the bridge at all. Without this the app just
			     renders blank tiles -- battery, bin, Wi-Fi and phase all empty -- and
			     looks like the robot has no data rather than like the app has lost
			     its connection. That is exactly how a severed docker network went
			     unnoticed for a day: the only mention of "unreachable" lived inside
			     the health drawer, which you have to open on purpose. -->
			<NcNoteCard
				v-if="bridgeUnreachable"
				type="error"
				heading="Can't reach the robot"
				data-testid="bridge-unreachable">
				<p>
					Nextcloud can't reach the {{ robotName }} bridge, so the readings below
					are blank rather than out of date. The robot itself may be perfectly
					fine — this is the link between Nextcloud and the bridge service.
				</p>
				<p class="nc-roomba-muted">
					Usually a restarted container that lost its network attachment. Run
					<code>make bridge-up</code> in the app directory, or open Connection
					health for details.
				</p>
			</NcNoteCard>

			<NcNoteCard v-if="error" type="error" :heading="'Something went wrong'">
				{{ error }}
			</NcNoteCard>
			<slot />
		</main>

		<ConnectionHealthDrawer
			:open="drawerOpen"
			:state="state"
			:transport="transport"
			:can-admin="canAdmin"
			@close="$emit('close-drawer')"
			@retry="$emit('retry-connect')" />
	</div>
</template>

<script>
import { isBridgeUnreachable } from '@/utils/format.js'
import { NcButton, NcNoteCard } from '@nextcloud/vue'

import ConnectionHealthDrawer from './ConnectionHealthDrawer.vue'
import StatusStrip from './StatusStrip.vue'

const TABS = [
	{ id: 'dashboard', label: 'Dashboard' },
	{ id: 'location', label: 'Location' },
	{ id: 'history', label: 'History' },
	{ id: 'settings', label: 'Settings' },
]

/**
 * Shell layout from the plan: sticky status strip, section nav, the active view
 * in the default slot, and the connection-health drawer.
 */
export default {
	name: 'AppShell',

	components: { ConnectionHealthDrawer, NcButton, NcNoteCard, StatusStrip },

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
		drawerOpen: {
			type: Boolean,
			default: false,
		},
		tab: {
			type: String,
			default: 'dashboard',
		},
		transport: {
			type: String,
			default: 'idle',
		},
		canAdmin: {
			type: Boolean,
			default: false,
		},
		error: {
			type: String,
			default: null,
		},
		/** Sticky message from the last failed operator command. */
		actionError: {
			type: String,
			default: null,
		},
		/** Which action produced `actionError`, for the heading. */
		actionErrorFor: {
			type: String,
			default: null,
		},
	},

	data() {
		return { tabs: TABS }
	},

	computed: {
		/**
		 * True when Nextcloud cannot reach the bridge at all.
		 *
		 * Deliberately keyed off `bridge_ok` rather than off missing readings: a
		 * genuinely idle robot can legitimately report nulls for some fields, and
		 * we must not cry wolf. `bridge_ok: false` means the HTTP call to the
		 * bridge itself failed, which is never normal.
		 *
		 * @returns {boolean} whether to show the unreachable banner
		 */
		bridgeUnreachable() {
			return isBridgeUnreachable(this.state)
		},

		/** @returns {string} the robot's display name, for the banner copy */
		robotName() {
			return (this.state && this.state.name) || 'robot'
		},

		actionErrorHeading() {
			return this.actionErrorFor
				? `“${this.actionErrorFor}” did not go through`
				: 'That command did not go through'
		},
		isCleaning() {
			if (!this.state) {
				return false
			}
			const phase = String(this.state.phase || '')
			const cycle = String(this.state.cycle || '')
			return phase === 'run' || cycle === 'clean' || cycle === 'spot'
		},
	},
}
</script>
