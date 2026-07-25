import Vue from 'vue'
import { createPinia, PiniaVuePlugin } from 'pinia'
import App from './App.vue'

try {
  // eslint-disable-next-line no-undef
  const { getCSPNonce } = require('@nextcloud/auth')
  // eslint-disable-next-line camelcase, no-undef
  __webpack_nonce__ = getCSPNonce()
} catch (_) {
  // optional
}

Vue.use(PiniaVuePlugin)
const pinia = createPinia()

const el = document.getElementById('nc-roomba-root')
if (el) {
  let bootstrap = {}
  try {
    bootstrap = JSON.parse(el.dataset.bootstrap || '{}')
  } catch (_) {}
  // eslint-disable-next-line no-new
  new Vue({
    pinia,
    render: (h) => h(App, { props: { bootstrap } }),
  }).$mount(el)
}
