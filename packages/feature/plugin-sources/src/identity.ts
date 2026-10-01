/**
 * Source identity, document validation, and the document → row transform.
 *
 * A source is keyed by its `sourceUrl`, exactly as a legado book source is,
 * and addressed by a **derived** id: slugified host plus a SHA-256 prefix.
 * Derived rather than random so that re-importing the same document produces
 * the same id — which is what makes re-import an *update* that keeps every URN,
 * cached row, cookie jar and playlist reference (docs/06 §1.2, §9).
 */

import { sha256Hex, SourceFormatError, STREAM_QUALITIES } from '@BBeBee/protocol'
import type { SourceDocument, SourceRecord, SourceType, StreamQuality } from '@BBeBee/protocol'

const SOURCE_TYPES: readonly SourceType[] = ['music', 'podcast', 'radio']

/** Schemes a source may be served over. Anything else is refused at import. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/**
 * How much of the digest goes into a source id.
 *
 * 8 hex characters — 32 bits. The suffix only has to separate two paths on one
 * host, but it was 16 bits, where a same-host collision reaches ~7% at a
 * hundred sources, and a collision makes `ON CONFLICT(id)` overwrite an
 * unrelated source's row wholesale.
 */
const ID_DIGEST_CHARS = 8

/**
 * Content hash of a stored document.
 *
 * Full SHA-256, not a prefix: this is what decides whether a re-import is an
 * update or a no-op, so a collision does not merely confuse a diff — it
 * classifies a changed document as "unchanged" and silently skips the update.
 */
export function docHashOf(docJson: string): string {
  return sha256Hex(docJson)
}

/**
 * Derive the source id.
 *
 * The host makes it readable in a log line and in a URN; the digest suffix
 * keeps two paths on one host distinct. It never contains ':' — that would
 * make every URN in the namespace unparseable.
 */
export function sourceIdFor(sourceUrl: string): string {
  return `${hostSlug(sourceUrl)}-${sha256Hex(sourceUrl).slice(0, ID_DIGEST_CHARS)}`
}

function hostSlug(sourceUrl: string): string {
  let host: string
  try {
    host = new URL(sourceUrl).hostname || sourceUrl
  } catch {
    host = sourceUrl
  }
  const slug = host
    .toLowerCase()
    .replace(/^www[.]/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'source'
}

/**
 * The hosts a source may talk to.
 *
 * `sourceUrl`'s own host, plus whatever the document declares. Resolved once
 * at import so the import screen can show the user a plain list of hostnames —
 * a sentence they can actually judge (docs/06 §8).
 */
export function allowedHostsFor(doc: SourceDocument): string[] {
  const hosts = new Set<string>()
  const own = hostOf(doc.sourceUrl)
  if (own) hosts.add(own)
  for (const entry of doc.allowedHosts ?? []) {
    const host = hostOf(entry) ?? entry.trim().toLowerCase()
    if (host) hosts.add(host)
  }
  return [...hosts].sort()
}

/**
 * Reject an `allowedHosts` entry that grants more than it says.
 *
 * The list governs egress, so nothing in it may be quietly reinterpreted as
 * something broader than what was written. The matcher is asked about
 * hostnames only — there is no port and no path anywhere in it — so anything
 * else in an entry is dropped, and dropping it widens the grant:
 *
 *  - `nas:4533` reads as "this host on this port" and becomes *every* port.
 *  - `https://api.example.org/v1` reads as "this endpoint" and becomes the
 *    whole host.
 *
 * A scheme alone drops nothing, so `https://cdn.example.org` is accepted and
 * normalised — refusing it would be friction with no safety behind it.
 *
 * Refused at import, where the author is present and the message can name the
 * entry, rather than becoming a grant nobody wrote.
 */
function validateAllowedHosts(
  entries: readonly string[],
  at: (path: string, message: string) => void,
): void {
  entries.forEach((entry, i) => {
    const value = entry.trim()
    const path = `allowedHosts[${i}]`
    if (!value) {
      at(path, 'must not be empty')
      return
    }

    const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value)
    const rest = scheme ? value.slice(scheme[0].length) : value

    const slash = rest.indexOf('/')
    if (slash !== -1 && rest.slice(slash + 1).length > 0) {
      at(path, `"${value}" carries a path; the allowlist is per-host, so it would cover the whole host`)
      return
    }
    const authority = slash === -1 ? rest : rest.slice(0, slash)
    if (/[?#@]/.test(authority)) {
      at(path, `"${value}" is not a hostname`)
      return
    }

    // One colon outside brackets is a port. Two or more is an IPv6 literal,
    // which is a host and is fine.
    const outside = authority.startsWith('[')
      ? authority.slice(authority.indexOf(']') + 1)
      : authority
    if ((outside.match(/:/g)?.length ?? 0) === 1) {
      at(
        path,
        `"${value}" names a port; the allowlist is per-host, so the port would be ` +
          'dropped and the entry would cover every port — write just the host',
      )
    }
  })
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

/* ── Validation ─────────────────────────────────────────────────────────── */

const LIST_FIELDS = [
  'trackList', 'title', 'trackId', 'artist', 'album', 'albumId', 'artwork',
  'durationMs', 'quality', 'streamUrl', 'childUrl', 'kind',
] as const

/** Every rule field, by block. A rule that is not a string cannot be evaluated. */
const RULE_FIELDS: Record<string, readonly string[]> = {
  ruleSearch: LIST_FIELDS,
  ruleSearchArtist: LIST_FIELDS,
  ruleExplore: LIST_FIELDS,
  ruleTrackList: LIST_FIELDS,
  ruleAlbum: ['title', 'artist', 'artwork', 'year', 'description', 'trackCount', 'trackListUrl', 'childUrl'],
  ruleStream: ['url', 'headers', 'mimeType', 'codec', 'bitrateKbps', 'sampleRate', 'byteLength',
    'seekable', 'expiresAt', 'quality', 'qualities'],
  ruleLyric: ['lyric', 'format', 'offsetMs'],
  ruleLibrary: ['list', 'setSaved', 'createPlaylist', 'addToPlaylist', 'removeFromPlaylist',
    'deletePlaylist'],
  ruleArtist: ['artist', 'name', 'bio', 'artwork', 'albums', 'topTracks'],
  rulePlaylist: ['playlist', 'name', 'description', 'artwork', 'trackList', 'trackId', 'title', 'artist', 'durationMs'],
}

/** Top-level fields that are rules, and so must be strings like any other. */
const TOP_LEVEL_RULES = ['header', 'searchUrl', 'searchArtistUrl', 'exploreUrl'] as const

/**
 * Validate a parsed document.
 *
 * Collects every issue rather than the first: the import screen lists them
 * all, and fixing one at a time is miserable. `ruleStream` is the only
 * required rule block, because a source that cannot produce a playable URL is
 * not a music source (docs/06 §1.3).
 */
export function validateDocument(value: unknown, index = 0): SourceDocument {
  const issues: { path: string; message: string }[] = []
  const at = (path: string, message: string) => issues.push({ path, message })

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceFormatError(`entry ${index} is not an object`, [
      { path: `[${index}]`, message: 'expected a JSON object' },
    ])
  }
  const doc = value as Record<string, unknown>

  /* identity */
  if (typeof doc.sourceUrl !== 'string' || !doc.sourceUrl.trim()) {
    at('sourceUrl', 'required, and must be the backend base URL')
  } else {
    validateSourceUrl(doc.sourceUrl, at)
  }
  if (typeof doc.sourceName !== 'string' || !doc.sourceName.trim()) {
    at('sourceName', 'required')
  }

  /* scalars — an unchecked type here surfaces as a SQL binding crash */
  if (doc.sourceType !== undefined && !SOURCE_TYPES.includes(doc.sourceType as SourceType)) {
    at('sourceType', `must be one of ${SOURCE_TYPES.join(', ')}`)
  }
  for (const key of ['sourceGroup', 'sourceIcon', 'sourceComment', 'variableComment', 'jsLib',
    'concurrentRate', 'loginUrl', 'loginCheckJs'] as const) {
    if (doc[key] !== undefined && typeof doc[key] !== 'string') at(key, 'must be a string')
  }
  // `header: { "User-Agent": "…" }` is the single most likely authoring
  // mistake — the field looks like an object and is a *rule* that produces
  // one. Unchecked, it reached the evaluator as a raw TypeError.
  for (const key of TOP_LEVEL_RULES) {
    if (doc[key] === undefined) continue
    if (typeof doc[key] !== 'string') {
      at(key, 'must be a rule string (use "=" for a literal, e.g. =\u007b"X":"y"\u007d)')
      continue
    }
    // Symmetrical with `ruleStream.url`: a present-but-empty rule declares a
    // capability the source cannot serve, and derived capabilities would then
    // promise a search that returns nothing.
    if (!(doc[key] as string).trim()) at(key, 'must not be empty')
  }
  if (doc.loginUi !== undefined) validateLoginUi(doc.loginUi, at)
  if (doc.sortOrder !== undefined && !Number.isInteger(doc.sortOrder)) {
    at('sortOrder', 'must be an integer')
  }
  if (doc.enabled !== undefined && typeof doc.enabled !== 'boolean') {
    at('enabled', 'must be a boolean')
  }
  if (doc.allowedHosts !== undefined && !isStringArray(doc.allowedHosts)) {
    at('allowedHosts', 'must be an array of hostnames')
  } else if (doc.allowedHosts) {
    validateAllowedHosts(doc.allowedHosts, at)
  }

  if (doc.qualities !== undefined) {
    if (
      !Array.isArray(doc.qualities) ||
      !doc.qualities.every((q) => typeof q === 'string' && STREAM_QUALITIES.includes(q as StreamQuality))
    ) {
      at('qualities', `must be an array of valid stream qualities (${STREAM_QUALITIES.join(', ')})`)
    }
  }

  /* rule blocks */
  for (const [block, fields] of Object.entries(RULE_FIELDS)) {
    const rules = doc[block]
    if (rules === undefined) continue
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
      at(block, 'must be an object')
      continue
    }
    for (const [field, rule] of Object.entries(rules as Record<string, unknown>)) {
      if (!fields.includes(field)) {
        /*
         * Refused, deliberately — and asymmetric with unknown *top-level*
         * fields, which are kept so a document written for a newer runtime
         * still round-trips (docs/07 §4.1).
         *
         * A stray top-level key is forward compatibility. `ruleSearch.titel`
         * is a typo that would otherwise validate, never be read, and leave
         * the source half-working in a way that looks like the backend
         * changed — which is the single most expensive kind of bug for a
         * user to diagnose in a document they did not write.
         */
        at(`${block}.${field}`, `is not a known rule (expected one of: ${fields.join(', ')})`)
        continue
      }
      if (block === 'ruleStream' && field === 'qualities') {
        if (
          !Array.isArray(rule) ||
          !rule.every((q) => typeof q === 'string' && STREAM_QUALITIES.includes(q as StreamQuality))
        ) {
          at(`${block}.${field}`, `must be an array of valid stream qualities (${STREAM_QUALITIES.join(', ')})`)
        }
        continue
      }
      if (typeof rule !== 'string') at(`${block}.${field}`, 'must be a rule string')
    }
  }

  /* the one required block */
  const stream = doc.ruleStream
  if (stream === undefined) {
    at('ruleStream', 'required — a source that cannot produce a URL cannot play anything')
  } else if (stream === null || typeof stream !== 'object' || Array.isArray(stream)) {
    at('ruleStream', 'must be an object')
  } else {
    const url = (stream as Record<string, unknown>).url
    if (typeof url !== 'string') at('ruleStream.url', 'required')
    else if (!url.trim()) at('ruleStream.url', 'must not be empty')
  }

  if (issues.length) {
    const name = typeof doc.sourceName === 'string' ? doc.sourceName : `entry ${index}`
    throw new SourceFormatError(`${name} is not a valid source document`, issues)
  }
  return doc as unknown as SourceDocument
}

function validateSourceUrl(sourceUrl: string, at: (path: string, message: string) => void): void {
  if (sourceUrl !== sourceUrl.trim()) {
    // Otherwise ' https://x' and 'https://x' are two sources for one backend,
    // with two id namespaces and two half-populated libraries.
    at('sourceUrl', 'must not have leading or trailing whitespace')
    return
  }
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    at('sourceUrl', 'must be an absolute URL')
    return
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    at('sourceUrl', `scheme ${parsed.protocol} is not supported (use http or https)`)
  }
  if (parsed.username || parsed.password) {
    // The document is stored, exported and shared, so a credential in the URL
    // travels with it — the one thing export must never do (docs/06 §5).
    at('sourceUrl', 'must not embed credentials — put them in the source variable, not the URL')
  }
}

/** `loginUi` is a form spec the shell renders; a malformed one breaks sign-in. */
function validateLoginUi(value: unknown, at: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) {
    at('loginUi', 'must be an array of fields')
    return
  }
  const types = new Set(['text', 'password', 'checkbox', 'select'])
  value.forEach((field, i) => {
    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      at(`loginUi[${i}]`, 'must be an object')
      return
    }
    const f = field as Record<string, unknown>
    if (typeof f.id !== 'string' || !f.id.trim()) at(`loginUi[${i}].id`, 'required')
    if (typeof f.label !== 'string' || !f.label.trim()) at(`loginUi[${i}].label`, 'required')
    if (f.type !== undefined && !types.has(f.type as string)) {
      at(`loginUi[${i}].type`, `must be one of ${[...types].join(', ')}`)
    }
    if (f.options !== undefined && !isStringArray(f.options)) {
      at(`loginUi[${i}].options`, 'must be an array of strings')
    }
    if (f.placeholder !== undefined && typeof f.placeholder !== 'string') {
      at(`loginUi[${i}].placeholder`, 'must be a string')
    }
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

const BACKSLASH = '\\'
const WHITESPACE = /\s/
const FENCE = /^\s*```(?:json|jsonc)?\s*\n([\s\S]*?)\n?\s*```\s*$/

/* ── Parsing ────────────────────────────────────────────────────────────── */

/** One entry of an imported string, with the exact text it came from. */
export interface ParsedEntry {
  value: unknown
  /** The verbatim slice. Stored as `doc_json` so export round-trips exactly. */
  text: string
}

/**
 * Parse an imported string into documents, keeping each one's original text.
 *
 * Tolerates what people actually paste: leading whitespace, a wrapping
 * markdown code fence, and either one object or an array of them.
 *
 * The `text` is a **slice of the input**, not a re-serialisation. Export must
 * emit what was imported — key order, spacing and unknown fields included —
 * because the first time a user's document comes back subtly different, they
 * stop trusting export (docs/07 §4.1).
 */
export function parseSourceInput(input: string): ParsedEntry[] {
  const text = stripFence(input).trim()
  if (!text) throw new SourceFormatError('nothing to import', [])

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new SourceFormatError('not valid JSON', [
      { path: '', message: cause instanceof Error ? cause.message : String(cause) },
    ])
  }

  if (!Array.isArray(parsed)) return [{ value: parsed, text }]

  const spans = topLevelArraySpans(text)
  return parsed.map((value, i) => ({
    value,
    // If span recovery ever disagrees with the parse, fall back to a
    // re-serialisation rather than storing the wrong slice.
    text: spans.length === parsed.length ? spans[i]! : JSON.stringify(value),
  }))
}

/**
 * The source text of each element of a top-level JSON array.
 *
 * A small scanner rather than a parser: it tracks string state (so a ']' inside
 * a title is not a bracket) and nesting depth, and records the span between
 * top-level commas. `JSON.parse` has already proved the text is well-formed,
 * so this only has to agree with it, not validate anything.
 */
function topLevelArraySpans(text: string): string[] {
  const spans: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!

    if (inString) {
      if (escaped) escaped = false
      else if (ch === BACKSLASH) escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      if (depth === 1 && start === -1) start = i
      continue
    }

    if (ch === '[' || ch === '{') {
      depth++
      if (depth === 2 && start === -1) start = i
      continue
    }

    if (ch === ']' || ch === '}') {
      depth--
      if (depth === 1 && start !== -1) {
        spans.push(text.slice(start, i + 1))
        start = -1
      }
      if (depth === 0) break
      continue
    }

    if (depth === 1) {
      if (ch === ',') {
        if (start !== -1) {
          spans.push(text.slice(start, i).trim())
          start = -1
        }
        continue
      }
      // A bare scalar element (number, true, null) starts here.
      if (start === -1 && !WHITESPACE.test(ch)) start = i
    }
  }
  return spans
}

function stripFence(input: string): string {
  const fenced = FENCE.exec(input)
  return fenced?.[1] ?? input
}

/* ── Export and diffing ─────────────────────────────────────────────────── */

/**
 * Fields the app maintains, stripped on export.
 *
 * Sharing a source must not leak how fast *your* network is or when *you* last
 * used it. Credentials are not on this list because they are never in the
 * document to begin with — they live in `ctx.secrets` and `source_vars`, which
 * is what makes export safe by construction rather than by remembering.
 */
const APP_MAINTAINED = ['lastUpdated', 'respondTime', 'weight'] as const

export function exportableDocument(doc: SourceDocument): SourceDocument {
  const out = { ...doc } as unknown as Record<string, unknown>
  for (const key of APP_MAINTAINED) delete out[key]
  return out as unknown as SourceDocument
}

/**
 * Whether a source is one a user could share.
 *
 * Not every row is a document someone typed. `plugin-source-local` writes a
 * placeholder for the files on this device, and the ADR-5 migration writes one
 * per pre-existing provider — both with a `bbebee://` URL, because neither is
 * a backend anyone can reach. Emitting those from `export()` would produce a
 * file that `import()` then rejects, which is the one thing a round trip must
 * never do.
 */
export function isShareable(record: { sourceUrl: string }): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(record.sourceUrl).protocol)
  } catch {
    return false
  }
}

/** Whether a stored document carries any field export would have to strip. */
export function needsStripping(doc: SourceDocument): boolean {
  const record = doc as unknown as Record<string, unknown>
  return APP_MAINTAINED.some((key) => record[key] !== undefined)
}

/**
 * The text to export for one source.
 *
 * Returns the **verbatim slice** whenever nothing needs stripping, which is
 * the overwhelmingly common case. Re-serialising unconditionally was the one
 * place the byte-for-byte promise (docs/07 §4.1) failed on its only
 * user-facing path: an export/re-import round trip reordered keys, changed
 * spacing, rewrote `doc_hash`, and so came back reported as an *update* with
 * an empty change list — plus a needless source restart. Large integers lose
 * precision through `JSON.parse` too.
 *
 * Only a document carrying app-maintained fields is rebuilt, because there is
 * no way to remove a key from text without reformatting it.
 */
export function exportTextFor(record: {
  doc: SourceDocument
  docJson: string
}): string {
  if (!needsStripping(record.doc)) return record.docJson
  return JSON.stringify(exportableDocument(record.doc), null, 2)
}

/**
 * Which top-level fields differ. Drives the import diff the user is shown.
 *
 * Compared by *canonical* value, so re-ordering the keys of a nested rule
 * block is not a change. Otherwise a document that came back from an editor
 * with its keys sorted would report every block as modified, and the user
 * would be asked to confirm an update that changes nothing.
 */
export function changedFields(before: SourceDocument, after: SourceDocument): string[] {
  const a = before as unknown as Record<string, unknown>
  const b = after as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changed: string[] = []
  for (const key of keys) {
    if ((APP_MAINTAINED as readonly string[]).includes(key)) continue
    if (canonical(a[key]) !== canonical(b[key])) changed.push(key)
  }
  return changed.sort()
}

/** JSON with object keys sorted, so equality is about values, not spelling. */
function canonical(value: unknown): string {
  if (value === undefined) return ' undefined'
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
    // `Object.create(null)`, not `{}`: assigning a key literally named
    // `__proto__` to an ordinary object sets its prototype instead of adding
    // a property, so the key vanishes and two documents differing only there
    // compare equal — a change reported as "no change".
    const sorted = Object.create(null) as Record<string, unknown>
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k]
    }
    return sorted
  })
}

/* ── The row ────────────────────────────────────────────────────────────── */

/** Build a record from a document. `now` is injected so tests are not clocks. */
export function recordFor(
  doc: SourceDocument,
  opts: {
    docJson: string
    now: number
    importedAt?: number
    sortOrder?: number
    group?: string
    originUri?: string
    locallyModified?: boolean
    enabled?: boolean
  },
): SourceRecord {
  const group = opts.group ?? doc.sourceGroup
  return {
    id: sourceIdFor(doc.sourceUrl),
    sourceUrl: doc.sourceUrl,
    name: doc.sourceName,
    ...(group ? { group } : {}),
    type: doc.sourceType ?? 'music',
    doc,
    docJson: opts.docJson,
    docHash: docHashOf(opts.docJson),
    // An existing row's enabled flag wins: a user who disabled a flaky source
    // must not have it switched back on by the author publishing an update.
    enabled: opts.enabled ?? doc.enabled !== false,
    sortOrder: opts.sortOrder ?? doc.sortOrder ?? 0,
    allowedHosts: allowedHostsFor(doc),
    locallyModified: opts.locallyModified ?? false,
    ...(opts.originUri ? { originUri: opts.originUri } : {}),
    importedAt: opts.importedAt ?? opts.now,
    updatedAt: opts.now,
    failCount: 0,
  }
}
