import { describe, expect, it } from 'vitest'
import { adminPanelMode } from '../src/admin-panel'

/**
 * The admin panel has a writable form and a read-only one, and which a session
 * gets is decided here. The failure that matters is silent: a demo session
 * previewing admin handed the writable panel would look like a nicer preview,
 * right up until someone with the published password paused every run.
 */

describe('which admin panel a session sees', () => {
  it('gives a real admin the full panel', () => {
    expect(adminPanelMode('admin', 'admin')).toBe('full')
  })

  it('gives a demo session previewing admin the read-only panel, never the full one', () => {
    expect(adminPanelMode('demo', 'admin')).toBe('readOnly')
  })

  it('shows demo nothing while it previews any other role', () => {
    for (const viewing of ['demo', 'dev', 'qa'] as const) {
      expect(adminPanelMode('demo', viewing)).toBeNull()
    }
  })

  it('shows dev and qa nothing', () => {
    expect(adminPanelMode('dev', 'dev')).toBeNull()
    expect(adminPanelMode('qa', 'qa')).toBeNull()
  })
})
