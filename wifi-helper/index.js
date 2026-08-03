'use strict'

/**
 * nc-roomba-wifi-helper — privileged host service for Soft-AP Wi-Fi provisioning.
 *
 * This process runs as root and shells out to `nmcli` / `iw` / `ip`, so its
 * exposure is deliberately narrow:
 *
 *  - It refuses to start without ROOMBA_WIFI_HELPER_TOKEN. There is no
 *    "no token configured, allow everything" mode; set
 *    ROOMBA_WIFI_HELPER_ALLOW_NO_TOKEN=1 for local development only.
 *  - It does NOT bind 0.0.0.0 by default. The bridge reaches it as
 *    `host.docker.internal`, which Docker maps to the host's docker0 address,
 *    so the default binds loopback plus that gateway address — reachable from
 *    containers and the host, not from the rest of the LAN. Set
 *    ROOMBA_WIFI_HELPER_BIND to override (comma-separated addresses).
 *  - The token is compared in constant time, header or JSON body only. Query
 *    strings are not accepted: they land in access logs and Referer headers.
 */

const crypto = require('node:crypto')
const os = require('node:os')

const express = require('express')
const wifi = require('./lib/wifi')
const { provisionSoftAp, blidFromSsid } = require('./lib/provision')

const PORT = Number(process.env.ROOMBA_WIFI_HELPER_PORT || 8091)
const TOKEN = process.env.ROOMBA_WIFI_HELPER_TOKEN || ''
const ALLOW_NO_TOKEN = process.env.ROOMBA_WIFI_HELPER_ALLOW_NO_TOKEN === '1'
const VERSION = require('./package.json').version

/**
 * IPv4 address of the Docker bridge interface, when Docker is installed.
 * `extra_hosts: host.docker.internal:host-gateway` resolves to exactly this, so
 * binding it keeps the bridge working without exposing the LAN.
 *
 * @param {string} [ifname]
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @returns {string|null}
 */
function dockerGatewayAddress(
	ifname = process.env.ROOMBA_WIFI_HELPER_DOCKER_IFACE || 'docker0',
	interfaces = os.networkInterfaces(),
) {
	const entries = interfaces[ifname] || []
	const v4 = entries.find((e) => e && (e.family === 'IPv4' || e.family === 4))
	return v4 ? v4.address : null
}

/**
 * Addresses to listen on.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string|null} [gateway]
 * @returns {string[]}
 */
function resolveBindHosts(env = process.env, gateway = dockerGatewayAddress()) {
	const explicit = String(env.ROOMBA_WIFI_HELPER_BIND || '').trim()
	if (explicit) {
		return [...new Set(explicit.split(',').map((h) => h.trim()).filter(Boolean))]
	}
	const hosts = ['127.0.0.1']
	if (gateway && !hosts.includes(gateway)) {
		hosts.push(gateway)
	}
	return hosts
}

/**
 * Constant-time token comparison. Both sides are hashed first so the comparison
 * length is fixed and a wrong-length guess cannot be distinguished by timing.
 *
 * @param {string} got
 * @param {string} want
 * @returns {boolean}
 */
function tokenMatches(got, want) {
	if (typeof got !== 'string' || typeof want !== 'string' || want === '' || got === '') {
		return false
	}
	const a = crypto.createHash('sha256').update(got).digest()
	const b = crypto.createHash('sha256').update(want).digest()
	return crypto.timingSafeEqual(a, b)
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

// Request-level logging: Soft-AP joins fail in ways only visible live, so log
// method/path on entry and status/duration on finish (never the body — it
// carries the home Wi-Fi password).
app.use((req, res, next) => {
	const started = Date.now()
	// eslint-disable-next-line no-console
	console.log(`--> ${req.method} ${req.path}`)
	res.on('finish', () => {
		// eslint-disable-next-line no-console
		console.log(`<-- ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`)
	})
	next()
})

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireToken(req, res, next) {
	if (!TOKEN) {
		// Reached only under ROOMBA_WIFI_HELPER_ALLOW_NO_TOKEN=1 (startup refuses
		// otherwise), and even then every call is refused unless it is local.
		if (!ALLOW_NO_TOKEN) {
			return res.status(503).json({ ok: false, error: 'helper_misconfigured_no_token' })
		}
		return next()
	}
	// Header or JSON body only — never ?token=, which leaks into access logs.
	const got = req.get('x-roomba-helper-token') || (req.body && req.body.token) || ''
	if (!tokenMatches(String(got), TOKEN)) {
		return res.status(401).json({ ok: false, error: 'unauthorized' })
	}
	return next()
}

/**
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 */
function wrap(handler) {
	return (req, res) => {
		Promise.resolve()
			.then(() => handler(req, res))
			.catch((err) => {
				const status = err && Number.isInteger(err.status) ? err.status : 500
				res.status(status).json({ ok: false, error: err && err.message ? err.message : String(err) })
			})
	}
}

// Unauthenticated liveness only. The wireless interface name is host topology
// and is reported by the token-gated /wifi/scan and /wifi/link instead.
app.get('/health', (req, res) => {
	res.json({
		ok: true,
		service: 'nc-roomba-wifi-helper',
		version: VERSION,
		mock: process.env.ROOMBA_WIFI_HELPER_MOCK === '1',
		token_required: Boolean(TOKEN),
	})
})

app.post('/wifi/scan', requireToken, wrap(async (req, res) => {
	const roomba_only = req.body?.roomba_only !== false
	const networks = roomba_only ? await wifi.scanRoombaAps() : await wifi.scanWifi()
	res.json({ ok: true, networks, iface: wifi.IFACE })
}))

app.get('/wifi/link', requireToken, wrap(async (req, res) => {
	res.json(await wifi.linkStatus())
}))

app.post('/wifi/softap/join', requireToken, wrap(async (req, res) => {
	const body = req.body || {}
	const joined = await wifi.joinSoftAp({
		ssid: body.ssid,
		bssid: body.bssid,
		chan: body.chan,
	})
	const waitMs = Number(body.wait_ms || 60_000)
	const ready = await wifi.waitSoftApReady(waitMs)
	res.json({ ok: true, ...joined, ready })
}))

app.post('/wifi/softap/leave', requireToken, wrap(async (req, res) => {
	res.json(await wifi.leaveSoftAp())
}))

app.post('/wifi/softap/diagnose', requireToken, wrap(async (req, res) => {
	res.json(await wifi.diagnoseSoftAp())
}))

app.post('/wifi/softap/provision', requireToken, wrap(async (req, res) => {
	const body = req.body || {}
	const robotSsid = body.robot_ssid || body.softap_ssid || ''
	const joinFirst = body.join !== false

	if (joinFirst && robotSsid) {
		await wifi.joinSoftAp({
			ssid: robotSsid,
			bssid: body.bssid,
			chan: body.chan,
		})
		await wifi.waitSoftApReady(Number(body.wait_ms || 60_000))
	}

	try {
		const result = await provisionSoftAp({
			ssid: body.ssid || body.home_ssid,
			pass: body.pass || body.home_pass || body.password,
			blid: body.blid || blidFromSsid(robotSsid),
			robotSsid,
			host: body.host || wifi.SOFTAP_GW,
			timezone: body.timezone,
			country: body.country,
			localtimeoffset: body.localtimeoffset,
			verifyTimeoutMs: body.verify_timeout_ms,
		})
		res.json({ ok: true, ...result })
	} finally {
		if (body.leave !== false) {
			await wifi.leaveSoftAp().catch(() => {})
		}
	}
}))

function main() {
	if (!TOKEN) {
		if (!ALLOW_NO_TOKEN) {
			// eslint-disable-next-line no-console
			console.error(
				'nc-roomba-wifi-helper: refusing to start — ROOMBA_WIFI_HELPER_TOKEN is not set.\n'
				+ '  This service runs as root and can reconfigure the host wireless interface.\n'
				+ '  Set the token (systemd: EnvironmentFile=/etc/nc-roomba-wifi-helper.env), or set\n'
				+ '  ROOMBA_WIFI_HELPER_ALLOW_NO_TOKEN=1 for local development only.',
			)
			process.exit(78) // EX_CONFIG
		}
		// eslint-disable-next-line no-console
		console.warn(
			'nc-roomba-wifi-helper: *** RUNNING WITH NO TOKEN *** '
			+ '(ROOMBA_WIFI_HELPER_ALLOW_NO_TOKEN=1). Never do this on a shared network.',
		)
	}

	// Loopback and the docker gateway are separate listeners on the same port.
	// One failing (e.g. docker0 went away mid-boot) must not take the service
	// down, but zero listeners is fatal.
	const hosts = resolveBindHosts()
	let bound = 0
	let pending = hosts.length
	for (const host of hosts) {
		const server = app.listen(PORT, host, () => {
			bound++
			pending--
			// eslint-disable-next-line no-console
			console.log(
				`nc-roomba-wifi-helper ${VERSION} on ${host}:${PORT} `
				+ `mock=${process.env.ROOMBA_WIFI_HELPER_MOCK === '1'} token=${TOKEN ? 'on' : 'OFF'}`,
			)
		})
		server.on('error', (err) => {
			pending--
			// eslint-disable-next-line no-console
			console.error(`nc-roomba-wifi-helper: cannot listen on ${host}:${PORT} — ${err.message}`)
			if (pending === 0 && bound === 0) {
				// eslint-disable-next-line no-console
				console.error('nc-roomba-wifi-helper: no listening address, giving up')
				process.exit(1)
			}
		})
	}
}

if (require.main === module) {
	main()
}

module.exports = { app, resolveBindHosts, dockerGatewayAddress, tokenMatches }
