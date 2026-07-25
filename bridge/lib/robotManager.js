'use strict'

/**
 * Owns the ONE local MQTT session to the robot.
 *
 * The robot accepts a single MQTT client at a time: if the iRobot phone app is
 * open, our connection is refused (and vice versa). That is the app's #1
 * support footgun, so every refusal is captured as a `conflict` string that the
 * UI surfaces in the connection-health drawer instead of a generic error.
 *
 * `ROOMBA_MOCK=1` swaps the MQTT session for an in-process fake that reacts to
 * the same action names, so the gate suite runs without a robot.
 */

const { EventEmitter } = require('node:events')
const tls = require('node:tls')
const { constants } = require('node:crypto')

const dorita980 = require('dorita980')
const { normalizeState } = require('./stateNormalizer')

const BRIDGE_VERSION = require('../package.json').version

/** Actions the app exposes, mapped to dorita980 local methods (first hit wins). */
const ACTIONS = {
	clean: ['clean', 'start'],
	start: ['start', 'clean'],
	spot: ['spot', 'cleanSpot'],
	pause: ['pause'],
	resume: ['resume'],
	stop: ['stop'],
	dock: ['dock'],
	find: ['find'],
}

/** Mock phase/cycle transitions, keyed by action. */
const MOCK_TRANSITIONS = {
	clean: { phase: 'run', cycle: 'clean' },
	start: { phase: 'run', cycle: 'clean' },
	spot: { phase: 'run', cycle: 'spot' },
	pause: { phase: 'pause' },
	resume: { phase: 'run' },
	stop: { phase: 'stop', cycle: 'none' },
	dock: { phase: 'hmUsrDock' },
	find: {},
}

const CONFLICT_HINTS = [
	'identifier rejected',
	'not authorized',
	'connection refused',
	'econnreset',
]

/**
 * @returns {object} the raw-state seed used by mock mode
 */
function mockSeedState() {
	return {
		name: process.env.ROBOT_NAME || 'Alfred',
		batPct: 86,
		bin: { present: true, full: false },
		signal: { rssi: -52, snr: 38 },
		cleanMissionStatus: {
			cycle: 'none',
			phase: 'charge',
			initiator: '',
			nMssn: 41,
			error: 0,
			notReady: 0,
			mssnM: 0,
			sqft: 0,
			expireM: 0,
			rechrgM: 0,
		},
		// Pose is off by default so the Location fallback path is what the gates
		// exercise; ROOMBA_MOCK_POSE=1 flips the capability on.
		cap: {
			pose: process.env.ROOMBA_MOCK_POSE === '1' ? 1 : 0,
			carpetBoost: 1,
			multiPass: 2,
			edge: 1,
			binFullDetect: 1,
			eco: 1,
		},
		pose: { theta: 90, point: { x: 120, y: -45 } },
		cleanSchedule: {
			cycle: ['none', 'start', 'none', 'none', 'none', 'start', 'none'],
			h: [0, 15, 0, 0, 0, 15, 0],
			m: [0, 0, 0, 0, 0, 0, 0],
		},
		softwareVer: 'v2.4.16-mock',
		sku: 'R960020',
		bbrun: { nStuck: 12, nScrubs: 38, hr: 112, min: 24, sqft: 2140, nPicks: 5 },
		bbmssn: { nMssn: 41, nMssnOk: 37, nMssnC: 2, nMssnF: 1, aMssnM: 52, aCycleM: 48 },
		vacHigh: false,
		carpetBoost: true,
		openOnly: false,
		noAutoPasses: false,
		twoPass: false,
		binPause: false,
	}
}

class RobotManager extends EventEmitter {
	/**
	 * @param {object} [env] environment map (injectable for tests)
	 */
	constructor(env = process.env) {
		super()
		this.env = env
		this.mock = env.ROOMBA_MOCK === '1'
		this.blid = env.BLID || ''
		this.password = env.PASSWORD || ''
		this.ip = env.ROBOT_IP || ''
		this.firmware = Number(env.FIRMWARE_VERSION || 2) === 1 ? 1 : 2
		this.robot = null
		this.raw = this.mock ? mockSeedState() : {}
		this.connected = false
		this.conflict = null
		this.lastError = null
		this.lastCommand = null
		this.missionStartedAt = null
		this.startedAt = Date.now()
		this.updatedAt = new Date().toISOString()
		this.mockTimer = null
		this.mockTick = 0
	}

	/** @returns {boolean} true when credentials are present (or mock mode). */
	get configured() {
		return this.mock || Boolean(this.blid && this.password && this.ip)
	}

	/**
	 * Connect (or reconnect) the single MQTT session.
	 *
	 * @param {object} [creds] optional credential override
	 * @param {string} [creds.blid]
	 * @param {string} [creds.password]
	 * @param {string} [creds.ip]
	 * @returns {{ connected: boolean, mock: boolean, conflict: string|null, error: string|null }}
	 */
	connect(creds = {}) {
		if (creds.blid) {
			this.blid = String(creds.blid)
		}
		if (creds.password) {
			this.password = String(creds.password)
		}
		if (creds.ip) {
			this.ip = String(creds.ip)
		}

		this.disconnect()
		this.conflict = null
		this.lastError = null

		if (this.mock) {
			this.raw = mockSeedState()
			this.connected = true
			this.#startMockLoop()
			this.#publish()
			return this.health()
		}

		if (!this.configured) {
			this.lastError = 'BLID, PASSWORD and ROBOT_IP are required'
			return this.health()
		}

		try {
			this.robot = dorita980.Local(this.blid, this.password, this.ip, this.firmware)
		} catch (err) {
			this.lastError = err && err.message ? err.message : String(err)
			return this.health()
		}

		this.robot.on('connect', () => {
			this.connected = true
			this.conflict = null
			this.#publish()
		})
		this.robot.on('state', (state) => {
			this.#ingest(state)
		})
		this.robot.on('close', () => {
			this.connected = false
			this.#publish()
		})
		this.robot.on('offline', () => {
			this.connected = false
			this.#publish()
		})
		this.robot.on('error', (err) => {
			this.#recordError(err)
		})

		return this.health()
	}

	/** Tear down the MQTT session (or stop the mock loop). */
	disconnect() {
		if (this.mockTimer) {
			clearInterval(this.mockTimer)
			this.mockTimer = null
		}
		if (this.robot) {
			try {
				this.robot.end(true)
			} catch {
				// already closed
			}
			this.robot = null
		}
		this.connected = false
	}

	/**
	 * @returns {object} normalized state DTO
	 */
	getState() {
		return normalizeState(this.raw, {
			robot_id: Number(this.env.ROBOT_ID || 1),
			connected: this.connected,
			conflict: this.conflict,
			mock: this.mock,
			updated_at: this.updatedAt,
			mission_started_at: this.missionStartedAt,
			bridge_version: BRIDGE_VERSION,
			uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
			name: this.env.ROBOT_NAME || null,
		})
	}

	/**
	 * @returns {object} bridge health payload (GET /health)
	 */
	health() {
		return {
			ok: true,
			status: this.connected ? 'connected' : 'disconnected',
			connected: this.connected,
			mock: this.mock,
			configured: this.configured,
			conflict: this.conflict,
			error: this.lastError,
			version: BRIDGE_VERSION,
			uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
			firmware_version: this.firmware,
			robot_ip: this.ip || null,
			blid_present: Boolean(this.blid),
			last_command: this.lastCommand,
			updated_at: this.updatedAt,
		}
	}

	/**
	 * Run one of the supported robot commands.
	 *
	 * @param {string} name action name
	 * @returns {Promise<{ ok: boolean, action: string, phase: string|null, cycle: string|null }>}
	 * @throws {Error} with `.status` 400 (unknown), 501 (unsupported), 409 (conflict), 503 (offline)
	 */
	async action(name) {
		const action = String(name || '').toLowerCase()
		if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
			throw this.#httpError(400, `unknown action "${action}"`)
		}

		if (this.mock) {
			return this.#mockAction(action)
		}

		if (!this.robot) {
			throw this.#httpError(503, 'not connected to the robot')
		}
		if (this.conflict) {
			throw this.#httpError(409, this.conflict)
		}

		const method = ACTIONS[action].find((candidate) => typeof this.robot[candidate] === 'function')
		if (!method) {
			throw this.#httpError(501, `"${action}" is not supported by this robot firmware`)
		}

		try {
			await this.robot[method]()
		} catch (err) {
			this.#recordError(err)
			throw this.#httpError(this.conflict ? 409 : 502, this.conflict || String(err && err.message ? err.message : err))
		}

		this.lastCommand = { action, method, at: new Date().toISOString(), result: 'sent' }
		const mission = this.raw.cleanMissionStatus || {}
		return { ok: true, action, phase: mission.phase || null, cycle: mission.cycle || null }
	}

	/**
	 * @returns {Promise<object>} raw preference block (carpet boost / edge / passes / always finish)
	 */
	async getPreferences() {
		if (!this.mock && this.robot && typeof this.robot.getPreferences === 'function') {
			await this.#refresh(() => this.robot.getPreferences(false))
		}
		return {
			carpet_boost: this.raw.carpetBoost === true ? 'auto' : (this.raw.vacHigh === true ? 'performance' : 'eco'),
			edge_clean: this.raw.openOnly !== true,
			cleaning_passes: this.raw.noAutoPasses !== true ? 'auto' : (this.raw.twoPass === true ? 'two' : 'one'),
			always_finish: this.raw.binPause !== true,
			raw: {
				carpetBoost: this.raw.carpetBoost ?? null,
				vacHigh: this.raw.vacHigh ?? null,
				openOnly: this.raw.openOnly ?? null,
				noAutoPasses: this.raw.noAutoPasses ?? null,
				twoPass: this.raw.twoPass ?? null,
				binPause: this.raw.binPause ?? null,
			},
		}
	}

	/**
	 * @param {object} prefs operator-facing preference patch
	 * @returns {Promise<object>} preferences after the write
	 */
	async setPreferences(prefs = {}) {
		const delta = {}
		if (prefs.carpet_boost === 'auto') {
			Object.assign(delta, { carpetBoost: true, vacHigh: false })
		} else if (prefs.carpet_boost === 'performance') {
			Object.assign(delta, { carpetBoost: false, vacHigh: true })
		} else if (prefs.carpet_boost === 'eco') {
			Object.assign(delta, { carpetBoost: false, vacHigh: false })
		}
		if (typeof prefs.edge_clean === 'boolean') {
			delta.openOnly = !prefs.edge_clean
		}
		if (prefs.cleaning_passes === 'auto') {
			Object.assign(delta, { noAutoPasses: false, twoPass: false })
		} else if (prefs.cleaning_passes === 'one') {
			Object.assign(delta, { noAutoPasses: true, twoPass: false })
		} else if (prefs.cleaning_passes === 'two') {
			Object.assign(delta, { noAutoPasses: true, twoPass: true })
		}
		if (typeof prefs.always_finish === 'boolean') {
			delta.binPause = !prefs.always_finish
		}

		if (Object.keys(delta).length === 0) {
			throw this.#httpError(400, 'no recognised preference in payload')
		}

		if (this.mock) {
			Object.assign(this.raw, delta)
			this.#publish()
			return this.getPreferences()
		}

		if (!this.robot || typeof this.robot.setPreferences !== 'function') {
			throw this.#httpError(503, 'not connected to the robot')
		}
		await this.robot.setPreferences(delta)
		Object.assign(this.raw, delta)
		this.#publish()
		return this.getPreferences()
	}

	/**
	 * @returns {Promise<object>} dorita980 `cleanSchedule` week shape (index 0 = Sunday)
	 */
	async getSchedule() {
		if (!this.mock && this.robot && typeof this.robot.getWeek === 'function') {
			const week = await this.#refresh(() => this.robot.getWeek())
			if (week) {
				this.raw.cleanSchedule = week
			}
		}
		return this.raw.cleanSchedule || { cycle: [], h: [], m: [] }
	}

	/**
	 * @param {object} week `{ cycle: string[7], h: number[7], m: number[7] }`
	 * @returns {Promise<object>} schedule after the write
	 */
	async setSchedule(week) {
		const invalid = this.#validateWeek(week)
		if (invalid) {
			throw this.#httpError(400, invalid)
		}
		if (this.mock) {
			this.raw.cleanSchedule = week
			this.#publish()
			return this.getSchedule()
		}
		if (!this.robot || typeof this.robot.setWeek !== 'function') {
			throw this.#httpError(503, 'not connected to the robot')
		}
		await this.robot.setWeek(week)
		this.raw.cleanSchedule = week
		this.#publish()
		return this.getSchedule()
	}

	/**
	 * @returns {Promise<object>} lifetime run counters used by the maintenance hints
	 */
	async getBbrun() {
		if (!this.mock && this.robot && typeof this.robot.getBbrun === 'function') {
			const bbrun = await this.#refresh(() => this.robot.getBbrun())
			if (bbrun) {
				this.raw.bbrun = bbrun
			}
		}
		return { bbrun: this.raw.bbrun || {}, bbmssn: this.raw.bbmssn || {} }
	}

	/**
	 * LAN discovery (UDP broadcast on :5678).
	 *
	 * @param {number} [timeoutMs]
	 * @returns {Promise<{ candidates: Array<object>, mock: boolean }>}
	 */
	discover(timeoutMs = 6000) {
		if (this.mock) {
			return Promise.resolve({
				candidates: [{
					ip: this.ip || '192.168.1.50',
					hostname: 'Roomba-MOCKBLID000000000000000000',
					blid: this.blid || 'MOCKBLID000000000000000000',
					robotname: 'Alfred',
					sku: 'R960020',
					ver: '3',
				}],
				mock: true,
			})
		}
		return new Promise((resolve) => {
			const candidates = []
			let settled = false
			const finish = () => {
				if (!settled) {
					settled = true
					resolve({ candidates, mock: false })
				}
			}
			const timer = setTimeout(finish, timeoutMs)
			try {
				dorita980.discovery((err, data) => {
					if (!err && data) {
						candidates.push(data)
					}
					clearTimeout(timer)
					finish()
				})
			} catch (err) {
				this.lastError = err && err.message ? err.message : String(err)
				clearTimeout(timer)
				finish()
			}
		})
	}

	/**
	 * Fetch BLID + local password from a robot in onboarding mode (hold HOME
	 * until it beeps, then call this). Mirrors dorita980's `get-roomba-password`
	 * fw2 handshake: a TLS socket on :8883 and the magic probe packet.
	 *
	 * @param {string} ip robot IP
	 * @param {number} [timeoutMs]
	 * @returns {Promise<{ blid: string|null, password: string, ip: string }>}
	 */
	async getPassword(ip, timeoutMs = 12_000) {
		const host = String(ip || this.ip || '').trim()
		if (!host) {
			throw this.#httpError(400, 'ip is required')
		}
		if (this.mock) {
			return { blid: 'MOCKBLID000000000000000000', password: ':1:1700000000:MOCKPASSWORD', ip: host, mock: true }
		}

		const password = await new Promise((resolve, reject) => {
			const options = {
				host,
				port: 8883,
				rejectUnauthorized: false,
				ciphers: process.env.ROBOT_CIPHERS || 'AES128-SHA256,TLS_AES_256_GCM_SHA384',
				timeout: timeoutMs,
			}
			if (constants && constants.SSL_OP_LEGACY_SERVER_CONNECT) {
				options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT
			}
			let sliceFrom = 13
			const socket = tls.connect(options, () => {
				socket.write(Buffer.from('f005efcc3b2900', 'hex'))
			})
			const timer = setTimeout(() => {
				socket.destroy()
				reject(this.#httpError(504, 'timeout waiting for the robot password — hold HOME until it beeps, then retry'))
			}, timeoutMs)
			socket.on('data', (data) => {
				// The robot answers with a 2-byte preamble on some firmwares,
				// which shifts where the password starts.
				if (data.length === 2) {
					sliceFrom = 9
					return
				}
				clearTimeout(timer)
				socket.end()
				if (data.length <= 7) {
					reject(this.#httpError(409, 'robot is not in onboarding mode — hold HOME until it beeps, then retry'))
					return
				}
				resolve(Buffer.from(data).slice(sliceFrom).toString())
			})
			socket.on('error', (err) => {
				clearTimeout(timer)
				reject(this.#httpError(502, err && err.message ? err.message : String(err)))
			})
		})

		const info = await new Promise((resolve) => {
			try {
				const timer = setTimeout(() => resolve(null), 4000)
				dorita980.getRobotPublicInfo(host, (err, data) => {
					clearTimeout(timer)
					resolve(err ? null : data)
				})
			} catch {
				resolve(null)
			}
		})

		return {
			blid: info && info.blid ? info.blid : null,
			password,
			ip: host,
			robotname: info && info.robotname ? info.robotname : null,
			sku: info && info.sku ? info.sku : null,
		}
	}

	/**
	 * Subscribe to normalized state pushes (used by GET /stream).
	 *
	 * @param {(dto: object) => void} listener
	 * @returns {() => void} unsubscribe
	 */
	subscribe(listener) {
		this.on('state', listener)
		return () => this.off('state', listener)
	}

	// ── internals ─────────────────────────────────────────────────────────

	/**
	 * @param {object} state raw robot state
	 */
	#ingest(state) {
		this.raw = Object.assign({}, this.raw, state || {})
		this.connected = true
		this.#trackMission()
		this.#publish()
	}

	/** Track mission start so the timeline has an origin across reconnects. */
	#trackMission() {
		const mission = this.raw.cleanMissionStatus || {}
		const running = mission.cycle && mission.cycle !== 'none'
		if (running && !this.missionStartedAt) {
			this.missionStartedAt = new Date().toISOString()
		} else if (!running) {
			this.missionStartedAt = null
		}
	}

	#publish() {
		this.updatedAt = new Date().toISOString()
		this.emit('state', this.getState())
	}

	/**
	 * @param {unknown} err
	 */
	#recordError(err) {
		const message = err && err.message ? err.message : String(err)
		this.lastError = message
		const lower = message.toLowerCase()
		if (CONFLICT_HINTS.some((hint) => lower.includes(hint))) {
			this.conflict = 'Another client owns the robot\'s single MQTT session (the iRobot app is probably open). '
				+ 'Close it, wait 30 seconds, then retry connect.'
		}
		this.connected = false
		this.#publish()
	}

	/**
	 * dorita980 getters resolve only once the robot has published the field, so
	 * every read is time-boxed — a silent robot must not hang the HTTP request.
	 *
	 * @param {() => Promise<any>} fn
	 * @param {number} [timeoutMs]
	 * @returns {Promise<any|null>}
	 */
	async #refresh(fn, timeoutMs = 5000) {
		try {
			const value = await Promise.race([
				Promise.resolve().then(fn),
				new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
			])
			if (value && typeof value === 'object' && value.cleanMissionStatus) {
				this.raw = Object.assign({}, this.raw, value)
				this.updatedAt = new Date().toISOString()
			}
			return value
		} catch (err) {
			this.#recordError(err)
			return null
		}
	}

	/**
	 * @param {object} week
	 * @returns {string|null} validation error, or null when valid
	 */
	#validateWeek(week) {
		if (!week || typeof week !== 'object') {
			return 'week payload is required'
		}
		for (const key of ['cycle', 'h', 'm']) {
			if (!Array.isArray(week[key]) || week[key].length !== 7) {
				return `week.${key} must be an array of 7 entries (index 0 = Sunday)`
			}
		}
		if (!week.cycle.every((c) => c === 'none' || c === 'start')) {
			return 'week.cycle entries must be "none" or "start"'
		}
		if (!week.h.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) {
			return 'week.h entries must be integers 0-23'
		}
		if (!week.m.every((m) => Number.isInteger(m) && m >= 0 && m <= 59)) {
			return 'week.m entries must be integers 0-59'
		}
		return null
	}

	/**
	 * @param {string} action
	 * @returns {{ ok: boolean, action: string, phase: string|null, cycle: string|null, mock: boolean }}
	 */
	#mockAction(action) {
		const mission = this.raw.cleanMissionStatus
		const next = MOCK_TRANSITIONS[action] || {}
		if (next.phase) {
			mission.phase = next.phase
		}
		if (next.cycle !== undefined) {
			mission.cycle = next.cycle
		} else if (next.phase === 'run' && mission.cycle === 'none') {
			mission.cycle = 'clean'
		}
		if (action === 'clean' || action === 'start' || action === 'spot') {
			mission.mssnM = 0
			mission.sqft = 0
			mission.nMssn += 1
			mission.error = 0
			mission.notReady = 0
			this.missionStartedAt = new Date().toISOString()
		}
		if (action === 'stop') {
			this.missionStartedAt = null
		}
		this.lastCommand = { action, method: 'mock', at: new Date().toISOString(), result: 'sent' }
		this.mockTick = 0
		this.#publish()
		return { ok: true, action, phase: mission.phase, cycle: mission.cycle, mock: true }
	}

	/** Drive the fake robot so state actually moves while gates run. */
	#startMockLoop() {
		const intervalMs = Number(this.env.ROOMBA_MOCK_TICK_MS || 1000)
		this.mockTimer = setInterval(() => {
			const mission = this.raw.cleanMissionStatus
			this.mockTick += 1
			if (mission.phase === 'run') {
				mission.mssnM += 1
				mission.sqft += 7
				if (this.mockTick % 5 === 0 && this.raw.batPct > 5) {
					this.raw.batPct -= 1
				}
			} else if (mission.phase === 'hmUsrDock' || mission.phase === 'hmPostMsn') {
				// Arrive at the dock after a few ticks so dock->charge is observable.
				if (this.mockTick >= 3) {
					mission.phase = 'charge'
					mission.cycle = 'none'
					mission.mssnM = 0
					this.missionStartedAt = null
				}
			} else if (mission.phase === 'charge' && this.raw.batPct < 100) {
				this.raw.batPct += 1
			}
			this.raw.signal.rssi = -50 - (this.mockTick % 12)
			this.#publish()
		}, intervalMs)
		if (typeof this.mockTimer.unref === 'function') {
			this.mockTimer.unref()
		}
	}

	/**
	 * @param {number} status HTTP status
	 * @param {string} message
	 * @returns {Error & { status: number }}
	 */
	#httpError(status, message) {
		const err = new Error(message)
		err.status = status
		return err
	}
}

module.exports = { ACTIONS, MOCK_TRANSITIONS, RobotManager, mockSeedState }
