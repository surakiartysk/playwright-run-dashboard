import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The sizes text may be set in.
 *
 * Found by the UX review of the live site (decision 45): fourteen sizes in use, five of them half
 * pixels — 10.5, 11.5, 12.5, 13.5 — and the browser's own 13.33px on every control that was given
 * none. Each half pixel went to the step above it, and the scale is held here.
 */
const SCALE = [11, 12, 13, 14, 15, 16, 20, 22]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('the type scale', () => {
  const src = new URL('../src', import.meta.url).pathname
  const used = files(src).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/fontSize: ([0-9.]+)/g)].map(
      (m) => [path, Number(m[1])] as const,
    ),
  )

  it('sets every size from the scale, and none between its steps', () => {
    expect(used.length).toBeGreaterThan(100)
    const off = used
      .filter(([, size]) => !SCALE.includes(size))
      .map(([path, size]) => `${size} in ${path}`)
    expect(off).toEqual([])
  })

  it('gives a control with no size of its own the scale’s 13px, not the browser’s 13.33px', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toMatch(
      /button,\s*input,\s*select,\s*textarea \{\s*font: inherit;\s*font-size: 13px;/,
    )
  })
})
