'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')

const { RobotManager } = require('../lib/robotManager')
const { RETURN_HOME_PHASES, shouldStopBeforeDock } = require('../lib/binFullStop')

/**
 * @param {object} [env]
 * @returns {RobotManager}
 */
function mockManager(env = {}) {
	const manager = new RobotManager(Object.assign({
		ROOMBA_MOCK: '1',
		ROOMBA_MOCK_TICK_MS: '3600000',
		// Keep tests from touching a host /data or the live journal volume.
		ROOMBA_MISSION_LOG: '',
		ROOMBA_BRIDGE_CONFIG: '',
	}, env))
	// An empty ROOMBA_MISSION_LOG still falls through to /data in MissionLog;
	// the config loader treats a falsy path as in-memory, which is what we want.
	manager.connect()
	return manager
}

const base = {
	enabled: true,
	alreadyFired: false,
	bin: 'full',
	phase: 'hmPostMsn',
	cycle: 'clean',
	lastCommand: null,
	lastCommandAt: null,
	missionStartedAt: '2026-11-14T20:00:00.000Z',
}

test('decision: full bin + return-home phases trigger a pause', () => {
	for (const phase of RETURN_HOME_PHASES) {
		assert.equal(shouldStopBeforeDock({ ...base, phase }), true, phase)
	}
})

test('decision: bin ok does not trigger', () => {
	assert.equal(shouldStopBeforeDock({ ...base, bin: 'ok' }), false)
	assert.equal(shouldStopBeforeDock({ ...base, bin: 'missing' }), false)
	assert.equal(shouldStopBeforeDock({ ...base, bin: 'unknown' }), false)
})

test('decision: setting off disables it', () => {
	assert.equal(shouldStopBeforeDock({ ...base, enabled: false }), false)
})

test('decision: already fired this mission does not trigger again', () => {
	assert.equal(shouldStopBeforeDock({ ...base, alreadyFired: true }), false)
})

test('decision: non-return phases never trigger', () => {
	for (const phase of ['run', 'charge', 'pause', 'stop', 'recharge', 'stuck']) {
		assert.equal(shouldStopBeforeDock({ ...base, phase }), false, phase)
	}
})

test('decision: user-initiated dock (cycle dock) is not intercepted', () => {
	assert.equal(shouldStopBeforeDock({ ...base, phase: 'hmUsrDock', cycle: 'dock' }), false)
})

test('decision: user-initiated dock (last command dock this mission) is not intercepted', () => {
	assert.equal(shouldStopBeforeDock({
		...base,
		phase: 'hmUsrDock',
		cycle: 'clean',
		lastCommand: 'dock',
		lastCommandAt: '2026-11-14T20:10:00.000Z',
		missionStartedAt: '2026-11-14T20:00:00.000Z',
	}), false)
})

test('decision: a stale dock from a previous mission does not exempt an auto-return', () => {
	assert.equal(shouldStopBeforeDock({
		...base,
		phase: 'hmPostMsn',
		lastCommand: 'dock',
		lastCommandAt: '2026-11-14T18:00:00.000Z',
		missionStartedAt: '2026-11-14T20:00:00.000Z',
	}), true)
})

test('mock: full bin + auto return-home pauses once', async () => {
	const manager = mockManager()
	await manager.action('clean')
	assert.equal(manager.getState().phase, 'run')

	const state = manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(state.phase, 'pause', 'should pause where it is, not keep heading home')
	assert.equal(state.cycle, 'clean', 'pause must leave the mission resumable / dockable')
	assert.equal(state.bin, 'full')
	assert.equal(state.bin_full_stop.fired, true)
	assert.equal(state.bin_full_stop.enabled, true)
	assert.ok(state.bin_full_stop.seq >= 1)
	assert.equal(manager.lastCommand.action, 'pause')
	assert.equal(manager.lastCommand.reason, 'bin_full_stop_before_dock')

	const seq = state.bin_full_stop.seq
	const at = manager.lastCommand.at
	// A lagged MQTT frame may still say "heading home" after we paused.
	// Must not send a second pause (the latch holds), even if the reported
	// phase is briefly overwritten by that frame.
	manager.applyRawState({ cleanMissionStatus: { phase: 'hmPostMsn' } })
	assert.equal(manager.getState().bin_full_stop.seq, seq, 'must not fire a second event')
	assert.equal(manager.lastCommand.at, at, 'must not send a second pause')
	assert.equal(manager.lastCommand.action, 'pause')
	manager.disconnect()
})

test('mock: hmMidMsn and hmUsrDock with a full bin also pause', async () => {
	for (const phase of ['hmMidMsn', 'hmUsrDock']) {
		const manager = mockManager()
		await manager.action('clean')
		const state = manager.applyRawState({
			bin: { present: true, full: true },
			cleanMissionStatus: { phase },
		})
		assert.equal(state.phase, 'pause', phase)
		assert.equal(state.bin_full_stop.phase, phase)
		manager.disconnect()
	}
})

test('mock: bin ok does not pause on return-home', async () => {
	const manager = mockManager()
	await manager.action('clean')
	const state = manager.applyRawState({
		bin: { present: true, full: false },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(state.phase, 'hmPostMsn')
	assert.equal(state.bin_full_stop.fired, false)
	assert.notEqual(manager.lastCommand.action, 'pause')
	manager.disconnect()
})

test('mock: user-initiated dock after the pause is not intercepted', async () => {
	const manager = mockManager()
	await manager.action('clean')
	manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(manager.getState().phase, 'pause')

	const result = await manager.action('dock')
	assert.equal(result.ok, true)
	const state = manager.getState()
	assert.equal(state.phase, 'hmUsrDock', 'Home must be allowed after the pause, even with a full bin')
	assert.equal(state.bin, 'full')
	assert.equal(manager.lastCommand.action, 'dock')
	manager.disconnect()
})

test('mock: user dock (cycle dock) is not intercepted even if the flag has not fired', async () => {
	const manager = mockManager()
	await manager.action('clean')
	const state = manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmUsrDock', cycle: 'dock' },
	})
	assert.equal(state.phase, 'hmUsrDock')
	assert.equal(state.bin_full_stop.fired, false)
	manager.disconnect()
})

test('mock: setting off disables the intercept', async () => {
	const manager = mockManager()
	const prefs = await manager.setPreferences({ stop_before_dock_when_bin_full: false })
	assert.equal(prefs.stop_before_dock_when_bin_full, false)
	assert.equal(prefs.confirmed, true)

	await manager.action('clean')
	const state = manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(state.phase, 'hmPostMsn')
	assert.equal(state.bin_full_stop.enabled, false)
	assert.equal(state.bin_full_stop.fired, false)
	manager.disconnect()
})

test('mock: setting defaults to on and is returned with preferences', async () => {
	const manager = mockManager()
	const prefs = await manager.getPreferences()
	assert.equal(prefs.stop_before_dock_when_bin_full, true)
	assert.equal(manager.getState().bin_full_stop.enabled, true)
	manager.disconnect()
})

test('mock: a new mission re-arms the once-per-mission latch', async () => {
	const manager = mockManager()
	await manager.action('clean')
	manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(manager.getState().bin_full_stop.fired, true)
	const firstSeq = manager.getState().bin_full_stop.seq

	// End the mission, start a fresh one, and head home with a full bin again.
	await manager.action('stop')
	await manager.action('clean')
	assert.equal(manager.getState().bin_full_stop.fired, false, 'new mission clears the latch')

	const state = manager.applyRawState({
		bin: { present: true, full: true },
		cleanMissionStatus: { phase: 'hmPostMsn' },
	})
	assert.equal(state.phase, 'pause')
	assert.equal(state.bin_full_stop.fired, true)
	assert.ok(state.bin_full_stop.seq > firstSeq)
	manager.disconnect()
})
