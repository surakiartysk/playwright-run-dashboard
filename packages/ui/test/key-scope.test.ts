import { describe, expect, it } from 'vitest'
import { scopeOf } from '../src/components/ApiKeys'

/**
 * What the admin's key list says a key may do.
 *
 * A key with no branch list of its own has its role's branches. The list said
 * "any branch" for every such key, which is true only of admin's.
 */
describe("a key's scope, in words", () => {
  it("names the role's branches when the key has no list of its own", () => {
    expect(scopeOf({ allowedRefs: null, maxWorkers: null })).toBe(
      "the role's branches · up to the role's limit",
    )
  })

  it('names its own branches and workers when it has them', () => {
    expect(scopeOf({ allowedRefs: ['main', 'develop'], maxWorkers: 2 })).toBe(
      'main, develop · up to 2 workers',
    )
  })
})
