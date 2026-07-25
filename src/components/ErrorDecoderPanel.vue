<template>
  <div v-if="show" class="nc-roomba-panel" data-testid="error-decoder">
    <h3>{{ decoded.title }}</h3>
    <p>{{ decoded.detail }}</p>
    <p v-if="decoded.action"><strong>Next step:</strong> {{ decoded.action }}</p>
    <button v-if="conflict" class="secondary" @click="$emit('open-drawer')">Open connection help</button>
  </div>
</template>

<script>
export default {
  name: 'ErrorDecoderPanel',
  props: {
    decoded: { type: Object, default: null },
    conflict: { type: [Boolean, String], default: false },
  },
  computed: {
    show() {
      if (!this.decoded) return false
      if (!this.decoded.code) return false
      if (this.decoded.kind === 'ok' || this.decoded.kind === 'none') return false
      return true
    },
  },
}
</script>
