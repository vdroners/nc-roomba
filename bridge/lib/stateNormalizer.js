'use strict'

/**
 * Normalized state DTO for NC Roomba.
 *
 * The robot's raw MQTT payload is firmware- and model-specific and changes
 * shape between capability sets. Everything downstream (PHP, Pinia store, every
 * GUI surface) reads only the shape produced here, so unsupported fields are
 * `null` rather than absent.
 *
 * Shape is fixed by docs/plans/nc-roomba-v0.1.0.md ("Normalized state DTO").
 */

const BIN_OK = 'ok'
const BIN_FULL = 'full'
const BIN_MISSING = 'missing'
const BIN_UNKNOWN = 'unknown'

/** Roomba phase -> operator-facing label. */
const PHASE_LABELS = {
	charge: 'Charging',
	run: 'Cleaning',
	evac: 'Emptying',
	stop: 'Stopped',
	stuck: 'Stuck',
	hmMidMsn: 'Returning to dock (mid mission)',
	hmUsrDock: 'Returning to dock',
	hmPostMsn: 'Returning to dock (mission done)',
	new: 'Starting',
	pause: 'Paused',
	recharge: 'Recharging to resume',
	dockend: 'Docked',
	cancelled: 'Cancelled',
}

const ACTIVE_PHASES = new Set(['run', 'evac', 'hmMidMsn', 'hmPostMsn', 'hmUsrDock', 'new'])

/**
 * @param {unknown} value
 * @returns {number|null} finite number or null
 */
function num(value) {
	const n = typeof value === 'string' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * @param {unknown} value
 * @returns {object} plain object (never null) so callers can spread safely
 */
function obj(value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * Bin sensor state. The 960 reports `{ present, full }`; a robot without the
 * `binFullDetect` capability reports neither.
 *
 * @param {unknown} bin raw `bin` object
 * @returns {'ok'|'full'|'missing'|'unknown'}
 */
function normalizeBin(bin) {
	const b = obj(bin)
	if (typeof b.present !== 'boolean' && typeof b.full !== 'boolean') {
		return BIN_UNKNOWN
	}
	if (b.present === false) {
		return BIN_MISSING
	}
	if (b.full === true) {
		return BIN_FULL
	}
	return BIN_OK
}

/**
 * Pose is only meaningful when the robot advertises the `pose` capability AND
 * has published a point. Anything else must report `has_pose: false` so the
 * Location view falls back to last-known / phase text instead of drawing a
 * fake map.
 *
 * @param {object} raw raw robot state
 * @returns {{ has_pose: boolean, pose: { x: number|null, y: number|null, theta: number|null } }}
 */
function normalizePose(raw) {
	const pose = obj(raw.pose)
	const point = obj(pose.point)
	const x = num(point.x)
	const y = num(point.y)
	const theta = num(pose.theta)
	const capable = num(obj(raw.cap).pose) === 1
	const hasPoint = x !== null && y !== null
	return {
		has_pose: Boolean(capable && hasPoint),
		pose: { x, y, theta },
	}
}

/**
 * @param {object} raw raw robot state
 * @returns {object} capability matrix consumed by the UI to hide unsupported controls
 */
function normalizeCapabilities(raw) {
	const cap = obj(raw.cap)
	return {
		pose: num(cap.pose) === 1,
		carpet_boost: num(cap.carpetBoost) === 1,
		// multiPass reports the number of supported passes (2 on the 960), not a
		// boolean, so anything >= 1 means the control is available.
		multi_pass: (num(cap.multiPass) ?? 0) >= 1,
		edge_clean: num(cap.edge) === 1,
		bin_full_detect: num(cap.binFullDetect) === 1,
		schedule: Boolean(raw.cleanSchedule),
		eco: num(cap.eco) === 1,
	}
}

/**
 * @param {object} mission raw `cleanMissionStatus`
 * @param {string} updatedAt ISO timestamp of this sample
 * @param {string|null} startedAt tracked mission start, when the bridge saw it begin
 * @returns {{ started_at: string|null, sqft: number|null, mssn_m: number|null, n_mssn: number|null, initiator: string|null, rechrg_m: number|null }}
 */
function normalizeMission(mission, updatedAt, startedAt, cellCount = 0, cellCm = 25) {
	const m = obj(mission)
	const mssnM = num(m.mssnM)
	let started = startedAt || null
	// No tracked start (bridge restarted mid-mission): reconstruct it from the
	// robot's own elapsed-minutes counter so the timeline still has an origin.
	if (!started && mssnM !== null && mssnM > 0) {
		const base = Date.parse(updatedAt)
		if (Number.isFinite(base)) {
			started = new Date(base - mssnM * 60_000).toISOString()
		}
	}

	// The 960 reports mssnM=0 and sqft=0 live, so derive both (labelled "est."
	// in the UI). Keep the raw fields untouched for when a robot does report.
	let missionMEst = null
	const base = started ? Date.parse(started) : NaN
	const end = Date.parse(updatedAt)
	if (Number.isFinite(base) && Number.isFinite(end) && end >= base) {
		missionMEst = Math.round((end - base) / 60_000)
	}
	// Area from unique swept cells: cellCount × (cellCm cm)² → sq ft. Cell-count
	// dedupes the Roomba's constant re-covering, giving an honest "area cleaned".
	let sqftEst = null
	if (cellCount > 0) {
		const sqM = cellCount * (cellCm / 100) ** 2
		sqftEst = Math.round(sqM * 10.7639)
	}

	return {
		started_at: started,
		sqft: num(m.sqft),
		sqft_est: sqftEst,
		mssn_m: mssnM,
		mission_m_est: missionMEst,
		n_mssn: num(m.nMssn),
		initiator: typeof m.initiator === 'string' ? m.initiator : null,
		rechrg_m: num(m.rechrgM),
	}
}

/**
 * Build the normalized DTO.
 *
 * @param {object|null} raw raw robot state (dorita980 `state` event payload)
 * @param {object} [meta] bridge-side context
 * @param {number} [meta.robot_id] configured robot id (default 1)
 * @param {boolean} [meta.connected] MQTT session up
 * @param {string|null} [meta.conflict] conflict reason (another MQTT client owns the robot)
 * @param {string} [meta.updated_at] ISO timestamp for this sample
 * @param {string|null} [meta.mission_started_at] tracked mission start
 * @param {string} [meta.bridge_version] bridge package version
 * @param {number} [meta.uptime_s] bridge uptime seconds
 * @param {boolean} [meta.mock] mock mode active
 * @param {string|null} [meta.name] robot display name override
 * @returns {object} normalized state DTO
 */
function normalizeState(raw, meta = {}) {
	const state = obj(raw)
	const mission = obj(state.cleanMissionStatus)
	const signal = obj(state.signal)
	const updatedAt = meta.updated_at || new Date().toISOString()
	const { has_pose: hasPose, pose } = normalizePose(state)

	// Pose trail + covered cells (the accumulated "cleaned floor" footprint).
	const cellCm = num(meta.cell_cm) ?? 25
	const trail = Array.isArray(meta.pose_trail) ? meta.pose_trail : []
	const cells = meta.covered_cells instanceof Map ? meta.covered_cells : new Map()
	const coveredCells = [...cells.entries()].map(([k, n]) => {
		const [gx, gy] = k.split(',').map(Number)
		return { x: gx * cellCm, y: gy * cellCm, n }
	})

	return {
		robot_id: num(meta.robot_id) ?? 1,
		name: meta.name || (typeof state.name === 'string' ? state.name : null),
		connected: Boolean(meta.connected),
		conflict: meta.conflict || null,
		mock: Boolean(meta.mock),
		updated_at: updatedAt,
		battery_pct: num(state.batPct),
		bin: normalizeBin(state.bin),
		rssi: num(signal.rssi),
		phase: typeof mission.phase === 'string' ? mission.phase : null,
		phase_label: PHASE_LABELS[mission.phase] || null,
		cycle: typeof mission.cycle === 'string' ? mission.cycle : null,
		active: ACTIVE_PHASES.has(mission.phase) && mission.cycle !== 'none',
		error: num(mission.error) ?? 0,
		not_ready: num(mission.notReady) ?? 0,
		has_pose: hasPose,
		pose,
		pose_trail: trail.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? null, ts: p.ts })),
		covered_cells: coveredCells,
		cell_cm: cellCm,
		mission: normalizeMission(mission, updatedAt, meta.mission_started_at, cells.size, cellCm),
		capabilities: normalizeCapabilities(state),
		software_version: typeof state.softwareVer === 'string' ? state.softwareVer : null,
		sku: typeof state.sku === 'string' ? state.sku : null,
		bbrun: obj(state.bbrun),
		bbmssn: obj(state.bbmssn),
		schedule: state.cleanSchedule ? obj(state.cleanSchedule) : null,
		bridge: {
			version: meta.bridge_version || '0.0.0',
			uptime_s: num(meta.uptime_s) ?? 0,
			mock: Boolean(meta.mock),
		},
	}
}

/**
 * @param {object} dto normalized DTO
 * @param {number} [maxAgeMs] staleness threshold
 * @param {number} [now] epoch ms (injectable for tests)
 * @returns {boolean} true when the sample is too old to trust
 */
function isStale(dto, maxAgeMs = 30_000, now = Date.now()) {
	const ts = Date.parse(obj(dto).updated_at)
	if (!Number.isFinite(ts)) {
		return true
	}
	return now - ts > maxAgeMs
}

/**
 * @param {object} dto normalized DTO
 * @returns {boolean} true when error/notReady demand the decoder panel
 */
function needsAttention(dto) {
	const d = obj(dto)
	return (num(d.error) ?? 0) !== 0 || (num(d.not_ready) ?? 0) !== 0
}

module.exports = {
	ACTIVE_PHASES,
	BIN_FULL,
	BIN_MISSING,
	BIN_OK,
	BIN_UNKNOWN,
	PHASE_LABELS,
	isStale,
	needsAttention,
	normalizeBin,
	normalizeCapabilities,
	normalizeMission,
	normalizePose,
	normalizeState,
}
