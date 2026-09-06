/**
 * Everything that talks to the Worker.
 *
 * Kept in one file rather than fetching from components: a component that
 * fetches is a component that cannot be read without also reading the network
 * shape, and every one of them re-decides what to do about a 401.
 */

export type Role = 'demo' | 'dev' | 'qa' | 'admin'

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'timeout'

export interface Run {
  id: string
  service: string
  tags: string
  workers: number | null
  triggeredBy: string
  status: RunStatus
  ref: string
  total: number | null
  passed: number | null
  failed: number | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  reportUrl: string | null
  workflowUrl: string | null
  /** The suite that produced this result — null until its callback arrives. */
  suiteVersion: string | null
  suiteSha: string | null
}

export interface RolePolicy {
  role: Role
  allowedRefs: string[]
  maxWorkers: number
  canDelete: boolean
  sees: string
}

/**
 * The gate's three settings. `window` is the only one carrying timestamps.
 *
 * Mirrors GateMode in the Worker's gate.ts — the two are separate declarations
 * because the packages share no code, so a change on one side has to be made on
 * the other. The API rejects an unknown mode rather than falling back.
 */
export type GateMode = 'open' | 'closed' | 'window'

export interface GateStatus {
  state: 'open' | 'closed'
  /** Why it is in that state — `default` means no usable configuration. */
  reason: 'manual' | 'window' | 'default'
  opensAt: string | null
  closesAt: string | null
}

/** Thrown for any non-2xx, carrying the status so callers can branch on 401. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // The session lives in an HttpOnly cookie, so it has to be sent explicitly.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  const body = (await response.json().catch(() => ({}))) as { error?: string }

  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  }
  return body as T
}

export const api = {
  login: (password: string) =>
    request<{ role: Role; expiresAt: number }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ role: Role }>('/auth/me'),

  devCredentials: () =>
    request<{ mode: 'full' | 'demo-only'; passwords: Partial<Record<Role, string>> }>(
      '/auth/dev-credentials',
    ),

  roles: () => request<{ canPreview: boolean; roles: RolePolicy[] }>('/demo/roles'),

  /**
   * Previews another role's read view for an authenticated `demo` session.
   * Mints no session token — the caller's real, authenticated role is
   * unchanged; only what GET /runs and GET /runs/:id return is affected.
   */
  previewRole: (role: Role) =>
    request<{ previewing: Role }>('/demo/preview-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  stopPreview: () => request<{ ok: true }>('/demo/stop-preview', { method: 'POST' }),

  gate: () => request<GateStatus & { appliesToYou: boolean }>('/gate'),

  /**
   * Admin only; the API rejects every other role.
   *
   * `window` is the only mode carrying timestamps, and the API validates them
   * rather than falling back to open — see routes/gate.ts on why a silently
   * ignored window is worse than a rejected request.
   */
  setGate: (input: { mode: GateMode; opensAt?: string; closesAt?: string }) =>
    request<GateStatus>('/gate', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /**
   * `role` is always the caller's real, authenticated role; `viewAs` differs
   * from it only for a demo session currently previewing another role.
   *
   * `total` counts every run the caller may see, not the page — without it the
   * list could only truncate silently, which is what it used to do. `cursor`
   * asks for the page after a given row; `nextCursor` is null on the last page.
   */
  listRuns: (options: { cursor?: string | null; limit?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? RUNS_PER_PAGE) })
    if (options.cursor) query.set('cursor', options.cursor)
    return request<RunPage>(`/runs?${query}`)
  },

  createRun: (input: { service: string; tags: string; workers?: number; ref?: string }) =>
    request<{ runId: string; simulated: boolean }>('/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteRun: (id: string) => request<{ ok: true }>(`/runs/${id}`, { method: 'DELETE' }),

  /** Admin only. Revoked keys are included — see the route's own note. */
  listKeys: () => request<{ keys: ApiKey[] }>('/keys'),

  /**
   * The response carries `plaintext`, and it is the only time the key exists
   * outside the caller's own storage. Nothing can show it again.
   */
  createKey: (input: { label: string; role: Role; allowedRefs?: string[]; maxWorkers?: number }) =>
    request<{ key: ApiKey; plaintext: string }>('/keys', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revokeKey: (id: string) =>
    request<{ ok: true; alreadyRevoked?: boolean }>(`/keys/${id}`, { method: 'DELETE' }),
}

/**
 * How many runs a page holds.
 *
 * Shared between the first load and every "load more", so a page is always the
 * same size — a first page of 25 followed by pages of 10 makes the cursor's
 * behaviour look inconsistent when it is not.
 */
export const RUNS_PER_PAGE = 25

export type RunPage = {
  runs: Run[]
  role: Role
  viewAs: Role
  /** Every run the caller may see, counted past the end of this page. */
  total: number
  /** Null on the last page. */
  nextCursor: string | null
}

/**
 * A key as it can be read back — there is deliberately no field here that
 * could reconstruct the credential.
 */
export type ApiKey = {
  id: string
  label: string
  role: Role
  allowedRefs: string[] | null
  maxWorkers: number | null
  createdBy: Role
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** Runs still in flight — the UI polls only while one of these exists. */
export const isPending = (status: RunStatus) => status === 'queued' || status === 'running'
