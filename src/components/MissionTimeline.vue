<template>
  <div class="nc-roomba-panel" data-testid="mission-timeline">
    <h3>Mission timeline</h3>
    <div v-if="phases.length" class="nc-roomba-timeline">
      <span v-for="(p, i) in phases" :key="i" class="band">{{ p.phase }} <small>{{ formatTs(p.ts) }}</small></span>
    </div>
    <p v-else style="opacity:0.7">No phase events yet.</p>
  </div>
</template>

<script>
export default {
  name: 'MissionTimeline',
  props: { phases: { type: Array, default: () => [] } },
  methods: {
    formatTs(ts) {
      if (!ts) return ''
      const d = new Date(ts * 1000)
      return d.toLocaleTimeString()
    },
  },
}
</script>
