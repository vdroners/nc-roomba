'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')

process.env.ROOMBA_WIFI_HELPER_MOCK = '1'
process.env.ROOMBA_WIFI_HELPER_TOKEN = 'test-token'

const { app } = require('../index')

/**
 * @param {import('http').Server} server
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {Record<string,string>} [headers]
 */
function request(server, method, path, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const addr = server.address()
		const payload = body ? JSON.stringify(body) : null
		const req = http.request({
			host: '127.0.0.1',
			port: addr.port,
			method,
			path,
			headers: {
				...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
				...headers,
			},
		}, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				const raw = Buffer.concat(chunks).toString('utf8')
				let json = null
				try { json = JSON.parse(raw) } catch { /* ignore */ }
				resolve({ status: res.statusCode, json, raw })
			})
		})
		req.on('error', reject)
		if (payload) req.write(payload)
		req.end()
	})
}

test('health + token-gated scan/provision in mock mode', async () => {
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s))
	})
	try {
		const health = await request(server, 'GET', '/health')
		assert.equal(health.status, 200)
		assert.equal(health.json.ok, true)
		assert.equal(health.json.mock, true)

		const denied = await request(server, 'POST', '/wifi/scan', { roomba_only: true })
		assert.equal(denied.status, 401)

		const scan = await request(server, 'POST', '/wifi/scan', { roomba_only: true }, {
			'x-roomba-helper-token': 'test-token',
		})
		assert.equal(scan.status, 200)
		assert.ok(scan.json.networks.some((n) => /^Roomba-/.test(n.ssid)))

		const prov = await request(server, 'POST', '/wifi/softap/provision', {
			robot_ssid: 'Roomba-3165811C32410750',
			ssid: 'Sheela 6',
			pass: 'secret',
			join: true,
			leave: true,
		}, { 'x-roomba-helper-token': 'test-token' })
		assert.equal(prov.status, 200)
		assert.equal(prov.json.blid, '3165811C32410750')
		assert.match(prov.json.password, /^:1:/)
	} finally {
		await new Promise((r) => server.close(r))
	}
})
