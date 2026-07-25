<template>
	<div class="nc-roomba-control-pad-wrap">
		<div class="nc-roomba-control-pad" data-testid="control-pad">
			<NcButton
				v-for="cmd in commands"
				:key="cmd.name"
				:type="cmd.type"
				:disabled="disabled || Boolean(pending)"
				:aria-label="cmd.help"
				:title="cmd.help"
				:data-action="cmd.name"
				wide
				@click="press(cmd)">
				{{ pending === cmd.name ? cmd.busyLabel : cmd.label }}
			</NcButton>
		</div>

		<p v-if="disabled" class="nc-roomba-muted">
			You are not in the operator group, so the controls are read-only.
		</p>

		<!-- UI-2: stop ends the mission outright, so it is the one command that
		     asks first. Pause/dock stay one tap. -->
		<NcDialog
			v-if="confirmOpen"
			:open="confirmOpen"
			name="Stop the mission?"
			data-testid="stop-confirm"
			@update:open="confirmOpen = $event"
			@closing="confirmOpen = false">
			<p>
				Stopping ends the current cleaning cycle — the robot stays where it is and
				the mission is closed out. Use <strong>Pause</strong> if you want to
				resume, or <strong>Dock</strong> to send it home.
			</p>
			<template #actions>
				<NcButton data-testid="stop-cancel" @click="confirmOpen = false">
					Keep cleaning
				</NcButton>
				<NcButton type="error" data-testid="stop-confirm-button" @click="confirmStop">
					Stop mission
				</NcButton>
			</template>
		</NcDialog>
	</div>
</template>

<script>
import { NcButton, NcDialog } from '@nextcloud/vue'

/** Only commands the 960 actually supports locally. */
const COMMANDS = [
	{ name: 'clean', label: 'Clean', busyLabel: 'Starting…', type: 'primary', help: 'Start a full cleaning mission' },
	{ name: 'spot', label: 'Spot', busyLabel: 'Starting…', type: 'secondary', help: 'Spot clean the current area' },
	{ name: 'pause', label: 'Pause', busyLabel: 'Pausing…', type: 'secondary', help: 'Pause and keep the mission open' },
	{ name: 'resume', label: 'Resume', busyLabel: 'Resuming…', type: 'secondary', help: 'Resume the paused mission' },
	{ name: 'dock', label: 'Dock', busyLabel: 'Docking…', type: 'secondary', help: 'Return to the Home Base' },
	{ name: 'find', label: 'Find', busyLabel: 'Beeping…', type: 'tertiary', help: 'Play a locate tone' },
	{ name: 'stop', label: 'Stop', busyLabel: 'Stopping…', type: 'error', help: 'End the mission (asks to confirm)', confirm: true },
]

export default {
	name: 'ControlPad',

	components: { NcButton, NcDialog },

	props: {
		disabled: {
			type: Boolean,
			default: false,
		},
		/** Action currently in flight, from the store. */
		pending: {
			type: String,
			default: null,
		},
	},

	data() {
		return {
			commands: COMMANDS,
			confirmOpen: false,
		}
	},

	methods: {
		/**
		 * @param {object} cmd command descriptor
		 */
		press(cmd) {
			if (this.disabled) {
				return
			}
			if (cmd.confirm) {
				this.confirmOpen = true
				return
			}
			this.$emit('action', cmd.name)
		},

		confirmStop() {
			this.confirmOpen = false
			this.$emit('action', 'stop')
		},
	},
}
</script>
