'use strict'

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const IFACE = process.env.ROOMBA_WIFI_IFACE || 'wlp2s0'
const SOFTAP_IP = process.env.ROOMBA_SOFTAP_CLIENT_IP || '192.168.10.10'
const SOFTAP_GW = process.env.ROOMBA_SOFTAP_GW || '192.168.10.1'
const SOFTAP_PREFIX = Number(process.env.ROOMBA_SOFTAP_PREFIX || 24)

// Roomba 900/i/s series advertise Roomba-<BLID>; Braava and some newer
// units advertise iRobot-<BLID>.
const SOFTAP_SSID_RE = /^(Roomba|iRobot)-/i

/**
 * @param {number|null|undefined} chan
 * @returns {number|null} centre frequency in MHz
 */
function channelToFreq(chan) {
	const n = Number(chan)
	if (!Number.isFinite(n) || n <= 0) {
		return null
	}
	if (n === 14) {
		return 2484
	}
	if (n <= 13) {
		return 2407 + n * 5
	}
	return 5000 + n * 5
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{timeout?:number}} [opts]
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
async function run(cmd, args, opts = {}) {
	return execFileAsync(cmd, args, {
		timeout: opts.timeout || 60_000,
		maxBuffer: 2 * 1024 * 1024,
		env: process.env,
	})
}

const REGDOM = process.env.ROOMBA_WIFI_REGDOM || 'US'

/**
 * A prior Soft-AP session leaves the radio down + unmanaged, and NetworkManager
 * silently returns an empty scan list in that state. Always restore
 * managed + up before scanning.
 *
 * The regulatory domain is set to a real country (default US) as well: an
 * unset "country 00" regdom limits channel-1 TX power enough that association
 * to a weak open Soft-AP can silently fail.
 */
async function ensureRadioUp() {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return
	}
	await run('nmcli', ['radio', 'wifi', 'on']).catch(() => {})
	await run('iw', ['reg', 'set', REGDOM]).catch(() => {})
	await run('nmcli', ['device', 'set', IFACE, 'managed', 'yes']).catch(() => {})
	await run('ip', ['link', 'set', IFACE, 'up']).catch(() => {})
	await new Promise((r) => setTimeout(r, 1200))
}

/**
 * Handing the radio to `managed no` drops the link asynchronously, so an
 * immediate `iw connect` races it and fails with "Network is down (-100)".
 * Bring the link up and wait for the kernel to report the UP flag.
 *
 * @param {number} [timeoutMs]
 */
async function waitLinkUp(timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs
	let lastErr = null
	while (Date.now() < deadline) {
		await run('ip', ['link', 'set', IFACE, 'up']).catch((e) => { lastErr = e })
		try {
			const { stdout } = await run('ip', ['-br', 'link', 'show', IFACE])
			if (/[<,]UP[,>]/.test(stdout)) {
				return true
			}
		} catch (e) {
			lastErr = e
		}
		await new Promise((r) => setTimeout(r, 500))
	}
	const err = new Error(`interface ${IFACE} never came up${lastErr ? `: ${lastErr.message}` : ''}`)
	err.status = 503
	throw err
}

/**
 * `iw connect` returns as soon as the request is queued — it does NOT wait for
 * the association/carrier to actually come up. On some drivers the connect
 * "succeeds" while the link stays NO-CARRIER, which then makes the static IP
 * assignment and gateway ping fail with no obvious cause. Poll `iw link` until
 * the kernel reports we are actually associated.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<{connected:boolean,ssid:string|null}>}
 */
async function waitAssociated(timeoutMs = 12_000) {
	const deadline = Date.now() + timeoutMs
	let last = 'Not connected.'
	while (Date.now() < deadline) {
		try {
			const { stdout } = await run('iw', ['dev', IFACE, 'link'])
			last = stdout.trim()
			if (/Connected to/i.test(stdout)) {
				const m = stdout.match(/SSID:\s*(.+)/)
				return { connected: true, ssid: m ? m[1].trim() : null }
			}
		} catch { /* transient while associating */ }
		await new Promise((r) => setTimeout(r, 500))
	}
	const err = new Error(`association never completed on ${IFACE} (last: ${last})`)
	err.status = 502
	throw err
}

/**
 * @returns {Promise<Array<{ssid:string,bssid:string,chan:number|null,signal:number|null,security:string}>>}
 */
async function scanWifi() {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return [{
			ssid: 'Roomba-3165811C32410750',
			bssid: '80:C5:F2:C4:15:DE',
			chan: 1,
			signal: 60,
			security: '--',
		}, {
			ssid: 'Sheela 6',
			bssid: 'BA:5E:71:FF:A5:D9',
			chan: 1,
			signal: 100,
			security: 'WPA2',
		}]
	}

	await ensureRadioUp()
	await run('nmcli', ['device', 'wifi', 'rescan', 'ifname', IFACE]).catch(() => {})
	await new Promise((r) => setTimeout(r, 2500))

	// A radio that just came up can report an empty list on the first pass.
	let stdout = ''
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await run('nmcli', [
			'-t', '-f', 'SSID,BSSID,CHAN,SIGNAL,SECURITY',
			'device', 'wifi', 'list', 'ifname', IFACE, '--rescan', attempt === 0 ? 'yes' : 'auto',
		])
		stdout = res.stdout
		if (stdout.trim()) {
			break
		}
		await new Promise((r) => setTimeout(r, 2500))
	}

	const rows = []
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue
		// nmcli -t escapes : as \:
		const parts = []
		let cur = ''
		for (let i = 0; i < line.length; i++) {
			if (line[i] === '\\' && line[i + 1] === ':') {
				cur += ':'
				i++
			} else if (line[i] === ':') {
				parts.push(cur)
				cur = ''
			} else {
				cur += line[i]
			}
		}
		parts.push(cur)
		const [ssid, bssid, chan, signal, security] = parts
		if (!ssid && !bssid) continue
		rows.push({
			ssid: ssid || '',
			bssid: (bssid || '').toUpperCase(),
			chan: chan ? Number(chan) : null,
			signal: signal ? Number(signal) : null,
			security: security || '',
		})
	}
	return rows
}

/**
 * @returns {Promise<Array<{ssid:string,bssid:string,chan:number|null,signal:number|null,security:string}>>}
 */
async function scanRoombaAps() {
	const all = await scanWifi()
	return all.filter((r) => SOFTAP_SSID_RE.test(r.ssid))
}

/**
 * Join an open Soft-AP with a static IP; never become the default route.
 *
 * @param {{ssid:string,bssid?:string,chan?:number}} ap
 */
async function joinSoftAp(ap) {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return { ok: true, mock: true, iface: IFACE, client_ip: SOFTAP_IP, gateway: SOFTAP_GW }
	}

	const ssid = String(ap.ssid || '').trim()
	if (!ssid) {
		const err = new Error('ssid is required')
		err.status = 400
		throw err
	}
	const bssid = ap.bssid ? String(ap.bssid).trim() : ''
	// Soft-AP is always 2.4 GHz; default to ch1 when the scan row had no channel.
	const freq = channelToFreq(ap.chan) || 2412

	await ensureRadioUp()
	// Prefer iw for open Soft-AP (NM often mis-classifies as WEP).
	await run('nmcli', ['device', 'set', IFACE, 'managed', 'no']).catch(() => {})
	await waitLinkUp()
	// Soft-AP is short-lived; power-save drops TX and makes DHCP/MQTT fail.
	await run('iw', ['dev', IFACE, 'set', 'power_save', 'off']).catch(() => {})
	await run('iw', ['dev', IFACE, 'disconnect']).catch(() => {})

	const withFreq = ['dev', IFACE, 'connect', '-w', ssid]
	if (freq) withFreq.push(String(freq))
	if (bssid) withFreq.push(bssid)
	const attempts = [
		withFreq,
		['dev', IFACE, 'connect', '-w', ssid],
		['dev', IFACE, 'connect', ssid],
	]

	let joined = false
	let lastErr = null
	for (const args of attempts) {
		for (let retry = 0; retry < 2 && !joined; retry++) {
			try {
				await waitLinkUp()
				await run('iw', args, { timeout: 30_000 })
				// iw connect returns before association finishes — verify carrier.
				await waitAssociated()
				joined = true
			} catch (e) {
				lastErr = e
				await run('iw', ['dev', IFACE, 'disconnect']).catch(() => {})
				await new Promise((r) => setTimeout(r, 1500))
			}
		}
		if (joined) break
	}
	if (!joined) {
		const err = new Error(`could not associate with ${ssid}: ${lastErr ? lastErr.message : 'unknown error'}`)
		err.status = 502
		throw err
	}

	await run('ip', ['addr', 'flush', 'dev', IFACE]).catch(() => {})
	await run('ip', ['addr', 'add', `${SOFTAP_IP}/${SOFTAP_PREFIX}`, 'dev', IFACE])
	await run('ip', ['route', 'replace', `${SOFTAP_GW.replace(/\.\d+$/, '.0')}/${SOFTAP_PREFIX}`, 'dev', IFACE, 'metric', '2000']).catch(() => {})

	return { ok: true, iface: IFACE, client_ip: SOFTAP_IP, gateway: SOFTAP_GW, ssid, bssid }
}

/**
 * Wait until Soft-AP gateway answers ICMP or :8883.
 *
 * @param {number} [timeoutMs]
 */
async function waitSoftApReady(timeoutMs = 60_000) {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return { ok: true, mock: true, gateway: SOFTAP_GW, ready: true }
	}
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			await run('ping', ['-c', '1', '-W', '1', '-I', IFACE, SOFTAP_GW], { timeout: 5000 })
			return { ok: true, gateway: SOFTAP_GW, ready: true }
		} catch {
			// try TCP 8883
			try {
				await new Promise((resolve, reject) => {
					const net = require('node:net')
					const sock = net.connect({ host: SOFTAP_GW, port: 8883 }, () => {
						sock.end()
						resolve()
					})
					sock.setTimeout(1500)
					sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')) })
					sock.on('error', reject)
				})
				return { ok: true, gateway: SOFTAP_GW, ready: true, via: 'tcp8883' }
			} catch {
				await new Promise((r) => setTimeout(r, 1500))
			}
		}
	}
	const err = new Error(
		`Soft-AP gateway ${SOFTAP_GW} never responded — wait for the robot to say you are connected, then retry`,
	)
	err.status = 504
	throw err
}

async function leaveSoftAp() {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return { ok: true, mock: true }
	}
	await run('iw', ['dev', IFACE, 'disconnect']).catch(() => {})
	await run('ip', ['addr', 'flush', 'dev', IFACE]).catch(() => {})
	// Hand the radio back to NetworkManager UP, not down: a down interface makes
	// every later `nmcli device wifi list` return an empty set.
	await run('nmcli', ['device', 'set', IFACE, 'managed', 'yes']).catch(() => {})
	await run('ip', ['link', 'set', IFACE, 'up']).catch(() => {})
	return { ok: true }
}

async function linkStatus() {
	if (process.env.ROOMBA_WIFI_HELPER_MOCK === '1') {
		return { ok: true, mock: true, iface: IFACE, connected: false }
	}
	try {
		const { stdout } = await run('iw', ['dev', IFACE, 'link'])
		const connected = /Connected to/i.test(stdout)
		const ssidMatch = stdout.match(/SSID:\s*(.+)/)
		return {
			ok: true,
			iface: IFACE,
			connected,
			ssid: ssidMatch ? ssidMatch[1].trim() : null,
			raw: stdout.trim(),
		}
	} catch (e) {
		return { ok: false, iface: IFACE, connected: false, error: e.message }
	}
}

module.exports = {
	IFACE,
	SOFTAP_IP,
	SOFTAP_GW,
	SOFTAP_SSID_RE,
	channelToFreq,
	ensureRadioUp,
	waitLinkUp,
	waitAssociated,
	scanWifi,
	scanRoombaAps,
	joinSoftAp,
	waitSoftApReady,
	leaveSoftAp,
	linkStatus,
}
