import { describe, expect, it } from 'vitest'

import {
	achievementMetrics,
	achievementSummary,
	evaluateAchievements,
} from '@/utils/achievements.js'

// Alfred's real lifetime counters (Roomba 960, veteran unit) — the feature must
// light up immediately from data the robot already reports.
const ALFRED = {
	bbrun: { hr: 922, min: 39, sqft: 2816, nStuck: 1068, nCliffsF: 57318, nCliffsR: 23089 },
	bbmssn: { nMssn: 1793, nMssnOk: 249, nMssnC: 1037, nMssnF: 507 },
	missions: [],
}

const byId = (list) => Object.fromEntries(list.map((a) => [a.id, a]))

describe('achievements', () => {
	it('reduces raw counters into the metric bag', () => {
		const m = achievementMetrics(ALFRED)
		expect(m.missionsTotal).toBe(1793)
		expect(Math.round(m.runHours)).toBe(923) // 922h39m ≈ 922.65
		expect(m.areaSqft).toBe(2816)
		expect(m.cliffEvents).toBe(57318 + 23089)
		expect(m.errorFreeMissions).toBe(249) // floored by nMssnOk
	})

	it('unlocks the veteran tiers Alfred has earned', () => {
		const a = byId(evaluateAchievements(ALFRED))
		expect(a['first-sweep'].unlocked).toBe(true)
		expect(a['century-club'].unlocked).toBe(true)
		expect(a['marathon-maid'].unlocked).toBe(true) // 1793 >= 1000
		expect(a['day-of-duty'].unlocked).toBe(true)
		expect(a['fortnight-footman'].unlocked).toBe(true) // 922h >= 500
		expect(a['estate-keeper'].unlocked).toBe(false) // 2816 < 10000 sqft
		expect(a['edge-of-glory'].unlocked).toBe(true) // 80k cliff events
		expect(a['clean-sweep'].unlocked).toBe(true) // nMssnOk 249
	})

	it('reports progress for locked achievements', () => {
		const a = byId(evaluateAchievements(ALFRED))
		// Estate Keeper: 2816 / 10000 sqft.
		expect(a['estate-keeper'].unlocked).toBe(false)
		expect(a['estate-keeper'].progress).toBeCloseTo(0.2816, 3)
		expect(a['estate-keeper'].value).toBe(2816)
		expect(a['estate-keeper'].goal).toBe(10000)
	})

	it('gates Sure-Footed on the stuck-rate, not just hours', () => {
		// Alfred: 1068 stuck / ~922h ≈ 1.16/h → above 1, so NOT sure-footed.
		expect(byId(evaluateAchievements(ALFRED))['sure-footed'].unlocked).toBe(false)
		// A tidier robot with the same hours passes the gate.
		const tidy = { bbrun: { hr: 100, nStuck: 20 }, bbmssn: {}, missions: [] }
		expect(byId(evaluateAchievements(tidy))['sure-footed'].unlocked).toBe(true)
	})

	it('derives streak + comeback from recorded mission timestamps', () => {
		const day = (iso) => Math.floor(Date.parse(iso) / 1000)
		const missions = [
			// newest-first, as the store returns them
			{ id: 4, started_at: day('2026-07-25T10:00:00Z'), error_code: 0 },
			{ id: 3, started_at: day('2026-07-24T10:00:00Z'), error_code: 0 }, // clean after error → comeback
			{ id: 2, started_at: day('2026-07-24T08:00:00Z'), error_code: 5 },
			{ id: 1, started_at: day('2026-07-23T10:00:00Z'), error_code: 0 },
		]
		const m = achievementMetrics({ bbmssn: { nMssnOk: 0 }, bbrun: {}, missions })
		expect(m.activeDays).toBe(3)
		expect(m.hasComeback).toBe(true)
		const a = byId(evaluateAchievements({ bbmssn: { nMssnOk: 0 }, bbrun: {}, missions }))
		expect(a['streak-3'].unlocked).toBe(true)
		expect(a['streak-7'].unlocked).toBe(false)
		expect(a['comeback'].unlocked).toBe(true)
	})

	it('unlocks the mission-row badges only once real rows exist', () => {
		// Until the ingest bug was fixed, nc_roomba_missions had zero rows, so
		// every badge derived from recorded missions was permanently locked.
		// (clean-sweep is NOT one of them: errorFreeMissions is floored by the
		// robot's own bbmssn.nMssnOk, so it unlocks with no rows at all.)
		const counters = { bbrun: { hr: 925, min: 17 }, bbmssn: { nMssn: 1803, nMssnOk: 250 } }
		const empty = byId(evaluateAchievements({ ...counters, missions: [] }))
		expect(empty['streak-3'].unlocked).toBe(false)
		expect(empty['streak-7'].unlocked).toBe(false)
		expect(empty['fortnight-streak'].unlocked).toBe(false)
		expect(empty['comeback'].unlocked).toBe(false)
		expect(empty['clean-sweep'].unlocked).toBe(true)

		const DAY = 86400
		const base = Date.parse('2026-07-31T10:00:00Z') / 1000
		const missions = []
		for (let i = 0; i < 16; i++) {
			missions.push({ id: 100 - i, started_at: base - (i * DAY), error_code: i === 5 ? 6 : 0 })
		}
		const filled = byId(evaluateAchievements({ ...counters, missions }))
		expect(filled['streak-3'].unlocked).toBe(true)
		expect(filled['streak-7'].unlocked).toBe(true)
		expect(filled['fortnight-streak'].unlocked).toBe(true)
		expect(filled['comeback'].unlocked).toBe(true)
	})

	it('summarizes unlocked vs total', () => {
		const s = achievementSummary(evaluateAchievements(ALFRED))
		expect(s.total).toBeGreaterThan(10)
		expect(s.unlocked).toBeGreaterThan(0)
		expect(s.unlocked).toBeLessThanOrEqual(s.total)
	})

	it('is safe on empty input', () => {
		const a = evaluateAchievements()
		expect(Array.isArray(a)).toBe(true)
		expect(a.every((x) => x.unlocked === false)).toBe(true)
	})
})

// ── Badges earned under this app's watch ──────────────────────────────────────
// The 26 original badges all score off the robot's lifetime odometer, so on a
// unit that arrived with ~1,800 missions behind it, 16 of them unlocked the day
// the app was installed — including one that claimed to have witnessed "the very
// first cleaning mission". These four measure what the app actually saw.
describe('achievements earned since install', () => {
	const BASELINE = { recorded_at: 1785544241, bbmssn: { nMssn: 1803 }, bbrun: { hr: 925, min: 17 } }
	const find = (list, id) => list.find((a) => a.id === id)

	// Local wall clock, not UTC. -420 = PDT.
	const PDT = -420
	/** @param {string} iso local time, as if it were the robot's clock */
	const localTs = (iso) => Math.floor(Date.parse(iso + 'Z') / 1000) - PDT * 60

	it('scores missions from the install baseline, not the lifetime odometer', () => {
		const m = achievementMetrics({ bbmssn: { nMssn: 1806 }, baseline: BASELINE })
		expect(m.missionsSinceInstall).toBe(3)

		// The badge must stay locked at 3 even though the robot has run 1,806.
		const list = evaluateAchievements({ bbmssn: { nMssn: 1806 }, baseline: BASELINE })
		expect(find(list, 'new-management').unlocked).toBe(false)
		expect(find(list, 'new-management').value).toBe(3)
		// ...while a lifetime badge unlocks off the same input, as before.
		expect(find(list, 'century-club').unlocked).toBe(true)
	})

	it('falls back to recorded rows when there is no baseline', () => {
		// A fresh install has no baseline; count what we recorded rather than
		// crediting the robot's whole history or reporting NaN.
		const missions = [{ started_at: 1, error_code: 0 }, { started_at: 2, error_code: 0 }]
		expect(achievementMetrics({ bbmssn: { nMssn: 1806 }, missions }).missionsSinceInstall).toBe(2)
	})

	it('never reports negative progress if the robot counter is reset below baseline', () => {
		expect(achievementMetrics({ bbmssn: { nMssn: 5 }, baseline: BASELINE }).missionsSinceInstall).toBe(0)
	})

	it('takes the longest single recorded mission for The Long Game', () => {
		const missions = [{ msn_m: 9 }, { msn_m: null }, { msn_m: 31 }, { msn_m: 2 }]
		expect(achievementMetrics({ missions }).longestMissionMin).toBe(31)
		expect(find(evaluateAchievements({ missions }), 'long-game').unlocked).toBe(true)

		// A null duration (run too short to round to a minute) is zero, not a gap.
		expect(achievementMetrics({ missions: [{ msn_m: null }] }).longestMissionMin).toBe(0)
	})

	it('measures the LONGEST fault-free run, not the total', () => {
		// Newest-first, as the API returns them: 3 clean, a fault, then 4 clean.
		const missions = [
			{ error_code: 0 }, { error_code: 0 }, { error_code: 0 }, { error_code: 0 },
			{ error_code: 5 },
			{ error_code: 0 }, { error_code: 0 }, { error_code: 0 },
		]
		const m = achievementMetrics({ missions })
		expect(m.cleanStreak).toBe(4)
		expect(m.errorFreeMissions).toBe(7) // the count differs from the streak
		expect(find(evaluateAchievements({ missions }), 'no-complaints').unlocked).toBe(false)

		const ten = Array.from({ length: 10 }, () => ({ error_code: 0 }))
		expect(find(evaluateAchievements({ missions: ten }), 'no-complaints').unlocked).toBe(true)
	})

	it('detects a night shift in LOCAL time, not UTC', () => {
		// 23:30 local is the next day in UTC at a negative offset — bucketing by
		// UTC would both mis-date the day and miss the night shift entirely.
		const night = [{ started_at: localTs('2026-08-02T23:30:00'), error_code: 0 }]
		const day = [{ started_at: localTs('2026-08-02T09:00:00'), error_code: 0 }]

		expect(achievementMetrics({ missions: night, localOffsetMin: PDT }).nightMissions).toBe(1)
		expect(achievementMetrics({ missions: day, localOffsetMin: PDT }).nightMissions).toBe(0)
		expect(find(evaluateAchievements({ missions: night, localOffsetMin: PDT }), 'night-porter').unlocked).toBe(true)

		// 05:00 local counts; 06:00 does not.
		expect(achievementMetrics({ missions: [{ started_at: localTs('2026-08-02T05:00:00') }], localOffsetMin: PDT }).nightMissions).toBe(1)
		expect(achievementMetrics({ missions: [{ started_at: localTs('2026-08-02T06:00:00') }], localOffsetMin: PDT }).nightMissions).toBe(0)
	})

	it('buckets active days by local date', () => {
		// Two 17:00-local cleans on consecutive local days. Under UTC bucketing at
		// -420 both land on the following UTC day and could collapse or shift.
		const missions = [
			{ started_at: localTs('2026-08-01T17:00:00') },
			{ started_at: localTs('2026-08-02T17:00:00') },
		]
		expect(achievementMetrics({ missions, localOffsetMin: PDT }).activeDays).toBe(2)
	})

	it('keeps Sure-Footed’s progress bar describing its own rule', () => {
		// `gate` replaces the metric>=goal test, so metric/goal only feed the bar.
		// It used to point at runHours, rendering a full "925 / 50" beside a LOCKED
		// badge — a bar describing a condition the badge does not use.
		const busy = evaluateAchievements({ bbrun: { hr: 925, nStuck: 1071 } })
		const sf = find(busy, 'sure-footed')
		expect(sf.unlocked).toBe(false)
		expect(sf.progress).toBeLessThan(1) // no longer a full bar while locked

		const tidy = find(evaluateAchievements({ bbrun: { hr: 100, nStuck: 20 } }), 'sure-footed')
		expect(tidy.unlocked).toBe(true)
	})

	it('leaves all four locked on empty input', () => {
		// Guards the suite-wide invariant: nothing may unlock with no data.
		const list = evaluateAchievements()
		for (const id of ['long-game', 'new-management', 'no-complaints', 'night-porter']) {
			expect(find(list, id).unlocked, id).toBe(false)
			expect(find(list, id).value, id).toBe(0)
		}
	})
})
