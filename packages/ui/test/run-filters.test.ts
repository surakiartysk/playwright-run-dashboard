import { describe, expect, it } from 'vitest'
import { applyFilter, counts, type StatusFilter } from '../src/components/RunFilters'
import type { Run, RunStatus } from '../src/api'

/**
 * Which runs each filter admits.
 *
 * The interesting case is not `passed` — it is what counts as failed. A run
 * that errored or timed out never produced a result, and a reader clicking
 * "Failed" is looking for exactly those as much as for an honest red run.
 * Leaving them out means a broken run is invisible under every filter but
 * "All", which is the opposite of what a filter is for.
 */

const run = (status: RunStatus): Run => ({
  id: `run-${status}-${Math.random().toString(36).slice(2, 8)}`,
  service: 'items',
  tags: 'smoke',
  workers: null,
  triggeredBy: 'demo',
  status,
  ref: 'main',
  total: 10,
  passed: 10,
  failed: 0,
  startedAt: '2026-01-01T12:00:00Z',
  finishedAt: null,
  durationMs: 1000,
  reportUrl: null,
  workflowUrl: null,
})

const statuses = (runs: Run[]) => runs.map((r) => r.status).sort()

describe('applyFilter', () => {
  const all = [
    run('passed'),
    run('failed'),
    run('error'),
    run('timeout'),
    run('queued'),
    run('running'),
  ]

  it('returns everything for "all"', () => {
    expect(applyFilter(all, 'all')).toHaveLength(6)
  })

  it('returns only passed runs for "passed"', () => {
    expect(statuses(applyFilter(all, 'passed'))).toEqual(['passed'])
  })

  /** The one that is easy to get wrong. */
  it('counts error and timeout as failed, not just the failed status', () => {
    expect(statuses(applyFilter(all, 'failed'))).toEqual(['error', 'failed', 'timeout'])
  })

  it('counts queued and running as running', () => {
    expect(statuses(applyFilter(all, 'running'))).toEqual(['queued', 'running'])
  })

  /**
   * Every run must be reachable under some filter other than "all". A status
   * that matches nothing is a row a reader cannot find by narrowing, and the
   * failure is silent — the count simply reads lower than the list.
   */
  it('leaves no status unreachable', () => {
    for (const one of all) {
      const reachable = (['passed', 'failed', 'running'] as StatusFilter[]).some(
        (f) => applyFilter([one], f).length === 1,
      )
      expect(reachable, `${one.status} matches no filter`).toBe(true)
    }
  })

  it('never returns a run the filter does not admit', () => {
    // The filters partition the list: the three specific ones sum to all of it,
    // with nothing counted twice.
    const parts = (['passed', 'failed', 'running'] as StatusFilter[]).flatMap((f) =>
      applyFilter(all, f),
    )
    expect(parts).toHaveLength(all.length)
  })

  it('handles an empty list', () => {
    expect(applyFilter([], 'failed')).toEqual([])
  })
})

describe('counts', () => {
  it('reports what each filter would show', () => {
    expect(counts([run('passed'), run('passed'), run('error'), run('queued')])).toEqual({
      all: 4,
      passed: 2,
      failed: 1,
      running: 1,
    })
  })

  it('is all zeroes for an empty list', () => {
    expect(counts([])).toEqual({ all: 0, passed: 0, failed: 0, running: 0 })
  })
})
