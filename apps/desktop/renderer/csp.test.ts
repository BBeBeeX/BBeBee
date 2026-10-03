/**
 * The renderer's Content-Security-Policy, as a check rather than a comment.
 *
 * It guards in both directions, because the two ways to get this wrong look
 * like opposite virtues:
 *
 *  - **Tightened back.** Removing `'wasm-unsafe-eval'` reads like hardening
 *    and is a boot failure: Chromium gates `WebAssembly.instantiate` on
 *    `script-src`, so QuickJS cannot compile, `ctx.js` never starts, and
 *    `createApp` aborts on the core service list (docs/04 §19).
 *  - **Widened to `'unsafe-eval'`.** That also makes the WASM work, which is
 *    why it is the tempting fix, and it hands the renderer `eval` and
 *    `new Function` — foreign *JavaScript* in the app's own realm, which is
 *    the one thing the policy exists to refuse (docs/02 §2).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8')

/** The policy as `directive -> sources`, read from the `<meta>` the shell ships. */
const policy = new Map<string, string[]>(
  (/content="([^"]*\bdefault-src\b[^"]*)"/.exec(html)?.[1] ?? '')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, ...sources]) => [name!, sources]),
)

describe('the renderer CSP', () => {
  it('is the one the shell actually serves', () => {
    // If this fails the parse is wrong and every assertion below is vacuous.
    expect(policy.get('default-src')).toEqual(["'self'"])
  })

  it("allows WebAssembly, which is what makes `ctx.js` a sandbox and not a plan", () => {
    expect(policy.get('script-src')).toContain("'wasm-unsafe-eval'")
  })

  it('still refuses eval, which is the whole point of the narrower token', () => {
    const scripts = policy.get('script-src') ?? []
    expect(scripts).not.toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
  })

  it('allows dynamic plugins scheme in script-src for desktop extensions', () => {
    const scripts = policy.get('script-src') ?? []
    expect(scripts.some((s) => s.toLowerCase() === 'bbebee-plugin:')).toBe(true)
  })

  it('allows media elements to play local blobs and streams', () => {
    const media = policy.get('media-src') ?? []
    expect(media).toContain("'self'")
    expect(media).toContain('blob:')
    expect(media).toContain('data:')
    expect(media).toContain('http:')
    expect(media).toContain('https:')
    expect(media).toContain('bbebee-file:')
  })

  it('allows local and remote artwork images', () => {
    const img = policy.get('img-src') ?? []
    expect(img).toContain("'self'")
    expect(img).toContain('data:')
    expect(img).toContain('blob:')
    expect(img).toContain('bbebee-file:')
    expect(img).toContain('https:')
    // Mirrors media-src: some sources serve covers from plain-http hosts.
    expect(img).toContain('http:')
  })
})

