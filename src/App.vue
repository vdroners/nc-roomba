<template>
  <AppShell
    :state="store.state"
    :age-s="store.lastSeenAgeS"
    :connected="store.connected"
    :conflict="store.conflict"
    :drawer-open="store.drawerOpen"
    :tab="tab"
    @update:tab="tab = $event"
    @open-drawer="store.openDrawer()"
    @close-drawer="store.closeDrawer()"
  >
    <p v-if="!canOperate" class="nc-roomba-panel warn">You need the <code>roomba-operators</code> group (or admin) to control Alfred.</p>
    <DashboardView v-if="tab==='dashboard'" :can-operate="canOperate" @open-drawer="store.openDrawer()" />
    <LocationView v-else-if="tab==='location'" />
    <HistoryView v-else-if="tab==='history'" />
    <SettingsView v-else-if="tab==='settings'" :can-admin="canAdmin" />
  </AppShell>
</template>

<script>
import AppShell from './components/AppShell.vue'
import DashboardView from './views/DashboardView.vue'
import LocationView from './views/LocationView.vue'
import HistoryView from './views/HistoryView.vue'
import SettingsView from './views/SettingsView.vue'
import { useRobotStore } from './store/robot'

export default {
  name: 'App',
  components: { AppShell, DashboardView, LocationView, HistoryView, SettingsView },
  props: { bootstrap: { type: Object, default: () => ({}) } },
  data() { return { tab: 'dashboard' } },
  computed: {
    store() { return useRobotStore() },
    canOperate() { return this.bootstrap.canOperate !== false },
    canAdmin() { return !!(this.bootstrap.is_admin || this.bootstrap.canAdmin) },
  },
  mounted() {
    this.store.init(this.bootstrap)
  },
}
</script>
