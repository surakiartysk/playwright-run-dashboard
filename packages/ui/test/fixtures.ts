import type { Run } from '../src/api'
import type { TrendPoint } from '../src/components/RunTrend'

/**
 * One place a test gets a `Run` or a `TrendPoint` from.
 *
 * Three test files each built their own `Run` literal, and each drifted the
 * same way: four fields were added to the type over several months —
 * `suiteVersion`, `suiteSha`, `suite`, `startedBy` — and none of the copies
 * gained any of them. Nothing noticed, because this package's tsconfig did
 * not include `test/`, so a fixture could stand in for a type it no longer
 * matched. `describe()` then rendered `SUITE_LABELS[undefined]` into a tooltip
 * as the string "undefined", silently, in a test that was green.
 *
 * With the tests typechecked, the compiler enforces the shape. With one
 * factory, a new field is one edit rather than three — and the alternative,
 * making every fixture a full literal again, is how this drifted in the first
 * place.
 *
 * Defaults are the most ordinary run there is: a passing API smoke run of
 * `items` on `main`, started by demo. A test that cares about a field sets it;
 * one that does not gets something plausible and stops caring.
 */
export function run(overrides: Partial<Run> = {}): Run {
  const status = overrides.status ?? 'passed'
  const total = overrides.total ?? 10
  const passed = overrides.passed ?? (status === 'passed' ? total : total - 1)
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    suite: 'api',
    service: 'items',
    tags: 'smoke',
    workers: null,
    triggeredBy: 'demo',
    startedBy: null,
    status,
    ref: 'main',
    total,
    passed,
    failed: total - passed,
    startedAt: '2026-01-01T12:00:00Z',
    finishedAt: null,
    durationMs: 1000,
    reportUrl: null,
    workflowUrl: null,
    suiteVersion: null,
    suiteSha: null,
    ...overrides,
  }
}

/**
 * A chart point. The geometry tests only read `rate`, `passed` and `id`, and
 * used to pass exactly those three — correct for the code under test, wrong
 * for the type it was passed as. This fills the rest so the compiler agrees.
 */
export function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  const total = overrides.total ?? 10
  const passed = overrides.passed ?? true
  return {
    rate: 100,
    passed,
    id: `point-${Math.random().toString(36).slice(2, 8)}`,
    suite: 'api',
    service: 'items',
    tags: 'smoke',
    ref: 'main',
    triggeredBy: 'demo',
    startedBy: null,
    passedCount: overrides.passedCount ?? (passed ? total : total - 1),
    total,
    startedAt: '2026-01-01T12:00:00Z',
    ...overrides,
  }
}
