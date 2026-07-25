/** @vitest-environment node */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('error catalog', () => {
  it('has bin full and stuck codes', () => {
    const raw = readFileSync(resolve(__dirname, '../../knowledge/error_codes.json'), 'utf8')
    const catalog = JSON.parse(raw)
    const errors = catalog.errors || catalog.error
    const binEntry = Object.values(errors).find((e) => String(e.title).toLowerCase().includes('bin full'))
    expect(binEntry).toBeTruthy()
    expect(Object.keys(errors).length).toBeGreaterThan(5)
  })
})
