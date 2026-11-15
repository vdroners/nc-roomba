'use strict'

/**
 * Decide whether the bridge should pause the robot before it docks with a
 * full bin — so the operator can empty it somewhere reachable, then press
 * Home to send it to charge.
 *
 * The charging dock on this install sits under a bookshelf, which makes
 * emptying the bin there awkward. The 960 cannot be told to drive to a
 * named spot, so the practical option is: when it starts heading home with
 * a full bin, pause it where it is.
 *
 * Pure decision function: RobotManager applies the pause. Kept free of
 * MQTT / HTTP so the rules can be unit-tested without a manager.
 */

const { BIN_FULL } = require('./stateNormalizer')

/** Raw cleanMissionStatus.phase values that mean the robot is driving home. */
const RETURN_HOME_PHASES = new Set(['hmUsrDock', 'hmPostMsn', 'hmMidMsn'])

/** A user (or the dock button) asked it to go home — never intercept that. */
const USER_DOCK_CYCLE = 'dock'

/**
 * @param {object} input
 * @param {boolean} input.enabled setting is on
 * @param {boolean} input.alreadyFired already paused once this mission
 * @param {string|null} input.bin normalized bin status
 * @param {string|null} input.phase raw mission phase
 * @param {string|null} input.cycle raw mission cycle
 * @param {string|null} [input.lastCommand] last action name the bridge sent
 * @param {string|null} [input.lastCommandAt] ISO timestamp of that action
 * @param {string|null} [input.missionStartedAt] ISO timestamp of this mission
 * @returns {boolean} true when the bridge should send pause
 */
function shouldStopBeforeDock(input = {}) {
	if (!input.enabled || input.alreadyFired) {
		return false
	}
	if (input.bin !== BIN_FULL) {
		return false
	}
	if (!RETURN_HOME_PHASES.has(input.phase)) {
		return false
	}
	// Already held — no need to pause again (and 'pause'/'stop' are not
	// return-home phases anyway; this is belt and braces).
	if (input.phase === 'pause' || input.phase === 'stop') {
		return false
	}
	// cycle: dock is the robot's own "user asked me to go home" errand.
	if (String(input.cycle || '') === USER_DOCK_CYCLE) {
		return false
	}
	// App / API Home: the dock command is recorded before the MQTT phase
	// change lands, so lastCommand already says dock when we see hmUsrDock.
	if (input.lastCommand === 'dock' && commandBelongsToThisMission(input)) {
		return false
	}
	return true
}

/**
 * A stale dock from a previous mission must not exempt a later auto-return.
 *
 * @param {object} input
 * @returns {boolean}
 */
function commandBelongsToThisMission(input) {
	const at = Date.parse(input.lastCommandAt || '')
	if (!Number.isFinite(at)) {
		// No timestamp: treat as current (safer to honour the exemption than
		// to trap the operator mid-Home).
		return true
	}
	const started = Date.parse(input.missionStartedAt || '')
	if (Number.isFinite(started)) {
		return at >= started
	}
	// No mission start (heading home after the journal already closed, or
	// the bridge restarted): honour a recent dock only.
	return Date.now() - at < 5 * 60 * 1000
}

/**
 * Shape stored on the normalized DTO.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {boolean} opts.fired
 * @param {string|null} [opts.at]
 * @param {number|null} [opts.seq]
 * @param {string|null} [opts.phase]
 * @returns {{ enabled: boolean, fired: boolean, at: string|null, seq: number|null, phase: string|null }}
 */
function binFullStopDto(opts = {}) {
	return {
		enabled: Boolean(opts.enabled),
		fired: Boolean(opts.fired),
		at: opts.at || null,
		seq: Number.isFinite(Number(opts.seq)) && Number(opts.seq) > 0 ? Number(opts.seq) : null,
		phase: opts.phase || null,
	}
}

const fs = require('node:fs')
const path = require('node:path')

const CONFIG_DEFAULTS = {
	stop_before_dock_when_bin_full: true,
	bin_full_stop_seq: 0,
	bin_full_stop_fired: false,
	bin_full_stop_at: null,
	bin_full_stop_phase: null,
}

/**
 * Production compose sets ROOMBA_MISSION_LOG=/data/missions.json; the setting
 * lives next to that journal. Unit tests leave both env vars unset so this
 * stays in memory and never writes to a host /data directory.
 *
 * @param {object} env
 * @returns {string|null}
 */
function resolveConfigPath(env = process.env) {
	const explicit = env && env.ROOMBA_BRIDGE_CONFIG
	if (explicit) {
		return explicit
	}
	const log = env && env.ROOMBA_MISSION_LOG
	if (log) {
		return path.join(path.dirname(log), 'bridge-config.json')
	}
	return null
}

/**
 * @param {object} env
 * @param {{ warn?: Function }} [logger]
 * @returns {object}
 */
function loadBridgeConfig(env = process.env, logger = console) {
	const file = resolveConfigPath(env)
	const cfg = { ...CONFIG_DEFAULTS, path: file }
	if (!file) {
		return cfg
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
		if (parsed && typeof parsed === 'object') {
			if (typeof parsed.stop_before_dock_when_bin_full === 'boolean') {
				cfg.stop_before_dock_when_bin_full = parsed.stop_before_dock_when_bin_full
			}
			const seq = Number(parsed.bin_full_stop_seq)
			if (Number.isFinite(seq) && seq >= 0) {
				cfg.bin_full_stop_seq = seq
			}
			cfg.bin_full_stop_fired = parsed.bin_full_stop_fired === true
			cfg.bin_full_stop_at = typeof parsed.bin_full_stop_at === 'string' ? parsed.bin_full_stop_at : null
			cfg.bin_full_stop_phase = typeof parsed.bin_full_stop_phase === 'string' ? parsed.bin_full_stop_phase : null
		}
	} catch (err) {
		if (err && err.code !== 'ENOENT' && logger && typeof logger.warn === 'function') {
			logger.warn(`binFullStop: could not read ${file} (${err.message}); using defaults`)
		}
	}
	return cfg
}

/**
 * Atomic write (tmp + rename) so a crash cannot leave a truncated file.
 *
 * @param {string|null} file
 * @param {object} data
 * @param {{ warn?: Function }} [logger]
 */
function saveBridgeConfig(file, data, logger = console) {
	if (!file) {
		return
	}
	const payload = {
		stop_before_dock_when_bin_full: data.stop_before_dock_when_bin_full !== false,
		bin_full_stop_seq: Number(data.bin_full_stop_seq) || 0,
		bin_full_stop_fired: data.bin_full_stop_fired === true,
		bin_full_stop_at: data.bin_full_stop_at || null,
		bin_full_stop_phase: data.bin_full_stop_phase || null,
	}
	const tmp = `${file}.tmp`
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
		fs.renameSync(tmp, file)
	} catch (err) {
		try { fs.unlinkSync(tmp) } catch { /* ignore */ }
		if (logger && typeof logger.warn === 'function') {
			logger.warn(`binFullStop: could not write ${file} (${err.message})`)
		}
	}
}

module.exports = {
	RETURN_HOME_PHASES,
	USER_DOCK_CYCLE,
	binFullStopDto,
	loadBridgeConfig,
	resolveConfigPath,
	saveBridgeConfig,
	shouldStopBeforeDock,
}
