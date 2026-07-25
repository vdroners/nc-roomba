#!/usr/bin/env node
'use strict'

/**
 * Phase-0 Soft-AP dogfood against the host wifi-helper.
 *
 * Usage:
 *   ROOMBA_WIFI_HELPER_URL=http://127.0.0.1:8091 \
 *   ROOMBA_WIFI_HELPER_TOKEN=... \
 *   HOME_SSID='Sheela 6' HOME_PASS='...' \
 *   node scripts/softap-dogfood.js [Roomba-SSID]
 *
 * Operator must put the robot in Soft-AP first:
 *   1) CLEAN until all lights flash
 *   2) HOME + SPOT until melody / green Wi-Fi blink
 *   3) Wait for spoken "connected to Roomba" after the helper joins
 */

const HELPER = (process.env.ROOMBA_WIFI_HELPER_URL || 'http://127.0.0.1:8091').replace(/\/$/, '')
const TOKEN = process.env.ROOMBA_WIFI_HELPER_TOKEN || ''
const HOME_SSID = process.env.HOME_SSID || 'Sheela 6'
const HOME_PASS = process.env.HOME_PASS || ''

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 */
async function helper(method, path, body) {
	const headers = { Accept: 'application/json' }
	if (TOKEN) headers['x-roomba-helper-token'] = TOKEN
	let payload
	if (body) {
		payload = JSON.stringify(body)
		headers['Content-Type'] = 'application/json'
	}
	const res = await fetch(`${HELPER}${path}`, { method, headers, body: payload })
	const json = await res.json().catch(() => ({}))
	if (!res.ok || json.ok === false) {
		throw new Error(json.error || `HTTP ${res.status}`)
	}
	return json
}

async function main() {
	if (!HOME_PASS) {
		console.error('HOME_PASS is required')
		process.exit(2)
	}
	console.log('helper health…')
	console.log(await helper('GET', '/health'))

	let robotSsid = process.argv[2] || ''
	if (!robotSsid) {
		console.log('scanning for Roomba Soft-AP…')
		const scan = await helper('POST', '/wifi/scan', { roomba_only: true })
		console.log(scan.networks)
		if (!scan.networks.length) {
			throw new Error('No Roomba-* Soft-AP found — put robot in HOME+SPOT Soft-AP mode')
		}
		robotSsid = scan.networks[0].ssid
	}

	console.log('provisioning', robotSsid, '→', HOME_SSID)
	const result = await helper('POST', '/wifi/softap/provision', {
		robot_ssid: robotSsid,
		ssid: HOME_SSID,
		pass: HOME_PASS,
		timezone: 'America/Los_Angeles',
		country: 'US',
		localtimeoffset: -420,
		wait_ms: 90_000,
		join: true,
		leave: true,
	})
	console.log('SUCCESS')
	console.log(JSON.stringify({
		blid: result.blid,
		password: result.password,
		steps: result.steps,
	}, null, 2))
	console.log('Next: LAN discover + connect with this password (force-quit iRobot app).')
}

main().catch((e) => {
	console.error('FAIL', e.message || e)
	process.exit(1)
})
