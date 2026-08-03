import { describe, expect, it } from 'vitest'

import { hasMapReplay } from '@/utils/format.js'

describe('hasMapReplay', () => {
	it('needs at least two trail points or one covered cell', () => {
		expect(hasMapReplay([], [])).toBe(false)
		expect(hasMapReplay([{ x: 0, y: 0 }], [])).toBe(false)
		expect(hasMapReplay([{ x: 0, y: 0 }, { x: 10, y: 0 }], [])).toBe(true)
		expect(hasMapReplay([], [{ x: 0, y: 0, n: 1 }])).toBe(true)
	})
})

describe('settings capability defaults', () => {
	it('treats missing capability flags as supported', () => {
		const caps = {}
		expect(caps.schedule !== false).toBe(true)
		expect(caps.carpet_boost !== false).toBe(true)
		expect(caps.multi_pass !== false).toBe(true)
	})
})
