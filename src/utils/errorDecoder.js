/**
 * Client-side view logic for the error decoder panel.
 *
 * The catalog itself is server-side (`knowledge/error_codes.yaml` via
 * `ErrorDecoderService`) so notifications, Activity and this panel all quote the
 * same copy. These helpers only decide *whether* to show the panel and how to
 * present a code the server had no entry for.
 */

/** Codes the robot reports while it is perfectly healthy. */
const OK_KINDS = ['ok', 'none']

/** iRobot 9xx `cleanMissionStatus.notReady` code for "bin full". */
export const NOT_READY_BIN_FULL = 16

/** Fallback copy; the server catalog (`knowledge/error_codes.yaml` not_ready 16) is the source of truth. */
const BIN_FULL_COPY = {
	title: 'Bin full: empty the bin',
	detail: 'Roomba won\'t start a new clean while the dust bin is full. Waiting will not clear it.',
	action: 'Empty the bin, push it back in until it clicks, then press Clean. This alert clears by itself once Roomba sees an empty bin.',
}

/**
 * A full bin never clears by waiting, so it outranks the generic notReady copy.
 *
 * @param {object|null} state enriched (or raw-ish) state DTO
 * @returns {boolean} true when the bin sensor, notReady 16 or the server decode says full
 */
export function isBinFull(state) {
	if (!state) {
		return false
	}
	const decoded = state.decoded_error || {}
	return state.bin === 'full'
		|| Number(state.not_ready ?? state.notReady ?? 0) === NOT_READY_BIN_FULL
		|| decoded.kind === 'bin_full'
}

/**
 * @param {object|null} state enriched state DTO
 * @returns {boolean} true when `error` or `not_ready` is non-zero
 */
export function hasFault(state) {
	if (!state) {
		return false
	}
	return Number(state.error || 0) !== 0
		|| Number(state.not_ready || state.notReady || 0) !== 0
		|| isBinFull(state)
}

/**
 * @param {object|null} state enriched state DTO
 * @returns {'error'|'warning'|'success'} NcNoteCard severity
 */
export function faultSeverity(state) {
	if (!state) {
		return 'success'
	}
	if (Number(state.error || 0) !== 0) {
		return 'error'
	}
	// notReady is "cannot start yet" (bin out, on a cliff, still docked wrong) —
	// annoying but not a failed mission.
	return Number(state.not_ready || state.notReady || 0) !== 0 || isBinFull(state) ? 'warning' : 'success'
}

/**
 * Resolve what the panel renders: the server-decoded entry when present, an
 * honest placeholder when the catalog has no row for this code.
 *
 * @param {object|null} state enriched state DTO
 * @returns {{ show: boolean, severity: string, code: number, kind: string, title: string, detail: string, action: string }}
 */
export function decoratedError(state) {
	const error = Number((state && state.error) || 0)
	const notReady = Number((state && (state.not_ready ?? state.notReady)) || 0)
	let decoded = (state && state.decoded_error) || {}
	// Belt-and-braces for an older server that still decodes 16 as "just docked":
	// with no real error, a full bin always gets the bin-full copy.
	if (error === 0 && isBinFull(state) && decoded.kind !== 'bin_full') {
		decoded = {
			code: notReady === NOT_READY_BIN_FULL ? notReady : 0,
			kind: 'bin_full',
			title: BIN_FULL_COPY.title,
			detail: BIN_FULL_COPY.detail,
			action: BIN_FULL_COPY.action,
		}
	}
	const code = Number(decoded.code ?? (error !== 0 ? error : notReady))
	const kind = decoded.kind || (error !== 0 ? 'error' : (notReady !== 0 ? 'not_ready' : 'ok'))
	const show = hasFault(state) && !OK_KINDS.includes(kind)

	const title = decoded.title
		|| (error !== 0 ? `Robot error ${error}` : `Robot not ready (${notReady})`)
	const detail = decoded.detail
		|| 'This code is not in the local catalog yet. Check the robot for a physical obstruction, then retry.'

	return {
		show,
		severity: faultSeverity(state),
		code,
		kind,
		title,
		detail,
		action: decoded.action || '',
	}
}

/**
 * @param {object|null} state enriched state DTO
 * @returns {boolean} true when the bridge could not own the MQTT session
 */
export function isConflict(state) {
	if (!state) {
		return false
	}
	const health = state.connection_health || {}
	return Boolean(state.conflict || health.conflict || health.mqtt === 'conflict')
}

/**
 * @param {object|null} state enriched state DTO
 * @returns {boolean} true when the last sample is too old to trust
 */
export function isStale(state) {
	return Boolean(state && state.connection_health && state.connection_health.stale)
}
