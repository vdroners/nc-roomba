'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')

process.env.ROOMBA_WIFI_HELPER_MOCK = '1'

const {
	blidFromSsid,
	makeLocalPassword,
	authExchangePacket,
	provisionSoftAp,
} = require('../lib/provision')
const { channelToFreq, SOFTAP_SSID_RE } = require('../lib/wifi')

test('SOFTAP_SSID_RE matches both factory AP prefixes', () => {
	assert.ok(SOFTAP_SSID_RE.test('Roomba-1A2B3C4D5E6F7788'))
	assert.ok(SOFTAP_SSID_RE.test('iRobot-1A2B3C4D5E6F7788'))
	assert.equal(SOFTAP_SSID_RE.test('Sheela 6'), false)
})

test('blidFromSsid parses Roomba Soft-AP name', () => {
	assert.equal(blidFromSsid('Roomba-1A2B3C4D5E6F7788'), '1A2B3C4D5E6F7788')
	assert.equal(blidFromSsid('iRobot-1A2B3C4D5E6F7788'), '1A2B3C4D5E6F7788')
	assert.equal(blidFromSsid('Sheela 6'), null)
})

test('channelToFreq covers 2.4 and 5 GHz', () => {
	assert.equal(channelToFreq(1), 2412)
	assert.equal(channelToFreq(6), 2437)
	assert.equal(channelToFreq(11), 2462)
	assert.equal(channelToFreq(14), 2484)
	assert.equal(channelToFreq(36), 5180)
	assert.equal(channelToFreq(null), null)
})

test('makeLocalPassword matches :1:epoch:secret shape', () => {
	const p = makeLocalPassword()
	assert.match(p, /^:1:\d{10}:[0-9a-f]{16}$/)
})

test('authExchangePacket starts with MQTT auth-exchange header', () => {
	const p = makeLocalPassword()
	const pkt = authExchangePacket(p)
	assert.equal(pkt[0], 0xf0)
	assert.equal(pkt[1], 5 + Buffer.byteLength(p))
	assert.equal(pkt.subarray(2, 7).toString('hex'), 'efcc3b2900')
})

test('authExchangePacket uses varint remaining-length past 127 bytes', () => {
	const long = ':1:1700000000:' + 'a'.repeat(200)
	const pkt = authExchangePacket(long)
	const remaining = 5 + Buffer.byteLength(long)
	assert.equal(pkt[0], 0xf0)
	assert.equal(pkt[1], (remaining % 128) | 0x80)
	assert.equal(pkt[2], Math.floor(remaining / 128))
	assert.equal(pkt.subarray(3, 8).toString('hex'), 'efcc3b2900')
})

test('mock provisionSoftAp returns blid + password', async () => {
	const result = await provisionSoftAp({
		ssid: 'Sheela 6',
		pass: 'secret',
		robotSsid: 'Roomba-1A2B3C4D5E6F7788',
	})
	assert.equal(result.blid, '1A2B3C4D5E6F7788')
	assert.match(result.password, /^:1:/)
	assert.equal(result.mock, true)
	assert.ok(result.steps.length >= 3)
})
