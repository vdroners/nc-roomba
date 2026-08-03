/**
 * Butler-themed achievements, derived purely from data the robot already
 * reports — no database, no server writes. Given the lifetime run counters
 * (`bbrun`), lifetime mission counters (`bbmssn`) and the locally-recorded
 * mission list, `evaluateAchievements()` returns a deterministic, testable list
 * of badges with unlock state and progress toward the next tier.
 *
 * Mirrors the format.js / errorDecoder.js convention: presentation-independent
 * logic lives here so the same rules the operator sees are what the unit tests
 * assert.
 */

/**
 * Each definition scores itself from a metrics bag and reports progress toward
 * its threshold. `metric(m)` returns the current value; `goal` is the target.
 *
 * @typedef {object} AchievementDef
 * @property {string} id
 * @property {string} title
 * @property {string} blurb
 * @property {string} icon single glyph/emoji shown on the badge
 * @property {'bronze'|'silver'|'gold'} tier
 * @property {(m: object) => number} metric
 * @property {number} goal
 * @property {(m: object) => boolean} [gate] extra condition beyond metric>=goal
 */

/** @type {AchievementDef[]} */
const CATALOGUE = [
	// ── Missions ────────────────────────────────────────────────────────────
	{
		id: 'first-sweep', title: 'First Sweep', icon: '🧹', tier: 'bronze',
		// Was "Completed the very first cleaning mission." — untrue on any robot
		// that had already been in service, since this reads the LIFETIME odometer.
		// Alfred arrived with ~1,800 missions behind him; the app never saw a first.
		blurb: 'The mission counter is on the board.',
		metric: (m) => m.missionsTotal, goal: 1,
	},
	{
		id: 'century-club', title: 'Century Club', icon: '💯', tier: 'silver',
		blurb: 'One hundred missions of faithful service.',
		metric: (m) => m.missionsTotal, goal: 100,
	},
	{
		id: 'marathon-maid', title: 'Marathon Maid', icon: '🏅', tier: 'gold',
		blurb: 'A thousand missions and still going.',
		metric: (m) => m.missionsTotal, goal: 1000,
	},

	// ── Run time ────────────────────────────────────────────────────────────
	{
		id: 'ten-hours', title: 'Ten Hours of Service', icon: '⏱️', tier: 'bronze',
		blurb: 'Ten hours on the job.',
		metric: (m) => m.runHours, goal: 10,
	},
	{
		id: 'day-of-duty', title: 'Day of Duty', icon: '🕰️', tier: 'silver',
		blurb: 'A full day — 24 hours — of cleaning.',
		metric: (m) => m.runHours, goal: 24,
	},
	{
		id: 'fortnight-footman', title: 'Fortnight Footman', icon: '🎖️', tier: 'gold',
		blurb: 'Over 500 hours of dutiful labour.',
		metric: (m) => m.runHours, goal: 500,
	},

	// ── Area ────────────────────────────────────────────────────────────────
	{
		id: 'acre-apprentice', title: 'Acre Apprentice', icon: '📐', tier: 'bronze',
		blurb: 'Cleaned 1,000 square feet in total.',
		metric: (m) => m.areaSqft, goal: 1000,
	},
	{
		id: 'estate-keeper', title: 'Estate Keeper', icon: '🏛️', tier: 'silver',
		blurb: 'Cleaned 10,000 square feet in total.',
		metric: (m) => m.areaSqft, goal: 10000,
	},

	// ── Reliability / behaviour ───────────────────────────────────────────────
	{
		id: 'sure-footed', title: 'Sure-Footed', icon: '🦶', tier: 'silver',
		blurb: 'Kept the stuck-rate under one per hour over 50+ hours.',
		// `gate` REPLACES the metric>=goal test, so metric/goal only drive the
		// progress bar. Pointing it at runHours made the bar read a full "925 / 50"
		// beside a locked badge — describing a condition the badge does not use.
		// Score the bar on the thing actually being asked for instead: how close
		// the stuck-rate is to the one-per-hour ceiling, as a percentage.
		metric: (m) => (m.stuckPerHour > 0 ? Math.min(100, Math.round(100 / m.stuckPerHour)) : (m.runHours > 0 ? 100 : 0)),
		goal: 100,
		gate: (m) => m.runHours >= 50 && m.stuckPerHour > 0 && m.stuckPerHour < 1,
	},
	{
		id: 'edge-of-glory', title: 'Edge of Glory', icon: '🪜', tier: 'bronze',
		blurb: 'Ten thousand cliff-sensor saves from a tumble.',
		metric: (m) => m.cliffEvents, goal: 10000,
	},
	{
		id: 'clean-sweep', title: 'Clean Sweep', icon: '✨', tier: 'bronze',
		blurb: 'Finished a mission with no error at all.',
		metric: (m) => m.errorFreeMissions, goal: 1,
	},
	{
		id: 'comeback', title: 'The Comeback', icon: '🔄', tier: 'silver',
		blurb: 'Bounced back with a clean mission right after a failed one.',
		metric: (m) => (m.hasComeback ? 1 : 0), goal: 1,
	},

	// ── Streaks (from recorded mission timestamps) ────────────────────────────
	{
		id: 'streak-3', title: 'Tidy Habit', icon: '🔥', tier: 'bronze',
		blurb: 'Cleaned on three different days.',
		metric: (m) => m.activeDays, goal: 3,
	},
	{
		id: 'streak-7', title: 'Week of White Gloves', icon: '🧤', tier: 'silver',
		blurb: 'Cleaned on seven different days.',
		metric: (m) => m.activeDays, goal: 7,
	},

	// ── More missions (higher + playful tiers) ────────────────────────────────
	{
		id: 'half-century', title: 'Half Century', icon: '🎯', tier: 'bronze',
		blurb: 'Fifty missions down.',
		metric: (m) => m.missionsTotal, goal: 50,
	},
	{
		id: 'five-hundred-club', title: 'Old Faithful', icon: '🛎️', tier: 'silver',
		blurb: 'Five hundred missions of loyal service.',
		metric: (m) => m.missionsTotal, goal: 500,
	},
	{
		id: 'legend', title: 'Household Legend', icon: '👑', tier: 'gold',
		blurb: 'Two thousand missions — a true household legend.',
		metric: (m) => m.missionsTotal, goal: 2000,
	},

	// ── More run time ─────────────────────────────────────────────────────────
	{
		id: 'work-week', title: 'The Full Work Week', icon: '📅', tier: 'silver',
		blurb: 'Forty hours clocked — a proper work week.',
		metric: (m) => m.runHours, goal: 40,
	},
	{
		id: 'thousand-hours', title: 'Master of the House', icon: '🏆', tier: 'gold',
		blurb: 'One thousand hours of service.',
		metric: (m) => m.runHours, goal: 1000,
	},

	// ── More area ─────────────────────────────────────────────────────────────
	{
		id: 'square-shooter', title: 'Square Shooter', icon: '🟦', tier: 'bronze',
		blurb: 'Cleaned 5,000 square feet in total.',
		metric: (m) => m.areaSqft, goal: 5000,
	},
	{
		id: 'ballpark', title: 'Ballpark Figure', icon: '⚾', tier: 'gold',
		blurb: 'Cleaned 50,000 square feet — about an acre and change.',
		metric: (m) => m.areaSqft, goal: 50000,
	},

	// ── Quirky wear-counter milestones (pure fun, real data) ──────────────────
	{
		id: 'scrubbz', title: 'Scrub Life', icon: '🧽', tier: 'bronze',
		blurb: 'A thousand carpet/edge scrubs.',
		metric: (m) => m.scrubs, goal: 1000,
	},
	{
		id: 'daredevil', title: 'Cliff Daredevil', icon: '🧗', tier: 'silver',
		blurb: 'Fifty thousand cliff-sensor saves — lives dangerously, survives every time.',
		metric: (m) => m.cliffEvents, goal: 50000,
	},
	{
		id: 'featherweight', title: 'Featherweight Feet', icon: '🪶', tier: 'gold',
		blurb: 'Twelve thousand gentle wheel picks over the floors.',
		metric: (m) => m.picks, goal: 12000,
	},
	{
		id: 'perfectionist', title: 'The Perfectionist', icon: '💎', tier: 'silver',
		blurb: 'Two hundred and fifty spotless, error-free missions.',
		metric: (m) => m.errorFreeMissions, goal: 250,
	},
	{
		id: 'fortnight-streak', title: 'Clockwork Butler', icon: '⏰', tier: 'gold',
		blurb: 'Cleaned on fourteen different days.',
		metric: (m) => m.activeDays, goal: 14,
	},

	// ── Earned under this app's watch ─────────────────────────────────────────
	// Everything above scores off the robot's lifetime odometer, so on a unit that
	// arrived with ~1,800 missions behind it most of the wall unlocked on the day
	// the app was installed. These four are measured from the install baseline or
	// from missions this app actually recorded, so they move.
	{
		id: 'long-game', title: 'The Long Game', icon: '⌛', tier: 'bronze',
		blurb: 'A single mission lasting twenty-five minutes or more.',
		metric: (m) => m.longestMissionMin, goal: 25,
	},
	{
		id: 'new-management', title: 'Under New Management', icon: '🗝️', tier: 'silver',
		blurb: 'Ten missions completed since Nextcloud began keeping the books.',
		metric: (m) => m.missionsSinceInstall, goal: 10,
	},
	{
		id: 'no-complaints', title: 'No Complaints', icon: '🎩', tier: 'silver',
		blurb: 'Ten recorded missions in a row without a single fault.',
		metric: (m) => m.cleanStreak, goal: 10,
	},
	{
		id: 'night-porter', title: 'Night Porter', icon: '🌙', tier: 'gold',
		blurb: 'Attended to the floors between ten at night and six in the morning.',
		metric: (m) => m.nightMissions, goal: 1,
	},
]

/**
 * @param {number|null|undefined} n
 * @returns {number} finite number or 0
 */
function num(n) {
	const v = Number(n)
	return Number.isFinite(v) ? v : 0
}

/**
 * Reduce the raw robot counters + recorded missions into the flat metric bag
 * the catalogue scores against.
 *
 * @param {object} [input]
 * @param {object} [input.bbrun] lifetime run counters
 * @param {object} [input.bbmssn] lifetime mission counters
 * @param {Array<object>} [input.missions] locally-recorded mission rows
 * @param {object|null} [input.baseline] odometer snapshot taken at install
 * @param {number} [input.localOffsetMin] minutes to add to UTC for local time
 * @returns {object} metric bag
 */
export function achievementMetrics({
	bbrun = {},
	bbmssn = {},
	missions = [],
	baseline = null,
	localOffsetMin = 0,
} = {}) {
	const runHours = num(bbrun.hr) + num(bbrun.min) / 60
	const missionsTotal = num(bbmssn.nMssn) || missions.length
	const stuckPerHour = runHours > 0 ? num(bbrun.nStuck) / runHours : 0

	// Recorded-mission-derived signals (present only once NC has logged some).
	let errorFreeMissions = 0
	let hasComeback = false
	const days = new Set()
	let prevWasError = null
	// Longest run of consecutive fault-free missions, and the running count.
	let cleanStreak = 0
	let currentStreak = 0
	let longestMissionMin = 0
	let nightMissions = 0
	// Missions arrive newest-first; walk oldest-first for the comeback check.
	const chrono = [...missions].reverse()
	for (const m of chrono) {
		const errored = Number(m.error_code || m.error || 0) !== 0
		if (!errored) {
			errorFreeMissions += 1
			currentStreak += 1
			cleanStreak = Math.max(cleanStreak, currentStreak)
			if (prevWasError === true) {
				hasComeback = true
			}
		} else {
			currentStreak = 0
		}
		prevWasError = errored

		// Duration only exists because 0.10.0 started recording it. Null on runs
		// too short to round to a minute, so treat absence as zero, not as a gap.
		longestMissionMin = Math.max(longestMissionMin, num(m.msn_m ?? m.mssn_m))

		const ts = Number(m.started_at)
		if (Number.isFinite(ts) && ts > 0) {
			// LOCAL wall clock, not UTC. `toISOString()` buckets a 17:00 clean in a
			// negative-offset install into the *next* day, and the night shift below
			// would be plain wrong on UTC.
			const local = new Date((ts + num(localOffsetMin) * 60) * 1000)
			days.add(local.toISOString().slice(0, 10))
			const hour = local.getUTCHours() // already shifted, so UTC getters read local
			if (hour >= 22 || hour < 6) {
				nightMissions += 1
			}
		}
	}
	// bbmssn.nMssnOk is the robot's own lifetime "ok" count — a better floor for
	// error-free missions than only what NC has recorded locally.
	errorFreeMissions = Math.max(errorFreeMissions, num(bbmssn.nMssnOk))

	// Missions completed since this app was installed.
	//
	// Prefer the robot's own counter minus its value at install — that counts runs
	// the app may have missed. Fall back to the number of rows we recorded when
	// there is no baseline (a fresh install), and never report a negative if the
	// robot's counter is ever reset below the baseline.
	const baselineMssn = num(baseline && baseline.bbmssn && baseline.bbmssn.nMssn)
	const missionsSinceInstall = baselineMssn > 0
		? Math.max(0, num(bbmssn.nMssn) - baselineMssn)
		: missions.length

	return {
		runHours,
		missionsTotal,
		areaSqft: num(bbrun.sqft),
		stuckPerHour,
		cliffEvents: num(bbrun.nCliffsF) + num(bbrun.nCliffsR),
		scrubs: num(bbrun.nScrubs),
		picks: num(bbrun.nPicks),
		errorFreeMissions,
		hasComeback,
		activeDays: days.size,
		missionsSinceInstall,
		cleanStreak,
		longestMissionMin,
		nightMissions,
	}
}

/**
 * @param {object} [input] same shape as {@link achievementMetrics}
 * @returns {Array<{id:string,title:string,blurb:string,icon:string,tier:string,unlocked:boolean,value:number,goal:number,progress:number}>}
 */
export function evaluateAchievements(input = {}) {
	const m = achievementMetrics(input)
	return CATALOGUE.map((def) => {
		const value = num(def.metric(m))
		const unlocked = def.gate ? def.gate(m) : value >= def.goal
		const progress = def.goal > 0 ? Math.max(0, Math.min(1, value / def.goal)) : (unlocked ? 1 : 0)
		return {
			id: def.id,
			title: def.title,
			blurb: def.blurb,
			icon: def.icon,
			tier: def.tier,
			unlocked,
			value,
			goal: def.goal,
			progress: unlocked ? 1 : progress,
		}
	})
}

/**
 * @param {Array<{unlocked:boolean}>} list result of {@link evaluateAchievements}
 * @returns {{unlocked:number,total:number}} summary for a teaser count
 */
export function achievementSummary(list) {
	const arr = Array.isArray(list) ? list : []
	return { unlocked: arr.filter((a) => a.unlocked).length, total: arr.length }
}
