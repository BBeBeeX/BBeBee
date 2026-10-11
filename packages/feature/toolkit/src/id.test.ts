import { describe, expect, it } from 'vitest'
import { albumId, artistId, artistKey, artworkId, normalise, stableId, trackId } from './id.js'

describe('stableId', () => {
  it('is derived, not random — the same parts give the same id', () => {
    expect(stableId('track', 'file:///music/a.flac')).toBe(
      stableId('track', 'file:///music/a.flac'),
    )
  })

  it('separates inputs that would concatenate into the same string', () => {
    // 'ab' + 'c' and 'a' + 'bc' join to the same 'abc' unless the join
    // carries a separator; the space in `join(' ')` is load-bearing.
    expect(stableId('ab', 'c')).not.toBe(stableId('a', 'bc'))
  })

  it('folds undefined parts to empty rather than the string "undefined"', () => {
    expect(stableId('album', undefined)).toBe(stableId('album', ''))
  })

  it('is 16 hex characters', () => {
    expect(stableId('track', 'x')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('normalise', () => {
  it('case-folds, trims and collapses whitespace', () => {
    expect(normalise('  The   BEATLES ')).toBe('the beatles')
  })

  it('treats undefined as the empty string', () => {
    expect(normalise(undefined)).toBe('')
  })
})

describe('catalogue entity ids', () => {
  it('key an album on title and album artist, normalised', () => {
    expect(albumId('Abbey Road', 'The Beatles')).toBe(albumId('abbey road', 'the  beatles'))
    expect(albumId('Abbey Road', 'The Beatles')).not.toBe(albumId('Let It Be', 'The Beatles'))
  })

  it('keys a track on its uri, so a moved file is a different track', () => {
    expect(trackId('file:///a.flac')).toBe(trackId('file:///a.flac'))
    expect(trackId('file:///a.flac')).not.toBe(trackId('file:///b.flac'))
  })

  it('keys an artist on the normalised name', () => {
    expect(artistId('AC/DC')).toBe(artistId('ac/dc'))
  })
})

describe('artistKey', () => {
  it('keeps the readable slug for a Latin name', () => {
    expect(artistKey('The Beatles')).toBe('the-beatles')
    expect(artistKey('AC/DC')).toBe('ac-dc')
    // Stable across the shape a caller writes and the shape a backend sends.
    expect(artistKey('  The   BEATLES ')).toBe('the-beatles')
  })

  it('falls back to a stable hash for a name the slug cannot represent', () => {
    // The bug this exists for: an ASCII-only slug collapses every non-Latin
    // name to the empty string, so `|| 'unknown'` made one artist row for all
    // of them.
    expect(artistKey('Мираж')).toMatch(/^[0-9a-f]{16}$/)
    expect(artistKey('Мираж')).toBe(artistKey('Мираж'))
  })

  it('gives different non-Latin names different keys', () => {
    expect(artistKey('Мираж')).not.toBe(artistKey('Каскад'))
    expect(artistKey('Северное сияние')).not.toBe(artistKey('Южный крест'))
  })
})

describe('artworkId', () => {
  it('is content-addressed: the same bytes, the same id', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    expect(artworkId(bytes)).toBe(artworkId(new Uint8Array([1, 2, 3, 4, 5])))
  })

  it('separates covers that differ in any byte', () => {
    expect(artworkId(new Uint8Array([1, 2, 3]))).not.toBe(artworkId(new Uint8Array([1, 2, 4])))
  })

  it('folds the length in, so same-value different-length digests still differ', () => {
    const twoRounds = (seed: number, n: number): string => {
      let hash = seed
      for (let i = 0; i < n; i++) hash = Math.imul(hash ^ i, 0x01000193) >>> 0
      return hash.toString(16).padStart(8, '0')
    }
    // Constructed so both digests end equal only if the length suffix were
    // absent; with it, the ids cannot collide.
    expect(artworkId(new Uint8Array(2))).not.toBe(artworkId(new Uint8Array(3)))
    expect(twoRounds(0x811c9dc5, 2)).not.toBe(twoRounds(0x811c9dc5, 3))
  })

  it('is two rounds over different salts, plus the length', () => {
    // Pinned structurally: the first round is the bare FNV-1a pass, the
    // second runs over the alternate salt, and the length suffix closes it.
    // A single 32-bit round plus the length collides on same-size covers
    // often enough to matter at library scale.
    const round = (bytes: Uint8Array, seed: number): string => {
      let hash = seed
      for (const b of bytes) hash = Math.imul(hash ^ b, 0x01000193) >>> 0
      return hash.toString(16).padStart(8, '0')
    }
    const bytes = new Uint8Array([9, 8, 7])
    expect(artworkId(bytes)).toBe(
      `${round(bytes, 0x811c9dc5)}${round(bytes, 0x811c9dc5 ^ 0x5bf03635)}` +
        `${bytes.length.toString(16)}`,
    )
  })
})
