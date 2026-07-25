'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeState, normalizeBin } = require('../lib/stateNormalizer')

test('normalizeBin', () => {
  assert.equal(normalizeBin({ present: true, full: false }), 'ok')
  assert.equal(normalizeBin({ present: true, full: true }), 'full')
  assert.equal(normalizeBin({ present: false }), 'missing')
})

test('normalizeState has_pose when cap.pose and point present', () => {
  const s = normalizeState({
    batPct: 50,
    bin: { present: true, full: false },
    cap: { pose: 1 },
    pose: { theta: 90, point: { x: 1, y: 2 } },
    cleanMissionStatus: {
      cycle: 'clean',
      phase: 'run',
      error: 0,
      notReady: 0,
    },
  }, { connected: true, bridge_version: '0.1.0', uptime_s: 1 })
  assert.equal(s.has_pose, true)
  assert.equal(s.pose.x, 1)
  assert.equal(s.battery_pct, 50)
  assert.equal(s.connected, true)
})

test('normalizeState has_pose false without capability', () => {
  const s = normalizeState({
    pose: { theta: 90, point: { x: 1, y: 2 } },
    cleanMissionStatus: { cycle: 'none', phase: 'charge' },
  }, { connected: true })
  assert.equal(s.has_pose, false)
})
