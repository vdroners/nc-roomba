import { isBinFull } from './errorDecoder.js'
import { isBridgeUnreachable, isCleaningCycle } from './format.js'

/** Phases that mean the robot is actively cleaning. */
const CLEANING = new Set(['run'])
/** Phases that mean the robot is heading home. */
const RETURNING = new Set(['hmMidMsn', 'hmUsrDock', 'hmPostMsn'])
/** Phases that mean the robot is on the dock. */
const DOCKED = new Set(['charge', 'dockend', 'recharge'])
/** Phases where a mission is held, while `cycle` still names the mission. */
const HELD = new Set(['pause', 'stop'])

/**
 * Single overall status for the dashboard hero, derived from phase, cycle and
 * fault flags. Pure so it can be unit-tested without mounting the component.
 *
 * Phase wins over `cycle`: the robot keeps `cycle: clean|quick` while it is
 * paused, returning or recharging mid-mission, so checking the cycle first
 * labelled all of those "Cleaning".
 *
 * @param {object|null} state enriched state DTO
 * @param {{ binEmptied?: boolean }} [opts] store-derived flags
 * @returns {{label:string,detail:string,tone:'ok'|'run'|'dock'|'warn'|'idle'}}
 */
export function heroStatus(state, opts = {}) {
	if (!state) {
		return { label: 'Connecting…', detail: 'Waiting for the first telemetry sample.', tone: 'idle' }
	}
	// Bridge down or robot MQTT session down: the fields below are the last
	// reading, not the present. Saying "Idle and ready to clean" here is wrong.
	const health = state.connection_health || {}
	if (isBridgeUnreachable(state) || health.mqtt === 'down') {
		return {
			label: 'Offline',
			detail: 'Can\'t reach the robot right now — the readings shown are the last ones received.',
			tone: 'idle',
		}
	}
	const phase = String(state.phase || '')
	const cleaning = isCleaningCycle(state.cycle)
	const error = Number(state.error || 0)
	const notReady = Number(state.not_ready || 0)

	if (error !== 0) {
		return { label: 'Attention', detail: 'The robot reported an error — see the alert below.', tone: 'warn' }
	}
	// A full bin outranks docked/charging/busy: it never clears by waiting.
	if (isBinFull(state)) {
		const stopped = Boolean(state.bin_full_stop && state.bin_full_stop.fired && HELD.has(phase))
		if (stopped) {
			return {
				label: 'Bin full',
				detail: 'Stopped before docking — empty the bin, then press Home to send it to charge.',
				tone: 'warn',
			}
		}
		return { label: 'Bin full', detail: 'Empty the bin, push it back in until it clicks, then press Clean.', tone: 'warn' }
	}
	if (HELD.has(phase) && cleaning) {
		return { label: 'Paused', detail: 'Mission paused — resume from the controls.', tone: 'warn' }
	}
	if (phase === 'pause') {
		return { label: 'Paused', detail: 'Mission paused — resume from the controls.', tone: 'warn' }
	}
	if (RETURNING.has(phase)) {
		return { label: 'Returning', detail: 'Heading back to the dock.', tone: 'run' }
	}
	if (DOCKED.has(phase) && cleaning) {
		return {
			label: 'Recharging',
			detail: 'Mid-clean: charging on the dock. It heads back out on its own to finish once charged.',
			tone: 'run',
		}
	}
	if (CLEANING.has(phase) || cleaning) {
		return { label: 'Cleaning', detail: 'On the job — live progress on the mission stage.', tone: 'run' }
	}
	if (opts.binEmptied && notReady === 0) {
		return { label: 'Ready', detail: 'Bin emptied — ready to clean. Press Clean to start.', tone: 'ok' }
	}
	if (DOCKED.has(phase)) {
		return { label: 'Charging', detail: 'Docked and topping up — ready when you are.', tone: 'dock' }
	}
	if (notReady !== 0) {
		return { label: 'Not ready', detail: 'Off the dock or not ready to clean.', tone: 'warn' }
	}
	return { label: 'Ready', detail: 'Idle and ready to clean.', tone: 'ok' }
}
