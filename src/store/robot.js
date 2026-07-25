import { defineStore } from 'pinia'
import * as api from '../services/api'

export const useRobotStore = defineStore('robot', {
  state: () => ({
    state: null,
    missions: [],
    selectedMission: null,
    schedule: null,
    preferences: null,
    drawerOpen: false,
    error: null,
    pollTimer: null,
    lastSeenAgeS: 0,
    ageTimer: null,
    bootstrap: {},
  }),
  getters: {
    connected: (s) => !!s.state?.connected,
    conflict: (s) => s.state?.conflict || s.state?.connection_health?.mqtt === 'conflict',
    decodedError: (s) => s.state?.decoded_error || null,
    hints: (s) => s.state?.maintenance_hints || [],
  },
  actions: {
    init(bootstrap) {
      this.bootstrap = bootstrap || {}
      this.refresh()
      this.startPolling()
      this.ageTimer = setInterval(() => {
        const u = this.state?.updated_at
        if (!u) { this.lastSeenAgeS = 0; return }
        const ts = Date.parse(u)
        this.lastSeenAgeS = Number.isNaN(ts) ? 0 : Math.max(0, Math.floor((Date.now() - ts) / 1000))
      }, 1000)
    },
    startPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer)
      this.pollTimer = setInterval(() => this.refresh(), 3000)
    },
    async refresh() {
      try {
        this.state = await api.getState()
        this.error = null
        if (this.state?.connection_health?.mqtt === 'conflict') {
          // keep drawer available
        }
      } catch (e) {
        this.error = e?.response?.data?.error || e.message || 'state failed'
      }
    },
    async doAction(action) {
      const data = await api.postAction(action)
      await this.refresh()
      return data
    },
    async loadMissions() {
      this.missions = await api.getMissions()
    },
    async loadMission(id) {
      this.selectedMission = await api.getMission(id)
    },
    async loadSchedule() {
      this.schedule = await api.getSchedule()
    },
    async saveSchedule(week) {
      this.schedule = await api.setSchedule(week)
    },
    async loadPreferences() {
      this.preferences = await api.getPreferences()
    },
    openDrawer() { this.drawerOpen = true },
    closeDrawer() { this.drawerOpen = false },
  },
})
