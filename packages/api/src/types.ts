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

export interface Bindings {
  DB: D1Database
  REPORTS: R2Bucket

  GITHUB_REPO: string
  GITHUB_WORKFLOW: string
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
  service: string
  tags: string
  workers: number | null
  triggered_by: string
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
  service: string
  tags: string
  workers: number | null
  triggeredBy: string
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
  service: row.service,
  tags: row.tags,
  workers: row.workers,
  triggeredBy: row.triggered_by,
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
