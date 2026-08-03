<template>
	<div class="nc-roomba-view">
		<div class="nc-roomba-view__header">
			<h2>Settings</h2>
			<p class="nc-roomba-muted">Schedule and cleaning preferences.</p>
		</div>

		<ScheduleWeekGrid
			v-if="showSchedule"
			:value="store.schedule"
			:next="store.nextScheduled"
			:disabled="!store.canOperate"
			@save="saveSchedule" />

		<p v-else-if="capabilitiesLoaded" class="nc-roomba-muted">
			{{ robotName }} does not expose a weekly schedule over the local API.
		</p>

		<div v-if="showAnyPreferences" class="nc-roomba-panel" data-testid="preferences">
			<h3>Cleaning preferences</h3>
			<p v-if="!store.preferences" class="nc-roomba-muted">Reading preferences from {{ robotName }}…</p>

			<template v-else>
				<fieldset v-if="showCarpetBoost" class="nc-roomba-fieldset">
					<legend>Carpet boost</legend>
					<NcCheckboxRadioSwitch
						v-for="option in visibleCarpetOptions"
						:key="option.value"
						:model-value="prefs.carpet_boost"
						:value="option.value"
						:disabled="locked"
						name="carpet_boost"
						type="radio"
						@update:model-value="prefs.carpet_boost = $event">
						{{ option.label }}
					</NcCheckboxRadioSwitch>
				</fieldset>

				<fieldset v-if="showMultiPass" class="nc-roomba-fieldset">
					<legend>Cleaning passes</legend>
					<NcCheckboxRadioSwitch
						v-for="option in passOptions"
						:key="option.value"
						:model-value="prefs.cleaning_passes"
						:value="option.value"
						:disabled="locked"
						name="cleaning_passes"
						type="radio"
						@update:model-value="prefs.cleaning_passes = $event">
						{{ option.label }}
					</NcCheckboxRadioSwitch>
				</fieldset>

				<NcCheckboxRadioSwitch
					v-if="showEdgeClean"
					:checked="prefs.edge_clean"
					:disabled="locked"
					type="switch"
					@update:checked="prefs.edge_clean = $event">
					Edge clean (run the side brush along walls)
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					v-if="showAlwaysFinish"
					:checked="prefs.always_finish"
					:disabled="locked"
					type="switch"
					@update:checked="prefs.always_finish = $event">
					Always finish (keep cleaning when the bin fills)
				</NcCheckboxRadioSwitch>

				<div class="nc-roomba-actions">
					<NcButton type="primary" :disabled="locked || !prefsDirty" @click="savePrefs">
						{{ savingPrefs ? 'Saving…' : 'Save preferences' }}
					</NcButton>
					<NcButton :disabled="savingPrefs" @click="reloadPrefs">Reload from robot</NcButton>
				</div>
			</template>
		</div>

		<p v-else-if="capabilitiesLoaded" class="nc-roomba-muted">
			{{ robotName }} does not expose cleaning preferences over the local API.
		</p>

		<p class="nc-roomba-muted nc-roomba-admin-pointer">
			Robot discovery, onboarding and data retention live in
			<strong>Administration → NC Roomba</strong>.
		</p>

		<NcNoteCard v-if="notice" :type="noticeType">{{ notice }}</NcNoteCard>
	</div>
</template>

<script>
import { NcButton, NcCheckboxRadioSwitch, NcNoteCard } from '@nextcloud/vue'

import ScheduleWeekGrid from '../components/ScheduleWeekGrid.vue'
import { useRobotStore } from '../store/robot.js'

const CARPET_OPTIONS = [
	{ value: 'auto', label: 'Auto (boost on carpet)' },
	{ value: 'performance', label: 'Performance (always high power)' },
	{ value: 'eco', label: 'Eco (quiet, longer runtime)' },
]

const PASS_OPTIONS = [
	{ value: 'auto', label: 'Auto (decide per room)' },
	{ value: 'one', label: 'One pass' },
	{ value: 'two', label: 'Two passes' },
]

/**
 * @param {object|null} preferences store preferences block
 * @returns {object} editable copy with defaults filled in
 */
function editableCopy(preferences) {
	const p = preferences || {}
	return {
		carpet_boost: p.carpet_boost || 'auto',
		cleaning_passes: p.cleaning_passes || 'auto',
		edge_clean: p.edge_clean !== false,
		always_finish: p.always_finish !== false,
	}
}

export default {
	name: 'SettingsView',

	components: { NcButton, NcCheckboxRadioSwitch, NcNoteCard, ScheduleWeekGrid },

	data() {
		return {
			carpetOptions: CARPET_OPTIONS,
			passOptions: PASS_OPTIONS,
			prefs: editableCopy(null),
			savingPrefs: false,
			savingSchedule: false,
			notice: '',
			noticeType: 'success',
		}
	},

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
		capabilities() {
			return (this.store.state && this.store.state.capabilities) || {}
		},
		capabilitiesLoaded() {
			return Boolean(this.store.state && this.store.state.capabilities)
		},
		showSchedule() {
			return this.capabilities.schedule !== false
		},
		showCarpetBoost() {
			return this.capabilities.carpet_boost !== false
		},
		showMultiPass() {
			return this.capabilities.multi_pass !== false
		},
		showEdgeClean() {
			return this.capabilities.edge_clean !== false
		},
		showAlwaysFinish() {
			return this.capabilities.bin_full_detect !== false
		},
		showAnyPreferences() {
			return this.showCarpetBoost || this.showMultiPass || this.showEdgeClean || this.showAlwaysFinish
		},
		visibleCarpetOptions() {
			if (this.capabilities.eco === false) {
				return this.carpetOptions.filter((o) => o.value !== 'eco')
			}
			return this.carpetOptions
		},
		locked() {
			return !this.store.canOperate || this.savingPrefs
		},
		prefsDirty() {
			return JSON.stringify(this.prefs) !== JSON.stringify(editableCopy(this.store.preferences))
		},
	},

	watch: {
		'store.preferences': {
			deep: true,
			handler(preferences) {
				if (!this.prefsDirty) {
					this.prefs = editableCopy(preferences)
				}
			},
		},
	},

	async mounted() {
		if (this.showSchedule) {
			await this.store.loadSchedule()
		}
		if (this.showAnyPreferences) {
			await this.store.loadPreferences()
			this.prefs = editableCopy(this.store.preferences)
		}
	},

	methods: {
		/**
		 * @param {string} message operator-facing text
		 * @param {'success'|'warning'|'error'} [type]
		 */
		report(message, type = 'success') {
			this.notice = message
			this.noticeType = type
		},

		/**
		 * @param {object} week dorita980 week shape
		 */
		async saveSchedule(week) {
			this.savingSchedule = true
			try {
				await this.store.saveSchedule(week)
				if (this.store.error) {
					this.report(this.store.error, 'error')
				} else if (this.store.scheduleConfirmed) {
					this.report(`${this.robotName} confirmed the new schedule.`, 'success')
				} else {
					this.report(
						`Sent to ${this.robotName}. It has not confirmed yet — give it a moment, then reload Settings.`,
						'warning',
					)
				}
			} finally {
				this.savingSchedule = false
			}
		},

		async savePrefs() {
			this.savingPrefs = true
			try {
				await this.store.savePreferences({ ...this.prefs })
				if (this.store.error) {
					this.report(this.store.error, 'error')
				} else if (this.store.preferencesConfirmed) {
					this.report(`${this.robotName} confirmed the new preferences.`, 'success')
				} else {
					this.report(
						`Sent to ${this.robotName}. It has not confirmed yet — give it a moment, then Reload from robot.`,
						'warning',
					)
				}
			} finally {
				this.savingPrefs = false
			}
		},

		async reloadPrefs() {
			await this.store.loadPreferences()
			this.prefs = editableCopy(this.store.preferences)
		},
	},
}
</script>
