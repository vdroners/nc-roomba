'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')

const { ACTIONS, RobotManager } = require('../lib/robotManager')

/**
 * @param {object} [env] extra env
 * @returns {RobotManager} a connected mock-mode manager (ticker disabled)
 */
function mockManager(env = {}) {
	const manager = new RobotManager(Object.assign({ ROOMBA_MOCK: '1', ROOMBA_MOCK_TICK_MS: '3600000' }, env))
	manager.connect()
	return manager
}

test('mock mode connects without credentials and reports health', () => {
	const manager = mockManager()
	const health = manager.health()
	assert.equal(health.connected, true)
	assert.equal(health.mock, true)
	assert.equal(health.status, 'connected')
	assert.equal(typeof health.version, 'string')
	manager.disconnect()
})

test('real mode refuses to connect without credentials', () => {
	const manager = new RobotManager({ ROOMBA_MOCK: '0' })
	assert.equal(manager.configured, false)
	const health = manager.connect()
	assert.equal(health.connected, false)
	assert.match(health.error, /BLID/)
})

test('mock actions move phase and cycle', async () => {
	const manager = mockManager()
	assert.equal(manager.getState().phase, 'charge')

	await manager.action('clean')
	let state = manager.getState()
	assert.equal(state.phase, 'run')
	assert.equal(state.cycle, 'clean')
	assert.equal(state.active, true)

	await manager.action('pause')
	assert.equal(manager.getState().phase, 'pause')

	await manager.action('resume')
	assert.equal(manager.getState().phase, 'run')

	await manager.action('dock')
	assert.equal(manager.getState().phase, 'hmUsrDock')

	await manager.action('stop')
	state = manager.getState()
	assert.equal(state.phase, 'stop')
	assert.equal(state.cycle, 'none')
	assert.equal(state.active, false)
	manager.disconnect()
})

test('spot starts a spot cycle and find leaves state alone', async () => {
	const manager = mockManager()
	await manager.action('spot')
	assert.equal(manager.getState().cycle, 'spot')

	const before = manager.getState().phase
	const result = await manager.action('find')
	assert.equal(result.ok, true)
	assert.equal(manager.getState().phase, before)
	manager.disconnect()
})

test('unknown actions are rejected with a 400', async () => {
	const manager = mockManager()
	await assert.rejects(() => manager.action('launch'), (err) => err.status === 400)
	manager.disconnect()
})

test('every advertised action has at least one dorita980 method candidate', () => {
	for (const [name, candidates] of Object.entries(ACTIONS)) {
		assert.ok(candidates.length > 0, `${name} has no method candidates`)
	}
	assert.deepEqual(
		Object.keys(ACTIONS).sort(),
		['clean', 'dock', 'find', 'pause', 'resume', 'spot', 'start', 'stop'],
	)
})

test('preferences round-trip through mock mode', async () => {
	const manager = mockManager()
	const initial = await manager.getPreferences()
	assert.equal(initial.carpet_boost, 'auto')
	assert.equal(initial.edge_clean, true)

	const updated = await manager.setPreferences({ carpet_boost: 'performance', edge_clean: false, cleaning_passes: 'two', always_finish: false })
	assert.equal(updated.carpet_boost, 'performance')
	assert.equal(updated.edge_clean, false)
	assert.equal(updated.cleaning_passes, 'two')
	assert.equal(updated.always_finish, false)

	await assert.rejects(() => manager.setPreferences({}), (err) => err.status === 400)
	manager.disconnect()
})

test('schedule round-trips and rejects malformed weeks', async () => {
	const manager = mockManager()
	const week = {
		cycle: ['none', 'start', 'none', 'none', 'none', 'none', 'none'],
		h: [0, 15, 0, 0, 0, 0, 0],
		m: [0, 30, 0, 0, 0, 0, 0],
	}
	const saved = await manager.setSchedule(week)
	assert.deepEqual(saved, week)
	assert.deepEqual(await manager.getSchedule(), week)

	await assert.rejects(() => manager.setSchedule({ cycle: ['none'], h: [0], m: [0] }), (err) => err.status === 400)
	await assert.rejects(
		() => manager.setSchedule({ cycle: ['maybe', 'none', 'none', 'none', 'none', 'none', 'none'], h: [0, 0, 0, 0, 0, 0, 0], m: [0, 0, 0, 0, 0, 0, 0] }),
		(err) => err.status === 400,
	)
	await assert.rejects(
		() => manager.setSchedule({ cycle: ['none', 'none', 'none', 'none', 'none', 'none', 'none'], h: [0, 0, 0, 0, 0, 0, 99], m: [0, 0, 0, 0, 0, 0, 0] }),
		(err) => err.status === 400,
	)
	manager.disconnect()
})

test('bbrun exposes lifetime counters for the maintenance hints', async () => {
	const manager = mockManager()
	const { bbrun, bbmssn } = await manager.getBbrun()
	assert.equal(typeof bbrun.nStuck, 'number')
	assert.equal(typeof bbmssn.nMssn, 'number')
	manager.disconnect()
})

test('discover returns a mock candidate with a blid', async () => {
	const manager = mockManager({ ROBOT_IP: '192.168.1.77', ROOMBA_DISCOVER_SUBNETS: '' })
	// Offline/deterministic: assert mock fallback, not the LAN :8883 sweep.
	const { candidates } = await manager.discover(100, { skip_scan: true, skip_udp: true })
	assert.equal(candidates.length, 1)
	assert.equal(candidates[0].ip, '192.168.1.77')
	assert.ok(candidates[0].blid)
	manager.disconnect()
})

test('mock onboarding returns credentials without touching the network', async () => {
	const manager = mockManager()
	const creds = await manager.getPassword('192.168.1.77')
	assert.equal(creds.ip, '192.168.1.77')
	assert.ok(creds.password.length > 0)
	await assert.rejects(() => manager.getPassword(''), (err) => err.status === 400)
	manager.disconnect()
})

test('subscribers receive a normalized DTO on every action', async () => {
	const manager = mockManager()
	const seen = []
	const unsubscribe = manager.subscribe((dto) => seen.push(dto))
	await manager.action('clean')
	await manager.action('pause')
	unsubscribe()
	await manager.action('stop')

	assert.equal(seen.length, 2, 'unsubscribe must stop the pushes')
	assert.equal(seen[0].phase, 'run')
	assert.equal(seen[1].phase, 'pause')
	assert.ok(seen[0].updated_at)
	manager.disconnect()
})

test('mock ticker advances mission counters while cleaning', async () => {
	const manager = mockManager({ ROOMBA_MOCK_TICK_MS: '10' })
	await manager.action('clean')
	await new Promise((resolve) => setTimeout(resolve, 60))
	const state = manager.getState()
	assert.ok(state.mission.mssn_m > 0, 'mission minutes should advance')
	assert.ok(state.mission.sqft > 0, 'covered area should advance')
	manager.disconnect()
})
