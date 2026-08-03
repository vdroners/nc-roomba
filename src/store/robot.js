import { defineStore } from 'pinia'

import * as api from '../services/api.js'
import { ageSeconds } from '../utils/format.js'
import { decoratedError, hasFault, isConflict, isStale } from '../utils/errorDecoder.js'

/** Poll cadence when SSE is unavailable (notify_push not required). */
const POLL_MS = 3000
/**
 * Safety-net poll cadence that runs even while SSE is "connected". SSE can
 * silently stall behind a buffering proxy (the stream stays open but no frames
 * arrive), which felt like a dead UI. A slow background poll guarantees the
 * data still refreshes without waiting for the stream to error out.
 */
const SSE_BACKUP_POLL_MS = 6000
/**
 * Consecutive SSE failures tolerated before giving up on the stream.
 *
 * An EventSource fires `error` on *every* close, including the ordinary
 * close-then-reconnect that ends a healthy short-lived stream. At 1 a single
 * normal cycle abandoned SSE permanently and the app spent the rest of the
 * session on the 3 s poll. The counter resets on every received frame, so this
 * only trips when several connection attempts in a row deliver nothing.
 */
const SSE_MAX_FAILURES = 5
/** Client-side live timeline cap — history detail reads the persisted events. */
const MAX_LIVE_EVENTS = 60

/**
 * Optimistic phase hint per action. The robot takes a second or two to report
 * the new phase; without a hint the button feels dead. Reverted on error and
 * overwritten by the next real sample either way.
 */
// Live-pipeline handles live outside the reactive store: an EventSource and
// interval ids are not state, and keeping them here means `$state` stays
// serialisable (and Vue never tries to make a socket reactive).
let liveSource = null
let pollTimer = null
let ageTimer = null
/** Bound handler for tab focus/visibility so we can add and remove the same ref. */
let focusHandler = null

const OPTIMISTIC_PHASE = {
	clean: 'run',
	pause: 'pause',
	resume: 'run',
	stop: 'stop',
	dock: 'hmUsrDock',
}

export const useRobotStore = defineStore('robot', {
	state: () => ({
		/** @type {object|null} enriched state DTO from PHP */
		state: null,
		/** @type {object} page bootstrap (permissions, robot id, app version) */
		bootstrap: {},
		/** @type {object[]} */
		missions: [],
		/** @type {boolean} did the robot echo the last preference write back? */
		preferencesConfirmed: true,
		/** @type {object|null} */
		selectedMission: null,
		/** @type {object|null} dorita980 week shape */
		schedule: null,
		/** @type {object|null} */
		preferences: null,
		/** @type {Array<{ ts: number, phase: string, cycle: string|null }>} live phase bands */
		phaseEvents: [],
		/** @type {'idle'|'sse'|'poll'} which live pipeline is active */
		transport: 'idle',
		drawerOpen: false,
		/**
		 * Transient read error (a failed poll / list fetch). Cleared by the next
		 * successful read, which is correct: the condition it describes is gone.
		 *
		 * @type {string|null}
		 */
		error: null,
		/**
		 * Sticky failure from an operator *command*. Kept apart from `error`
		 * because the background poll runs every 3–6 s and used to wipe the
		 * message before anyone could read it. Only `dismissActionError()`
		 * clears it — or the next command, which supersedes it.
		 *
		 * @type {string|null}
		 */
		actionError: null,
		/** @type {string|null} the action `actionError` belongs to */
		actionErrorFor: null,
		/** @type {string|null} action currently in flight */
		actionPending: null,
		lastSeenAgeS: 0,
		loading: false,
		sseFailures: 0,
	}),

	getters: {
		robotId: (state) => Number(
			state.bootstrap.robot_id
			|| (state.bootstrap.robot && state.bootstrap.robot.id)
			|| (state.state && state.state.robot_id)
			|| api.DEFAULT_ROBOT_ID,
		),
		connected: (state) => Boolean(state.state && state.state.connected),
		conflict: (state) => isConflict(state.state),
		conflictMessage: (state) => {
			const health = (state.state && state.state.connection_health) || {}
			return state.state?.conflict || health.conflict || ''
		},
		stale: (state) => isStale(state.state),
		hasSample: (state) => Boolean(state.state && state.state.updated_at),
		fault: (state) => hasFault(state.state),
		decodedError: (state) => decoratedError(state.state),
		hints: (state) => (state.state && state.state.maintenance_hints) || [],
		bbrun: (state) => (state.state && state.state.bbrun) || {},
		bbmssn: (state) => (state.state && state.state.bbmssn) || {},
		softwareVersion: (state) => (state.state && state.state.software_version) || '',
		sku: (state) => (state.state && state.state.sku) || '',
		alfred: (state) => (state.bootstrap && state.bootstrap.alfred) || { enabled: false, talk_room: '' },

		/**
		 * The robot's odometer at install time, or null on an install with none.
		 *
		 * Achievements added after 0.10.0 score from here so they measure what this
		 * app witnessed. Without it, a robot arriving with ~1,800 missions behind it
		 * unlocks most of the wall on day one.
		 */
		missionBaseline: (state) => (state.bootstrap && state.bootstrap.mission_baseline) || null,

		/**
		 * Minutes to add to UTC to get the robot's local wall clock.
		 *
		 * Day bucketing and the night-shift badge must use local time: a 17:00
		 * clean in a negative-UTC-offset install lands on the *next* UTC day.
		 */
		localOffsetMin: (state) => {
			const next = (state.state && state.state.next_scheduled) || {}
			const off = Number(next.server_offset_min)
			return Number.isFinite(off) ? off : 0
		},
		nextScheduled: (state) => (state.state && state.state.next_scheduled) || null,
		bridgeInfo: (state) => (state.state && state.state.bridge) || {},
		// The page controller only lets group members and admins render the app at
		// all, and every mutation is re-checked server-side; the flag is here so a
		// read-only bootstrap can grey the controls out instead of failing on POST.
		canOperate: (state) => state.bootstrap.can_operate !== false && state.bootstrap.canOperate !== false,
		canAdmin: (state) => Boolean(state.bootstrap.is_admin || state.bootstrap.canAdmin),
		hasPose: (state) => Boolean(state.state && state.state.has_pose),
		/** Live bands for MissionTimeline; falls back to the current phase. */
		livePhases: (state) => {
			if (state.phaseEvents.length > 0) {
				return state.phaseEvents
			}
			if (!state.state || !state.state.phase) {
				return []
			}
			return [{ ts: Math.floor(Date.now() / 1000), phase: state.state.phase, cycle: state.state.cycle }]
		},
	},

	actions: {
		/**
		 * @param {object} [bootstrap] page bootstrap payload
		 * @param {object} [options]
		 * @param {boolean} [options.live] start the SSE/poll pipeline and age ticker (off in unit tests)
		 * @returns {Promise<void>}
		 */
		async init(bootstrap = {}, options = {}) {
			this.bootstrap = bootstrap || {}
			await this.refresh()
			if (options.live !== false) {
				this.startLive()
				this.startAgeTicker()
				this.startFocusRefresh()
			}
		},

		/**
		 * Prefer SSE for instant updates, but ALWAYS run a slow background poll
		 * alongside it: SSE can stay "open" behind a buffering proxy while no
		 * frames actually arrive, which reads as a frozen UI. The backup poll
		 * keeps data honest; if SSE really is dead we drop to the faster poll.
		 *
		 * ── The server contract ──────────────────────────────────────────────
		 * `GET /api/robots/{id}/stream` is a SHORT-LIVED stream, not a long-poll
		 * that stays open for the session. It emits one well-formed enriched
		 * `state` frame plus a `retry:` hint and then closes. The browser's
		 * EventSource honours `retry:` and reconnects on its own, so the steady
		 * state is a repeating frame → close → reconnect cycle.
		 *
		 * That matters because EventSource reports *every* close as `error`,
		 * with no way to distinguish "server finished cleanly" from "server is
		 * unreachable". So a close is only treated as a failure when no frame
		 * arrived on that connection: `sseFailures` is reset by the `state`
		 * listener, and it takes SSE_MAX_FAILURES *frameless* attempts in a row
		 * before we give up. A tidy close after a good frame costs nothing.
		 */
		startLive() {
			// Safety-net poll runs regardless of SSE health.
			this.startPolling(SSE_BACKUP_POLL_MS)
			if (typeof EventSource !== 'function') {
				return
			}
			this.stopLive()
			try {
				const source = new EventSource(api.streamUrl(this.robotId))
				source.addEventListener('state', (event) => {
					// A delivered frame proves the stream works. Whatever close
					// follows it is the normal end of a short-lived stream.
					this.sseFailures = 0
					try {
						this.applyState(JSON.parse(event.data))
					} catch {
						// A malformed frame is not worth tearing the stream down for.
					}
				})
				source.addEventListener('error', () => {
					this.sseFailures += 1
					if (this.sseFailures >= SSE_MAX_FAILURES) {
						this.stopLive()
						this.startPolling()
					}
				})
				liveSource = source
				this.transport = 'sse'
			} catch {
				this.startPolling()
			}
		},

		/** Refresh immediately when the tab regains focus/visibility. */
		startFocusRefresh() {
			if (focusHandler || typeof document === 'undefined') {
				return
			}
			focusHandler = () => {
				if (document.visibilityState !== 'hidden') {
					this.refresh()
				}
			}
			document.addEventListener('visibilitychange', focusHandler)
			window.addEventListener('focus', focusHandler)
		},

		/**
		 * @param {number} [intervalMs]
		 */
		startPolling(intervalMs = POLL_MS) {
			this.stopPolling()
			pollTimer = setInterval(() => {
				this.refresh()
			}, intervalMs)
			this.transport = 'poll'
		},

		/** Relative "last seen" text must tick even when no sample arrives. */
		startAgeTicker() {
			if (ageTimer) {
				return
			}
			ageTimer = setInterval(() => {
				this.lastSeenAgeS = this.state ? ageSeconds(this.state.updated_at) : 0
			}, 1000)
		},

		stopPolling() {
			if (pollTimer) {
				clearInterval(pollTimer)
				pollTimer = null
			}
		},

		stopLive() {
			if (liveSource) {
				liveSource.close()
				liveSource = null
			}
		},

		/** Release every timer / stream (called on component destroy). */
		dispose() {
			this.stopLive()
			this.stopPolling()
			if (ageTimer) {
				clearInterval(ageTimer)
				ageTimer = null
			}
			if (focusHandler && typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', focusHandler)
				window.removeEventListener('focus', focusHandler)
				focusHandler = null
			}
			this.transport = 'idle'
		},

		/**
		 * @returns {Promise<object|null>} freshly fetched state
		 */
		async refresh() {
			this.loading = true
			try {
				this.applyState(await api.getState(this.robotId))
				this.error = null
			} catch (err) {
				this.error = errorMessage(err, 'Could not read robot state')
			} finally {
				this.loading = false
			}
			return this.state
		},

		/**
		 * Merge a state sample and append a live timeline band on phase change.
		 *
		 * This is a MERGE, not a replace. Frames do not all carry the same keys:
		 * the SSE enriched frame, the poll DTO and the body echoed back by an
		 * action can each omit fields (`maintenance_hints`, `next_scheduled`,
		 * `bbrun`/`bbmssn`, `pose_trail`…). Assigning the frame wholesale blanked
		 * whatever the newest one happened to leave out, so tiles that had real
		 * numbers a second ago flickered to "—".
		 *
		 * Merging is shallow on purpose: nested objects (`mission`, `bbrun`,
		 * `connection_health`) are always emitted whole by the backend, so a
		 * deep merge would keep stale members of a shrinking object instead.
		 *
		 * @param {object|null} dto enriched state DTO (may be partial)
		 */
		applyState(dto) {
			if (!dto || typeof dto !== 'object') {
				return
			}
			const previous = this.state
			// Read phase/cycle/updated_at off the merged result, not the raw frame:
			// a frame that omits them means "unchanged", not "cleared".
			const next = { ...(previous || {}), ...dto }
			this.state = next
			this.lastSeenAgeS = ageSeconds(next.updated_at)
			const changed = !previous || previous.phase !== next.phase || previous.cycle !== next.cycle
			if (changed && next.phase) {
				this.phaseEvents.push({
					ts: Math.floor((Date.parse(next.updated_at) || Date.now()) / 1000),
					phase: next.phase,
					cycle: next.cycle || null,
				})
				if (this.phaseEvents.length > MAX_LIVE_EVENTS) {
					this.phaseEvents.splice(0, this.phaseEvents.length - MAX_LIVE_EVENTS)
				}
			}
			// A fresh mission starts its own timeline.
			if (previous && previous.cycle !== 'none' && next.cycle === 'none') {
				this.phaseEvents = this.phaseEvents.slice(-1)
			}
		},

		/**
		 * @param {string} action clean|pause|resume|stop|dock|find
		 * @returns {Promise<object|null>} server result, or null when it failed
		 */
		async doAction(action) {
			if (this.actionPending) {
				return null
			}
			const rollbackPhase = this.state ? this.state.phase : null
			this.actionPending = action
			this.error = null
			// A new command supersedes the previous command's verdict.
			this.actionError = null
			this.actionErrorFor = null
			if (this.state && OPTIMISTIC_PHASE[action]) {
				this.state = { ...this.state, phase: OPTIMISTIC_PHASE[action] }
			}
			try {
				const result = await api.postAction(action, this.robotId)
				await this.refresh()
				return result
			} catch (err) {
				if (this.state) {
					this.state = { ...this.state, phase: rollbackPhase }
				}
				// Sticky, NOT `this.error`: refresh() nulls `error` on its next
				// success, and the poll fires within 3–6 s, so putting a command
				// failure there meant the operator never saw why the robot
				// ignored them. This one waits for an explicit dismiss.
				this.actionError = errorMessage(err, `Could not ${action}`)
				this.actionErrorFor = action
				if (isConflict(this.state) || /conflict/i.test(this.actionError)) {
					this.drawerOpen = true
				}
				return null
			} finally {
				this.actionPending = null
			}
		},

		/** @returns {Promise<object[]>} */
		async loadMissions() {
			try {
				this.missions = await api.getMissions(this.robotId)
			} catch (err) {
				this.error = errorMessage(err, 'Could not load history')
			}
			return this.missions
		},

		/**
		 * @param {number} id mission id
		 * @returns {Promise<object|null>}
		 */
		async loadMission(id) {
			try {
				this.selectedMission = await api.getMission(id)
			} catch (err) {
				this.error = errorMessage(err, 'Could not load mission')
			}
			return this.selectedMission
		},

		clearMission() {
			this.selectedMission = null
		},

		/** @returns {Promise<object|null>} */
		async loadSchedule() {
			try {
				this.schedule = await api.getSchedule(this.robotId)
			} catch (err) {
				this.error = errorMessage(err, 'Could not load the schedule')
			}
			return this.schedule
		},

		/**
		 * @param {object} week dorita980 week shape
		 * @returns {Promise<object|null>}
		 */
		async saveSchedule(week) {
			try {
				this.schedule = await api.setSchedule(week, this.robotId)
				this.error = null
			} catch (err) {
				this.error = errorMessage(err, 'Could not save the schedule')
			}
			return this.schedule
		},

		/** @returns {Promise<object|null>} */
		async loadPreferences() {
			try {
				this.preferences = await api.getPreferences(this.robotId)
			} catch (err) {
				this.error = errorMessage(err, 'Could not load preferences')
			}
			return this.preferences
		},

		/**
		 * @param {object} preferences preference patch
		 * @returns {Promise<object|null>}
		 */
		async savePreferences(preferences) {
			try {
				const { preferences: saved, confirmed } = await api.setPreferences(preferences, this.robotId)
				this.preferences = saved
				// The robot echoes a preference change back within a second or two.
				// Until it does we say so rather than implying it is settled — the old
				// code applied the bridge's pre-change cache as though it were
				// confirmed, which read to the operator as "my change was ignored".
				this.preferencesConfirmed = confirmed
				this.error = null
			} catch (err) {
				this.error = errorMessage(err, 'Could not save preferences')
			}
			return this.preferences
		},

		/** @returns {Promise<object|null>} bridge connect result */
		async connectTest() {
			try {
				const result = await api.connectTest(this.robotId)
				await this.refresh()
				return result
			} catch (err) {
				this.error = errorMessage(err, 'Connect test failed')
				this.drawerOpen = true
				return null
			}
		},

		openDrawer() {
			this.drawerOpen = true
		},

		closeDrawer() {
			this.drawerOpen = false
		},

		toggleDrawer() {
			this.drawerOpen = !this.drawerOpen
		},

		clearError() {
			this.error = null
		},

		/** Operator acknowledged the last failed command. */
		dismissActionError() {
			this.actionError = null
			this.actionErrorFor = null
		},
	},
})

/**
 * @param {unknown} err axios error
 * @param {string} fallback message when the server said nothing useful
 * @returns {string} operator-facing message
 */
function errorMessage(err, fallback) {
	const data = err && err.response && err.response.data
	if (data && typeof data === 'object') {
		return String(data.error || data.message || fallback)
	}
	return String((err && err.message) || fallback)
}
