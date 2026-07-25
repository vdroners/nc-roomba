<template>
  <div>
    <h2>Settings</h2>
    <ScheduleWeekGrid :value="schedule" :next="nextScheduled" @save="saveSchedule" />
    <div class="nc-roomba-panel">
      <h3>Cleaning preferences</h3>
      <p v-if="!preferences">Loading…</p>
      <pre v-else style="font-size:0.8rem">{{ preferences }}</pre>
      <button @click="loadPrefs">Refresh preferences</button>
    </div>

    <div class="nc-roomba-panel" data-testid="auto-discover">
      <h3>Auto discover</h3>
      <p>
        Scans the LAN for Roomba MQTT (:8883). UDP broadcast is tried first; if the
        robot is quiet we TCP-scan the configured subnet (default <code>10.0.0.0/24</code>).
      </p>
      <p>
        <button :disabled="discovering" @click="runDiscover">
          {{ discovering ? 'Scanning…' : 'Auto discover' }}
        </button>
      </p>
      <p v-if="discoverMsg" class="nc-roomba-muted">{{ discoverMsg }}</p>
      <ul v-if="candidates.length" class="nc-roomba-discover-list">
        <li v-for="c in candidates" :key="c.ip">
          <strong>{{ c.robotname || 'Roomba' }}</strong>
          — {{ c.ip }}
          <span v-if="c.blid"> · BLID {{ c.blid }}</span>
          <span v-if="c.sku"> · {{ c.sku }}</span>
          <span v-if="c.source"> · {{ c.source }}</span>
          <button type="button" class="nc-roomba-linkish" @click="selectCandidate(c)">Use</button>
        </li>
      </ul>
      <div v-if="selected" class="nc-roomba-onboard-box">
        <p>
          Selected <strong>{{ selected.robotname || 'Roomba' }}</strong> at
          <code>{{ selected.ip }}</code>
          <span v-if="selected.blid"> (BLID <code>{{ selected.blid }}</code>)</span>.
        </p>
        <p v-if="canAdmin">
          Hold <strong>HOME</strong> on the robot until it beeps, then retrieve credentials:
        </p>
        <p v-if="canAdmin">
          <button :disabled="onboarding" @click="runOnboard">
            {{ onboarding ? 'Retrieving…' : 'Onboard (hold HOME)' }}
          </button>
        </p>
        <p v-else class="nc-roomba-muted">
          Ask an admin to finish onboarding (hold HOME) in Administration → NC Roomba,
          or use the button above if you have admin rights.
        </p>
        <p v-if="onboardMsg">{{ onboardMsg }}</p>
      </div>
    </div>

    <div v-if="canAdmin" class="nc-roomba-panel">
      <h3>Retention</h3>
      <p>Default 365 days. Configure in Admin settings.</p>
      <button @click="previewRetention">Preview prune</button>
      <pre v-if="retention" style="font-size:0.8rem">{{ retention }}</pre>
    </div>
    <div v-if="canAdmin" class="nc-roomba-panel">
      <h3>Admin onboarding</h3>
      <p>
        Full DHCP guidance and encrypted credential storage also live under
        <strong>Administration → NC Roomba</strong>.
      </p>
    </div>
  </div>
</template>

<script>
import ScheduleWeekGrid from '../components/ScheduleWeekGrid.vue'
import { useRobotStore } from '../store/robot'
import * as api from '../services/api'

export default {
  name: 'SettingsView',
  components: { ScheduleWeekGrid },
  props: { canAdmin: Boolean },
  data() {
    return {
      retention: null,
      discovering: false,
      discoverMsg: '',
      candidates: [],
      selected: null,
      onboarding: false,
      onboardMsg: '',
    }
  },
  computed: {
    store() { return useRobotStore() },
    schedule() { return this.store.schedule },
    preferences() { return this.store.preferences },
    nextScheduled() { return this.store.state?.next_scheduled },
  },
  async mounted() {
    try { await this.store.loadSchedule() } catch (_) {}
    try { await this.store.loadPreferences() } catch (_) {}
  },
  methods: {
    async saveSchedule(week) {
      await this.store.saveSchedule(week)
    },
    async loadPrefs() {
      await this.store.loadPreferences()
    },
    async previewRetention() {
      this.retention = await api.retentionPreview()
    },
    async runDiscover() {
      this.discovering = true
      this.discoverMsg = 'Scanning LAN (UDP + :8883)…'
      this.candidates = []
      this.selected = null
      this.onboardMsg = ''
      try {
        const data = await api.discover()
        const list = data.candidates || data.robots || []
        this.candidates = list
        if (!list.length) {
          this.discoverMsg = data.error
            ? `Discover failed: ${data.error}`
            : 'No Roomba found. Confirm Alfred is on Wi‑Fi and try again.'
        } else {
          const src = data.sources ? JSON.stringify(data.sources) : ''
          this.discoverMsg = `Found ${list.length} robot(s)${src ? ` ${src}` : ''}. Click Use, then onboard.`
          const alfred = list.find((c) => String(c.robotname || '').toLowerCase() === 'alfred')
          if (alfred) this.selected = alfred
        }
      } catch (e) {
        this.discoverMsg = e?.response?.data?.error || e?.message || 'Discover failed'
      } finally {
        this.discovering = false
      }
    },
    selectCandidate(c) {
      this.selected = c
      this.onboardMsg = ''
    },
    async runOnboard() {
      if (!this.selected?.ip) return
      this.onboarding = true
      this.onboardMsg = 'Hold HOME until Alfred beeps… retrieving password'
      try {
        const data = await api.onboard({
          ip: this.selected.ip,
          name: this.selected.robotname || 'Alfred',
          blid: this.selected.blid,
        })
        if (data.ok) {
          this.onboardMsg = `Onboarded ${data.robot?.name || 'Alfred'} at ${data.robot?.host || this.selected.ip}`
          try { await this.store.refresh() } catch (_) {}
        } else {
          this.onboardMsg = data.error || 'Onboard failed — hold HOME and retry'
        }
      } catch (e) {
        this.onboardMsg = e?.response?.data?.error || e?.message || 'Onboard failed'
      } finally {
        this.onboarding = false
      }
    },
  },
}
</script>
