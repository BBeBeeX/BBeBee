import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Hex } from './hash.js'

/** The reference. Not available on Hermes, which is why `sha256Hex` exists. */
const ref = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('sha256Hex', () => {
  it('matches the known vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('agrees with node:crypto across lengths, including every padding boundary', () => {
    // 55/56 and 119/120 are where the length field forces an extra block —
    // the classic place a hand-written implementation goes wrong.
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 121, 255, 1000]) {
      const input = 'a'.repeat(n)
      expect(sha256Hex(input), `length ${n}`).toBe(ref(input))
    }
  })

  it('agrees on non-ASCII, including astral characters', () => {
    for (const input of ['Björk', 'Ελληνικά', '🎵🎶', 'a🎵b', 'Jóga — Homogenic']) {
      expect(sha256Hex(input), input).toBe(ref(input))
    }
  })

  it('accepts bytes as well as a string', () => {
    const bytes = new TextEncoder().encode('abc')
    expect(sha256Hex(bytes)).toBe(sha256Hex('abc'))
    expect(sha256Hex(new Uint8Array(0))).toBe(sha256Hex(''))
  })

  it('encodes a lone surrogate as WTF-8, diverging from TextEncoder', () => {
    // A documented divergence (see the module note), pinned against a real
    // vector rather than against itself: `sha256Hex(x) === sha256Hex(x)` would
    // pass for any implementation, including a broken one.
    //
    // 'a' + U+D800 + 'b' is 61 ED A0 80 62 in WTF-8. `TextEncoder` would
    // substitute U+FFFD and produce a different digest entirely.
    const lone = 'a\uD800b'
    expect(sha256Hex(lone)).toBe(
      '45e334b6c74ca5db8d8f8fcd1157fb31a2ebc9953e0d8d182e37b6b67e6a1705',
    )
    expect(sha256Hex(lone), 'not the UTF-8 replacement encoding').not.toBe(
      ref('a\uFFFDb'),
    )
  })

  it('agrees on the URLs it actually hashes', () => {
    for (const url of [
      'https://music.example.org',
      'https://music.example.org/',
      'http://127.0.0.1:4533',
      'bbebee://local',
    ]) {
      expect(sha256Hex(url), url).toBe(ref(url))
    }
  })
})
