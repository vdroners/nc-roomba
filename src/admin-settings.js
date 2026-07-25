import Vue from 'vue'
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

const el = document.getElementById('nc-roomba-admin-root')
if (el) {
  let config = {}
  try { config = JSON.parse(el.dataset.config || '{}') } catch (_) {}
  const robot = config.robot || config.primary || {}
  // eslint-disable-next-line no-new
  new Vue({
    el,
    data() {
      return {
        cfg: {
          name: robot.name || config.name || 'Alfred',
          ip: robot.host || robot.ip || config.ip || '',
          blid: robot.blid || config.blid || '',
          password: '',
          retention_days: config.retention_days || 365,
          bridge_url: config.bridge_url || '',
          operator_group: config.operator_group || 'roomba-operators',
        },
        robotId: robot.id || 1,
        status: '',
        passwordSet: !!(robot.password_set || config.password_set),
      }
    },
    async created() {
      try {
        const base = generateUrl('/apps/nc_roomba')
        const { data } = await axios.get(base + '/api/admin/settings')
        if (data.robot) {
          this.cfg.name = data.robot.name || this.cfg.name
          this.cfg.ip = data.robot.host || this.cfg.ip
          this.cfg.blid = data.robot.blid || this.cfg.blid
          this.robotId = data.robot.id || 1
          this.passwordSet = !!data.robot.password_set
        }
        if (data.retention_days != null) this.cfg.retention_days = data.retention_days
        if (data.bridge_url) this.cfg.bridge_url = data.bridge_url
        if (data.operator_group) this.cfg.operator_group = data.operator_group
      } catch (_) {}
    },
    methods: {
      async save() {
        const base = generateUrl('/apps/nc_roomba')
        const payload = {
          name: this.cfg.name,
          host: this.cfg.ip,
          blid: this.cfg.blid,
          retention_days: this.cfg.retention_days,
          bridge_url: this.cfg.bridge_url,
          operator_group: this.cfg.operator_group,
        }
        if (this.cfg.password) payload.password = this.cfg.password
        await axios.put(base + '/api/admin/settings', payload)
        this.status = 'Saved'
        this.cfg.password = ''
      },
      async retrieve() {
        const base = generateUrl('/apps/nc_roomba')
        this.status = 'Hold HOME on Alfred, retrieving…'
        const { data } = await axios.post(base + '/api/admin/onboard', { ip: this.cfg.ip, host: this.cfg.ip })
        if (data.blid) this.cfg.blid = data.blid
        if (data.password) this.cfg.password = data.password
        this.status = data.error || 'Credentials retrieved — click Save'
      },
      async connect() {
        const base = generateUrl('/apps/nc_roomba')
        const { data } = await axios.post(`${base}/api/robots/${this.robotId}/connect-test`)
        this.status = data.ok ? 'Connected' : (data.error || data.conflict || JSON.stringify(data))
      },
    },
    template: `
      <div class="nc-roomba-panel" style="max-width:640px">
        <h2>NC Roomba — Alfred</h2>
        <p>Create a DHCP reservation for Alfred. Operators: group <code>{{ cfg.operator_group }}</code>.</p>
        <p><label>Name <input v-model="cfg.name"/></label></p>
        <p><label>LAN IP <input v-model="cfg.ip"/></label></p>
        <p><label>BLID <input v-model="cfg.blid" style="width:100%"/></label></p>
        <p><label>Password <input v-model="cfg.password" type="password" style="width:100%" :placeholder="passwordSet ? '(encrypted — leave blank to keep)' : ''"/></label></p>
        <p><label>Retention days <input v-model.number="cfg.retention_days" type="number" min="1"/></label></p>
        <p><label>Bridge URL <input v-model="cfg.bridge_url" style="width:100%"/></label></p>
        <p>
          <button @click="retrieve">Retrieve credentials (hold HOME)</button>
          <button @click="save">Save</button>
          <button @click="connect">Test connection</button>
        </p>
        <p>{{ status }}</p>
      </div>
    `,
  })
}
