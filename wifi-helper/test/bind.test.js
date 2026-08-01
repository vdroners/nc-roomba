'use strict'

/**
 * The helper is a root HTTP service that can reconfigure the host wireless
 * interface. These lock down its exposure: where it listens, and how it decides
 * a caller is allowed in.
 */

const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')

process.env.ROOMBA_WIFI_HELPER_MOCK = '1'
process.env.ROOMBA_WIFI_HELPER_TOKEN = 'bind-test-token'

const { app, resolveBindHosts, dockerGatewayAddress, tokenMatches } = require('../index')

const DOCKER_IFACES = {
	lo: [{ family: 'IPv4', address: '127.0.0.1' }],
	docker0: [
		{ family: 'IPv6', address: 'fe80::1' },
		{ family: 'IPv4', address: '172.17.0.1' },
	],
	wlp2s0: [{ family: 'IPv4', address: '10.0.0.84' }],
}

test('dockerGatewayAddress picks the IPv4 address of the docker bridge', () => {
	assert.equal(dockerGatewayAddress('docker0', DOCKER_IFACES), '172.17.0.1')
	assert.equal(dockerGatewayAddress('docker0', { lo: [] }), null)
	assert.equal(dockerGatewayAddress('nope', DOCKER_IFACES), null)
})

test('default bind is loopback plus the docker gateway — never 0.0.0.0', () => {
	const hosts = resolveBindHosts({}, '172.17.0.1')
	assert.deepEqual(hosts, ['127.0.0.1', '172.17.0.1'])
	assert.equal(hosts.includes('0.0.0.0'), false)

	// No Docker on the host: loopback only.
	assert.deepEqual(resolveBindHosts({}, null), ['127.0.0.1'])
})

test('ROOMBA_WIFI_HELPER_BIND still wins, and accepts a list', () => {
	assert.deepEqual(resolveBindHosts({ ROOMBA_WIFI_HELPER_BIND: '0.0.0.0' }, '172.17.0.1'), ['0.0.0.0'])
	assert.deepEqual(
		resolveBindHosts({ ROOMBA_WIFI_HELPER_BIND: '127.0.0.1, 10.0.0.84 ,127.0.0.1' }, null),
		['127.0.0.1', '10.0.0.84'],
	)
})

test('tokenMatches is exact and never true for an empty side', () => {
	assert.equal(tokenMatches('s3cret', 's3cret'), true)
	assert.equal(tokenMatches('s3cre', 's3cret'), false)
	assert.equal(tokenMatches('s3crett', 's3cret'), false)
	assert.equal(tokenMatches('', 's3cret'), false)
	assert.equal(tokenMatches('s3cret', ''), false)
	assert.equal(tokenMatches(undefined, 's3cret'), false)
})

/**
 * @param {import('http').Server} server
 * @param {string} method
 * @param {string} path
 * @param {object|null} [body]
 * @param {Record<string,string>} [headers]
 */
function request(server, method, path, body = null, headers = {}) {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : null
		const req = http.request({
			host: '127.0.0.1',
			port: server.address().port,
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

test('?token= is not accepted; header and body are; /health leaks no interface name', async () => {
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s))
	})
	try {
		const health = await request(server, 'GET', '/health')
		assert.equal(health.status, 200)
		assert.equal(health.json.iface, undefined)
		assert.equal(health.json.token_required, true)

		// Query strings land in access logs and Referer headers.
		const viaQuery = await request(server, 'POST', '/wifi/scan?token=bind-test-token', {})
		assert.equal(viaQuery.status, 401)

		const wrong = await request(server, 'POST', '/wifi/scan', {}, { 'x-roomba-helper-token': 'nope' })
		assert.equal(wrong.status, 401)

		const viaHeader = await request(server, 'POST', '/wifi/scan', {}, { 'x-roomba-helper-token': 'bind-test-token' })
		assert.equal(viaHeader.status, 200)

		const viaBody = await request(server, 'POST', '/wifi/scan', { token: 'bind-test-token' })
		assert.equal(viaBody.status, 200)

		// Every mutating route is gated, not just the one the old test covered.
		for (const [method, path] of [
			['POST', '/wifi/scan'],
			['GET', '/wifi/link'],
			['POST', '/wifi/softap/join'],
			['POST', '/wifi/softap/leave'],
			['POST', '/wifi/softap/provision'],
		]) {
			const res = await request(server, method, path, {})
			assert.equal(res.status, 401, `${method} ${path} must require the token`)
		}
	} finally {
		await new Promise((r) => server.close(r))
	}
})
