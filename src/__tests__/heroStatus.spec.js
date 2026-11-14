import { describe, expect, it } from 'vitest'

import { heroStatus } from '@/utils/heroStatus.js'

const base = { phase: 'charge', cycle: 'none', error: 0, not_ready: 0, bin: 'ok' }

describe('status hero', () => {
	it('shows mid-mission recharge as Recharging, not Cleaning (live 960, 2026-11-11)', () => {
		const s = heroStatus({ ...base, phase: 'charge', cycle: 'clean', battery_pct: 80 })
		expect(s.label).toBe('Recharging')
		expect(s.detail).toMatch(/on its own/)
		expect(heroStatus({ ...base, phase: 'charge', cycle: 'quick' }).label).toBe('Recharging')
	})

	it('shows a paused or stopped mission as Paused even though cycle still names it', () => {
		expect(heroStatus({ ...base, phase: 'pause', cycle: 'clean' }).label).toBe('Paused')
		expect(heroStatus({ ...base, phase: 'stop', cycle: 'quick' }).label).toBe('Paused')
	})

	it('shows Returning while heading home mid-mission', () => {
		expect(heroStatus({ ...base, phase: 'hmMidMsn', cycle: 'clean' }).label).toBe('Returning')
		expect(heroStatus({ ...base, phase: 'hmUsrDock', cycle: 'quick' }).label).toBe('Returning')
	})

	it('shows Cleaning while running', () => {
		expect(heroStatus({ ...base, phase: 'run', cycle: 'quick' }).label).toBe('Cleaning')
	})

	it('keeps the plain docked / idle copy', () => {
		expect(heroStatus(base).label).toBe('Charging')
		expect(heroStatus({ ...base, phase: '' }).label).toBe('Ready')
		expect(heroStatus(null).label).toBe('Connecting…')
	})

	it('bin full and errors outrank everything else', () => {
		expect(heroStatus({ ...base, cycle: 'clean', bin: 'full' }).label).toBe('Bin full')
		expect(heroStatus({ ...base, not_ready: 16 }).label).toBe('Bin full')
		expect(heroStatus({ ...base, bin: 'full', error: 5 }).label).toBe('Attention')
	})

	it('confirms a just-emptied bin', () => {
		expect(heroStatus(base, { binEmptied: true }).detail).toMatch(/Bin emptied/)
	})
})
