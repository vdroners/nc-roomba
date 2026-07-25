<template>
  <div>
    <div class="nc-roomba-control-pad" data-testid="control-pad">
      <button @click="run('clean')">Clean</button>
      <button class="secondary" @click="run('spot')">Spot</button>
      <button class="secondary" @click="run('pause')">Pause</button>
      <button class="secondary" @click="run('resume')">Resume</button>
      <button class="danger" @click="askStop">Stop</button>
      <button @click="run('dock')">Dock</button>
      <button class="secondary" @click="run('find')">Find</button>
    </div>
    <div v-if="confirmOpen" class="nc-roomba-dialog-backdrop" data-testid="stop-confirm">
      <div class="nc-roomba-dialog">
        <h3>Stop mission?</h3>
        <p>This ends the current cleaning cycle. Prefer Pause if you want to resume.</p>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end">
          <button class="secondary" @click="confirmOpen=false">Cancel</button>
          <button class="danger" @click="confirmStop">Stop</button>
        </div>
      </div>
    </div>
    <p v-if="msg" style="opacity:0.8">{{ msg }}</p>
  </div>
</template>

<script>
export default {
  name: 'ControlPad',
  props: { disabled: Boolean },
  data() { return { confirmOpen: false, msg: '' } },
  methods: {
    askStop() { this.confirmOpen = true },
    async confirmStop() {
      this.confirmOpen = false
      await this.run('stop')
    },
    async run(action) {
      if (this.disabled) return
      this.msg = `${action}…`
      try {
        await this.$emit('action', action)
        // parent handles; also support promise via listener pattern
        this.$parent.$store && null
        this.msg = `${action} sent`
      } catch (e) {
        this.msg = e.message || 'failed'
      }
    },
  },
}
</script>
