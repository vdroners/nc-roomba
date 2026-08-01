'use strict'

require('./tlsLegacy')

const crypto = require('node:crypto')
const tls = require('node:tls')
const mqtt = require('mqtt')

const SOFTAP_GW = process.env.ROOMBA_SOFTAP_GW || '192.168.10.1'

/**
 * @param {number} ms
 */
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * @returns {string} `:1:<epoch>:<16 hex chars>`
 */
function makeLocalPassword() {
	const ts = Math.floor(Date.now() / 1000)
	const secret = crypto.randomBytes(8).toString('hex')
	return `:1:${ts}:${secret}`
}

/**
 * MQTT Authentication Exchange packet that pushes a local password onto Soft-AP.
 *
 * @param {string} password
 * @returns {Buffer}
 */
function authExchangePacket(password) {
	const magic = Buffer.from('efcc3b2900', 'hex')
	const passBuf = Buffer.from(password, 'utf8')
	const remaining = Buffer.concat([magic, passBuf])
	return Buffer.concat([Buffer.from([0xf0]), encodeRemainingLength(remaining.length), remaining])
}

/**
 * MQTT variable-length remaining-length encoding (7 bits per byte, MSB = continuation).
 *
 * @param {number} len
 * @returns {Buffer}
 */
function encodeRemainingLength(len) {
	const out = []
	let value = len
	do {
		let byte = value % 128
		value = Math.floor(value / 128)
		if (value > 0) {
			byte |= 0x80
		}
		out.push(byte)
	} while (value > 0)
	return Buffer.from(out)
}

/**
 * True when the robot echoed back a usable local password.
 *
 * The robot answers the auth-exchange packet by echoing the password it now
 * holds. Anything else — including a clean socket close with no bytes, or a few
 * bytes of TLS chatter — means the password was NOT accepted, and treating that
 * as success is how fabricated credentials get saved over working ones.
 *
 * @param {string} text bytes received so far, as utf8
 * @param {string} password the password we pushed
 * @returns {boolean}
 */
function isAuthEcho(text, password) {
	if (!text) {
		return false
	}
	return text.includes(password) || /:1:\d+:/.test(text)
}

/**
 * @param {string} host
 * @param {string} password
 * @param {number} [timeoutMs]
 * @param {{connect?: typeof tls.connect}} [deps] test seam
 * @returns {Promise<string>} the echoed payload
 */
function setPasswordViaAuthExchange(host, password, timeoutMs = 15_000, deps = {}) {
	const connect = deps.connect || tls.connect
	return new Promise((resolve, reject) => {
		const opts = {
			host,
			port: 8883,
			rejectUnauthorized: false,
			ciphers: process.env.ROBOT_CIPHERS || 'DEFAULT@SECLEVEL=0',
			minVersion: 'TLSv1',
			timeout: timeoutMs,
		}
		if (crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT) {
			opts.secureOptions = crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
		}
		const sock = connect(opts, () => {
			sock.write(authExchangePacket(password))
		})
		const chunks = []
		let settled = false
		const timer = setTimeout(() => {
			finish(new Error('auth exchange timed out — the robot never echoed the local password'))
		}, timeoutMs)
		/**
		 * @param {Error|null} err
		 * @param {string} [value]
		 */
		function finish(err, value) {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(timer)
			try { sock.end() } catch { /* ignore */ }
			try { sock.destroy() } catch { /* ignore */ }
			if (err) reject(err)
			else resolve(value)
		}
		sock.on('data', (d) => {
			chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d))
			const text = Buffer.concat(chunks).toString('utf8')
			if (isAuthEcho(text, password)) {
				finish(null, text)
			}
		})
		sock.on('error', (e) => finish(e))
		// A close without a valid echo is a failure, not a success with partial
		// bytes: the previous `resolve(partial)` here let a robot that hung up
		// count as provisioned.
		sock.on('end', () => finish(new Error(
			'robot closed the auth-exchange connection without echoing the local password',
		)))
		sock.on('close', () => finish(new Error(
			'auth-exchange connection closed before the robot echoed the local password',
		)))
	})
}

/**
 * @param {string} host
 * @param {string} blid
 * @param {string} password
 */
function mqttConnect(host, blid, password) {
	return new Promise((resolve, reject) => {
		const client = mqtt.connect(`mqtts://${host}:8883`, {
			clientId: blid,
			username: blid,
			password,
			protocolId: 'MQTT',
			protocolVersion: 4,
			rejectUnauthorized: false,
			ciphers: process.env.ROBOT_CIPHERS || 'DEFAULT@SECLEVEL=0',
			connectTimeout: 20_000,
			reconnectPeriod: 0,
		})
		const timer = setTimeout(() => {
			try { client.end(true) } catch { /* ignore */ }
			reject(new Error('mqtt connect timeout'))
		}, 25_000)
		client.on('connect', () => {
			clearTimeout(timer)
			resolve(client)
		})
		client.on('error', (e) => {
			clearTimeout(timer)
			reject(e)
		})
	})
}

/**
 * @param {import('mqtt').MqttClient} client
 * @param {string} topic
 * @param {object|string} payload
 */
function pub(client, topic, payload) {
	return new Promise((resolve, reject) => {
		const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
		client.publish(topic, body, { qos: 0 }, (err) => (err ? reject(err) : resolve()))
	})
}

/**
 * BLID is encoded in Soft-AP SSID: Roomba-<BLID>
 *
 * @param {string} ssid
 * @returns {string|null}
 */
function blidFromSsid(ssid) {
	const m = String(ssid || '').match(/^(?:Roomba|iRobot)-([0-9A-Fa-f]{16,})$/i)
	return m ? m[1].toUpperCase() : null
}

/**
 * Topics we publish the configuration on. A broker echoes a subscriber's own
 * publishes back, so matching the home SSID inside one of these would confirm
 * nothing but our own `wlcfg` write.
 */
const OWN_PUBLISH_TOPIC_RE = /(^|\/)(wifictl|delta)(\/|$)/i

/**
 * Every `ssid`-ish value anywhere in a decoded payload.
 *
 * @param {unknown} value
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectSsidValues(value, out = []) {
	if (!value || typeof value !== 'object') {
		return out
	}
	for (const [key, child] of Object.entries(value)) {
		if (/ssid$/i.test(key) && (typeof child === 'string' || typeof child === 'number')) {
			out.push(String(child))
		}
		if (child && typeof child === 'object') {
			collectSsidValues(child, out)
		}
	}
	return out
}

/**
 * Does this inbound robot message show it holding the home SSID?
 *
 * The robot reports the SSID hex-encoded in `wlcfg`, and plain in some
 * `netinfo`/`wifistat` shapes, so both forms are accepted. Messages on the
 * topics we ourselves publish to are ignored.
 *
 * @param {string} topic
 * @param {Buffer|string} raw
 * @param {string} homeSsid
 * @returns {boolean}
 */
function payloadConfirmsSsid(topic, raw, homeSsid) {
	if (!homeSsid || OWN_PUBLISH_TOPIC_RE.test(String(topic || ''))) {
		return false
	}
	const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '')
	const hex = Buffer.from(homeSsid, 'utf8').toString('hex')
	const wanted = new Set([homeSsid.toLowerCase(), hex.toLowerCase()])

	let decoded = null
	try { decoded = JSON.parse(text) } catch { /* non-JSON payloads fall through */ }
	if (decoded) {
		return collectSsidValues(decoded).some((v) => wanted.has(String(v).toLowerCase()))
	}
	const lower = text.toLowerCase()
	return lower.includes(homeSsid.toLowerCase()) || lower.includes(hex.toLowerCase())
}

/**
 * Watch inbound robot messages for a report of the home SSID.
 *
 * Nothing in the publish sequence is acknowledged (QoS 0, and the `chkssid` /
 * `wactivate` results were never read), so this is the only signal that the
 * robot actually took the credentials rather than ignoring eight packets.
 *
 * Attach this BEFORE publishing: the robot answers `wactivate` while the rest
 * of the sequence is still being paced out, so a watcher installed afterwards
 * would miss the one message that matters. `wait()` therefore returns
 * immediately if the match already arrived.
 *
 * @param {import('mqtt').MqttClient} client subscribed to `#`
 * @param {string} homeSsid
 * @returns {{wait:(timeoutMs:number)=>Promise<{topic:string,payload:string}|null>, stop:()=>void}}
 */
function createSsidWatcher(client, homeSsid) {
	/** @type {{topic:string,payload:string}|null} */
	let match = null
	/** @type {Array<(v: {topic:string,payload:string}) => void>} */
	const waiters = []

	const onMessage = (topic, payload) => {
		if (match || !payloadConfirmsSsid(topic, payload, homeSsid)) {
			return
		}
		match = { topic: String(topic), payload: String(payload) }
		while (waiters.length) {
			waiters.shift()(match)
		}
	}
	client.on('message', onMessage)

	return {
		wait(timeoutMs) {
			if (match) {
				return Promise.resolve(match)
			}
			return new Promise((resolve) => {
				const settle = (value) => {
					clearTimeout(timer)
					resolve(value)
				}
				const timer = setTimeout(() => {
					const i = waiters.indexOf(settle)
					if (i >= 0) {
						waiters.splice(i, 1)
					}
					resolve(null)
				}, timeoutMs)
				waiters.push(settle)
			})
		},
		stop() {
			client.removeListener('message', onMessage)
		},
	}
}

/**
 * kumy Soft-AP Wi-Fi provision sequence.
 *
 * @param {object} opts
 * @param {string} opts.ssid home Wi-Fi SSID (2.4 GHz)
 * @param {string} opts.pass home Wi-Fi password
 * @param {string} [opts.blid]
 * @param {string} [opts.robotSsid] Soft-AP SSID (to derive BLID)
 * @param {string} [opts.host]
 * @param {string} [opts.timezone]
 * @param {string} [opts.country]
 * @param {number} [opts.localtimeoffset] minutes from UTC
 * @param {number} [opts.verifyTimeoutMs] how long to wait for the robot to confirm the home SSID
 * @param {{authExchange?:Function, connectMqtt?:Function}} [opts.deps] test seam
 * @returns {Promise<{blid:string,password:string,host:string,verified:boolean,steps:string[]}>}
 * @throws when the robot never confirms it took the home SSID (credentials are
 *   then NOT returned, so nothing overwrites the stored working ones)
 */
async function provisionSoftAp(opts) {
	const host = opts.host || SOFTAP_GW
	const homeSsid = String(opts.ssid || '').trim()
	const homePass = String(opts.pass || '')
	if (!homeSsid || !homePass) {
		const err = new Error('home wifi ssid and pass are required')
		err.status = 400
		throw err
	}

	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		// Placeholder BLID for the mock path only. Never put a real device's
		// identifier here: this is an AGPL repo, and a BLID names one specific
		// robot. The real one lives in the untracked .env.
		const blid = opts.blid || blidFromSsid(opts.robotSsid) || '1A2B3C4D5E6F7788'
		const password = makeLocalPassword()
		return {
			blid,
			password,
			host,
			mock: true,
			verified: true,
			steps: ['mock_auth', 'mock_wlcfg', 'mock_wactivate', 'mock_verify', 'mock_uap_false'],
		}
	}

	const blid = (opts.blid || blidFromSsid(opts.robotSsid) || '').toUpperCase()
	if (!/^[0-9A-F]{16,}$/.test(blid)) {
		const err = new Error('blid is required (or robot Soft-AP SSID Roomba-<BLID>)')
		err.status = 400
		throw err
	}

	const deps = opts.deps || {}
	const authExchange = deps.authExchange || setPasswordViaAuthExchange
	const connectMqtt = deps.connectMqtt || mqttConnect
	const verifyTimeoutMs = Number(opts.verifyTimeoutMs || process.env.ROOMBA_SOFTAP_VERIFY_MS || 30_000)
	// The robot drops packets published back-to-back, hence the pacing. Kept as
	// a knob so tests do not have to sit through the real 1.5 s-per-step wall.
	const stepDelayMs = Number(opts.stepDelayMs ?? process.env.ROOMBA_SOFTAP_STEP_MS ?? 1500)
	// Escape hatch for firmware that never reports back. Off by default: the
	// point of the verification step is that "could not confirm" must not be
	// written over credentials that already work.
	const allowUnverified = process.env.ROOMBA_SOFTAP_ALLOW_UNVERIFIED === '1'

	const password = makeLocalPassword()
	const steps = []
	await authExchange(host, password)
	steps.push('auth_exchange')
	await sleep(Math.min(stepDelayMs, 1000))

	const client = await connectMqtt(host, blid, password)
	steps.push('mqtt_connect')

	/** @type {ReturnType<typeof createSsidWatcher>|null} */
	let watcher = null
	try {
		// Subscribe before publishing anything so the reply to `chkssid` /
		// `wactivate` / `get netinfo` cannot arrive before we are listening.
		await new Promise((resolve) => {
			client.subscribe('#', { qos: 0 }, () => resolve())
		})
		steps.push('subscribe')
		watcher = createSsidWatcher(client, homeSsid)

		const ssidHex = Buffer.from(homeSsid, 'utf8').toString('hex')
		const now = Math.floor(Date.now() / 1000)
		const timezone = opts.timezone || 'America/Los_Angeles'
		const country = opts.country || 'US'
		const localtimeoffset = Number.isFinite(opts.localtimeoffset) ? opts.localtimeoffset : -420

		// `uap: false` tears the Soft-AP down, so it is deliberately NOT part of
		// this list — it only runs once the robot has confirmed the home SSID.
		const sequence = [
			['delta', { state: { timezone } }],
			['wifictl', { state: { country } }],
			['wifictl', { state: { wlcfg: { sec: 7, ssid: ssidHex, pass: homePass } } }],
			['wifictl', { state: { utctime: now } }],
			['wifictl', { state: { localtimeoffset } }],
			['wifictl', { state: { chkssid: true } }],
			['wifictl', { state: { wactivate: true } }],
			['wifictl', { state: { get: 'netinfo' } }],
		]

		for (const [topic, payload] of sequence) {
			await pub(client, topic, payload)
			steps.push(`${topic}:${Object.keys(payload.state || {}).join(',')}`)
			await sleep(stepDelayMs)
		}

		const confirmation = await watcher.wait(verifyTimeoutMs)
		if (!confirmation && !allowUnverified) {
			const err = new Error(
				`could not confirm the robot took "${homeSsid}" — it never reported the SSID back `
				+ `within ${Math.round(verifyTimeoutMs / 1000)}s. Nothing was saved; leave the robot in `
				+ 'Soft-AP mode and retry.',
			)
			err.status = 504
			err.steps = steps
			throw err
		}
		steps.push(confirmation ? `verified:${confirmation.topic}` : 'unverified_allowed')

		// Only now hand the radio back: the robot drops the Soft-AP on uap:false.
		await pub(client, 'wifictl', { state: { uap: false } })
		steps.push('wifictl:uap')
		await sleep(Math.min(stepDelayMs * 2, 3000))
		steps.push('done')

		return {
			blid,
			password,
			host,
			verified: Boolean(confirmation),
			confirmed_on: confirmation ? confirmation.topic : null,
			warning: confirmation
				? null
				: 'ROOMBA_SOFTAP_ALLOW_UNVERIFIED=1 — the robot never confirmed the home SSID.',
			steps,
		}
	} finally {
		if (watcher) {
			watcher.stop()
		}
		try { client.end(true) } catch { /* ignore */ }
	}
}

module.exports = {
	makeLocalPassword,
	authExchangePacket,
	blidFromSsid,
	createSsidWatcher,
	isAuthEcho,
	payloadConfirmsSsid,
	provisionSoftAp,
	setPasswordViaAuthExchange,
}
