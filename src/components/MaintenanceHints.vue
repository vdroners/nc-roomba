<template>
  <div class="nc-roomba-panel" data-testid="maintenance-hints">
    <h3>Maintenance</h3>
    <ul v-if="normalized.length">
      <li v-for="(h, i) in normalized" :key="i" :class="h.level">
        <strong v-if="h.title">{{ h.title }}:</strong> {{ h.message }}
      </li>
    </ul>
    <p v-else style="opacity:0.7">No maintenance advisories.</p>
    <pre v-if="bbrun && Object.keys(bbrun).length" style="font-size:0.75rem;opacity:0.8">{{ bbrun }}</pre>
  </div>
</template>

<script>
export default {
  name: 'MaintenanceHints',
  props: {
    hints: { type: Array, default: () => [] },
    bbrun: { type: Object, default: () => ({}) },
  },
  computed: {
    normalized() {
      return (this.hints || []).map((h) => ({
        level: h.level || h.severity || 'info',
        title: h.title || '',
        message: h.message || h.detail || h.action || '',
      })).filter((h) => h.message || h.title)
    },
  },
}
</script>
