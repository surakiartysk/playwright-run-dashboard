/**
 * Worker bindings and the shapes crossing the wire.
 *
 * Every secret has a development default. That is a deliberate trade: a repo
 * that cannot start without four secrets is a repo nobody starts. The defaults
 * are obviously fake, and `POST /runs` refuses to dispatch for real while
 * `SIMULATE_DISPATCH` is on — so a misconfigured deployment fails loudly
 * rather than quietly using them.
 */

export type Role = 'demo' | 'dev' | 'qa' | 'admin'

/**
 * Which suite a run belongs to, and so which repository it is dispatched to.
 *
 * A closed union rather than a free string: these are the two repositories
 * this deployment knows how to reach, and a third would need its own
 * configuration anyway — so an unknown value is a bug, not a case to handle.
 */
export type Suite = 'api' | 'ui'

export const SUITES: readonly Suite[] = ['api', 'ui'] as const

export const isSuite = (value: unknown): value is Suite =>
  typeof value === 'string' && (SUITES as readonly string[]).includes(value)

export interface Bindings {
  DB: D1Database
  REPORTS: R2Bucket

  GITHUB_REPO: string
  GITHUB_WORKFLOW: string
  /**
   * The UI suite's repository and workflow.
   *
   * Optional, and the reason is compatibility: a deployment that predates the
   * second suite has neither var set, and must keep working rather than
   * failing at startup for a suite nobody has asked it for. `resolveTarget`
   * turns the absence into a 422 on the one request that needs it, which is a
   * better answer than a 503 on every route.
   */
  GITHUB_UI_REPO?: string
  GITHUB_UI_WORKFLOW?: string
  SIMULATE_DISPATCH?: string

  GITHUB_TOKEN?: string
  WEBHOOK_SECRET?: string
  TOKEN_SECRET?: string
  DEMO_PASSWORD?: string
  DEV_PASSWORD?: string
  QA_PASSWORD?: string
  ADMIN_PASSWORD?: string
}

export type HonoEnv = { Bindings: Bindings }

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'timeout'

/** A run as stored. Column names are snake_case because SQL is. */
export interface RunRow {
  id: string
  /** 'api' for every run created before the second suite existed — see 0008. */
  suite: Suite
  service: string
  tags: string
  workers: number | null
  triggered_by: string
  /** What the person said their name was. Null for a key, and for older runs. */
  started_by: string | null
  status: RunStatus
  total: number | null
  passed: number | null
  failed: number | null
  ref: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  report_path: string | null
  workflow_url: string | null
  /** The suite that produced this result. Null until its callback arrives. */
  suite_version: string | null
  suite_sha: string | null
}

/** A run as the UI sees it — camelCase, with the report link resolved. */
export interface RunView {
  id: string
  suite: Suite
  service: string
  tags: string
  workers: number | null
  triggeredBy: string
  /**
   * Who said they started it — a claim, not an identity.
   *
   * Null for a machine key, for runs started before names existed, and for
   * anyone who signed in without giving one.
   */
  startedBy: string | null
  status: RunStatus
  total: number | null
  passed: number | null
  failed: number | null
  ref: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  reportUrl: string | null
  workflowUrl: string | null
  suiteVersion: string | null
  suiteSha: string | null
}

export interface CreateRunRequest {
  /**
   * Which suite to run. Optional, defaulting to 'api': every client written
   * before the second suite existed omits it, and those callers meant the
   * suite that was the only one at the time.
   */
  suite?: Suite
  service: string
  tags: string
  workers?: number
  /** Git ref to run against. Restricted by role — see routes/runs.ts. */
  ref?: string
}

/** Posted back by the workflow when a run finishes. */
export interface WebhookPayload {
  runId: string
  status: Exclude<RunStatus, 'queued' | 'running'>
  total?: number
  passed?: number
  failed?: number
  durationMs?: number
  reportPath?: string
  workflowUrl?: string
  /** Which suite ran. Optional: a workflow older than this field sends neither. */
  suiteVersion?: string
  suiteSha?: string
}

export const toView = (row: RunRow, reportUrl: string | null): RunView => ({
  id: row.id,
  suite: row.suite,
  service: row.service,
  tags: row.tags,
  workers: row.workers,
  triggeredBy: row.triggered_by,
  startedBy: row.started_by,
  status: row.status,
  ref: row.ref,
  total: row.total,
  passed: row.passed,
  failed: row.failed,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
  reportUrl,
  workflowUrl: row.workflow_url,
  suiteVersion: row.suite_version,
  suiteSha: row.suite_sha,
})
