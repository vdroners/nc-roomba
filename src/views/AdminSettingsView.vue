<template>
	<div class="nc-roomba-panel nc-roomba-admin">
		<h3>Alfred (Roomba 960)</h3>
		<p class="nc-roomba-muted">
			Give Alfred a DHCP reservation first — the local API is reached by IP, so a
			moving lease breaks the bridge. The password is stored encrypted.
		</p>

		<div class="nc-roomba-admin__grid">
			<label>
				Display name
				<input v-model="cfg.name" type="text">
			</label>
			<label>
				LAN IP
				<input v-model="cfg.host" type="text" placeholder="192.168.1.50">
			</label>
			<label>
				BLID
				<input v-model="cfg.blid" type="text">
			</label>
			<label>
				Local password
				<input
					v-model="cfg.password"
					type="password"
					:placeholder="passwordSet ? '(stored encrypted — leave blank to keep)' : ''">
			</label>
			<label>
				Bridge URL
				<input v-model="cfg.bridge_url" type="text" placeholder="http://nc_roomba_bridge:8080">
			</label>
			<label>
				Operator group
				<input v-model="cfg.operator_group" type="text">
			</label>
			<label>
				Retention (days)
				<input v-model.number="cfg.retention_days" type="number" min="0">
			</label>
		</div>

		<div class="nc-roomba-actions">
			<NcButton :disabled="!!busy" @click="scan">
				{{ busy === 'discover' ? 'Scanning…' : 'Auto discover' }}
			</NcButton>
			<NcButton :disabled="!!busy" @click="retrieve">
				{{ busy === 'onboard' ? 'Retrieving…' : 'Retrieve credentials (hold HOME)' }}
			</NcButton>
			<NcButton type="primary" :disabled="!!busy" @click="save">
				{{ busy === 'save' ? 'Saving…' : 'Save' }}
			</NcButton>
			<NcButton :disabled="!!busy" @click="test">
				{{ busy === 'connect' ? 'Connecting…' : 'Test connection' }}
			</NcButton>
		</div>

		<ul v-if="candidates.length" class="nc-roomba-list">
			<li v-for="candidate in candidates" :key="candidate.ip">
				<button type="button" @click="use(candidate)">
					<span class="nc-roomba-list__title">{{ candidate.robotname || 'Roomba' }} — {{ candidate.ip }}</span>
					<span class="nc-roomba-list__meta">
						{{ candidate.sku || 'unknown SKU' }}<span v-if="candidate.blid"> · BLID {{ candidate.blid }}</span>
					</span>
				</button>
			</li>
		</ul>

		<fieldset class="nc-roomba-fieldset">
			<legend>Retention</legend>
			<p class="nc-roomba-muted">
				Missions, phase events and telemetry samples older than the retention window are
				pruned by a background job. Preview first — apply deletes rows.
			</p>
			<div class="nc-roomba-actions">
				<NcButton :disabled="!!busy" @click="previewRetention">
					{{ busy === 'retention-preview' ? 'Counting…' : 'Preview prune' }}
				</NcButton>
				<NcButton :disabled="!!busy" @click="applyRetention">
					{{ busy === 'retention-apply' ? 'Pruning…' : 'Apply prune now' }}
				</NcButton>
			</div>
			<p v-if="retention" class="nc-roomba-muted">{{ retention }}</p>
		</fieldset>

		<NcNoteCard v-if="status" :type="statusType">{{ status }}</NcNoteCard>
	</div>
</template>

<script>
import { NcButton, NcNoteCard } from '@nextcloud/vue'

import * as api from '../services/api.js'

/**
 * @param {object} result retention dry-run / apply response
 * @param {string} verb 'would delete' or 'deleted'
 * @returns {string} one-line summary
 */
function summarizePrune(result, verb) {
	const counts = result && typeof result === 'object' ? (result.counts || result) : {}
	const parts = ['missions', 'phase_events', 'telemetry_samples', 'audits']
		.filter((key) => counts[key] !== undefined)
		.map((key) => `${counts[key]} ${key.replace(/_/g, ' ')}`)
	const cutoff = result && result.cutoff ? ` (older than ${result.cutoff})` : ''
	return parts.length ? `${verb} ${parts.join(', ')}${cutoff}` : `${verb} nothing${cutoff}`
}

export default {
	name: 'AdminSettingsView',

	components: { NcButton, NcNoteCard },

	props: {
		/** Server-rendered config from the admin template's dataset. */
		config: {
			type: Object,
			default: () => ({}),
		},
	},

	data() {
		const robot = this.config.robot || {}
		return {
			robotId: robot.id || api.DEFAULT_ROBOT_ID,
			passwordSet: Boolean(robot.password_set),
			busy: null,
			status: '',
			statusType: 'success',
			/** @type {object[]} LAN discovery candidates */
			candidates: [],
			retention: '',
			cfg: {
				name: robot.name || 'Alfred',
				host: robot.host || '',
				blid: robot.blid || '',
				password: '',
				bridge_url: this.config.bridge_url || '',
				operator_group: this.config.operator_group || 'roomba-operators',
				retention_days: this.config.retention_days ?? 365,
			},
		}
	},

	async mounted() {
		try {
			const settings = await api.getAdminSettings()
			const robot = settings.robot || {}
			this.robotId = robot.id || this.robotId
			this.passwordSet = Boolean(robot.password_set)
			this.cfg.name = robot.name || this.cfg.name
			this.cfg.host = robot.host || this.cfg.host
			this.cfg.blid = robot.blid || this.cfg.blid
			this.cfg.bridge_url = settings.bridge_url || this.cfg.bridge_url
			this.cfg.operator_group = settings.operator_group || this.cfg.operator_group
			this.cfg.retention_days = settings.retention_days ?? this.cfg.retention_days
		} catch (err) {
			this.report(err.message || 'Could not load the current settings', 'warning')
		}
	},

	methods: {
		/**
		 * @param {string} message operator-facing text
		 * @param {'success'|'warning'|'error'} [type]
		 */
		report(message, type = 'success') {
			this.status = message
			this.statusType = type
		},

		async save() {
			this.busy = 'save'
			try {
				const payload = {
					name: this.cfg.name,
					host: this.cfg.host,
					blid: this.cfg.blid,
					bridge_url: this.cfg.bridge_url,
					operator_group: this.cfg.operator_group,
					retention_days: this.cfg.retention_days,
				}
				if (this.cfg.password) {
					payload.password = this.cfg.password
				}
				await api.saveAdminSettings(payload)
				this.cfg.password = ''
				this.passwordSet = true
				this.report('Saved.')
			} catch (err) {
				this.report(err.message || 'Save failed', 'error')
			} finally {
				this.busy = null
			}
		},

		/** UDP broadcast + subnet probe; the bridge does the actual scanning. */
		async scan() {
			this.busy = 'discover'
			this.candidates = []
			this.report('Scanning the LAN for robots…', 'warning')
			try {
				const result = await api.discover()
				this.candidates = result.candidates || result.robots || []
				if (this.candidates.length === 0) {
					this.report(result.error || 'No robots answered. Check that Alfred is on the same VLAN.', 'warning')
					return
				}
				// Pre-fill from the only (or the Alfred-named) candidate.
				const alfred = this.candidates.find((c) => String(c.robotname || '').toLowerCase() === 'alfred')
				this.use(alfred || this.candidates[0])
				this.report(`Found ${this.candidates.length} robot(s).`)
			} catch (err) {
				this.report(err.message || 'Discovery failed', 'error')
			} finally {
				this.busy = null
			}
		},

		/**
		 * @param {object} candidate discovery row
		 */
		use(candidate) {
			if (!candidate) {
				return
			}
			this.cfg.host = candidate.ip || this.cfg.host
			this.cfg.blid = candidate.blid || this.cfg.blid
			if (candidate.robotname) {
				this.cfg.name = candidate.robotname
			}
		},

		async previewRetention() {
			this.busy = 'retention-preview'
			try {
				const result = await api.retentionPreview()
				this.retention = summarizePrune(result, 'would delete')
			} catch (err) {
				this.report(err.message || 'Retention preview failed', 'error')
			} finally {
				this.busy = null
			}
		},

		async applyRetention() {
			this.busy = 'retention-apply'
			try {
				const result = await api.retentionApply()
				this.retention = summarizePrune(result, 'deleted')
				this.report('Retention prune complete.')
			} catch (err) {
				this.report(err.message || 'Retention prune failed', 'error')
			} finally {
				this.busy = null
			}
		},

		async retrieve() {
			if (!this.cfg.host) {
				this.report('Enter Alfred\'s LAN IP first.', 'warning')
				return
			}
			this.busy = 'onboard'
			this.report('Hold HOME on Alfred until it plays two tones…', 'warning')
			try {
				const result = await api.onboard({ ip: this.cfg.host, host: this.cfg.host, name: this.cfg.name })
				if (result.blid) {
					this.cfg.blid = result.blid
				}
				if (result.password) {
					this.cfg.password = result.password
				}
				this.report(result.error || 'Credentials retrieved — press Save.', result.error ? 'error' : 'success')
			} catch (err) {
				this.report(err.message || 'Credential retrieval failed', 'error')
			} finally {
				this.busy = null
			}
		},

		async test() {
			this.busy = 'connect'
			try {
				const result = await api.connectTest(this.robotId)
				const ok = Boolean(result.connected || result.ok)
				this.report(
					ok ? 'MQTT session established.' : (result.conflict || result.error || 'Not connected'),
					ok ? 'success' : 'error',
				)
			} catch (err) {
				this.report(err.message || 'Connect test failed', 'error')
			} finally {
				this.busy = null
			}
		},
	},
}
</script>
