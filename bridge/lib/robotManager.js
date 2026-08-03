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
const net = require('node:net')
const os = require('node:os')
const { constants } = require('node:crypto')

// Patch tls.connect for the robot's fw2 TLS stack BEFORE dorita980 loads.
require('./tlsLegacy')
const dorita980 = require('dorita980')
const { normalizeState } = require('./stateNormalizer')
const { WifiHelperClient } = require('./wifiHelperClient')
const { MissionLog } = require('./missionLog')

const BRIDGE_VERSION = require('../package.json').version

/** Pose-trail accumulation (the "cleaned floor" footprint). Pose is in cm. */
const TRAIL_MAX = 2000 // ring-buffer cap on trail points
const TRAIL_MIN_MOVE_CM = 5 // decimate: ignore points closer than this
const CELL_CM = 25 // covered-cell grid size (~robot swath); also the est-area unit

/**
 * `cleanMissionStatus.cycle` values that mean the robot is actually cleaning.
 *
 * It also reports non-cleaning errands here -- `dock` (driving home), `evac`
 * (emptying into a base), `train` (mapping run). Treating "anything but none"
 * as a mission filed a docking manoeuvre as a completed clean, which is how a
 * five-second `cycle: dock` ended up in History with no area.
 */
const CLEANING_CYCLES = new Set(['clean', 'quick', 'spot'])

/**
 * How long a just-written preference is protected from a stale upstream refresh.
 * Comfortably longer than the observed echo latency (<2 s on a real 960), short
 * enough that a value the robot genuinely refused reverts visibly rather than
 * being masked forever.
 */
const LOCAL_WRITE_GRACE_MS = 15_000
/** Budget for waiting on the robot to echo a preference write. */
const PREF_ECHO_TIMEOUT_MS = 8_000
const PREF_ECHO_POLL_MS = 400
const SCHEDULE_ECHO_TIMEOUT_MS = 8_000
const SCHEDULE_ECHO_POLL_MS = 400

/**
 * @param {unknown} value
 * @returns {number|null} a finite number, or null (never NaN, never 0-for-absent)
 */
function numOrNull(value) {
	if (value === null || value === undefined || value === '') {
		return null
	}
	const n = Number(value)
	return Number.isFinite(n) ? n : null
}

/**
 * Actions the app exposes, mapped to dorita980 local methods (first hit wins).
 *
 * Every name here must resolve to a method the installed dorita980 actually
 * implements — see test/robotManager.test.js, which checks this against the
 * real library rather than the mock. `spot` used to be listed
 * (`['spot','cleanSpot']`); dorita980 v2's Local class exposes neither, so the
 * button returned 501 against the real robot every time. The mock implemented
 * it, which is why the test suite never noticed.
 */
const ACTIONS = {
	clean: ['clean', 'start'],
	start: ['start', 'clean'],
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
	pause: { phase: 'pause' },
	resume: { phase: 'run' },
	stop: { phase: 'stop', cycle: 'none' },
	dock: { phase: 'hmUsrDock' },
	find: {},
}

const CONFLICT_HINTS = [
	'identifier rejected',
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
		/** @type {{values:object,at:number}|null} freshly-written prefs (see #noteLocalWrite) */
		this.localWrite = null
		// Mission-scoped pose trail + covered-cell dwell map — reset on new mission.
		this.poseTrail = []
		this.coveredCells = new Map() // "gx,gy" -> dwell count
		// Set on mission start so the previous mission's stale pose (still sitting
		// in the merged `raw`) is not appended as this mission's first point.
		this.poseStale = false
		/** @type {{cycle:string,battery_start:?number,n_mssn_start:?number}|null} */
		this.missionMeta = null
		// Journal of completed missions, drained by Nextcloud via GET /missions.
		this.missionLog = new MissionLog({ logger: { warn: (m) => this.log(m) } })
		this.startedAt = Date.now()
		this.updatedAt = new Date().toISOString()
		this.mockTimer = null
		this.mockTick = 0
		this.wifiHelper = new WifiHelperClient(env)
		/** @type {{phase:string,ok:boolean|null,error:string|null,detail:object|null,updated_at:string}} */
		this.softapStatus = {
			phase: 'idle',
			ok: null,
			error: null,
			detail: null,
			updated_at: new Date().toISOString(),
		}
		this._softapRunning = false
	}

	/**
	 * @param {string} phase
	 * @param {object} [patch]
	 */
	#setSoftapStatus(phase, patch = {}) {
		this.softapStatus = {
			phase,
			ok: patch.ok !== undefined ? patch.ok : this.softapStatus.ok,
			error: patch.error !== undefined ? patch.error : null,
			detail: patch.detail !== undefined ? patch.detail : this.softapStatus.detail,
			updated_at: new Date().toISOString(),
		}
	}

	/** @returns {object} Soft-AP provision progress for UI polling */
	getSoftapStatus() {
		return { ...this.softapStatus }
	}

	/**
	 * Scan for Roomba Soft-AP SSIDs via the host wifi-helper.
	 *
	 * @param {boolean} [roombaOnly]
	 */
	async scanSoftAp(roombaOnly = true) {
		if (this.mock || this.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
			return {
				ok: true,
				mock: true,
				networks: [{
					ssid: 'Roomba-1A2B3C4D5E6F7788',
					bssid: '80:C5:F2:C4:15:DE',
					chan: 1,
					signal: 60,
					security: '--',
				}],
			}
		}
		const result = await this.wifiHelper.scan(roombaOnly)
		return { ok: true, ...result }
	}

	/**
	 * Orchestrate Soft-AP Wi-Fi provision → leave Soft-AP → LAN discover → optional connect.
	 *
	 * @param {object} opts
	 * @param {string} opts.home_ssid
	 * @param {string} opts.home_pass
	 * @param {string} [opts.robot_ssid]
	 * @param {string} [opts.bssid]
	 * @param {string} [opts.blid]
	 * @param {string} [opts.name]
	 * @param {string} [opts.timezone]
	 * @param {string} [opts.country]
	 * @param {number} [opts.localtimeoffset]
	 * @param {boolean} [opts.connect=true]
	 * @param {boolean} [opts.discover=true]
	 */
	async softapProvision(opts = {}) {
		if (this._softapRunning) {
			const err = new Error('softap provision already running')
			err.status = 409
			throw err
		}
		this._softapRunning = true
		this.#setSoftapStatus('starting', { ok: null, error: null, detail: null })

		try {
			const homeSsid = String(opts.home_ssid || opts.ssid || '').trim()
			const homePass = String(opts.home_pass || opts.pass || opts.password || '')
			if (!homeSsid || !homePass) {
				const err = new Error('home_ssid and home_pass are required')
				err.status = 400
				throw err
			}

			let robotSsid = String(opts.robot_ssid || opts.softap_ssid || '').trim()
			let bssid = opts.bssid || ''
			let chan = opts.chan

			this.#setSoftapStatus('scanning')
			if (!robotSsid) {
				const scan = await this.scanSoftAp(true)
				const networks = scan.networks || []
				if (!networks.length) {
					const err = new Error(
						'No Roomba Soft-AP found — put the robot in Soft-AP mode (HOME+SPOT until melody)',
					)
					err.status = 404
					throw err
				}
				robotSsid = networks[0].ssid
				bssid = networks[0].bssid || bssid
				chan = networks[0].chan
			}

			this.#setSoftapStatus('provisioning', { detail: { robot_ssid: robotSsid, home_ssid: homeSsid } })

			let prov
			if (this.mock || this.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
				const blidMatch = robotSsid.match(/^(?:Roomba|iRobot)-([0-9A-Fa-f]{16,})$/i)
				prov = {
					ok: true,
					mock: true,
					blid: (opts.blid || (blidMatch && blidMatch[1]) || '1A2B3C4D5E6F7788').toUpperCase(),
					password: `:1:${Math.floor(Date.now() / 1000)}:mocksoftap00001`,
					steps: ['mock'],
				}
			} else {
				prov = await this.wifiHelper.provision({
					robot_ssid: robotSsid,
					bssid,
					chan,
					ssid: homeSsid,
					pass: homePass,
					blid: opts.blid,
					timezone: opts.timezone || 'America/Los_Angeles',
					country: opts.country || 'US',
					localtimeoffset: opts.localtimeoffset,
					wait_ms: Number(opts.wait_ms || 90_000),
					join: true,
					leave: true,
				})
			}

			const blid = String(prov.blid || '').toUpperCase()
			const password = String(prov.password || '')
			if (!blid || !password) {
				const err = new Error('softap provision returned incomplete credentials')
				err.status = 502
				throw err
			}

			let lanIp = ''
			let candidates = []
			if (opts.discover !== false) {
				this.#setSoftapStatus('discovering', { detail: { blid, robot_ssid: robotSsid } })
				// Robot needs time to associate + DHCP on home Wi-Fi after Soft-AP drops;
				// observed 15-60 s, so poll rather than taking a single shot.
				await new Promise((r) => setTimeout(r, Number(opts.discover_delay_ms || 15_000)))
				const attempts = Number(opts.discover_attempts || 4)
				for (let i = 0; i < attempts; i++) {
					const discovered = await this.discover(Number(opts.discover_timeout_ms || 20_000))
					candidates = discovered.candidates || []
					// Only accept a same-BLID match, or a lone candidate. Picking
					// candidates[0] blind would target a different robot on the LAN.
					const match = candidates.find((c) => String(c.blid || '').toUpperCase() === blid)
						|| (candidates.length === 1 ? candidates[0] : null)
					if (match && match.ip) {
						lanIp = String(match.ip)
						break
					}
					this.#setSoftapStatus('discovering', {
						detail: { blid, robot_ssid: robotSsid, attempt: i + 1, of: attempts },
					})
				}
			}

			let connectHealth = null
			if (opts.connect !== false && lanIp) {
				this.#setSoftapStatus('connecting', { detail: { blid, ip: lanIp } })
				connectHealth = this.connect({
					blid,
					password,
					ip: lanIp,
					name: opts.name,
				})
			} else if (opts.connect !== false && !lanIp) {
				// Stash credentials even without LAN IP so PHP can save them.
				this.blid = blid
				this.password = password
			}

			// The robot's local MQTT password must never reach the status object:
			// getSoftapStatus() is served by the unauthenticated bridge route
			// /onboard/softap-status and mirrored to /api/admin/setup/status, and
			// it lives for the whole process lifetime. It is returned exactly once
			// here, in the provision response, so PHP can persist it.
			const detail = {
				blid,
				ip: lanIp || null,
				robot_ssid: robotSsid,
				home_ssid: homeSsid,
				name: opts.name || (candidates[0] && candidates[0].robotname) || null,
				candidates,
				connect: connectHealth,
				steps: prov.steps || [],
				verified: prov.verified !== false,
				mock: Boolean(prov.mock || this.mock),
				password_returned: true,
			}
			this.#setSoftapStatus('done', { ok: true, error: null, detail })
			return { ok: true, ...detail, password, status: this.getSoftapStatus() }
		} catch (err) {
			this.#setSoftapStatus('error', {
				ok: false,
				error: err && err.message ? err.message : String(err),
			})
			throw err
		} finally {
			this._softapRunning = false
		}
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

		// dorita980 v2 attaches its own `error` listener that rethrows, which
		// turns a benign auth/reconnect error into an uncaught exception that
		// crash-loops the bridge. Drop it and handle errors ourselves.
		this.robot.removeAllListeners('error')

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
			pose_trail: this.poseTrail,
			covered_cells: this.coveredCells,
			cell_cm: CELL_CM,
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
			this.#noteLocalWrite(delta)
			this.#publish()
			return { ...(await this.getPreferences()), confirmed: true }
		}

		if (!this.robot || typeof this.robot.setPreferences !== 'function') {
			throw this.#httpError(503, 'not connected to the robot')
		}

		await this.robot.setPreferences(delta)
		Object.assign(this.raw, delta)
		// Protect the freshly-written keys from being overwritten by dorita980's
		// (still stale) cache on the very next read -- see #noteLocalWrite.
		this.#noteLocalWrite(delta)
		this.#publish()

		// Wait for the robot to echo the change back rather than guessing.
		// Measured on a real 960: the echo lands in well under two seconds.
		const confirmed = await this.#awaitPreferenceEcho(delta)
		return { ...(await this.getPreferences()), confirmed }
	}

	/**
	 * Remember a just-written preference so a stale refresh cannot undo it.
	 *
	 * `dorita980.getPreferences()` does not fetch anything: it resolves as soon as
	 * five always-present keys exist in its own accumulated `robotState` and hands
	 * back that whole cache. Writing a delta does not update that cache -- only the
	 * robot's next state publish does. So the read immediately after a write
	 * returned the PRE-CHANGE values, `#refresh` merged them over the delta we had
	 * just applied, and the app faithfully painted the old setting back. Operators
	 * reported "one pass doesn't save" twice; both previous fixes were in the UI,
	 * which could not win against a data source serving stale values.
	 *
	 * Deliberately narrow: only the keys just written, and only for
	 * LOCAL_WRITE_GRACE_MS. A blanket "local always wins" would also mask a
	 * genuine rejection by the robot, which is the opposite of what we want.
	 *
	 * @param {object} delta the raw robot fields just written
	 */
	#noteLocalWrite(delta) {
		this.localWrite = { values: { ...delta }, at: Date.now() }
	}

	/**
	 * Poll until the robot reports the values we asked for.
	 *
	 * Cannot use `waitPreferences`/`getRobotState` as a wait primitive: they
	 * resolve on a key being *present*, not on it changing, and these keys are
	 * always present. So compare values on each poll instead.
	 *
	 * @param {object} delta the raw robot fields just written
   * @returns {Promise<boolean>} true when the robot confirmed every field
	 */
	async #awaitPreferenceEcho(delta) {
		const deadline = Date.now() + PREF_ECHO_TIMEOUT_MS
		const keys = Object.keys(delta)
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, PREF_ECHO_POLL_MS))
			let live = null
			try {
				live = await this.robot.getRobotState(keys)
			} catch {
				return false
			}
			if (live && keys.every((k) => live[k] === delta[k])) {
				// The robot agrees; the local guard is no longer needed.
				this.localWrite = null
				Object.assign(this.raw, delta)
				this.#publish()
				return true
			}
		}
		return false
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
	 * @returns {Promise<object>} schedule after the write plus `confirmed`
	 */
	async setSchedule(week) {
		const invalid = this.#validateWeek(week)
		if (invalid) {
			throw this.#httpError(400, invalid)
		}
		if (this.mock) {
			this.raw.cleanSchedule = week
			this.#publish()
			return { ...(await this.getSchedule()), confirmed: true }
		}
		if (!this.robot || typeof this.robot.setWeek !== 'function') {
			throw this.#httpError(503, 'not connected to the robot')
		}
		await this.robot.setWeek(week)
		this.raw.cleanSchedule = week
		this.#publish()
		const confirmed = await this.#awaitScheduleEcho(week)
		return { ...(await this.getSchedule()), confirmed }
	}

	/**
	 * Poll until the robot reports the week we asked for.
	 *
	 * @param {object} week dorita980 week shape just written
	 * @returns {Promise<boolean>}
	 */
	async #awaitScheduleEcho(week) {
		const deadline = Date.now() + SCHEDULE_ECHO_TIMEOUT_MS
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, SCHEDULE_ECHO_POLL_MS))
			let live = null
			try {
				live = await this.robot.getWeek()
			} catch {
				return false
			}
			if (live && this.#weeksEqual(live, week)) {
				this.raw.cleanSchedule = live
				this.#publish()
				return true
			}
		}
		return false
	}

	/**
	 * @param {object|null} a
	 * @param {object|null} b
	 * @returns {boolean}
	 */
	#weeksEqual(a, b) {
		if (!a || !b) {
			return false
		}
		for (const key of ['cycle', 'h', 'm']) {
			if (!Array.isArray(a[key]) || !Array.isArray(b[key])) {
				return false
			}
			if (a[key].length !== 7 || b[key].length !== 7) {
				return false
			}
			for (let i = 0; i < 7; i++) {
				if (a[key][i] !== b[key][i]) {
					return false
				}
			}
		}
		return true
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
	 * LAN discovery. UDP broadcast often misses robots on busy Wi‑Fi, so we also
	 * probe hint IPs / ROBOT_IP and TCP-scan configured subnets on :8883, then
	 * call getRobotPublicInfo for each open host.
	 *
	 * Mock MQTT mode still runs a real LAN scan first so Auto Discover can find
	 * Alfred while gates keep using the fake session.
	 *
	 * @param {number} [timeoutMs]
	 * @param {{ ips?: string[], subnets?: string[], skip_scan?: boolean }} [opts]
	 * @returns {Promise<{ candidates: Array<object>, robots: Array<object>, mock: boolean, sources: object }>}
	 */
	async discover(timeoutMs = 8000, opts = {}) {
		const sources = { udp: 0, probe: 0, scan: 0 }
		const byIp = new Map()
		const add = (data, source) => {
			if (!data || !data.ip) return
			const normalized = this.#normalizeDiscovery(data)
			if (!normalized) return
			const prev = byIp.get(normalized.ip) || {}
			byIp.set(normalized.ip, {
				...prev,
				...normalized,
				source: prev.source ? `${prev.source}+${source}` : source,
			})
			sources[source] = (sources[source] || 0) + 1
		}

		// 1) TCP :8883 scan first — works across Docker NAT when UDP broadcast does not.
		if (!opts.skip_scan) {
			const subnets = this.#discoverSubnets(opts.subnets)
			const openIps = await this.#scanPort8883(subnets, 48)
			for (const ip of openIps) {
				const info = await this.#irobotUdpProbe(ip, 2500)
				if (info) add(info, 'scan')
			}
		}

		// 2) Explicit hint / ROBOT_IP probes.
		const hintIps = []
		if (this.ip) hintIps.push(this.ip)
		for (const ip of opts.ips || []) {
			if (ip && !hintIps.includes(ip)) hintIps.push(String(ip).trim())
		}
		for (const ip of hintIps) {
			if (byIp.has(ip)) continue
			const info = await this.#irobotUdpProbe(ip, 2500)
			if (info) add(info, 'probe')
		}

		// 3) UDP broadcast last (collect all replies; always close :5678).
		if (!opts.skip_udp) {
			const udpList = await this.#irobotUdpBroadcast(timeoutMs)
			for (const c of udpList) add(c, 'udp')
		}

		let candidates = [...byIp.values()]
		if (candidates.length === 0 && this.mock) {
			candidates = [{
				ip: this.ip || '192.168.1.50',
				hostname: 'Roomba-MOCKBLID000000000000000000',
				blid: this.blid || 'MOCKBLID000000000000000000',
				robotname: 'Alfred',
				sku: 'R960020',
				ver: '3',
				source: 'mock',
			}]
		}

		return {
			candidates,
			robots: candidates,
			mock: this.mock,
			sources,
		}
	}

	/**
	 * @param {object} data
	 * @returns {object|null}
	 */
	#normalizeDiscovery(data) {
		if (!data || !data.ip) return null
		const hostname = data.hostname || null
		let blid = data.blid || null
		if (!blid && hostname && /^(Roomba|iRobot)-/i.test(hostname)) {
			blid = hostname.split('-').slice(1).join('-')
		}
		return {
			ip: data.ip,
			hostname,
			blid,
			robotname: data.robotname || null,
			sku: data.sku || null,
			ver: data.ver || null,
			mac: data.mac || null,
			sw: data.sw || null,
			cap: data.cap || null,
		}
	}

	/**
	 * Unicast or broadcast irobotmcs probe. Always closes the UDP socket.
	 *
	 * @param {string} targetIp
	 * @param {number} timeoutMs
	 * @returns {Promise<object|null>}
	 */
	#irobotUdpProbe(targetIp, timeoutMs = 2500) {
		const dgram = require('node:dgram')
		return new Promise((resolve) => {
			const server = dgram.createSocket('udp4')
			let done = false
			const finish = (value) => {
				if (done) return
				done = true
				clearTimeout(timer)
				try { server.close() } catch { /* already closed */ }
				resolve(value)
			}
			const timer = setTimeout(() => finish(null), timeoutMs)
			server.on('error', () => finish(null))
			server.on('message', (msg) => {
				try {
					const parsed = JSON.parse(msg.toString())
					const host = parsed.hostname || ''
					if (parsed.ip && (/^Roomba-/i.test(host) || /^iRobot-/i.test(host))) {
						finish(parsed)
					}
				} catch { /* ignore */ }
			})
			server.bind(5678, () => {
				try {
					if (targetIp === '255.255.255.255') server.setBroadcast(true)
					const message = Buffer.from('irobotmcs')
					server.send(message, 0, message.length, 5678, targetIp)
				} catch {
					finish(null)
				}
			})
		})
	}

	/**
	 * Broadcast irobotmcs and collect every Roomba/iRobot reply until timeout.
	 *
	 * @param {number} timeoutMs
	 * @returns {Promise<object[]>}
	 */
	#irobotUdpBroadcast(timeoutMs = 8000) {
		const dgram = require('node:dgram')
		return new Promise((resolve) => {
			const server = dgram.createSocket('udp4')
			const found = []
			const seen = new Set()
			let done = false
			const finish = () => {
				if (done) return
				done = true
				clearTimeout(timer)
				try { server.close() } catch { /* already closed */ }
				resolve(found)
			}
			const timer = setTimeout(finish, timeoutMs)
			server.on('error', () => finish())
			server.on('message', (msg) => {
				try {
					const parsed = JSON.parse(msg.toString())
					const host = parsed.hostname || ''
					if (parsed.ip && (/^Roomba-/i.test(host) || /^iRobot-/i.test(host)) && !seen.has(parsed.ip)) {
						seen.add(parsed.ip)
						found.push(parsed)
					}
				} catch { /* ignore */ }
			})
			server.bind(5678, () => {
				try {
					server.setBroadcast(true)
					const message = Buffer.from('irobotmcs')
					server.send(message, 0, message.length, 5678, '255.255.255.255')
				} catch {
					finish()
				}
			})
		})
	}

	/**
	 * @param {string[]|undefined} override
	 * @returns {string[]} list of "a.b.c" /24 bases
	 */
	#discoverSubnets(override) {
		const bases = new Set()
		const raw = override && override.length
			? override
			: String(this.env.ROOMBA_DISCOVER_SUBNETS || process.env.ROOMBA_DISCOVER_SUBNETS || '')
				.split(/[,\s]+/)
				.filter(Boolean)
		for (const entry of raw) {
			const m = entry.match(/^(\d+\.\d+\.\d+)(?:\.\d+)?(?:\/\d+)?$/)
			if (m) bases.add(m[1])
		}
		for (const addrs of Object.values(os.networkInterfaces())) {
			for (const a of addrs || []) {
				const family = a.family === 'IPv4' || a.family === 4
				if (!family || a.internal) continue
				const parts = a.address.split('.').map(Number)
				// Skip Docker / pod bridges — Roomba lives on the LAN.
				if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue
				bases.add(`${parts[0]}.${parts[1]}.${parts[2]}`)
			}
		}
		return [...bases]
	}

	/**
	 * @param {string[]} bases
	 * @param {number} concurrency
	 * @returns {Promise<string[]>}
	 */
	async #scanPort8883(bases, concurrency = 40) {
		const ips = []
		for (const base of bases) {
			for (let host = 1; host <= 254; host++) {
				ips.push(`${base}.${host}`)
			}
		}
		const open = []
		let i = 0
		const workers = Array.from({ length: Math.min(concurrency, ips.length) }, async () => {
			while (i < ips.length) {
				const ip = ips[i++]
				if (await this.#tcpOpen(ip, 8883, 250)) open.push(ip)
			}
		})
		await Promise.all(workers)
		return open
	}

	/**
	 * @param {string} host
	 * @param {number} port
	 * @param {number} timeoutMs
	 * @returns {Promise<boolean>}
	 */
	#tcpOpen(host, port, timeoutMs) {
		return new Promise((resolve) => {
			const socket = net.connect({ host, port }, () => {
				socket.destroy()
				resolve(true)
			})
			const done = (ok) => {
				socket.destroy()
				resolve(ok)
			}
			socket.setTimeout(timeoutMs, () => done(false))
			socket.on('error', () => done(false))
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
				// Match dorita980 + OpenSSL 3: legacy renegotiation is applied by tlsLegacy.js
				ciphers: process.env.ROBOT_CIPHERS || 'DEFAULT@SECLEVEL=0',
				minVersion: 'TLSv1',
				timeout: timeoutMs,
			}
			if (constants && constants.SSL_OP_LEGACY_SERVER_CONNECT) {
				options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT
			}
			let sliceFrom = 13
			const chunks = []
			const socket = tls.connect(options, () => {
				socket.write(Buffer.from('f005efcc3b2900', 'hex'))
			})
			const timer = setTimeout(() => {
				socket.destroy()
				reject(this.#httpError(504, 'timeout waiting for the robot password — hold HOME until it beeps, then retry'))
			}, timeoutMs)
			const finish = (err, value) => {
				clearTimeout(timer)
				try { socket.end() } catch { /* ignore */ }
				if (err) {
					reject(err)
				} else {
					resolve(value)
				}
			}
			socket.on('data', (data) => {
				const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary')
				// The robot answers with a 2-byte preamble on some firmwares,
				// which shifts where the password starts (dorita980 getpassword.js).
				if (buf.length === 2) {
					sliceFrom = 9
					chunks.push(buf)
					return
				}
				chunks.push(buf)
				const all = Buffer.concat(chunks)
				if (all.length <= 7) {
					finish(this.#httpError(409, 'robot is not in onboarding mode — hold HOME until it beeps, then retry'))
					return
				}
				const extracted = extractRoombaPassword(all, sliceFrom)
				if (!extracted) {
					finish(this.#httpError(409, 'robot is not in onboarding mode — hold HOME until it beeps, then retry'))
					return
				}
				finish(null, extracted)
			})
			socket.on('error', (err) => {
				finish(this.#httpError(502, err && err.message ? err.message : String(err)))
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

	/**
	 * Track mission start/end: gives the timeline an origin across reconnects,
	 * and journals every completed mission for Nextcloud to drain.
	 */
	#trackMission() {
		const mission = this.raw.cleanMissionStatus || {}
		const running = CLEANING_CYCLES.has(String(mission.cycle || ''))

		if (running && !this.missionStartedAt) {
			// A new mission began — start a fresh footprint.
			this.missionStartedAt = new Date().toISOString()
			this.poseTrail = []
			this.coveredCells = new Map()
			// `this.raw` is a running merge, so it still holds the *previous*
			// mission's final pose. Appending it here produced a trail whose
			// first point was hundreds of centimetres from the second (observed
			// live: (-103,-291) followed by (0,0)), drawing a phantom line across
			// the map and adding a stray covered cell that inflated the area
			// estimate. Wait for a genuinely fresh pose instead.
			this.poseStale = true
			this.missionMeta = {
				cycle: String(mission.cycle),
				battery_start: numOrNull(this.raw.batPct),
				n_mssn_start: numOrNull((this.raw.bbmssn || {}).nMssn),
			}
		} else if (!running && this.missionStartedAt) {
			this.#finishMission(mission)
			this.missionStartedAt = null
			this.missionMeta = null
			// Keep the last footprint on screen until the next mission starts.
		}

		if (running) {
			this.#appendPose()
		}
	}

	/**
	 * Journal a mission that has just stopped running.
	 *
	 * The bridge is the only component that sees the start and stop edges as
	 * they happen, so these timings are the authoritative ones. Nextcloud's own
	 * sampler runs on five-minute cron and would otherwise have to guess.
	 *
	 * @param {object} mission raw cleanMissionStatus at the moment it stopped
	 */
	#finishMission(mission) {
		if (!this.missionLog) {
			return
		}
		try {
			const state = this.getState()
			const meta = this.missionMeta || {}
			const m = (state && state.mission) || {}
			const phase = mission.phase || state.phase || null
			const error = Number(mission.error || state.error || 0) || 0

			// `nMssn` is the robot's own lifetime mission odometer. Recording it
			// lets Nextcloud reconcile: if the counter advanced by more than the
			// journal explains (bridge restarted mid-mission, say), it knows a
			// mission happened that nobody witnessed.
			const nMssnEnd = numOrNull((this.raw.bbmssn || {}).nMssn)

			const record = this.missionLog.append({
				started_at: this.missionStartedAt,
				ended_at: new Date().toISOString(),
				cycle: meta.cycle || String(mission.cycle || 'clean'),
				phase_final: phase,
				error_code: error,
				// Raw first, derived second: a 960 reports both as 0, which is why
				// the estimates exist. Never present an estimate as measured.
				sqft: numOrNull(m.sqft),
				sqft_est: numOrNull(m.sqft_est),
				mssn_m: numOrNull(m.mssn_m),
				mission_m_est: numOrNull(m.mission_m_est),
				battery_start: meta.battery_start ?? null,
				battery_end: numOrNull(this.raw.batPct),
				n_mssn_start: meta.n_mssn_start ?? null,
				n_mssn_end: nMssnEnd,
				pose_trail: Array.isArray(state.pose_trail) ? state.pose_trail : [],
				covered_cells: Array.isArray(state.covered_cells) ? state.covered_cells : [],
				cell_cm: CELL_CM,
				trail_points: Array.isArray(state.pose_trail) ? state.pose_trail.length : 0,
				covered_cells_count: Array.isArray(state.covered_cells) ? state.covered_cells.length : 0,
				source: 'bridge',
			})
			this.log(`mission journalled seq=${record.seq} cycle=${record.cycle} error=${record.error_code}`)
		} catch (err) {
			// A journalling failure must never disturb robot control.
			this.log(`mission journal failed: ${err && err.message ? err.message : err}`)
		}
	}

	/**
	 * Append the current pose to the mission trail (decimated) and mark its
	 * covered cell. Reads the same raw shape as stateNormalizer.normalizePose.
	 */
	#appendPose() {
		const pose = this.raw.pose || {}
		const point = pose.point || {}
		const x = Number(point.x)
		const y = Number(point.y)
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return
		}
		// First pose after a mission reset: `raw` still carries the previous
		// mission's last point, so drop exactly one sample and wait for a real one.
		if (this.poseStale) {
			this.poseStale = false
			this.lastStalePose = { x, y }
			return
		}
		if (this.lastStalePose && this.lastStalePose.x === x && this.lastStalePose.y === y) {
			return // unchanged since the reset — still the old mission's pose
		}
		this.lastStalePose = null
		const theta = Number(pose.theta)
		const last = this.poseTrail[this.poseTrail.length - 1]
		if (last && Math.hypot(x - last.x, y - last.y) < TRAIL_MIN_MOVE_CM) {
			return // decimate sensor jitter / stationary samples
		}
		this.poseTrail.push({ x, y, theta: Number.isFinite(theta) ? theta : null, ts: Date.now() })
		if (this.poseTrail.length > TRAIL_MAX) {
			this.poseTrail.shift()
		}
		const key = `${Math.round(x / CELL_CM)},${Math.round(y / CELL_CM)}`
		this.coveredCells.set(key, (this.coveredCells.get(key) || 0) + 1)
	}

	/**
	 * @param {string} message
	 */
	log(message) {
		console.log(`[roomba] ${message}`)
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
		const lower = message.toLowerCase()
		// MQTT CONNACK code 5 / "not authorized" == the BLID or local password
		// is wrong. The local password is NOT the iRobot account password — it
		// must be fetched from the robot in onboarding mode (hold HOME).
		if (Number(err && err.code) === 5 || lower.includes('not authorized')) {
			this.lastError = 'Not authorized — the BLID or local password is wrong. '
				+ 'The local password is not your iRobot account password; use '
				+ '"Retrieve credentials (hold HOME)" to fetch the correct one.'
		} else if (CONFLICT_HINTS.some((hint) => lower.includes(hint))) {
			this.conflict = 'Another client owns the robot\'s single MQTT session (the iRobot app is probably open). '
				+ 'Close it, wait 30 seconds, then retry connect.'
			this.lastError = message
		} else {
			this.lastError = message
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
	/**
	 * Strip fields from an upstream snapshot that we have just written ourselves.
	 *
	 * dorita980's cache lags a write by up to a second or two, and merging it
	 * wholesale reverted the operator's change. Only the keys written inside the
	 * grace window are withheld; everything else in the snapshot is authoritative
	 * and passes through untouched.
	 *
	 * @param {object} value upstream robotState snapshot
	 * @returns {object} the snapshot minus keys covered by a fresh local write
	 */
	#withoutStaleWrites(value) {
		const pending = this.localWrite
		if (!pending) {
			return value
		}
		if (Date.now() - pending.at > LOCAL_WRITE_GRACE_MS) {
			this.localWrite = null
			return value
		}
		const filtered = { ...value }
		for (const key of Object.keys(pending.values)) {
			if (filtered[key] !== pending.values[key]) {
				delete filtered[key]
			}
		}
		return filtered
	}

	async #refresh(fn, timeoutMs = 5000) {
		try {
			const value = await Promise.race([
				Promise.resolve().then(fn),
				new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
			])
			if (value && typeof value === 'object' && value.cleanMissionStatus) {
				this.raw = Object.assign({}, this.raw, this.#withoutStaleWrites(value))
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
		if (action === 'clean' || action === 'start') {
			mission.mssnM = 0
			mission.sqft = 0
			mission.nMssn += 1
			mission.error = 0
			mission.notReady = 0
		}
		this.lastCommand = { action, method: 'mock', at: new Date().toISOString(), result: 'sent' }
		this.mockTick = 0
		// Route through the same tracking path as a real MQTT push. The mock used
		// to set/clear `missionStartedAt` itself and publish directly, which meant
		// the mission start/end edges never reached #trackMission -- so nothing
		// was journalled and the mock proved a code path the real robot does not
		// take. One lifecycle owner, exercised identically by both.
		this.#ingest({})
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
				}
			} else if (mission.phase === 'charge' && this.raw.batPct < 100) {
				this.raw.batPct += 1
			}
			this.raw.signal.rssi = -50 - (this.mockTick % 12)
			this.#ingest({})
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

/**
 * Pull the dorita980 local password out of a get-password TLS payload.
 * Prefer the canonical `:1:<epoch>:<secret>` form (regex), then fall back to
 * the dorita980 slice offsets. Rejects short "not in onboarding" packets.
 *
 * @param {Buffer} buf
 * @param {number} preferredOffset dorita980 default 13, or 9 after a 2-byte preamble
 * @returns {string|null}
 */
function extractRoombaPassword(buf, preferredOffset = 13) {
	if (!Buffer.isBuffer(buf) || buf.length <= 7) {
		return null
	}
	const asText = buf.toString('binary')
	const match = asText.match(/:1:\d+:[ -~]+/)
	if (match && match[0]) {
		return match[0].trim()
	}
	const offsets = [preferredOffset, 13, 9, 7, 8, 10, 11, 12, 14, 15, 16]
	for (const off of offsets) {
		if (off >= buf.length) {
			continue
		}
		const candidate = buf.subarray(off).toString('utf8').replace(/\0+$/g, '').trim()
		if (candidate.startsWith(':1:') && candidate.length >= 20 && /^[\x20-\x7e]+$/.test(candidate)) {
			return candidate
		}
	}
	return null
}

module.exports = { ACTIONS, MOCK_TRANSITIONS, RobotManager, mockSeedState, extractRoombaPassword }
