'use strict'

/**
 * Roomba fw2 robots (e.g. the 960) run an old TLS stack that does NOT support
 * RFC 5746 secure renegotiation and only offers legacy ciphers. OpenSSL 3
 * (bundled with Node >= 17) refuses both by default, so the local MQTT session
 * fails its TLS handshake with ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED and
 * loops offline/close with no surfaced error.
 *
 * dorita980 v2 builds its own mqtt.connect() options and does not expose the
 * TLS knobs we need, so patch tls.connect once at startup to inject them for
 * the robot's :8883 endpoint only. Everything else keeps the secure defaults.
 *
 * Require this module BEFORE requiring dorita980.
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
		// dorita980 hard-codes 'AES128-SHA256', which OpenSSL 3 rejects at its
		// default security level. Drop to SECLEVEL 0 so DHE-RSA-AES256-SHA256
		// negotiates. Operator can override via ROBOT_CIPHERS.
		if (!opts.ciphers || opts.ciphers === 'AES128-SHA256') {
			opts.ciphers = process.env.ROBOT_CIPHERS || 'DEFAULT@SECLEVEL=0'
		}
	}
	return origConnect(...args)
}

module.exports = { patched: true }
