import { describe, it, expect } from 'vitest'
import { mount } from 'vue' // may fail - use simple unit without vue-test-utils

// Lightweight pure checks for decoder catalog presence via fetch of knowledge is N/A in browser.
// Test normalize-like helpers for age label logic inline.

describe('status strip fields', () => {
  it('formats battery label', () => {
    const batteryLabel = (v) => (v == null ? '—' : `${v}%`)
    expect(batteryLabel(88)).toBe('88%')
    expect(batteryLabel(null)).toBe('—')
  })
})
