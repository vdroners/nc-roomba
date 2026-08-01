'use strict'

/**
 * Mission journal + mission lifecycle.
 *
 * These cover the machinery that makes History trustworthy. Before it existed,
 * Nextcloud reconstructed missions purely from five-minute cron samples — with
 * measured gaps of up to 110 minutes against a 28-minute average mission — so
 * short runs vanished and the rest were mis-dated.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { MissionLog } = require('../lib/missionLog')
const { RobotManager } = require('../lib/robotManager')

function tmpJournal(name) {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ncroomba-')), name)
}

test('journal assigns monotonic seqs and drains with ?since', () => {
	const log = new MissionLog({ path: tmpJournal('a.json') })
	assert.equal(log.summary().next_seq, 1)

	const first = log.append({ cycle: 'clean' })
	const second = log.append({ cycle: 'spot' })
	assert.equal(first.seq, 1)
	assert.equal(second.seq, 2)

	assert.deepEqual(log.since(0).map((r) => r.seq), [1, 2])
	assert.deepEqual(log.since(1).map((r) => r.seq), [2])
	assert.deepEqual(log.since(2).map((r) => r.seq), [])
	assert.equal(log.summary().newest_seq, 2)
})

test('journal survives a restart -- the point of writing it to disk', () => {
	const file = tmpJournal('b.json')
	const first = new MissionLog({ path: file })
	first.append({ cycle: 'clean', started_at: '2026-07-31T10:00:00.000Z' })
	first.append({ cycle: 'clean', started_at: '2026-07-31T12:00:00.000Z' })

	// A `docker compose up --build` is exactly when an in-memory buffer would
	// lose the missions it had not yet handed over.
	const reopened = new MissionLog({ path: file })
	assert.equal(reopened.summary().count, 2)
	assert.equal(reopened.summary().next_seq, 3)
	assert.equal(reopened.append({ cycle: 'spot' }).seq, 3, 'seq continues, never restarts')
})

test('a corrupt journal does not stop the bridge from booting', () => {
	const file = tmpJournal('c.json')
	fs.writeFileSync(file, '{"records": [ truncated…')
	const warnings = []
	const log = new MissionLog({ path: file, logger: { warn: (m) => warnings.push(m) } })

	// Controlling the robot matters more than the journal: start empty and say so.
	assert.equal(log.summary().count, 0)
	assert.equal(warnings.length, 1)
	assert.match(warnings[0], /could not read/)
	assert.equal(log.append({ cycle: 'clean' }).seq, 1)
})

test('journal is bounded so it cannot grow without limit', () => {
	const log = new MissionLog({ path: tmpJournal('d.json'), max: 3 })
	for (let i = 0; i < 10; i += 1) {
		log.append({ cycle: 'clean' })
	}
	const s = log.summary()
	assert.equal(s.count, 3)
	assert.equal(s.newest_seq, 10, 'newest is kept')
	assert.equal(s.oldest_seq, 8, 'oldest are dropped, not the newest')
})

test('a mission is journalled on the running -> idle edge, with real timings', async () => {
	const env = {
		...process.env,
		ROOMBA_MOCK: '1',
		ROOMBA_MOCK_POSE: '1',
		ROOMBA_MISSION_LOG: tmpJournal('e.json'),
		ROOMBA_MOCK_TICK_MS: '50',
	}
	const m = new RobotManager(env)
	m.log = () => {}
	await m.connect()

	assert.equal(m.missionLog.summary().count, 0)
	await m.action('clean')
	assert.equal(m.getState().cycle, 'clean')
	assert.equal(m.missionLog.summary().count, 0, 'not journalled while still running')

	await m.action('stop')
	const records = m.missionLog.since(0)
	assert.equal(records.length, 1, 'journalled exactly once, on the end edge')

	const rec = records[0]
	assert.equal(rec.cycle, 'clean')
	assert.equal(rec.source, 'bridge')
	assert.equal(rec.error_code, 0)
	assert.ok(rec.started_at && rec.ended_at, 'both edges observed')
	assert.ok(
		Date.parse(rec.ended_at) >= Date.parse(rec.started_at),
		'ended_at is not before started_at',
	)
	// Raw and derived are kept apart: a 960 reports sqft/mssnM as 0, which is
	// why the estimates exist. An estimate must never masquerade as measured.
	assert.ok('sqft' in rec && 'sqft_est' in rec)
	assert.ok('mssn_m' in rec && 'mission_m_est' in rec)

	if (m.mockTimer) {
		clearInterval(m.mockTimer)
	}
})

test('a second mission journals separately rather than extending the first', async () => {
	const env = {
		...process.env,
		ROOMBA_MOCK: '1',
		ROOMBA_MISSION_LOG: tmpJournal('f.json'),
		ROOMBA_MOCK_TICK_MS: '50',
	}
	const m = new RobotManager(env)
	m.log = () => {}
	await m.connect()

	await m.action('clean')
	await m.action('stop')
	await m.action('clean')
	await m.action('stop')

	const records = m.missionLog.since(0)
	assert.equal(records.length, 2)
	assert.deepEqual(records.map((r) => r.seq), [1, 2])

	if (m.mockTimer) {
		clearInterval(m.mockTimer)
	}
})

test('the previous mission\'s pose is not carried into the new trail', async () => {
	const env = {
		...process.env,
		ROOMBA_MOCK: '1',
		ROOMBA_MOCK_POSE: '1',
		ROOMBA_MISSION_LOG: tmpJournal('g.json'),
		ROOMBA_MOCK_TICK_MS: '50',
	}
	const m = new RobotManager(env)
	m.log = () => {}
	await m.connect()

	// `raw` is a running merge, so at the instant a mission starts it still holds
	// the *previous* mission's final pose. Appending it produced a trail whose
	// first point was hundreds of centimetres from the second (observed live:
	// (-103,-291) then (0,0)) -- a phantom line across the map plus a stray
	// covered cell that inflated the area estimate.
	m.raw.pose = { theta: 0, point: { x: -103, y: -291 } }
	await m.action('clean')

	const trail = m.getState().pose_trail
	assert.ok(
		!trail.some((p) => p.x === -103 && p.y === -291),
		'the stale pose must not appear in the new mission trail',
	)

	if (m.mockTimer) {
		clearInterval(m.mockTimer)
	}
})
