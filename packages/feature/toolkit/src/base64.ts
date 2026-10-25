/**
 * Base64 over plain `Uint8Array`s, with no runtime dependency.
 *
 * Written for `core-codec-mobile`: the native artwork batch bridge answers in
 * base64 strings, and Hermes ships neither `Buffer` nor (reliably across RN
 * versions) `atob`, so the codec needs its own total codec. Node callers
 * keep using `Buffer`; this exists so the mobile path does not have to
 * feature-detect its decoder.
 *
 * Standard alphabet with padding; whitespace is tolerated on decode because
 * base64 in the wild picks up line breaks.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const LOOKUP: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]!] = i

export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }
  return out
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '')
  const remaining = clean.length % 4
  if (remaining === 1) throw new Error('invalid base64: impossible length')

  const byteLength = (clean.length * 3) >> 2
  const out = new Uint8Array(byteLength)
  let outIndex = 0
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length; i++) {
    const value = LOOKUP[clean[i]!]
    if (value === undefined) throw new Error(`invalid base64 character: ${clean[i]}`)
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[outIndex++] = (buffer >> bits) & 0xff
    }
  }
  return out
}
