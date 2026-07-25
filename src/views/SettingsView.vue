<template>
	<div class="nc-roomba-view">
		<div class="nc-roomba-view__header">
			<h2>Settings</h2>
			<p class="nc-roomba-muted">Schedule, cleaning preferences, discovery and retention.</p>
		</div>

		<ScheduleWeekGrid
			:value="store.schedule"
			:next="store.nextScheduled"
			:disabled="!store.canOperate"
			@save="saveSchedule" />

		<div class="nc-roomba-panel" data-testid="preferences">
			<h3>Cleaning preferences</h3>
			<p v-if="!store.preferences" class="nc-roomba-muted">Reading preferences from {{ robotName }}…</p>

			<template v-else>
				<fieldset class="nc-roomba-fieldset">
					<legend>Carpet boost</legend>
					<NcCheckboxRadioSwitch
						v-for="option in carpetOptions"
						:key="option.value"
						:checked="prefs.carpet_boost === option.value"
						:value="option.value"
						:disabled="locked"
						name="carpet_boost"
						type="radio"
						@update:checked="prefs.carpet_boost = option.value">
						{{ option.label }}
					</NcCheckboxRadioSwitch>
				</fieldset>

				<fieldset class="nc-roomba-fieldset">
					<legend>Cleaning passes</legend>
					<NcCheckboxRadioSwitch
						v-for="option in passOptions"
						:key="option.value"
						:checked="prefs.cleaning_passes === option.value"
						:value="option.value"
						:disabled="locked"
						name="cleaning_passes"
						type="radio"
						@update:checked="prefs.cleaning_passes = option.value">
						{{ option.label }}
					</NcCheckboxRadioSwitch>
				</fieldset>

				<NcCheckboxRadioSwitch
					:checked="prefs.edge_clean"
					:disabled="locked"
					type="switch"
					@update:checked="prefs.edge_clean = $event">
					Edge clean (run the side brush along walls)
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
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

		<div class="nc-roomba-panel" data-testid="auto-discover">
			<h3>Auto discover</h3>
			<p class="nc-roomba-muted">
				Scans the LAN for Roomba MQTT (:8883). UDP broadcast is tried first; if the
				robot stays quiet the bridge TCP-scans the configured subnet
				(<code>ROOMBA_DISCOVER_SUBNETS</code>, default <code>10.0.0.0/24</code>).
			</p>
			<div class="nc-roomba-actions">
				<NcButton :disabled="discovering" @click="runDiscover">
					{{ discovering ? 'Scanning…' : 'Auto discover' }}
				</NcButton>
			</div>
			<p v-if="discoverMsg" class="nc-roomba-muted">{{ discoverMsg }}</p>

			<ul v-if="candidates.length" class="nc-roomba-list">
				<li v-for="candidate in candidates" :key="candidate.ip">
					<button
						type="button"
						:class="{ active: selected && selected.ip === candidate.ip }"
						@click="selectCandidate(candidate)">
						<span class="nc-roomba-list__title">
							{{ candidate.robotname || 'Roomba' }} — {{ candidate.ip }}
						</span>
						<span class="nc-roomba-list__meta">
							<span v-if="candidate.sku">{{ candidate.sku }}</span>
							<span v-if="candidate.blid"> · BLID {{ candidate.blid }}</span>
							<span v-if="candidate.source"> · via {{ candidate.source }}</span>
						</span>
					</button>
				</li>
			</ul>

			<div v-if="selected" class="nc-roomba-fieldset">
				<p>
					Selected <strong>{{ selected.robotname || 'Roomba' }}</strong> at
					<code>{{ selected.ip }}</code>. Give it a DHCP reservation before onboarding —
					the local API is reached by IP.
				</p>
				<template v-if="store.canAdmin">
					<p>Hold <strong>HOME</strong> until {{ robotName }} plays two tones, then:</p>
					<div class="nc-roomba-actions">
						<NcButton :disabled="onboarding" @click="runOnboard">
							{{ onboarding ? 'Retrieving…' : 'Retrieve credentials (hold HOME)' }}
						</NcButton>
					</div>
				</template>
				<p v-else class="nc-roomba-muted">
					Ask an administrator to finish onboarding in Administration → NC Roomba;
					the local password is stored encrypted and only admins may write it.
				</p>
				<p v-if="onboardMsg">{{ onboardMsg }}</p>
			</div>
		</div>

		<div v-if="store.canAdmin" class="nc-roomba-panel">
			<h3>Retention</h3>
			<p class="nc-roomba-muted">
				Missions, phase events and telemetry older than the retention window
				(default 365 days, set in Administration → NC Roomba) are pruned by a
				background job. Preview counts rows; apply deletes them.
			</p>
			<div class="nc-roomba-actions">
				<NcButton :disabled="retentionBusy" @click="previewRetention">Preview prune</NcButton>
				<NcButton :disabled="retentionBusy" @click="applyRetention">Apply prune now</NcButton>
			</div>
			<p v-if="retentionMsg" class="nc-roomba-muted">{{ retentionMsg }}</p>
		</div>

		<NcNoteCard v-if="notice" :type="noticeType">{{ notice }}</NcNoteCard>
	</div>
</template>

<script>
import { NcButton, NcCheckboxRadioSwitch, NcNoteCard } from '@nextcloud/vue'

import ScheduleWeekGrid from '../components/ScheduleWeekGrid.vue'
import * as api from '../services/api.js'
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

/**
 * @param {object} result retention response
 * @param {string} verb 'would delete' / 'deleted'
 * @returns {string} one-line summary
 */
function summarizePrune(result, verb) {
	const counts = (result && (result.counts || result)) || {}
	const parts = ['missions', 'phase_events', 'telemetry_samples', 'audits']
		.filter((key) => counts[key] !== undefined)
		.map((key) => `${counts[key]} ${key.replace(/_/g, ' ')}`)
	const cutoff = result && result.cutoff ? ` (older than ${result.cutoff})` : ''
	return parts.length ? `${verb} ${parts.join(', ')}${cutoff}` : `${verb} nothing${cutoff}`
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
			discovering: false,
			discoverMsg: '',
			candidates: [],
			selected: null,
			onboarding: false,
			onboardMsg: '',
			retentionBusy: false,
			retentionMsg: '',
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
				this.prefs = editableCopy(preferences)
			},
		},
	},

	async mounted() {
		await this.store.loadSchedule()
		await this.store.loadPreferences()
		this.prefs = editableCopy(this.store.preferences)
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
			await this.store.saveSchedule(week)
			this.report(this.store.error || `Schedule written to ${this.robotName}.`, this.store.error ? 'error' : 'success')
		},

		async savePrefs() {
			this.savingPrefs = true
			try {
				await this.store.savePreferences({ ...this.prefs })
				this.report(this.store.error || `Preferences written to ${this.robotName}.`, this.store.error ? 'error' : 'success')
			} finally {
				this.savingPrefs = false
			}
		},

		async reloadPrefs() {
			await this.store.loadPreferences()
			this.prefs = editableCopy(this.store.preferences)
		},

		async runDiscover() {
			this.discovering = true
			this.discoverMsg = 'Scanning the LAN (UDP broadcast, then :8883)…'
			this.candidates = []
			this.selected = null
			this.onboardMsg = ''
			try {
				const data = await api.discover()
				this.candidates = data.candidates || data.robots || []
				if (this.candidates.length === 0) {
					this.discoverMsg = data.error
						? `Discovery failed: ${data.error}`
						: 'No robot answered. Confirm the robot is on Wi-Fi and on this VLAN, then retry.'
					return
				}
				const wanted = String(this.robotName || '').toLowerCase()
				const named = wanted
					? this.candidates.find((c) => String(c.robotname || '').toLowerCase() === wanted)
					: null
				this.selected = named || this.candidates[0]
				this.discoverMsg = `Found ${this.candidates.length} robot(s).`
			} catch (err) {
				this.discoverMsg = (err.response && err.response.data && err.response.data.error) || err.message || 'Discovery failed'
			} finally {
				this.discovering = false
			}
		},

		/**
		 * @param {object} candidate discovery row
		 */
		selectCandidate(candidate) {
			this.selected = candidate
			this.onboardMsg = ''
		},

		async runOnboard() {
			if (!this.selected || !this.selected.ip) {
				return
			}
			this.onboarding = true
			this.onboardMsg = `Hold HOME until ${this.selected.robotname || this.robotName} beeps — retrieving the local password…`
			try {
				const data = await api.onboard({
					ip: this.selected.ip,
					host: this.selected.ip,
					name: this.selected.robotname || this.robotName,
					blid: this.selected.blid,
				})
				if (data.error) {
					this.onboardMsg = data.error
					return
				}
				const robot = data.robot || {}
				this.onboardMsg = `Onboarded ${robot.name || this.selected.robotname || this.robotName} at ${robot.host || this.selected.ip}.`
				await this.store.refresh()
			} catch (err) {
				this.onboardMsg = (err.response && err.response.data && err.response.data.error) || err.message || 'Onboarding failed'
			} finally {
				this.onboarding = false
			}
		},

		async previewRetention() {
			this.retentionBusy = true
			try {
				this.retentionMsg = summarizePrune(await api.retentionPreview(), 'Would delete')
			} catch (err) {
				this.report(err.message || 'Retention preview failed', 'error')
			} finally {
				this.retentionBusy = false
			}
		},

		async applyRetention() {
			this.retentionBusy = true
			try {
				this.retentionMsg = summarizePrune(await api.retentionApply(), 'Deleted')
			} catch (err) {
				this.report(err.message || 'Retention prune failed', 'error')
			} finally {
				this.retentionBusy = false
			}
		},
	},
}
</script>
