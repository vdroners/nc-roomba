<template>
  <div class="nc-roomba-status-strip" data-testid="status-strip">
    <span class="nc-roomba-chip" :class="connected ? 'ok' : 'danger'" @click="$emit('open-drawer')" style="cursor:pointer">
      {{ connected ? 'MQTT up' : 'MQTT down' }}
    </span>
    <span class="nc-roomba-chip" data-field="battery">Battery {{ batteryLabel }}</span>
    <span class="nc-roomba-chip" :class="binClass" data-field="bin">Bin {{ bin }}</span>
    <span class="nc-roomba-chip" data-field="rssi">Wi‑Fi {{ rssiLabel }}</span>
    <span class="nc-roomba-chip" data-field="phase">{{ phase }} / {{ cycle }}</span>
    <span class="nc-roomba-chip" data-field="last-seen">Last seen {{ ageLabel }}</span>
    <span v-if="conflict" class="nc-roomba-chip warn" @click="$emit('open-drawer')" style="cursor:pointer">Conflict</span>
  </div>
</template>

<script>
export default {
  name: 'StatusStrip',
  props: {
    state: { type: Object, default: null },
    ageS: { type: Number, default: 0 },
    conflict: { type: [Boolean, String], default: false },
    connected: { type: Boolean, default: false },
  },
  computed: {
    batteryLabel() {
      const v = this.state?.battery_pct
      return v == null ? '—' : `${v}%`
    },
    bin() { return this.state?.bin || 'unknown' },
    binClass() { return this.bin === 'full' ? 'warn' : (this.bin === 'ok' ? 'ok' : '') },
    rssiLabel() {
      const v = this.state?.rssi
      return v == null ? '—' : `${v} dBm`
    },
    phase() { return this.state?.phase || '—' },
    cycle() { return this.state?.cycle || '—' },
    ageLabel() {
      if (!this.state?.updated_at) return '—'
      if (this.ageS < 5) return 'just now'
      if (this.ageS < 60) return `${this.ageS}s ago`
      return `${Math.floor(this.ageS / 60)}m ago`
    },
  },
}
</script>
