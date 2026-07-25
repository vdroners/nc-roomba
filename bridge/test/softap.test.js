'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')

const { RobotManager } = require('../lib/robotManager')

test('softapProvision mock path returns blid/password and done status', async () => {
	const manager = new RobotManager({
		ROOMBA_MOCK: '1',
		ROOMBA_MOCK_TICK_MS: '3600000',
		ROOMBA_WIFI_HELPER_MOCK: '1',
	})
	const result = await manager.softapProvision({
		home_ssid: 'Sheela 6',
		home_pass: 'secret',
		robot_ssid: 'Roomba-3165811C32410750',
		discover: false,
		connect: false,
		name: 'Alfred',
	})
	assert.equal(result.ok, true)
	assert.equal(result.blid, '3165811C32410750')
	assert.match(result.password, /^:1:/)
	assert.equal(manager.getSoftapStatus().phase, 'done')
	assert.equal(manager.getSoftapStatus().ok, true)
	manager.disconnect()
})

test('scanSoftAp mock returns Roomba network', async () => {
	const manager = new RobotManager({ ROOMBA_MOCK: '1', ROOMBA_WIFI_HELPER_MOCK: '1' })
	const scan = await manager.scanSoftAp(true)
	assert.ok(scan.networks.some((n) => n.ssid.startsWith('Roomba-')))
	manager.disconnect()
})

test('softapProvision rejects concurrent runs', async () => {
	const manager = new RobotManager({ ROOMBA_MOCK: '1', ROOMBA_WIFI_HELPER_MOCK: '1' })
	manager._softapRunning = true
	await assert.rejects(() => manager.softapProvision({
		home_ssid: 'Sheela 6',
		home_pass: 'x',
		discover: false,
		connect: false,
	}), (err) => err.status === 409)
	manager.disconnect()
})
