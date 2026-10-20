/**
 * SHA-256, in pure TypeScript.
 *
 * Identity derivation has to be **deterministic across every platform and
 * synchronous**: a source id appears in a URN, in a primary key, and in a log
 * line, and it must be the same value on Hermes and in a renderer. `ctx.crypto`
 * is neither — it is async and platform-backed — so identity cannot depend on
 * it without making URN construction an await and the derivation untestable
 * without a kernel.
 *
 * This is for **identity, not authentication**. It is not constant-time and it
 * is not for signing; `ctx.crypto` remains the only thing that touches
 * credentials.
 *
 * Two properties worth knowing before reusing it:
 *
 *  - **Lone surrogates encode WTF-8, not UTF-8.** `TextEncoder` replaces an
 *    unpaired surrogate with U+FFFD; this encodes it as three bytes. Every
 *    input here is a URL or a JSON document, where a lone surrogate cannot
 *    survive `JSON.parse` anyway — and self-consistency is what identity
 *    needs. It does mean a digest of such a string will not match
 *    `node:crypto`.
 *  - **It buffers.** UTF-8 encoding and padding each allocate a copy, so peak
 *    use is roughly three times the input. Fine for a URL or a document,
 *    wrong for a file — `ctx.crypto.digestStream` exists for those.
 *
 * Why not the 32-bit FNV-1a this replaced: a source id truncates the digest,
 * and `doc_hash` decides whether a re-import is an update or a no-op. At
 * 32 bits a collision is not academic — it makes `ON CONFLICT(id)` overwrite
 * an unrelated source, or classifies a changed document as "unchanged" and
 * silently skips the update. See docs/06 §1.2 and docs/07 §4.1.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** UTF-8 bytes of a string, without depending on `TextEncoder`'s availability. */
function utf8(input: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    // Combine a surrogate pair into one code point before encoding it.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        i++
      }
    }
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      )
    }
  }
  return Uint8Array.from(out)
}

/** SHA-256 of a string or bytes, as lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8(input) : input

  // Pad to a multiple of 64 bytes: 0x80, zeroes, then the bit length as a
  // 64-bit big-endian integer.
  const bitLength = bytes.length * 8
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  // Lengths beyond 2^53 bits cannot occur here and would overflow anyway.
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!
      const b = w[i - 2]!
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!]

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }

  let out = ''
  for (const word of h) out += word.toString(16).padStart(8, '0')
  return out
}

/**
 * SHA-512 of bytes, as raw bytes. Pure TypeScript — same rationale as
 * `sha256Hex` above (deterministic on Hermes and in renderers, no async
 * platform crypto involved).
 *
 * Used to verify npm `dist.integrity` (`sha512-<base64>`) when installing
 * plugins from an npm registry. Differentially tested against `node:crypto`
 * (empty input, padding boundaries, multi-block and random inputs).
 */
const SHA512_K: ReadonlyArray<readonly [hi: number, lo: number]> = [
  [0x428a2f98, 0xd728ae22], [0x71374491, 0x23ef65cd], [0xb5c0fbcf, 0xec4d3b2f], [0xe9b5dba5, 0x8189dbbc],
  [0x3956c25b, 0xf348b538], [0x59f111f1, 0xb605d019], [0x923f82a4, 0xaf194f9b], [0xab1c5ed5, 0xda6d8118],
  [0xd807aa98, 0xa3030242], [0x12835b01, 0x45706fbe], [0x243185be, 0x4ee4b28c], [0x550c7dc3, 0xd5ffb4e2],
  [0x72be5d74, 0xf27b896f], [0x80deb1fe, 0x3b1696b1], [0x9bdc06a7, 0x25c71235], [0xc19bf174, 0xcf692694],
  [0xe49b69c1, 0x9ef14ad2], [0xefbe4786, 0x384f25e3], [0x0fc19dc6, 0x8b8cd5b5], [0x240ca1cc, 0x77ac9c65],
  [0x2de92c6f, 0x592b0275], [0x4a7484aa, 0x6ea6e483], [0x5cb0a9dc, 0xbd41fbd4], [0x76f988da, 0x831153b5],
  [0x983e5152, 0xee66dfab], [0xa831c66d, 0x2db43210], [0xb00327c8, 0x98fb213f], [0xbf597fc7, 0xbeef0ee4],
  [0xc6e00bf3, 0x3da88fc2], [0xd5a79147, 0x930aa725], [0x06ca6351, 0xe003826f], [0x14292967, 0x0a0e6e70],
  [0x27b70a85, 0x46d22ffc], [0x2e1b2138, 0x5c26c926], [0x4d2c6dfc, 0x5ac42aed], [0x53380d13, 0x9d95b3df],
  [0x650a7354, 0x8baf63de], [0x766a0abb, 0x3c77b2a8], [0x81c2c92e, 0x47edaee6], [0x92722c85, 0x1482353b],
  [0xa2bfe8a1, 0x4cf10364], [0xa81a664b, 0xbc423001], [0xc24b8b70, 0xd0f89791], [0xc76c51a3, 0x0654be30],
  [0xd192e819, 0xd6ef5218], [0xd6990624, 0x5565a910], [0xf40e3585, 0x5771202a], [0x106aa070, 0x32bbd1b8],
  [0x19a4c116, 0xb8d2d0c8], [0x1e376c08, 0x5141ab53], [0x2748774c, 0xdf8eeb99], [0x34b0bcb5, 0xe19b48a8],
  [0x391c0cb3, 0xc5c95a63], [0x4ed8aa4a, 0xe3418acb], [0x5b9cca4f, 0x7763e373], [0x682e6ff3, 0xd6b2b8a3],
  [0x748f82ee, 0x5defb2fc], [0x78a5636f, 0x43172f60], [0x84c87814, 0xa1f0ab72], [0x8cc70208, 0x1a6439ec],
  [0x90befffa, 0x23631e28], [0xa4506ceb, 0xde82bde9], [0xbef9a3f7, 0xb2c67915], [0xc67178f2, 0xe372532b],
  [0xca273ece, 0xea26619c], [0xd186b8c7, 0x21c0c207], [0xeada7dd6, 0xcde0eb1e], [0xf57d4f7f, 0xee6ed178],
  [0x06f067aa, 0x72176fba], [0x0a637dc5, 0xa2c898a6], [0x113f9804, 0xbef90dae], [0x1b710b35, 0x131c471b],
  [0x28db77f5, 0x23047d84], [0x32caab7b, 0x40c72493], [0x3c9ebe0a, 0x15c9bebc], [0x431d67c4, 0x9c100d4c],
  [0x4cc5d4be, 0xcb3e42b6], [0x597f299c, 0xfc657e2a], [0x5fcb6fab, 0x3ad6faec], [0x6c44198c, 0x4a475817],
]

type U64 = readonly [hi: number, lo: number]

function u64add(ah: number, al: number, bh: number, bl: number): U64 {
  const lo = (al + bl) >>> 0
  // A carry occurred exactly when the wrapped sum fell below an addend.
  const hi = (ah + bh + (lo < al ? 1 : 0)) >>> 0
  return [hi, lo]
}

function u64rotr(hi: number, lo: number, n: number): U64 {
  const r = n % 64
  if (r === 0) return [hi >>> 0, lo >>> 0]
  if (r < 32) {
    return [((hi >>> r) | (lo << (32 - r))) >>> 0, ((lo >>> r) | (hi << (32 - r))) >>> 0]
  }
  if (r === 32) return [lo >>> 0, hi >>> 0]
  const m = r - 32
  return [((lo >>> m) | (hi << (32 - m))) >>> 0, ((hi >>> m) | (lo << (32 - m))) >>> 0]
}

function u64shr(hi: number, lo: number, n: number): U64 {
  if (n === 0) return [hi >>> 0, lo >>> 0]
  if (n < 32) return [(hi >>> n) >>> 0, ((lo >>> n) | (hi << (32 - n))) >>> 0]
  if (n === 32) return [0, hi >>> 0]
  return [0, (hi >>> (n - 32)) >>> 0]
}

function u64xor(...words: number[]): U64 {
  let hi = 0
  let lo = 0
  for (let i = 0; i + 1 < words.length; i += 2) {
    hi ^= words[i]!
    lo ^= words[i + 1]!
  }
  return [hi >>> 0, lo >>> 0]
}

export function sha512(input: Uint8Array): Uint8Array {
  const bitLenHi = Math.floor(input.length / 0x20000000)
  const bitLenLo = (input.length << 3) >>> 0
  const paddedLen = (((input.length + 16) >> 7) + 1) << 7
  const padded = new Uint8Array(paddedLen)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer)
  // 128-bit big-endian length; the high 96 bits are zero for any realistic input.
  view.setUint32(paddedLen - 16, 0)
  view.setUint32(paddedLen - 12, 0)
  view.setUint32(paddedLen - 8, bitLenHi)
  view.setUint32(paddedLen - 4, bitLenLo)

  let h: U64[] = [
    [0x6a09e667, 0xf3bcc908],
    [0xbb67ae85, 0x84caa73b],
    [0x3c6ef372, 0xfe94f82b],
    [0xa54ff53a, 0x5f1d36f1],
    [0x510e527f, 0xade682d1],
    [0x9b05688c, 0x2b3e6c1f],
    [0x1f83d9ab, 0xfb41bd6b],
    [0x5be0cd19, 0x137e2179],
  ]
  const w: U64[] = new Array(80)

  for (let off = 0; off < paddedLen; off += 128) {
    for (let i = 0; i < 16; i++) {
      w[i] = [view.getUint32(off + i * 8), view.getUint32(off + i * 8 + 4)]
    }
    for (let i = 16; i < 80; i++) {
      const wi15 = w[i - 15]!
      const wi2 = w[i - 2]!
      const wi16 = w[i - 16]!
      const wi7 = w[i - 7]!
      const [s0h, s0l] = u64xor(
        ...u64rotr(wi15[0], wi15[1], 1),
        ...u64rotr(wi15[0], wi15[1], 8),
        ...u64shr(wi15[0], wi15[1], 7),
      )
      const [s1h, s1l] = u64xor(
        ...u64rotr(wi2[0], wi2[1], 19),
        ...u64rotr(wi2[0], wi2[1], 61),
        ...u64shr(wi2[0], wi2[1], 6),
      )
      let [wh, wl] = u64add(wi16[0], wi16[1], s0h, s0l)
      ;[wh, wl] = u64add(wh, wl, wi7[0], wi7[1])
      ;[wh, wl] = u64add(wh, wl, s1h, s1l)
      w[i] = [wh, wl]
    }

    let [ah, al] = h[0]!
    let [bh, bl] = h[1]!
    let [ch, cl] = h[2]!
    let [dh, dl] = h[3]!
    let [eh, el] = h[4]!
    let [fh, fl] = h[5]!
    let [gh, gl] = h[6]!
    let [hh, hl] = h[7]!

    for (let i = 0; i < 80; i++) {
      const [s1h, s1l] = u64xor(...u64rotr(eh, el, 14), ...u64rotr(eh, el, 18), ...u64rotr(eh, el, 41))
      const chh = ((eh & fh) ^ (~eh & gh)) >>> 0
      const chl = ((el & fl) ^ (~el & gl)) >>> 0
      const ki = SHA512_K[i]!
      const wi = w[i]!
      let [t1h, t1l] = u64add(hh, hl, s1h, s1l)
      ;[t1h, t1l] = u64add(t1h, t1l, chh, chl)
      ;[t1h, t1l] = u64add(t1h, t1l, ki[0], ki[1])
      ;[t1h, t1l] = u64add(t1h, t1l, wi[0], wi[1])
      const [s0h, s0l] = u64xor(...u64rotr(ah, al, 28), ...u64rotr(ah, al, 34), ...u64rotr(ah, al, 39))
      const mjh = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0
      const mjl = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0
      const [t2h, t2l] = u64add(s0h, s0l, mjh, mjl)
      hh = gh
      hl = gl
      gh = fh
      gl = fl
      fh = eh
      fl = el
      ;[eh, el] = u64add(dh, dl, t1h, t1l)
      dh = ch
      dl = cl
      ch = bh
      cl = bl
      bh = ah
      bl = al
      ;[ah, al] = u64add(t1h, t1l, t2h, t2l)
    }

    const working: U64[] = [
      [ah, al],
      [bh, bl],
      [ch, cl],
      [dh, dl],
      [eh, el],
      [fh, fl],
      [gh, gl],
      [hh, hl],
    ]
    h = h.map((prev, i) => {
      const cur = working[i]!
      const [nh, nl] = u64add(prev[0], prev[1], cur[0], cur[1])
      const next: U64 = [nh, nl]
      return next
    })
  }

  const out = new Uint8Array(64)
  const outView = new DataView(out.buffer)
  h.forEach(([hi, lo], i) => {
    outView.setUint32(i * 8, hi)
    outView.setUint32(i * 8 + 4, lo)
  })
  return out
}
