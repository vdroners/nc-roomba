'use strict'

/**
 * Same OpenSSL-3 legacy renegotiation shim as the bridge — Roomba Soft-AP
 * MQTT on :8883 needs SECLEVEL=0 + LEGACY_SERVER_CONNECT.
 */
const tls = require('node:tls')
const crypto = require('node:crypto')

const LEGACY_SERVER_CONNECT = crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
const ROOMBA_PORT = 8883
const origConnect = tls.connect.bind(tls)

tls.connect = function patchedConnect(...args) {
	const opts = args[0]
	if (opts && typeof opts === 'object' && Number(opts.port) === ROOMBA_PORT) {
		opts.secureOptions = (opts.secureOptions || 0) | LEGACY_SERVER_CONNECT
		if (!opts.minVersion) {
			opts.minVersion = 'TLSv1'
		}
		if (!opts.ciphers || opts.ciphers === 'AES128-SHA256') {
			opts.ciphers = process.env.ROBOT_CIPHERS || 'DEFAULT@SECLEVEL=0'
		}
	}
	return origConnect(...args)
}

module.exports = { patched: true }
