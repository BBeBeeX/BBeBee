import { describe, expect, it } from 'vitest'

import { decodeBase64, encodeBase64 } from './base64.js'

describe('base64', () => {
  it('round-trips every length, including the padding edge cases', () => {
    for (let len = 0; len <= 12; len++) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len) % 256
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes))
    }
  })

  it('matches the canonical vectors', () => {
    expect(encodeBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
    expect(Array.from(decodeBase64('aGVsbG8='))).toEqual(Array.from(new TextEncoder().encode('hello')))
    expect(encodeBase64(new Uint8Array([0, 255, 128]))).toBe('AP+A')
  })

  it('decodes whitespace-padded input', () => {
    expect(Array.from(decodeBase64('aGVs\nbG8= '))).toEqual(Array.from(new TextEncoder().encode('hello')))
  })

  it('rejects impossible lengths and foreign characters', () => {
    expect(() => decodeBase64('aGVsb')).toThrow()
    expect(() => decodeBase64('a#vs')).toThrow()
  })
})
