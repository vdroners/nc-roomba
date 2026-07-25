<template>
  <div class="nc-roomba-panel" data-testid="schedule-week">
    <h3>Weekly schedule</h3>
    <p style="opacity:0.75;font-size:0.85rem">Times are robot-local. Nextcloud server TZ may differ.</p>
    <div class="nc-roomba-week-grid">
      <div v-for="(day, i) in days" :key="day" class="day">
        <strong>{{ day }}</strong>
        <label><input type="checkbox" :checked="week.cycle[i]==='start'" @change="toggle(i, $event)"/> On</label>
        <input type="time" :value="timeValue(i)" @change="setTime(i, $event)" />
      </div>
    </div>
    <p v-if="next">Next: {{ next.day }} {{ next.local_time }} — {{ next.note }}</p>
    <button @click="$emit('save', week)">Save schedule</button>
  </div>
</template>

<script>
const EMPTY = {
  cycle: ['none', 'none', 'none', 'none', 'none', 'none', 'none'],
  h: [9, 9, 9, 9, 9, 9, 9],
  m: [0, 0, 0, 0, 0, 0, 0],
}

export default {
  name: 'ScheduleWeekGrid',
  props: {
    value: { type: Object, default: null },
    next: { type: Object, default: null },
  },
  data() {
    return {
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      week: JSON.parse(JSON.stringify(this.value || EMPTY)),
    }
  },
  watch: {
    value: {
      deep: true,
      handler(v) {
        if (v) this.week = JSON.parse(JSON.stringify(v))
      },
    },
  },
  methods: {
    toggle(i, e) {
      this.$set(this.week.cycle, i, e.target.checked ? 'start' : 'none')
    },
    timeValue(i) {
      const h = String(this.week.h[i] ?? 9).padStart(2, '0')
      const m = String(this.week.m[i] ?? 0).padStart(2, '0')
      return `${h}:${m}`
    },
    setTime(i, e) {
      const [h, m] = e.target.value.split(':').map(Number)
      this.$set(this.week.h, i, h)
      this.$set(this.week.m, i, m)
    },
  },
}
</script>
