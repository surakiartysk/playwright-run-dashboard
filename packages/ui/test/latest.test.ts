import { describe, expect, it } from 'vitest'
import { latestOnly } from '../src/latest'

/**
 * The guard the run list asks through — see latest.ts. Each test holds the
 * answers back and releases them in the order that went wrong in a browser:
 * an older request answering after a newer one was asked.
 */
function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('latestOnly', () => {
  it('drops an answer that arrives after a newer request was asked', async () => {
    const first = held<string>()
    const second = held<string>()
    const answers = [first, second]
    const list = latestOnly(() => answers.shift()!.promise)

    const older = list.ask()
    const newer = list.ask()
    second.resolve('filtered')
    first.resolve('unfiltered')

    expect(await newer).toBe('filtered')
    expect(await older).toBeNull()
  })

  it('drops every answer still in flight once told to forget, as sign-out does', async () => {
    const admins = held<string>()
    const list = latestOnly(() => admins.promise)

    const inFlight = list.ask()
    list.forget()
    admins.resolve("the admin's runs")

    expect(await inFlight).toBeNull()
  })

  it('swallows the failure of a superseded request rather than reporting it', async () => {
    const first = held<string>()
    const second = held<string>()
    const answers = [first, second]
    const list = latestOnly(() => answers.shift()!.promise)

    const older = list.ask()
    const newer = list.ask()
    first.reject(new Error('stale 401'))
    second.resolve('current')

    expect(await older).toBeNull()
    expect(await newer).toBe('current')
  })

  it('still reports the failure of the current request', async () => {
    const list = latestOnly(() => Promise.reject(new Error('down')))

    await expect(list.ask()).rejects.toThrow('down')
  })

  it('passes the answer through when nothing newer was asked', async () => {
    const list = latestOnly((n: number) => Promise.resolve(n * 2))

    expect(await list.ask(21)).toBe(42)
  })
})
