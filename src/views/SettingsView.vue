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
    <div v-if="canAdmin" class="nc-roomba-panel">
      <h3>Retention</h3>
      <p>Default 365 days. Configure in Admin settings.</p>
      <button @click="previewRetention">Preview prune</button>
      <pre v-if="retention" style="font-size:0.8rem">{{ retention }}</pre>
    </div>
    <div v-if="canAdmin" class="nc-roomba-panel">
      <h3>Onboarding</h3>
      <p>Use <strong>Administration → NC Roomba</strong> for DHCP guidance, hold-HOME credential retrieval, and connect test.</p>
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
  data() { return { retention: null } },
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
  },
}
</script>
