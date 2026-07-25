<template>
  <div>
    <h2>Location</h2>
    <div v-if="hasPose" class="nc-roomba-panel">
      <p>Live pose: x={{ pose.x }}, y={{ pose.y }}, θ={{ pose.theta }}</p>
      <div class="nc-roomba-map-fallback">
        <div>
          <div style="width:12px;height:12px;border-radius:50%;background:var(--nc-app-accent);margin:0 auto 0.5rem"></div>
          Map canvas (pose available)
        </div>
      </div>
    </div>
    <div v-else class="nc-roomba-map-fallback" data-testid="location-fallback">
      <div>
        <p><strong>Live map unavailable</strong></p>
        <p>This firmware does not publish pose. Showing phase / last-known status instead.</p>
        <p>Phase: {{ phase }} · Cycle: {{ cycle }}</p>
        <p style="opacity:0.7">Optional floorplan upload can be added in admin for a backdrop.</p>
      </div>
    </div>
  </div>
</template>

<script>
import { useRobotStore } from '../store/robot'

export default {
  name: 'LocationView',
  computed: {
    store() { return useRobotStore() },
    hasPose() { return !!this.store.state?.has_pose },
    pose() { return this.store.state?.pose || {} },
    phase() { return this.store.state?.phase || '—' },
    cycle() { return this.store.state?.cycle || '—' },
  },
}
</script>
