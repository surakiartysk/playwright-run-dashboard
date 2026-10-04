import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATUS_LOOK, elapsed, pendingNote } from '../src/run-status'
import { ICON_PATHS } from '../src/components/Icon'
import type { RunStatus } from '../src/api'

/**
 * What a row says about its status, apart from drawing it.
 *
 * The table is the thing worth testing: three of the six statuses are red, so
 * colour cannot tell them apart and the icon and word have to. A test that only
 * checked "every status has an entry" would pass with `error` and `timeout`
 * both drawing the same cross.
 */

const STATUSES = Object.keys(STATUS_LOOK) as RunStatus[]

describe('STATUS_LOOK', () => {
  it('covers all six statuses', () => {
    expect(STATUSES.sort()).toEqual(['error', 'failed', 'passed', 'queued', 'running', 'timeout'])
  })

  it('gives every status its own icon, so colour is never the only signal', () => {
    const icons = STATUSES.map((s) => STATUS_LOOK[s].icon)
    expect(new Set(icons).size).toBe(STATUSES.length)
  })

  it('gives every status its own word', () => {
    const labels = STATUSES.map((s) => STATUS_LOOK[s].label)
    expect(new Set(labels).size).toBe(STATUSES.length)
  })

  it('draws every icon it names', () => {
    for (const status of STATUSES) {
      expect(ICON_PATHS[STATUS_LOOK[status].icon], status).toMatch(/^<(circle|line|path)/)
    }
  })

  it('keeps the three failures red, passes green and runs in flight amber', () => {
    const color = (s: RunStatus) => STATUS_LOOK[s].color
    expect(new Set(['failed', 'error', 'timeout'].map((s) => color(s as RunStatus))).size).toBe(1)
    expect(new Set(['queued', 'running'].map((s) => color(s as RunStatus))).size).toBe(1)
    expect(new Set([color('passed'), color('failed'), color('queued')]).size).toBe(3)
  })
})

describe('elapsed', () => {
  const start = '2026-01-01T12:00:00Z'
  const after = (seconds: number) => Date.parse(start) + seconds * 1000

  it.each([
    ['no time at all', 0, '0s'],
    ['seconds', 42, '42s'],
    ['the last second before a minute', 59, '59s'],
    ['the minute boundary', 60, '1m 00s'],
    ['minutes with padded seconds', 125, '2m 05s'],
    ['the last second before an hour', 3599, '59m 59s'],
    ['the hour boundary', 3600, '1h 00m'],
    ['hours with padded minutes', 3600 * 2 + 60 * 7, '2h 07m'],
  ])('reads %s', (_label, seconds, expected) => {
    expect(elapsed(start, after(seconds))).toBe(expected)
  })

  it('never goes negative when this browser is behind the Worker', () => {
    expect(elapsed(start, after(-300))).toBe('0s')
  })
})

describe('pendingNote', () => {
  const startedAt = '2026-01-01T12:00:00Z'
  const now = Date.parse(startedAt) + 75_000

  it('says a queued run is waiting, without a time it has not earned', () => {
    expect(pendingNote({ status: 'queued', startedAt }, now)).toBe('waiting for a runner')
  })

  it('says how long a running one has been going', () => {
    expect(pendingNote({ status: 'running', startedAt }, now)).toBe('running for 1m 15s')
  })
})

describe('animations', () => {
  /**
   * A component names its animation as a string and the keyframes live in
   * index.html. Rename one and the other still builds: the element simply stops
   * moving, and a running row looks the same as a queued one.
   */
  it('has a @keyframes rule for every animation a component names', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const dir = new URL('../src/components/', import.meta.url)
    const named = new Set<string>()
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(new URL(file, dir), 'utf8')
      for (const m of source.matchAll(/animation:\s*'([a-z-]+)\s/g)) {
        if (m[1]) named.add(m[1])
      }
    }

    expect([...named].sort()).toEqual(expect.arrayContaining(['indeterminate', 'spin']))
    for (const name of named) {
      expect(html, name).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`))
    }
  })
})
