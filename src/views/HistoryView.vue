<template>
  <div>
    <h2>History</h2>
    <p>
      <a :href="exportUrl('json')" target="_blank">Export JSON</a> ·
      <a :href="exportUrl('csv')" target="_blank">Export CSV</a>
    </p>
    <ul>
      <li v-for="m in missions" :key="m.id" style="cursor:pointer;margin:0.35rem 0" @click="select(m.id)">
        #{{ m.id }} · {{ m.cycle }} · {{ m.result || m.outcome }} · {{ format(m.started_at) }}
      </li>
    </ul>
    <div v-if="selected">
      <h3>Mission #{{ selected.id }}</h3>
      <MissionTimeline :phases="selected.phases || []" />
      <pre style="font-size:0.75rem">{{ selected }}</pre>
    </div>
  </div>
</template>

<script>
import MissionTimeline from '../components/MissionTimeline.vue'
import { useRobotStore } from '../store/robot'
import { exportMissionsUrl } from '../services/api'

export default {
  name: 'HistoryView',
  components: { MissionTimeline },
  data() { return { selected: null } },
  computed: {
    store() { return useRobotStore() },
    missions() { return this.store.missions },
  },
  async mounted() {
    await this.store.loadMissions()
  },
  methods: {
    exportUrl(fmt) { return exportMissionsUrl(fmt) },
    format(ts) { return ts ? new Date(ts * 1000).toLocaleString() : '' },
    async select(id) {
      await this.store.loadMission(id)
      this.selected = this.store.selectedMission
    },
  },
}
</script>
