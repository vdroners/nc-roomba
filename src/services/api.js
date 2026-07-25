import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

const base = generateUrl('/apps/nc_roomba')
const RID = 1

export async function getState(robotId = RID) {
  const { data } = await axios.get(`${base}/api/robots/${robotId}/state`)
  return data
}

export async function postAction(action, robotId = RID) {
  const { data } = await axios.post(`${base}/api/robots/${robotId}/action/${action}`)
  return data
}

export async function getMissions(robotId = RID) {
  const { data } = await axios.get(base + '/api/missions', { params: { robot_id: robotId } })
  return data.items || data.missions || []
}

export async function getMission(id) {
  const { data } = await axios.get(`${base}/api/missions/${id}`)
  return data
}

export function exportMissionsUrl(format, robotId = RID) {
  return `${base}/api/missions/export?format=${format}&robot_id=${robotId}`
}

export async function getSchedule(robotId = RID) {
  const { data } = await axios.get(`${base}/api/robots/${robotId}/schedule`)
  return data.week || data
}

export async function setSchedule(week, robotId = RID) {
  const { data } = await axios.put(`${base}/api/robots/${robotId}/schedule`, { week })
  return data.week || data.body || data
}

export async function getPreferences(robotId = RID) {
  const { data } = await axios.get(`${base}/api/robots/${robotId}/preferences`)
  return data.preferences || data
}

export async function setPreferences(prefs, robotId = RID) {
  const { data } = await axios.put(`${base}/api/robots/${robotId}/preferences`, { preferences: prefs })
  return data
}

export async function getAdminSettings() {
  const { data } = await axios.get(base + '/api/admin/settings')
  return data
}

export async function saveAdminSettings(cfg) {
  const { data } = await axios.put(base + '/api/admin/settings', cfg)
  return data
}

export async function onboard(payload) {
  const { data } = await axios.post(base + '/api/admin/onboard', payload)
  return data
}

export async function connectTest(robotId = RID) {
  const { data } = await axios.post(`${base}/api/robots/${robotId}/connect-test`)
  return data
}

export async function discover() {
  const { data } = await axios.post(base + '/api/robots/discover')
  return data
}

export async function retentionPreview() {
  const { data } = await axios.post(base + '/api/admin/retention/dry-run')
  return data
}

export async function retentionApply() {
  const { data } = await axios.post(base + '/api/admin/retention/apply')
  return data
}
