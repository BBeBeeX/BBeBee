/**
 * The digest primitives a source document needs, in portable TypeScript.
 *
 * Not `node:crypto` and not WebCrypto. Two reasons, and the second is the one
 * that decides it:
 *
 *  - This runs on Node, in the desktop webview, and in React Native's JSC, and
 *    only one of those has `node:crypto`. WebCrypto is closer to universal but
 *    is *asynchronous* and has no MD5 — and MD5 is exactly what Subsonic's
 *    auth scheme requires, so the one algorithm a shipped document depends on
 *    is the one WebCrypto refuses to provide.
 *  - A rule is evaluated inside a sandbox where the host surface is a fixed
 *    list (docs/06 §8). Reaching a platform API from there would mean the list
 *    is not the whole story.
 *
 * ⚠️ MD5 and SHA-1 are here because **backends** use them, not because they
 * are sound. MD5 is broken for collision resistance and SHA-1 is broken for
 * the same; neither is used by this app for anything of its own. `sha256Hex`
 * in `hash.ts` is what identity and integrity use.
 */

import { sha256Hex } from './hash.js'

/* ── UTF-8 ──────────────────────────────────────────────────────────────── */

function bytesOf(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/* ── MD5 ────────────────────────────────────────────────────────────────── */

/** Per-round shift amounts. */
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/** `floor(abs(sin(i + 1)) * 2^32)`, precomputed so startup does no trig. */
const MD5_K = new Uint32Array(
  Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)),
)

function rotl(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift))
}

export function md5Hex(input: string | Uint8Array): string {
  const message = bytesOf(input)
  const bitLength = message.length * 8

  // Pad to 56 mod 64, then eight bytes of little-endian length.
  const padded = new Uint8Array((((message.length + 8) >> 6) + 1) << 6)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLength >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const words = new Uint32Array(16)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true)

    let [a, b, c, d] = [a0, b0, c0, d0]
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      b = (b + rotl((a + f + MD5_K[i]! + words[g]!) >>> 0, MD5_SHIFTS[i]!)) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return hex(out)
}

/* ── SHA-1 ──────────────────────────────────────────────────────────────── */

export function sha1Hex(input: string | Uint8Array): string {
  const message = bytesOf(input)
  const bitLength = message.length * 8

  const padded = new Uint8Array((((message.length + 8) >> 6) + 1) << 6)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  // Big-endian length, unlike MD5. Getting this backwards produces a digest
  // that is wrong only for messages near a block boundary — the kind of bug
  // that passes a smoke test and fails on one real document.
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1) >>> 0
    }

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const tmp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = tmp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  for (const [i, value] of [h0, h1, h2, h3, h4].entries()) outView.setUint32(i * 4, value)
  return hex(out)
}

/* ── HMAC ───────────────────────────────────────────────────────────────── */

type HashName = 'md5' | 'sha1' | 'sha256'

const BLOCK_SIZE = 64

/**
 * HMAC over any of the three, per RFC 2104.
 *
 * Written against raw digests rather than hex, because the construction hashes
 * a *digest* in the outer pass — feeding it the hex string instead is a
 * mistake that produces stable, plausible, entirely wrong output that only
 * fails when compared against another implementation.
 */
export function hmacHex(algorithm: HashName, key: string | Uint8Array, message: string): string {
  const digest = (bytes: Uint8Array): Uint8Array => {
    const asHex =
      algorithm === 'md5' ? md5Hex(bytes) : algorithm === 'sha1' ? sha1Hex(bytes) : sha256Hex(bytes)
    return fromHex(asHex)
  }

  let keyBytes = bytesOf(key)
  if (keyBytes.length > BLOCK_SIZE) keyBytes = digest(keyBytes)

  const padded = new Uint8Array(BLOCK_SIZE)
  padded.set(keyBytes)

  const inner = new Uint8Array(BLOCK_SIZE + bytesOf(message).length)
  const outer = new Uint8Array(BLOCK_SIZE + (algorithm === 'md5' ? 16 : algorithm === 'sha1' ? 20 : 32))
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] = padded[i]! ^ 0x36
    outer[i] = padded[i]! ^ 0x5c
  }
  inner.set(bytesOf(message), BLOCK_SIZE)
  outer.set(digest(inner), BLOCK_SIZE)
  return hex(digest(outer))
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

/* ── Base64 and randomness ──────────────────────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Encode(input: string | Uint8Array): string {
  const bytes = bytesOf(input)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

/**
 * Decode standard *or* URL-safe base64.
 *
 * ⚠️ `-` and `_` are **mapped**, not stripped. Stripping them was silent
 * corruption of exactly the values that matter: a JWT and an OAuth token are
 * base64url by definition, and dropping their `-`/`_` shifts every subsequent
 * character into the wrong quantum. `"-_--"` decoded to the empty string
 * rather than to its three bytes — and only for tokens that happened to
 * contain one, so it failed intermittently and looked like a backend problem.
 *
 * Padding is optional, but a length of 1 mod 4 cannot have come from an
 * encoder and is refused rather than half-decoded.
 *
 * Returns **text**: the bytes are decoded as UTF-8, which is what every caller
 * here wants (a token, a credential, a JSON header). Arbitrary binary would
 * need a bytes-returning sibling, and nothing has asked for one.
 */
export function base64Decode(input: string): string {
  // Map first, then clean: the order is the bug.
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  if (clean.length % 4 === 1) {
    throw new Error(`base64: ${clean.length} characters cannot be a base64 string`)
  }
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      (B64.indexOf(clean[i + 2] ?? 'A') << 6) |
      B64.indexOf(clean[i + 3] ?? 'A')
    bytes.push((n >> 16) & 0xff)
    if (clean[i + 2] !== undefined) bytes.push((n >> 8) & 0xff)
    if (clean[i + 3] !== undefined) bytes.push(n & 0xff)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * `length` random bytes, hex-encoded.
 *
 * `crypto.getRandomValues` is a web standard present on every target — not a
 * platform API — and it is a CSPRNG. `Math.random` is not, and this is used
 * for auth salts, where a predictable value is the whole vulnerability.
 */
export function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.max(1, Math.min(length, 256)))
  globalThis.crypto.getRandomValues(bytes)
  return hex(bytes)
}

/* ── RSA & RSA-OAEP (PKCS#1 v1.5 & RFC 8017 OAEP-SHA256) ────────────────── */

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '')
  const padIndex = clean.indexOf('=')
  const unpadded = padIndex === -1 ? clean : clean.slice(0, padIndex)
  const bytes: number[] = []
  for (let i = 0; i < unpadded.length; i += 4) {
    const c0 = B64.indexOf(unpadded[i]!)
    const c1 = B64.indexOf(unpadded[i + 1] ?? 'A')
    const c2 = unpadded[i + 2] ? B64.indexOf(unpadded[i + 2]!) : 0
    const c3 = unpadded[i + 3] ? B64.indexOf(unpadded[i + 3]!) : 0
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3
    bytes.push((n >> 16) & 0xff)
    if (i + 2 < unpadded.length) bytes.push((n >> 8) & 0xff)
    if (i + 3 < unpadded.length) bytes.push(n & 0xff)
  }
  return new Uint8Array(bytes)
}

export interface RsaPublicKey {
  n: bigint
  e: bigint
  k: number
}

/**
 * Parse an RSA public key from PEM format (PKCS#1 or X.509 SubjectPublicKeyInfo).
 */
export function parseRsaPublicKey(pem: string): RsaPublicKey {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')
  const der = base64ToBytes(b64)
  let pos = 0

  function readLength(): number {
    const b = der[pos++]!
    if ((b & 0x80) === 0) return b
    const numBytes = b & 0x7f
    let len = 0
    for (let i = 0; i < numBytes; i++) {
      len = (len << 8) | der[pos++]!
    }
    return len
  }

  function readInteger(): bigint {
    const tag = der[pos++]!
    if (tag !== 0x02) throw new Error(`expected INTEGER (0x02), got 0x${tag.toString(16)}`)
    const len = readLength()
    let val = 0n
    for (let i = 0; i < len; i++) {
      val = (val << 8n) | BigInt(der[pos++]!)
    }
    return val
  }

  if (der[pos++] !== 0x30) throw new Error('expected outer SEQUENCE')
  readLength()

  // SubjectPublicKeyInfo check: AlgorithmIdentifier sequence
  if (der[pos] === 0x30) {
    pos++
    const algoLen = readLength()
    pos += algoLen
    if (der[pos++] !== 0x03) throw new Error('expected BIT STRING')
    readLength()
    pos++ // unused bits byte
    if (der[pos++] !== 0x30) throw new Error('expected inner SEQUENCE')
    readLength()
  }

  const n = readInteger()
  const e = readInteger()
  let hexLen = n.toString(16).length
  if (hexLen % 2 !== 0) hexLen++
  const k = hexLen / 2

  return { n, e, k }
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n
  base = base % mod
  while (exp > 0n) {
    if ((exp & 1n) === 1n) res = (res * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return res
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let val = 0n
  for (let i = 0; i < bytes.length; i++) {
    val = (val << 8n) | BigInt(bytes[i]!)
  }
  return val
}

function bigintToBytes(val: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(val & 0xffn)
    val >>= 8n
  }
  return out
}

/**
 * Encrypt using RSA PKCS#1 v1.5 padding, returned as base64 string.
 */
export function rsaEncrypt(plainText: string | Uint8Array, publicKeyPem: string): string {
  const key = parseRsaPublicKey(publicKeyPem)
  const m = bytesOf(plainText)
  const k = key.k
  if (m.length > k - 11) {
    throw new Error(`message too long: max ${k - 11} bytes for ${k * 8}-bit RSA key`)
  }

  const psLen = k - m.length - 3
  const ps = new Uint8Array(psLen)
  for (let i = 0; i < psLen; i++) {
    let r = 0
    while (r === 0) {
      const b = new Uint8Array(1)
      globalThis.crypto.getRandomValues(b)
      r = b[0]!
    }
    ps[i] = r
  }

  const em = new Uint8Array(k)
  em[0] = 0x00
  em[1] = 0x02
  em.set(ps, 2)
  em[2 + psLen] = 0x00
  em.set(m, 3 + psLen)

  const c = modPow(bytesToBigInt(em), key.e, key.n)
  return base64Encode(bigintToBytes(c, k))
}

function mgf1Sha256(seed: Uint8Array, maskLen: number): Uint8Array {
  const t = new Uint8Array(maskLen)
  let outPos = 0
  let counter = 0
  const c = new Uint8Array(4)
  const cView = new DataView(c.buffer)
  while (outPos < maskLen) {
    cView.setUint32(0, counter, false)
    const combined = new Uint8Array(seed.length + 4)
    combined.set(seed, 0)
    combined.set(c, seed.length)
    const hash = fromHex(sha256Hex(combined))
    const copyLen = Math.min(hash.length, maskLen - outPos)
    t.set(hash.subarray(0, copyLen), outPos)
    outPos += copyLen
    counter++
  }
  return t
}

/**
 * Encrypt using RSA-OAEP with SHA-256, returned as lowercase hex string.
 */
export function rsaOaepEncrypt(
  plainText: string | Uint8Array,
  publicKeyPem: string,
  label: string = '',
): string {
  const key = parseRsaPublicKey(publicKeyPem)
  const m = bytesOf(plainText)
  const k = key.k
  const hLen = 32

  if (m.length > k - 2 * hLen - 2) {
    throw new Error(`message too long: max ${k - 2 * hLen - 2} bytes for RSA-OAEP SHA-256`)
  }

  const lHash = fromHex(sha256Hex(bytesOf(label)))
  const psLen = k - m.length - 2 * hLen - 2
  const db = new Uint8Array(k - hLen - 1)
  db.set(lHash, 0)
  db.fill(0, hLen, hLen + psLen)
  db[hLen + psLen] = 0x01
  db.set(m, hLen + psLen + 1)

  const seed = new Uint8Array(hLen)
  globalThis.crypto.getRandomValues(seed)

  const dbMask = mgf1Sha256(seed, k - hLen - 1)
  for (let i = 0; i < db.length; i++) db[i] = db[i]! ^ dbMask[i]!

  const seedMask = mgf1Sha256(db, hLen)
  for (let i = 0; i < seed.length; i++) seed[i] = seed[i]! ^ seedMask[i]!

  const em = new Uint8Array(k)
  em[0] = 0x00
  em.set(seed, 1)
  em.set(db, 1 + hLen)

  const c = modPow(bytesToBigInt(em), key.e, key.n)
  return hex(bigintToBytes(c, k))
}
