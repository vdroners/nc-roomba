'use strict'

/**
 * nc-roomba-wifi-helper — privileged host service for Soft-AP Wi-Fi provisioning.
 *
 * Binds to ROOMBA_WIFI_HELPER_BIND (default 0.0.0.0:8091) so the Docker bridge
 * can reach it via host.docker.internal. Requires ROOMBA_WIFI_HELPER_TOKEN for
 * every mutating call when the token env is set (recommended in production).
 */

const express = require('express')
const wifi = require('./lib/wifi')
const { provisionSoftAp, blidFromSsid } = require('./lib/provision')

const PORT = Number(process.env.ROOMBA_WIFI_HELPER_PORT || 8091)
const HOST = process.env.ROOMBA_WIFI_HELPER_BIND || '0.0.0.0'
const TOKEN = process.env.ROOMBA_WIFI_HELPER_TOKEN || ''
const VERSION = require('./package.json').version

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireToken(req, res, next) {
	if (!TOKEN) {
		return next()
	}
	const got = req.get('x-roomba-helper-token') || req.query.token || (req.body && req.body.token)
	if (got !== TOKEN) {
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

app.get('/health', (req, res) => {
	res.json({
		ok: true,
		service: 'nc-roomba-wifi-helper',
		version: VERSION,
		mock: process.env.ROOMBA_WIFI_HELPER_MOCK === '1',
		iface: wifi.IFACE,
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
		})
		res.json({ ok: true, ...result })
	} finally {
		if (body.leave !== false) {
			await wifi.leaveSoftAp().catch(() => {})
		}
	}
}))

if (require.main === module) {
	app.listen(PORT, HOST, () => {
		// eslint-disable-next-line no-console
		console.log(`nc-roomba-wifi-helper ${VERSION} on ${HOST}:${PORT} mock=${process.env.ROOMBA_WIFI_HELPER_MOCK === '1'}`)
	})
}

module.exports = { app }
