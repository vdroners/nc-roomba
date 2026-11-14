import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decoratedError, faultSeverity, hasFault, isBinFull, isConflict, isStale } from '@/utils/errorDecoder.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('error decoder view logic', () => {
	it('shows nothing while the robot is healthy', () => {
		const state = { error: 0, not_ready: 0, decoded_error: { code: 0, kind: 'ok', title: '', detail: '' } }
		expect(hasFault(state)).toBe(false)
		expect(decoratedError(state).show).toBe(false)
	})

	it('shows the server-decoded copy for a real error', () => {
		const decoded = decoratedError({
			error: 18,
			not_ready: 0,
			decoded_error: {
				code: 18,
				kind: 'error',
				title: 'Bin full',
				detail: 'The dust bin needs emptying before the next mission.',
				action: 'Empty the bin and press CLEAN.',
			},
		})

		expect(decoded.show).toBe(true)
		expect(decoded.severity).toBe('error')
		expect(decoded.title).toBe('Bin full')
		expect(decoded.action).toBe('Empty the bin and press CLEAN.')
	})

	it('treats notReady as a warning, not a failure', () => {
		const state = { error: 0, not_ready: 15, decoded_error: { code: 15, kind: 'not_ready', title: 'Charging — settling on the dock' } }
		expect(faultSeverity(state)).toBe('warning')
		expect(decoratedError(state).show).toBe(true)
	})

	it('shows bin full for the live 960 sample (notReady 16 + bin full)', () => {
		const state = {
			phase: 'charge',
			cycle: 'none',
			error: 0,
			not_ready: 16,
			bin: 'full',
			decoded_error: { code: 16, kind: 'bin_full', title: 'Bin full: empty the bin', detail: 'x', action: 'Empty the bin, then press Clean.' },
		}
		expect(isBinFull(state)).toBe(true)
		const d = decoratedError(state)
		expect(d.show).toBe(true)
		expect(d.severity).toBe('warning')
		expect(d.title).toMatch(/bin full/i)
	})

	it('overrides a stale server "just docked" decode when the bin is full', () => {
		const d = decoratedError({
			error: 0,
			not_ready: 16,
			bin: 'ok',
			decoded_error: { code: 16, kind: 'not_ready', title: 'Just docked / busy', action: 'Give it a few seconds, then retry.' },
		})
		expect(d.kind).toBe('bin_full')
		expect(d.title).toMatch(/bin full/i)
		expect(d.action).toMatch(/empty the bin/i)
	})

	it('flags bin.full even when notReady is 0', () => {
		const d = decoratedError({ error: 0, not_ready: 0, bin: 'full', decoded_error: { code: 0, kind: 'none', title: '' } })
		expect(d.show).toBe(true)
		expect(d.code).toBe(0)
		expect(d.title).toMatch(/bin full/i)
	})

	it('a real error still wins over a full bin', () => {
		const d = decoratedError({ error: 5, not_ready: 16, bin: 'full', decoded_error: { code: 5, kind: 'error', title: 'Wheel stuck' } })
		expect(d.kind).toBe('error')
		expect(d.title).toBe('Wheel stuck')
	})

	it('clears once the bin is emptied', () => {
		const state = { error: 0, not_ready: 0, bin: 'ok', decoded_error: { code: 0, kind: 'none', title: '' } }
		expect(isBinFull(state)).toBe(false)
		expect(decoratedError(state).show).toBe(false)
	})

	it('is honest when the catalog has no entry for the code', () => {
		const decoded = decoratedError({ error: 231, not_ready: 0, decoded_error: null })
		expect(decoded.show).toBe(true)
		expect(decoded.code).toBe(231)
		expect(decoded.title).toBe('Robot error 231')
		expect(decoded.detail).toMatch(/not in the local catalog/i)
	})

	it('accepts the raw notReady spelling from an un-enriched payload', () => {
		expect(hasFault({ error: 0, notReady: 7 })).toBe(true)
	})

	it('detects conflict and staleness from connection_health', () => {
		expect(isConflict({ connection_health: { mqtt: 'conflict' } })).toBe(true)
		expect(isConflict({ conflict: 'iRobot app is open' })).toBe(true)
		expect(isConflict({ connection_health: { mqtt: 'up' } })).toBe(false)
		expect(isStale({ connection_health: { stale: true } })).toBe(true)
		expect(isStale(null)).toBe(false)
	})

	it('survives a null state (first paint before any sample)', () => {
		expect(hasFault(null)).toBe(false)
		expect(decoratedError(null).show).toBe(false)
	})
})

describe('error catalog', () => {
	it('ships the codes the decoder panel promises', () => {
		const raw = readFileSync(resolve(here, '../../knowledge/error_codes.json'), 'utf8')
		const catalog = JSON.parse(raw)
		const errors = catalog.errors || catalog.error || {}

		expect(Object.keys(errors).length).toBeGreaterThan(5)
		// Bin full is the code the operator hits most; it must decode.
		const binFull = Object.values(errors).find((entry) => String(entry.title).toLowerCase().includes('bin full'))
		expect(binFull).toBeTruthy()
		// notReady 16 is the 9xx bin-full code, not "just docked".
		expect(String(catalog.not_ready['16'].title)).toMatch(/bin full/i)
		expect(String(catalog.not_ready['16'].action)).toMatch(/empty/i)
		for (const entry of Object.values(errors)) {
			expect(String(entry.title).length).toBeGreaterThan(0)
		}
	})
})
