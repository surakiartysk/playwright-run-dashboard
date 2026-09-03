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
}

export interface RolePolicy {
  role: Role
  allowedRefs: string[]
  maxWorkers: number
  canDelete: boolean
  sees: string
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

  gate: () =>
    request<{
      state: 'open' | 'closed'
      reason: 'manual' | 'window' | 'default'
      opensAt: string | null
      closesAt: string | null
      appliesToYou: boolean
    }>('/gate'),

  /**
   * `role` is always the caller's real, authenticated role; `viewAs` differs
   * from it only for a demo session currently previewing another role.
   */
  listRuns: () => request<{ runs: Run[]; role: Role; viewAs: Role }>('/runs?limit=25'),

  createRun: (input: { service: string; tags: string; workers?: number; ref?: string }) =>
    request<{ runId: string; simulated: boolean }>('/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteRun: (id: string) => request<{ ok: true }>(`/runs/${id}`, { method: 'DELETE' }),
}

/** Runs still in flight — the UI polls only while one of these exists. */
export const isPending = (status: RunStatus) => status === 'queued' || status === 'running'
