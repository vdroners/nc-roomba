<template>
  <div>
    <h2>Alfred</h2>
    <ControlPad :disabled="!canOperate" @action="onAction" />
    <ErrorDecoderPanel :decoded="decoded" :conflict="!!conflict" @open-drawer="$emit('open-drawer')" />
    <MissionTimeline :phases="livePhases" />
    <MaintenanceHints :hints="hints" :bbrun="bbrun" />
  </div>
</template>

<script>
import ControlPad from '../components/ControlPad.vue'
import ErrorDecoderPanel from '../components/ErrorDecoderPanel.vue'
import MissionTimeline from '../components/MissionTimeline.vue'
import MaintenanceHints from '../components/MaintenanceHints.vue'
import { useRobotStore } from '../store/robot'

export default {
  name: 'DashboardView',
  components: { ControlPad, ErrorDecoderPanel, MissionTimeline, MaintenanceHints },
  props: { canOperate: { type: Boolean, default: true } },
  computed: {
    store() { return useRobotStore() },
    state() { return this.store.state },
    decoded() { return this.state?.decoded_error },
    conflict() { return this.store.conflict },
    hints() { return this.state?.maintenance_hints || [] },
    bbrun() { return this.state?.bbrun || {} },
    livePhases() {
      const phase = this.state?.phase
      if (!phase) return []
      return [{ phase, ts: Math.floor(Date.now() / 1000), cycle: this.state?.cycle }]
    },
  },
  methods: {
    async onAction(action) {
      await this.store.doAction(action)
    },
  },
}
</script>
