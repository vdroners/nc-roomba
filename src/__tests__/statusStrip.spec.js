import { describe, expect, it } from 'vitest'

import {
	ageSeconds,
	batteryClass,
	batteryLabel,
	binClass,
	binLabel,
	durationLabel,
	lastSeenLabel,
	phaseLabel,
	rssiClass,
	rssiLabel,
	timestampLabel,
} from '@/utils/format.js'

// The status strip is a thin template over these helpers, so testing them
// covers every label the operator actually reads (UI-1 / G31).
describe('status strip labels', () => {
	it('formats battery and grades it', () => {
		expect(batteryLabel(86)).toBe('86%')
		expect(batteryLabel(null)).toBe('—')
		expect(batteryLabel(undefined)).toBe('—')
		expect(batteryClass(86)).toBe('ok')
		expect(batteryClass(25)).toBe('warn')
		expect(batteryClass(8)).toBe('danger')
		expect(batteryClass(null)).toBe('')
	})

	it('formats the bin sensor including the unsupported case', () => {
		expect(binLabel('ok')).toBe('Bin OK')
		expect(binLabel('full')).toBe('Bin full')
		expect(binLabel('missing')).toBe('Bin missing')
		expect(binLabel(undefined)).toBe('Bin unknown')
		expect(binClass('full')).toBe('warn')
		expect(binClass('missing')).toBe('danger')
		expect(binClass('unknown')).toBe('')
	})

	it('grades Wi-Fi signal by dBm', () => {
		expect(rssiLabel(-52)).toBe('Wi-Fi -52 dBm (strong)')
		expect(rssiLabel(-68)).toBe('Wi-Fi -68 dBm (ok)')
		expect(rssiLabel(-82)).toBe('Wi-Fi -82 dBm (weak)')
		expect(rssiLabel(null)).toBe('Wi-Fi —')
		expect(rssiClass(-52)).toBe('ok')
		expect(rssiClass(-72)).toBe('warn')
		expect(rssiClass(-82)).toBe('danger')
	})

	it('combines phase and cycle into one label', () => {
		expect(phaseLabel({ phase: 'run', cycle: 'clean' })).toBe('Cleaning · Clean')
		expect(phaseLabel({ phase: 'charge', cycle: 'none' })).toBe('Charging')
		expect(phaseLabel({ phase: 'hmPostMsn', cycle: 'clean' })).toBe('Returning to dock · Clean')
		// Unknown phases pass through rather than reading "undefined".
		expect(phaseLabel({ phase: 'newPhase', cycle: 'none' })).toBe('newPhase')
		expect(phaseLabel(null)).toBe('Unknown')
	})

	it('renders a relative last-seen age', () => {
		expect(lastSeenLabel(0)).toBe('just now')
		expect(lastSeenLabel(3)).toBe('just now')
		expect(lastSeenLabel(42)).toBe('42s ago')
		expect(lastSeenLabel(120)).toBe('2m ago')
		expect(lastSeenLabel(7200)).toBe('2h ago')
		expect(lastSeenLabel(10, false)).toBe('never')
	})

	it('computes the age of an ISO timestamp', () => {
		const now = Date.parse('2026-07-25T12:00:00.000Z')
		expect(ageSeconds('2026-07-25T11:59:30.000Z', now)).toBe(30)
		expect(ageSeconds('not a date', now)).toBe(0)
		expect(ageSeconds(null, now)).toBe(0)
	})

	it('formats durations and timestamps for the timeline', () => {
		expect(durationLabel(45)).toBe('45s')
		expect(durationLabel(600)).toBe('10m')
		expect(durationLabel(3900)).toBe('1h 05m')
		expect(timestampLabel(null)).toBe('')
		expect(timestampLabel('nonsense')).toBe('')
		expect(timestampLabel(1753444800)).not.toBe('')
	})
})
