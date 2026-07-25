<template>
  <div class="nc-roomba-app-shell">
    <StatusStrip
      :state="state"
      :age-s="ageS"
      :connected="connected"
      :conflict="conflict"
      @open-drawer="$emit('open-drawer')"
    />
    <nav class="nc-roomba-nav">
      <button v-for="t in tabs" :key="t.id" :class="{ active: tab===t.id }" @click="$emit('update:tab', t.id)">{{ t.label }}</button>
    </nav>
    <main class="nc-roomba-main">
      <slot />
    </main>
    <ConnectionHealthDrawer :open="drawerOpen" :state="state" @close="$emit('close-drawer')" />
  </div>
</template>

<script>
import StatusStrip from './StatusStrip.vue'
import ConnectionHealthDrawer from './ConnectionHealthDrawer.vue'

export default {
  name: 'AppShell',
  components: { StatusStrip, ConnectionHealthDrawer },
  props: {
    state: Object,
    ageS: Number,
    connected: Boolean,
    conflict: [Boolean, String],
    drawerOpen: Boolean,
    tab: String,
  },
  data() {
    return {
      tabs: [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'location', label: 'Location' },
        { id: 'history', label: 'History' },
        { id: 'settings', label: 'Settings' },
      ],
    }
  },
}
</script>
