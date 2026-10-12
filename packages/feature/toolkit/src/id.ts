/**
 * Stable ids for things that have none.
 *
 * A local track has no remote id, so one is derived from the thing that
 * identifies it: its file Uri. Derived rather than random because the same
 * file must produce the same URN on every scan — otherwise a rescan orphans
 * every playlist entry, every queue row and every play record that referred to
 * it. The same argument covers every writer of catalogue rows, which is why
 * this lives here and not in the scanner.
 *
 * FNV-1a: a few lines, no dependency, and stable across platforms. It is not a
 * security hash and nothing here treats it as one — a collision would merge
 * two files, which is why the album and artist keys fold in more than a title.
 */

const OFFSET = 0x811c9dc5
const PRIME = 0x01000193

function fnv1a(value: string): string {
  let hash = OFFSET
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 64 bits, as two rounds over different salts. Collisions stay theoretical. */
export function stableId(...parts: (string | undefined)[]) {
  const joined = parts.map((p) => p ?? '').join('\x00')
  return `${fnv1a(joined)}${fnv1a(`\x01${joined}`)}`
}

/** Normalised for matching: case-folded, trimmed, whitespace collapsed. */
export function normalise(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function trackId(uri: string): string {
  return stableId('track', uri)
}

export function albumId(albumTitle: string | undefined, albumArtist: string | undefined): string {
  return stableId('album', normalise(albumTitle), normalise(albumArtist))
}

export function artistId(name: string): string {
  return stableId('artist', normalise(name))
}

/**
 * A remote artist's URN segment.
 *
 * The readable slug where the name is Latin, the stable hash where it is not.
 * An ASCII-only slug collapses every CJK name to the empty string, and the
 * `|| 'unknown'` that used to follow meant every Chinese uploader shared one
 * artist URN and one `artists` row — so the library showed whichever name was
 * written last, for all of them at once. Readable where it can be, unique
 * always.
 */
export function artistKey(name: string): string {
  const slug = normalise(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || artistId(name)
}

/**
 * Artwork is content-addressed, so two files sharing a cover share a row.
 *
 * Two rounds over different salts, like `stableId`. A single 32-bit round plus
 * the length collides on same-size covers often enough to matter at library
 * scale, and a collision here silently gives one album another's artwork.
 */
export function artworkId(bytes: Uint8Array): string {
  const digest = (seed: number): string => {
    let hash = seed
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i]!
      hash = Math.imul(hash, PRIME) >>> 0
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }
  return `${digest(OFFSET)}${digest(OFFSET ^ 0x5bf03635)}${bytes.length.toString(16)}`
}
