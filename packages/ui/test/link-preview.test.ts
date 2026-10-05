import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * What a link to the dashboard shows when someone pastes it.
 *
 * The page had a `<title>` and nothing else, so a link shared on LinkedIn
 * arrived as a bare line with no picture — on a portfolio piece whose links
 * are mostly shared there. These hold the tags to the file they point at.
 * Whether a given site then renders them is checked by hand, with its own
 * preview tool, after a deploy.
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function meta(attribute: 'name' | 'property', key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]*${attribute}="${key}"[^>]*>`, 's'))?.[0]
  return tag?.match(/content="([^"]*)"/)?.[1]
}

/** A PNG's width and height, from its header. */
function pngSize(path: URL): [number, number] {
  const bytes = readFileSync(path)
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

describe('the link preview', () => {
  it('has a title, a description and a large image card', () => {
    expect(meta('property', 'og:title')).toBeTruthy()
    expect(meta('property', 'og:description')).toBeTruthy()
    expect(meta('name', 'description')).toBeTruthy()
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
  })

  /*
   * Absolute, because the crawlers that fetch it do not resolve a relative URL
   * against the page — a relative one is a preview with no picture.
   */
  it('names its image by an absolute URL', () => {
    expect(meta('property', 'og:image')).toMatch(/^https:\/\//)
  })

  it('points at an image this build actually ships', () => {
    const { pathname } = new URL(meta('property', 'og:image') ?? 'https://x.invalid/missing')

    expect(existsSync(new URL(`../public${pathname}`, import.meta.url))).toBe(true)
  })

  it('states the size the image really is', () => {
    const { pathname } = new URL(meta('property', 'og:image') ?? 'https://x.invalid/missing')
    const [width, height] = pngSize(new URL(`../public${pathname}`, import.meta.url))

    expect([meta('property', 'og:image:width'), meta('property', 'og:image:height')]).toEqual([
      String(width),
      String(height),
    ])
    // The ratio the large card is cropped to; anything else is cut off.
    expect(width / height).toBeCloseTo(1200 / 630, 2)
  })
})
