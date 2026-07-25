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
 * @param {string} host
 * @param {string} password
 * @param {number} [timeoutMs]
 */
function setPasswordViaAuthExchange(host, password, timeoutMs = 15_000) {
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
		const sock = tls.connect(opts, () => {
			sock.write(authExchangePacket(password))
		})
		const chunks = []
		const timer = setTimeout(() => {
			sock.destroy()
			reject(new Error('auth exchange timeout'))
		}, timeoutMs)
		const finish = (err, value) => {
			clearTimeout(timer)
			try { sock.end() } catch { /* ignore */ }
			if (err) reject(err)
			else resolve(value)
		}
		sock.on('data', (d) => {
			chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d))
			const text = Buffer.concat(chunks).toString('utf8')
			if (text.includes(password) || /:1:\d+:/.test(text)) {
				finish(null, text)
			}
		})
		sock.on('error', (e) => finish(e))
		sock.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')))
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
 * @returns {Promise<{blid:string,password:string,host:string,steps:string[]}>}
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
		const blid = opts.blid || blidFromSsid(opts.robotSsid) || '3165811C32410750'
		const password = makeLocalPassword()
		return {
			blid,
			password,
			host,
			mock: true,
			steps: ['mock_auth', 'mock_wlcfg', 'mock_wactivate', 'mock_uap_false'],
		}
	}

	const blid = (opts.blid || blidFromSsid(opts.robotSsid) || '').toUpperCase()
	if (!/^[0-9A-F]{16,}$/.test(blid)) {
		const err = new Error('blid is required (or robot Soft-AP SSID Roomba-<BLID>)')
		err.status = 400
		throw err
	}

	const password = makeLocalPassword()
	const steps = []
	await setPasswordViaAuthExchange(host, password)
	steps.push('auth_exchange')
	await sleep(1000)

	const client = await mqttConnect(host, blid, password)
	steps.push('mqtt_connect')

	const ssidHex = Buffer.from(homeSsid, 'utf8').toString('hex')
	const now = Math.floor(Date.now() / 1000)
	const timezone = opts.timezone || 'America/Los_Angeles'
	const country = opts.country || 'US'
	const localtimeoffset = Number.isFinite(opts.localtimeoffset) ? opts.localtimeoffset : -420

	const sequence = [
		['delta', { state: { timezone } }],
		['wifictl', { state: { country } }],
		['wifictl', { state: { wlcfg: { sec: 7, ssid: ssidHex, pass: homePass } } }],
		['wifictl', { state: { utctime: now } }],
		['wifictl', { state: { localtimeoffset } }],
		['wifictl', { state: { chkssid: true } }],
		['wifictl', { state: { wactivate: true } }],
		['wifictl', { state: { get: 'netinfo' } }],
		['wifictl', { state: { uap: false } }],
	]

	for (const [topic, payload] of sequence) {
		await pub(client, topic, payload)
		steps.push(`${topic}:${Object.keys(payload.state || {}).join(',')}`)
		await sleep(1500)
	}

	await sleep(5000)
	try { client.end(true) } catch { /* ignore */ }
	steps.push('done')

	return { blid, password, host, steps }
}

module.exports = {
	makeLocalPassword,
	authExchangePacket,
	blidFromSsid,
	provisionSoftAp,
	setPasswordViaAuthExchange,
}
