'use strict'

/**
 * nc-roomba-bridge — HTTP/SSE front end for the single local MQTT session.
 *
 * Reachable only from the `nc-roomba-net` Docker network (the compose file
 * publishes no public host port); the Nextcloud app proxies every call, so the
 * browser never talks to the robot or this process directly.
 *
 * Env: BLID, PASSWORD, ROBOT_IP, FIRMWARE_VERSION=2, ROOMBA_MOCK=0|1, PORT=8080
 */

const express = require('express')

const { RobotManager } = require('./lib/robotManager')
const { needsAttention } = require('./lib/stateNormalizer')

const PORT = Number(process.env.PORT || 8080)
const HOST = process.env.HOST || '0.0.0.0'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

// CORS is off by default: the only legitimate caller is the Nextcloud PHP app,
// server-to-server on the Docker network. Set BRIDGE_CORS_ORIGIN for local
// debugging from a browser.
if (process.env.BRIDGE_CORS_ORIGIN) {
	const cors = require('cors')
	app.use(cors({ origin: process.env.BRIDGE_CORS_ORIGIN }))
}

const manager = new RobotManager(process.env)

/**
 * @param {import('express').Response} res
 * @param {unknown} err
 */
function sendError(res, err) {
	const status = err && Number.isInteger(err.status) ? err.status : 500
	const message = err && err.message ? err.message : String(err)
	res.status(status).json({ ok: false, error: message })
}

/**
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 * @returns {import('express').RequestHandler}
 */
function wrap(handler) {
	return (req, res) => {
		Promise.resolve()
			.then(() => handler(req, res))
			.catch((err) => sendError(res, err))
	}
}

app.get('/health', (req, res) => {
	res.json(manager.health())
})

async function handleDiscover(req, res) {
	const body = req.body || {}
	const timeoutMs = Number(req.query.timeout_ms || body.timeout_ms || 8000)
	const opts = {
		ips: Array.isArray(body.ips) ? body.ips : undefined,
		subnets: Array.isArray(body.subnets) ? body.subnets : undefined,
		skip_scan: body.skip_scan === true,
	}
	const result = await manager.discover(timeoutMs, opts)
	res.json({ ok: true, ...result })
}

app.get('/discover', wrap(handleDiscover))
app.post('/discover', wrap(handleDiscover))

app.post('/onboard/get-password', wrap(async (req, res) => {
	const creds = await manager.getPassword((req.body || {}).ip)
	res.json({ ok: true, ...creds })
}))

app.get('/onboard/softap-status', (req, res) => {
	res.json({ ok: true, status: manager.getSoftapStatus() })
})

app.post('/onboard/softap-scan', wrap(async (req, res) => {
	const roombaOnly = (req.body || {}).roomba_only !== false
	const result = await manager.scanSoftAp(roombaOnly)
	res.json(result)
}))

app.post('/onboard/softap-provision', wrap(async (req, res) => {
	const result = await manager.softapProvision(req.body || {})
	res.json(result)
}))

app.post('/connect', wrap(async (req, res) => {
	const health = manager.connect(req.body || {})
	res.status(health.connected || health.mock ? 200 : 202).json({ ok: true, ...health })
}))

app.post('/connect-test', wrap(async (req, res) => {
	const health = manager.connect(req.body || {})
	const ok = !!(health.connected || health.mock)
	res.status(ok ? 200 : 502).json({ ok, ...health })
}))

app.get('/state', (req, res) => {
	const state = manager.getState()
	res.json({ ok: true, needs_attention: needsAttention(state), state })
})

/**
 * Completed-mission journal, drained by Nextcloud.
 *
 * The bridge holds the only real-time view of the robot, so it knows exactly
 * when a mission started and stopped. Nextcloud samples on five-minute cron
 * (measured gaps: median 15 min, max 110) against a 28-minute average mission,
 * so reconstructing missions from those samples alone misses short runs and
 * mis-dates the rest. Instead the bridge journals each completed mission and
 * Nextcloud pulls with `?since=<seq>`, picking up wherever it left off — it can
 * be slow, restart, or be down for a day without losing one.
 *
 * `seq` is monotonic per journal file. `next_seq` lets a caller detect a journal
 * that was reset (seq going backwards) and re-sync.
 */
app.get('/missions', (req, res) => {
	const since = Number(req.query.since || 0) || 0
	const limit = Number(req.query.limit || 100) || 100
	res.json({
		ok: true,
		...manager.missionLog.summary(),
		missions: manager.missionLog.since(since, limit),
	})
})

// SSE: the app's live pipeline. Every push is the same normalized DTO that
// GET /state returns, so the poll fallback and the stream stay interchangeable.
app.get('/stream', (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	})

	const send = (dto) => {
		res.write(`event: state\ndata: ${JSON.stringify(dto)}\n\n`)
	}

	send(manager.getState())
	const unsubscribe = manager.subscribe(send)
	// Comment frames keep intermediaries from timing the connection out.
	const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000)

	req.on('close', () => {
		clearInterval(keepAlive)
		unsubscribe()
		res.end()
	})
})

app.post('/action/:name', wrap(async (req, res) => {
	const result = await manager.action(req.params.name)
	res.json({ ...result, state: manager.getState() })
}))

app.get('/preferences', wrap(async (req, res) => {
	res.json({ ok: true, preferences: await manager.getPreferences() })
}))

app.post('/preferences', wrap(async (req, res) => {
	res.json({ ok: true, preferences: await manager.setPreferences(req.body || {}) })
}))

app.get('/schedule', wrap(async (req, res) => {
	res.json({ ok: true, week: await manager.getSchedule() })
}))

app.post('/schedule', wrap(async (req, res) => {
	const body = req.body || {}
	res.json({ ok: true, week: await manager.setSchedule(body.week || body) })
}))

app.get('/bbrun', wrap(async (req, res) => {
	res.json({ ok: true, ...(await manager.getBbrun()) })
}))

app.use((req, res) => {
	res.status(404).json({ ok: false, error: `no route ${req.method} ${req.path}` })
})

// Auto-connect on boot when credentials are already configured (or in mock
// mode); otherwise the app onboards first and calls POST /connect.
if (manager.configured) {
	manager.connect()
}

const server = app.listen(PORT, HOST, () => {
	// eslint-disable-next-line no-console
	console.log(`[nc-roomba-bridge] listening on ${HOST}:${PORT} (mock=${manager.mock ? 1 : 0})`)
})

const shutdown = () => {
	manager.disconnect()
	server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

module.exports = { app, manager, server }
