'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
	isStale,
	needsAttention,
	normalizeBin,
	normalizeCapabilities,
	normalizeMission,
	normalizeState,
} = require('../lib/stateNormalizer')

/** Trimmed-down capture of a real Roomba 960 `state` payload. */
function raw960(overrides = {}) {
	return {
		name: 'Alfred',
		batPct: 74,
		bin: { present: true, full: false },
		signal: { rssi: -57, snr: 34 },
		cleanMissionStatus: {
			cycle: 'clean',
			phase: 'run',
			initiator: 'localApp',
			nMssn: 41,
			error: 0,
			notReady: 0,
			mssnM: 12,
			sqft: 143,
			expireM: 0,
			rechrgM: 0,
		},
		cap: { pose: 1, carpetBoost: 1, multiPass: 2, edge: 1, binFullDetect: 1, eco: 1 },
		pose: { theta: 92, point: { x: 415, y: -230 } },
		cleanSchedule: {
			cycle: ['none', 'start', 'none', 'none', 'none', 'start', 'none'],
			h: [0, 15, 0, 0, 0, 15, 0],
			m: [0, 0, 0, 0, 0, 0, 0],
		},
		softwareVer: 'v2.4.16-126',
		sku: 'R960020',
		bbrun: { nStuck: 12, nScrubs: 38, hr: 112, min: 24, sqft: 2140 },
		bbmssn: { nMssn: 41, nMssnOk: 37 },
		...overrides,
	}
}

test('normalizeBin covers present / full / missing / unsupported', () => {
	assert.equal(normalizeBin({ present: true, full: false }), 'ok')
	assert.equal(normalizeBin({ present: true, full: true }), 'full')
	assert.equal(normalizeBin({ present: false, full: false }), 'missing')
	// A robot without binFullDetect reports neither flag — say so, do not guess.
	assert.equal(normalizeBin({}), 'unknown')
	assert.equal(normalizeBin(null), 'unknown')
	assert.equal(normalizeBin('nope'), 'unknown')
})

test('normalizeState maps a real 960 payload onto the plan DTO', () => {
	const dto = normalizeState(raw960(), {
		robot_id: 1,
		connected: true,
		updated_at: '2026-07-25T18:00:00.000Z',
		bridge_version: '0.1.1',
		uptime_s: 640,
	})

	assert.equal(dto.robot_id, 1)
	assert.equal(dto.name, 'Alfred')
	assert.equal(dto.connected, true)
	assert.equal(dto.conflict, null)
	assert.equal(dto.battery_pct, 74)
	assert.equal(dto.bin, 'ok')
	assert.equal(dto.rssi, -57)
	assert.equal(dto.phase, 'run')
	assert.equal(dto.phase_label, 'Cleaning')
	assert.equal(dto.cycle, 'clean')
	assert.equal(dto.error, 0)
	assert.equal(dto.not_ready, 0)
	assert.equal(dto.software_version, 'v2.4.16-126')
	assert.equal(dto.sku, 'R960020')
	assert.equal(dto.mission.sqft, 143)
	assert.equal(dto.mission.mssn_m, 12)
	assert.equal(dto.mission.n_mssn, 41)
	assert.equal(dto.bridge.version, '0.1.1')
	assert.equal(dto.bridge.uptime_s, 640)
	assert.deepEqual(dto.schedule.h, [0, 15, 0, 0, 0, 15, 0])
})

test('normalizeState never throws on an empty or hostile payload', () => {
	for (const input of [null, undefined, {}, 'garbage', 42, []]) {
		const dto = normalizeState(input)
		assert.equal(dto.robot_id, 1)
		assert.equal(dto.connected, false)
		assert.equal(dto.battery_pct, null)
		assert.equal(dto.bin, 'unknown')
		assert.equal(dto.phase, null)
		assert.equal(dto.phase_label, null)
		assert.equal(dto.error, 0)
		assert.equal(dto.not_ready, 0)
		assert.equal(dto.has_pose, false)
		assert.equal(dto.schedule, null)
		assert.deepEqual(dto.pose, { x: null, y: null, theta: null })
		assert.equal(typeof dto.updated_at, 'string')
	}
})

test('has_pose requires both the capability and a published point', () => {
	assert.equal(normalizeState(raw960()).has_pose, true)

	// Capability off (Roomba 960 with pose reporting disabled by firmware).
	const noCap = raw960({ cap: { pose: 0 } })
	assert.equal(normalizeState(noCap).has_pose, false, 'no capability means no map')
	// The coordinates are still reported for debugging.
	assert.equal(normalizeState(noCap).pose.x, 415)

	// Capability on but the robot has not published a point yet.
	const noPoint = raw960({ pose: { theta: 0 } })
	assert.equal(normalizeState(noPoint).has_pose, false, 'no point means no map')
})

test('normalizeCapabilities reads the 960 capability matrix', () => {
	const caps = normalizeCapabilities(raw960())
	assert.equal(caps.pose, true)
	assert.equal(caps.carpet_boost, true)
	assert.equal(caps.multi_pass, true, 'multiPass counts supported passes (2 on the 960)')
	assert.equal(caps.edge_clean, true)
	assert.equal(caps.bin_full_detect, true)
	assert.equal(caps.eco, true)
	assert.equal(caps.schedule, true)

	const bare = normalizeCapabilities({})
	assert.equal(bare.pose, false)
	assert.equal(bare.multi_pass, false)
	assert.equal(bare.schedule, false)
})

test('normalizeMission reconstructs started_at from mssnM when untracked', () => {
	const updatedAt = '2026-07-25T18:00:00.000Z'
	const reconstructed = normalizeMission({ mssnM: 20 }, updatedAt, null)
	assert.equal(reconstructed.started_at, '2026-07-25T17:40:00.000Z')

	// A tracked start always wins over the reconstruction.
	const tracked = normalizeMission({ mssnM: 20 }, updatedAt, '2026-07-25T17:30:00.000Z')
	assert.equal(tracked.started_at, '2026-07-25T17:30:00.000Z')

	// Idle robot: nothing to reconstruct.
	assert.equal(normalizeMission({ mssnM: 0 }, updatedAt, null).started_at, null)
	assert.equal(normalizeMission({}, updatedAt, null).started_at, null)
})

test('conflict and mock flags pass through for the health drawer', () => {
	const dto = normalizeState(raw960(), {
		connected: false,
		conflict: 'iRobot app owns the MQTT session',
		mock: true,
	})
	assert.equal(dto.connected, false)
	assert.equal(dto.conflict, 'iRobot app owns the MQTT session')
	assert.equal(dto.mock, true)
	assert.equal(dto.bridge.mock, true)
})

test('active is true only while a cycle is actually running', () => {
	assert.equal(normalizeState(raw960()).active, true)
	const docking = raw960({ cleanMissionStatus: { phase: 'hmPostMsn', cycle: 'clean' } })
	assert.equal(normalizeState(docking).active, true)
	const charging = raw960({ cleanMissionStatus: { phase: 'charge', cycle: 'none' } })
	assert.equal(normalizeState(charging).active, false)
	// Phase says returning but the cycle already closed out.
	const finished = raw960({ cleanMissionStatus: { phase: 'hmUsrDock', cycle: 'none' } })
	assert.equal(normalizeState(finished).active, false)
})

test('needsAttention fires the decoder panel for error and notReady', () => {
	assert.equal(needsAttention(normalizeState(raw960())), false)
	const binFull = raw960({ cleanMissionStatus: { phase: 'stop', cycle: 'clean', error: 18 } })
	assert.equal(needsAttention(normalizeState(binFull)), true)
	const notReady = raw960({ cleanMissionStatus: { phase: 'charge', cycle: 'none', notReady: 16 } })
	assert.equal(needsAttention(normalizeState(notReady)), true)
	assert.equal(needsAttention(null), false)
})

test('isStale grades the sample age and distrusts a missing timestamp', () => {
	const now = Date.parse('2026-07-25T18:00:00.000Z')
	assert.equal(isStale({ updated_at: '2026-07-25T17:59:50.000Z' }, 30_000, now), false)
	assert.equal(isStale({ updated_at: '2026-07-25T17:58:00.000Z' }, 30_000, now), true)
	assert.equal(isStale({}, 30_000, now), true)
	assert.equal(isStale(null, 30_000, now), true)
})

test('normalizeState emits the accumulated pose trail + covered cells', () => {
	const trail = [
		{ x: 0, y: 0, theta: 90, ts: 1 },
		{ x: 25, y: 0, theta: 90, ts: 2 },
		{ x: 50, y: 0, theta: 0, ts: 3 },
	]
	const cells = new Map([['0,0', 4], ['1,0', 2], ['2,0', 1]])
	const dto = normalizeState(raw960(), { pose_trail: trail, covered_cells: cells, cell_cm: 25 })
	assert.equal(dto.pose_trail.length, 3)
	assert.deepEqual(dto.pose_trail[1], { x: 25, y: 0, theta: 90, ts: 2 })
	assert.equal(dto.covered_cells.length, 3)
	// cell "1,0" -> centre (25,0) in cm with dwell 2
	const c = dto.covered_cells.find((v) => v.x === 25 && v.y === 0)
	assert.equal(c.n, 2)
})

test('normalizeMission derives duration + area when the robot reports 0', () => {
	// 960 live: mssnM/sqft are 0 but started_at + swept cells exist.
	const started = '2026-07-26T18:00:00.000Z'
	const updated = '2026-07-26T18:09:00.000Z' // 9 minutes later
	const m = { cycle: 'clean', phase: 'run', mssnM: 0, sqft: 0 }
	// 40 cells * (0.25 m)^2 = 2.5 m^2 -> ~26.9 sq ft
	const dto = normalizeMission(m, updated, started, 40, 25)
	assert.equal(dto.mssn_m, 0) // raw untouched
	assert.equal(dto.sqft, 0) // raw untouched
	assert.equal(dto.mission_m_est, 9)
	assert.equal(dto.sqft_est, 27)
})
