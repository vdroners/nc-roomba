<template>
  <aside class="nc-roomba-drawer" :class="{ open }" data-testid="connection-drawer">
    <button @click="$emit('close')" style="float:right">Close</button>
    <h3>Connection health</h3>
    <p>MQTT: <strong>{{ mqtt }}</strong></p>
    <p v-if="conflict" class="warn">{{ conflict }}</p>
    <p>Bridge: {{ bridgeVersion }} · uptime {{ uptime }}s</p>
    <p>Last command: {{ lastCommandLabel }}</p>
    <h4>Recovery checklist</h4>
    <ol>
      <li>Close the iRobot mobile app completely.</li>
      <li>Disable other Roomba integrations (Home Assistant, etc.).</li>
      <li>Wait 30 seconds.</li>
      <li>Retry connect from Admin settings.</li>
      <li>Confirm DHCP reservation and <code>nc -zv IP 8883</code>.</li>
    </ol>
  </aside>
</template>

<script>
export default {
  name: 'ConnectionHealthDrawer',
  props: {
    open: Boolean,
    state: { type: Object, default: null },
  },
  computed: {
    mqtt() { return this.state?.connection_health?.mqtt || 'unknown' },
    conflict() { return this.state?.conflict || '' },
    bridgeVersion() { return this.state?.bridge?.version || '—' },
    uptime() { return this.state?.bridge?.uptime_s ?? '—' },
    lastCommandLabel() {
      const c = this.state?.connection_health?.last_command
      if (!c || !c.action) return 'none'
      return `${c.action} → ${c.result} @ ${c.ts || ''}`
    },
  },
}
</script>
