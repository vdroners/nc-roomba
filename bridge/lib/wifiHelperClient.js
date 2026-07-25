'use strict'

/**
 * HTTP client for the privileged host Soft-AP helper.
 */

const DEFAULT_URL = process.env.ROOMBA_WIFI_HELPER_URL || 'http://host.docker.internal:8091'

class WifiHelperClient {
	/**
	 * @param {object} [env]
	 */
	constructor(env = process.env) {
		this.baseUrl = String(env.ROOMBA_WIFI_HELPER_URL || DEFAULT_URL).replace(/\/$/, '')
		this.token = String(env.ROOMBA_WIFI_HELPER_TOKEN || '')
		this.timeoutMs = Number(env.ROOMBA_WIFI_HELPER_TIMEOUT_MS || 120_000)
	}

	/**
	 * @param {string} method
	 * @param {string} path
	 * @param {object|null} [body]
	 * @param {number} [timeoutMs]
	 */
	async request(method, path, body = null, timeoutMs = this.timeoutMs) {
		const url = `${this.baseUrl}${path}`
		const headers = { Accept: 'application/json' }
		if (this.token) {
			headers['x-roomba-helper-token'] = this.token
		}
		const ctrl = new AbortController()
		const timer = setTimeout(() => ctrl.abort(), timeoutMs)
		try {
			/** @type {RequestInit} */
			const init = { method, headers, signal: ctrl.signal }
			if (body !== null) {
				headers['Content-Type'] = 'application/json'
				init.body = JSON.stringify(body)
			}
			const res = await fetch(url, init)
			const text = await res.text()
			let json = null
			try { json = JSON.parse(text) } catch { /* ignore */ }
			if (!res.ok) {
				const err = new Error((json && json.error) || `wifi-helper HTTP ${res.status}`)
				err.status = res.status >= 400 && res.status < 600 ? res.status : 502
				err.body = json
				throw err
			}
			return json || { ok: true, raw: text }
		} catch (e) {
			if (e.name === 'AbortError') {
				const err = new Error('wifi-helper timeout')
				err.status = 504
				throw err
			}
			if (e.status) throw e
			const err = new Error(e.message || String(e))
			err.status = 502
			throw err
		} finally {
			clearTimeout(timer)
		}
	}

	health() {
		return this.request('GET', '/health', null, 5000)
	}

	scan(roombaOnly = true) {
		return this.request('POST', '/wifi/scan', { roomba_only: roombaOnly }, 30_000)
	}

	/**
	 * @param {object} body
	 */
	provision(body) {
		return this.request('POST', '/wifi/softap/provision', body, 180_000)
	}

	leave() {
		return this.request('POST', '/wifi/softap/leave', {}, 30_000)
	}
}

module.exports = { WifiHelperClient, DEFAULT_URL }
