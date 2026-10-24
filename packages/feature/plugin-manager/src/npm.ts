/**
 * npm registry client for `plugin-manager` (Layer 4).
 *
 * Every network read goes through an injected `HttpService`-shaped client,
 * every secret through `SecretsService`, every cache entry through a tiny
 * key/value interface backed by `ctx.store`. No `node:*` imports, no
 * cross-feature imports — the tarball codec is the pure-JS `fflate`
 * dependency of this package, semver ranges come from `@BBeBee/toolkit`,
 * and SHA-512/base64 from `@BBeBee/protocol`.
 */

import { Gunzip } from 'fflate'
import {
  base64Encode,
  base64ToBytes,
  derivePluginManagerDownloadHosts,
  effectiveNpmRegistryBase,
  effectiveRegistryRawBase,
  NPM_REGISTRY_CHINA,
  NPM_REGISTRY_OFFICIAL,
  REGISTRY_RAW_CHINA,
  REGISTRY_RAW_OFFICIAL,
  sha256Hex,
  sha512,
  type AppSettings,
  type HttpResponse,
  type HttpService,
  type ManagerNetworkSettings,
  type NpmResolvedPackage,
  type PluginManifest,
  type RegistryBlockedEntry,
  type RegistryPluginEntry,
} from '@BBeBee/protocol'
import { compareVersions, maxSatisfying, satisfiesRange } from '@BBeBee/toolkit'

/** Machine-readable failure reasons for npm plugin operations. */
export type NpmErrorCode =
  | 'ENTRY_NOT_FOUND'
  | 'INDEX_FETCH_FAILED'
  | 'INDEX_INVALID'
  | 'PACKUMENT_FETCH_FAILED'
  | 'PACKUMENT_INVALID'
  | 'VERSION_NOT_FOUND'
  | 'DEPENDENCY_INVALID'
  | 'DEPENDENCY_NOT_FOUND'
  | 'DEPENDENCY_CONFLICT'
  | 'DEPENDENCY_CYCLE'
  | 'SERVICE_UNAVAILABLE'
  | 'APP_VERSION_MISMATCH'
  | 'PLATFORM_MISMATCH'
  | 'SPOOF_DETECTED'
  | 'VERSION_MISMATCH'
  | 'INTEGRITY_MISMATCH'
  | 'SIZE_LIMIT'
  | 'TARBALL_INVALID'
  | 'BINARY_ASSET'
  | 'SECURITY_BLOCKED'
  | 'BRIDGE_UNAVAILABLE'
  | 'GRANT_UNAVAILABLE'
  | 'ACTIVATION_FAILED'
  | 'NOT_INSTALLED'
  | 'HAS_DEPENDENTS'
  | 'MAJOR_UPDATE_NEEDS_CONFIRM'
  | 'PLAN_CHANGED'
  | 'CONFIRM_REQUIRED'
  | 'DELISTED'
  | 'BLOCKED'
  | 'CRITICAL_PROVIDER'
  | 'NOT_A_PROVIDER'
  | 'DOWNLOAD_FAILED'

export class NpmPluginError extends Error {
  readonly code: NpmErrorCode
  constructor(code: NpmErrorCode, message: string) {
    super(message)
    this.name = 'NpmPluginError'
    this.code = code
  }
}

/** Minimal logger surface; `ctx.logger` satisfies it structurally. */
export interface NpmLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Tiny key/value cache backed by `ctx.store` (values carry their fetch time). */
export interface NpmKvCache {
  get<T>(key: string): Promise<{ value: T; fetchedAt: number } | undefined>
  set(key: string, value: unknown): Promise<void>
}

export interface NpmClientDeps {
  http: HttpService
  readSettings(): Promise<AppSettings | undefined>
  readSecret(key: string): Promise<string | undefined>
  cache: NpmKvCache
  log: NpmLogger
  now?: () => number
}

/** npm `dist.integrity` is `sha512-<base64>`; anything else is refused. */
const INTEGRITY_RE = /^sha512-([A-Za-z0-9+/]+=*)$/

/** A range string that names exactly one version (`1.2.3`, `v1.2.3-beta`). */
const EXACT_VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * The endpoint constants live in `@BBeBee/protocol`
 * (`services/plugin-manager-hosts.ts`) — they are inputs to the
 * settings-derived host set the capability gate also consumes, so
 * they may only exist once. Re-exported here for existing importers.
 */
export { NPM_REGISTRY_CHINA, NPM_REGISTRY_OFFICIAL, REGISTRY_RAW_CHINA, REGISTRY_RAW_OFFICIAL }
export const REGISTRY_INDEX_PATH = 'plugins/index.json'
/** Secret key (in the plugin's own `ctx.secrets` namespace) for the npm auth token. */
export const NPM_AUTH_TOKEN_KEY = 'npm.auth-token'

const JSON_TIMEOUT_MS = 30_000
const TARBALL_TIMEOUT_MS = 120_000
/** Refuse tarballs larger than this (D8-7); the value is documented, not negotiated. */
export const TARBALL_SIZE_LIMIT_BYTES = 50 * 1024 * 1024
/**
 * Refuse packages whose *decompressed* size passes this. The 50MB cap
 * above measures gzip bytes; a high-ratio archive (the audit's proof was
 * 1025×) would otherwise expand to gigabytes entirely in memory before
 * any check ran. Legitimate plugin bundles are single-digit megabytes.
 */
export const TARBALL_MAX_EXTRACTED_BYTES = 200 * 1024 * 1024
/** Refuse packages with more regular-file tar entries than this. */
export const TARBALL_MAX_ENTRIES = 4096
/**
 * Refuse a tarball download whose body stalls: the 120s request timeout
 * only covers response *headers* on the HTTP layer, so a mirror (or a
 * hijacked connection) dripping one byte a minute otherwise hangs the
 * install — and the market UI with it — forever. 30s without a single
 * chunk is a dead download, not a slow one.
 */
export const TARBALL_STALL_TIMEOUT_MS = 30_000
export const INDEX_CACHE_TTL_MS = 24 * 3600 * 1000
export const PACKUMENT_CACHE_TTL_MS = 15 * 60 * 1000

interface PackumentVersion {
  version?: string
  dist?: { tarball?: string; integrity?: string }
  /**
   * The version's declared `peerDependencies`, as published in its
   * `package.json` (the packument version object is npm's copy of exactly
   * that metadata). Carried through resolution so the install plan can
   * check the host-module version contract (P2) before anything downloads.
   */
  peerDependencies?: Record<string, string>
}

export interface Packument {
  name?: string
  'dist-tags'?: Record<string, string>
  versions?: Record<string, PackumentVersion>
}

/** One resolved node of the dependency tree (registry entry + pinned npm version). */
export interface ResolvedEntry {
  entry: RegistryPluginEntry
  pkg: NpmResolvedPackage
  /** The pinned version's declared `peerDependencies` (from the packument). */
  peerDependencies?: Record<string, string>
}

/**
 * The parsed registry index document. The index's wire format is an
 * object `{ entries, blocked }` (audit W4); for the transition the
 * parser also accepts the legacy bare-array form (entries only, no
 * blocked channel).
 */
export interface RegistryIndexDocument {
  entries: RegistryPluginEntry[]
  blocked: RegistryBlockedEntry[]
}

export interface ExtractedPackage {
  /** File path → UTF-8 text (`package/` prefix stripped). */
  files: Record<string, string>
  packageJson: { name?: string; version?: string; [key: string]: unknown }
  manifest: PluginManifest
  /** SHA-256 of the raw tarball, for the lock record. */
  tarballSha256: string
  /**
   * Set by the manager's prepare step when the version's npm
   * provenance attestation names the registry entry's repo as its
   * source (audit W6). Never set on a mismatch — that refuses the
   * install before extraction results are used.
   */
  provenanceVerified?: boolean
}

/**
 * Minimal ustar/pax tar reader (pure TypeScript — `fflate` ships no tar
 * codec). Handles regular files, directories, and pax extended headers
 * (`x`/`g`, for long file names as produced by `npm pack`). Anything else
 * (symlinks, …) is skipped: a plugin package is a tree of regular files.
 */
function readTar(data: Uint8Array, maxEntries: number = TARBALL_MAX_ENTRIES): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const headerText = new TextDecoder('utf-8')
  let fileEntries = 0
  const readField = (off: number, len: number): string => {
    let end = off
    while (end < off + len && data[end] !== 0) end++
    return headerText.decode(data.subarray(off, end))
  }
  let offset = 0
  let paxPath: string | undefined
  let paxGlobal = false
  while (offset + 512 <= data.length) {
    let allZero = true
    for (let i = offset; i < offset + 512; i++) {
      if (data[i] !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) break
    const name = readField(offset, 100)
    const prefix = readField(offset + 345, 155)
    const size = parseInt(readField(offset + 124, 12).trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new NpmPluginError('TARBALL_INVALID', 'tar header 的 size 非法')
    }
    const typeflag = String.fromCharCode(data[offset + 156] ?? 0)
    offset += 512
    const fileData = data.subarray(offset, offset + size)
    if (fileData.length < size) {
      throw new NpmPluginError('TARBALL_INVALID', 'tar 数据截断')
    }
    if (typeflag === 'x' || typeflag === 'g') {
      // Pax extended header: `"<len> path=<value>\n"` records.
      for (const line of headerText.decode(fileData).split('\n')) {
        const m = /^\d+ path=(.*)$/.exec(line)
        if (m) {
          paxPath = m[1]
          paxGlobal = typeflag === 'g'
        }
      }
    } else {
      const effective = paxPath ?? (prefix ? `${prefix}/${name}` : name)
      if (!paxGlobal) paxPath = undefined
      if ((typeflag === '0' || typeflag === '\0' || typeflag === '') && effective && !effective.endsWith('/')) {
        fileEntries++
        if (fileEntries > maxEntries) {
          throw new NpmPluginError('TARBALL_INVALID', `tar 条目数超过上限 ${maxEntries}`)
        }
        out[effective] = fileData.slice()
      }
    }
    offset += Math.ceil(size / 512) * 512
  }
  return out
}

const DEP_SPEC_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)(@(.+))?$/

/** Parses `"bob-dsp-pack"` / `"bob-dsp-pack@^2.0.0"` into `{ id, range? }`. */
export function parseDepSpecifier(spec: string): { id: string; range?: string } {
  const m = DEP_SPEC_RE.exec(spec.trim())
  if (!m) {
    throw new NpmPluginError(
      'DEPENDENCY_INVALID',
      `依赖声明 "${spec}" 非法，应为 "<registry-id>" 或 "<registry-id>@<semver-range>"`,
    )
  }
  return m[3] ? { id: m[1]!, range: m[3] } : { id: m[1]! }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Concatenates a byte stream under a hard size cap: the moment the running
 * total passes `limitBytes` the reader is cancelled and a SIZE_LIMIT error
 * is thrown, so an oversized tarball never fully lands in memory. Exported
 * for tests (the production cap is far too large to exercise directly).
 */
export async function concatStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  limitBytes: number,
  label: string,
  onProgress?: (loaded: number, total?: number) => void,
  total?: number,
  stallTimeoutMs: number = TARBALL_STALL_TIMEOUT_MS,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  // Every read races a stall timer: headers arrived long ago (that
  // timeout is the HTTP layer's), so silence on the body is judged on
  // its own clock. On a stall the reader is cancelled — the download is
  // refused, not left hanging.
  const readNext = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (!(stallTimeoutMs > 0)) return reader.read()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new NpmPluginError(
                  'DOWNLOAD_FAILED',
                  `${label} 下载停滞：${stallTimeoutMs}ms 内未收到数据，已中止`,
                ),
              ),
            stallTimeoutMs,
          )
        }),
      ])
    } catch (err) {
      if (err instanceof NpmPluginError) {
        await reader.cancel().catch(() => undefined)
      }
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await readNext()
    if (done) break
    if (!value) continue
    loaded += value.byteLength
    if (loaded > limitBytes) {
      await reader.cancel().catch(() => undefined)
      throw new NpmPluginError(
        'SIZE_LIMIT',
        `${label} 体积超过上限 ${(limitBytes / 1048576).toFixed(1)}MB（已接收 ${(loaded / 1048576).toFixed(1)}MB），拒绝安装`,
      )
    }
    chunks.push(value)
    onProgress?.(loaded, total)
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Streaming gunzip under a hard cap on the *decompressed* byte count.
 *
 * The compressed input is fed to fflate's `Gunzip` in slices; the moment
 * the running output total passes `limitBytes`, retained chunks are
 * dropped, no further input is pushed, and TARBALL_INVALID is thrown —
 * so a high-compression-ratio archive costs at most the cap in memory
 * instead of expanding without bound the way a one-shot `gunzipSync`
 * did. Exported for tests (the production cap is far too large to
 * exercise directly), mirroring `concatStreamWithLimit`.
 */
export function gunzipCapped(bytes: Uint8Array, limitBytes: number, label: string): Uint8Array {
  if (bytes.length === 0) {
    throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 不是合法的 gzip`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  let exceeded = false
  const gz = new Gunzip((chunk) => {
    if (exceeded) return
    total += chunk.byteLength
    if (total > limitBytes) {
      exceeded = true
      chunks.length = 0
      return
    }
    chunks.push(chunk)
  })
  try {
    const SLICE = 256 * 1024
    for (let off = 0; off < bytes.length && !exceeded; off += SLICE) {
      const end = Math.min(off + SLICE, bytes.length)
      gz.push(bytes.subarray(off, end), end === bytes.length)
    }
  } catch (err) {
    throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 不是合法的 gzip：${errMessage(err)}`)
  }
  if (exceeded) {
    throw new NpmPluginError(
      'TARBALL_INVALID',
      `包 ${label} 解压后体积超过上限 ${(limitBytes / 1048576).toFixed(0)}MB，拒绝安装`,
    )
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * POSIX-normalizes a tar entry's path relative to the package root:
 * empty and `.` segments collapse, and any `..` segment refuses the
 * package outright (undefined). Normalizing *before* the file map is
 * built matters beyond traversal: `dist/index.js`, `dist/./index.js`
 * and `dist//index.js` are three distinct raw keys but one file on
 * disk, so without this the disk writer's last-write-wins silently
 * picked a different file than the one the install record hashed.
 */
function normalizeTarRelPath(rel: string): string | undefined {
  const parts: string[] = []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return undefined
    parts.push(seg)
  }
  return parts.length > 0 ? parts.join('/') : undefined
}

/**
 * Hosts a tarball may be downloaded from: the protocol's
 * settings-derived pipeline host set — the very set the capability
 * gate grants this plugin (the shells merge it in `resolveGrants`),
 * consumed here from the same pure function so the two lists cannot
 * drift. `dist.tarball` is packument data — a mirror (or a poisoned
 * packument) controls it — so without this set it could point the
 * client at `127.0.0.1`, a link-local address, or an arbitrary third
 * host and have the request actually go out.
 *
 * Absent settings (unreadable) derive the built-in set: the built-in
 * registries/CDNs remain reachable, a custom-registry tarball is
 * refused rather than chased blindly. Comparison is by hostname,
 * matching the gate's own granularity.
 */
export function tarballAllowedHosts(settings?: ManagerNetworkSettings): Set<string> {
  return new Set(derivePluginManagerDownloadHosts(settings))
}

/** predicateType of the SLSA provenance attestation npm attaches to a version. */
export const PROVENANCE_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1'

/**
 * Outcome of comparing a version's npm provenance attestation with the
 * registry entry that pointed at it (audit W6):
 *  - `verified`: an attestation exists and names the entry's repo.
 *  - `mismatch`: an attestation exists and names a DIFFERENT repo —
 *    the package was built somewhere else than the entry claims; the
 *    caller refuses the install as spoofing.
 *  - `none`: the version carries no provenance attestation at all
 *    (npm answers the attestations endpoint with 404, or the body has
 *    no provenance entry).
 *  - `unknown`: the attestations could not be fetched (network) — the
 *    caller degrades exactly like every other registry read.
 */
export type ProvenanceVerdict =
  | { status: 'verified'; sourceRepo: string }
  | { status: 'mismatch'; sourceRepo: string }
  | { status: 'none' }
  | { status: 'unknown' }

/**
 * Extracts the source repository a provenance attestation names, from
 * the raw body of npm's `/-/npm/v1/attestations/<pkg>@<version>`
 * endpoint. The statement lives inside the Sigstore bundle's DSSE
 * envelope: base64 JSON → `predicate.buildDefinition.externalParameters
 * .workflow.repository` (the GitHub Actions workflow that built the
 * package). Pure and defensive — any shape surprise yields undefined,
 * never a throw. Only the repository identity is read; cryptographic
 * verification of the bundle is deliberately out of scope for the
 * pilot (the endpoint itself is served over the registry's TLS, the
 * same trust anchor as the packument).
 */
export function provenanceSourceRepo(body: unknown): string | undefined {
  try {
    if (!body || typeof body !== 'object') return undefined
    const attestations = (body as { attestations?: unknown }).attestations
    if (!Array.isArray(attestations)) return undefined
    for (const att of attestations) {
      if (!att || typeof att !== 'object') continue
      if ((att as { predicateType?: unknown }).predicateType !== PROVENANCE_PREDICATE_TYPE) continue
      const envelope = (att as { bundle?: { dsseEnvelope?: { payload?: unknown } } }).bundle?.dsseEnvelope
      if (!envelope || typeof envelope.payload !== 'string') continue
      const payload: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(envelope.payload)))
      const repo = (
        payload as {
          predicate?: { buildDefinition?: { externalParameters?: { workflow?: { repository?: unknown } } } }
        }
      )?.predicate?.buildDefinition?.externalParameters?.workflow?.repository
      if (typeof repo === 'string' && repo.trim()) return repo.trim()
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Normalizes a GitHub repository reference to a lowercase `owner/repo`
 * identity, accepting the `https://github.com/owner/repo` URL form
 * (with optional `.git`/trailing slash) used by registry entries and
 * provenance statements alike. Anything else yields undefined.
 */
export function gitHubRepoIdentity(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m) return undefined
  return `${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}`
}

/** Pure verdict for a fetched attestations body against an entry repo. */
export function provenanceVerdict(body: unknown, entryRepo: string): ProvenanceVerdict {
  const sourceRepo = provenanceSourceRepo(body)
  if (!sourceRepo) return { status: 'none' }
  const a = gitHubRepoIdentity(sourceRepo)
  const b = gitHubRepoIdentity(entryRepo)
  return a && b && a === b ? { status: 'verified', sourceRepo } : { status: 'mismatch', sourceRepo }
}

export class NpmClient {
  constructor(private readonly deps: NpmClientDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  // ---------------------------------------------------------------------------
  // Effective endpoints (D12)
  // ---------------------------------------------------------------------------

  /**
   * Effective npm registry: manual `npmRegistryUrl` wins; otherwise
   * `downloadRegion === 'mainland-china'` selects npmmirror, else the
   * official registry. The auth token (if any) is returned alongside —
   * it is only ever sent to this host.
   */
  async effectiveNpmRegistry(): Promise<{ url: string; official: string; authToken?: string }> {
    const settings = await this.deps.readSettings()
    const url = effectiveNpmRegistryBase(settings)
    const authToken = (await this.deps.readSecret(NPM_AUTH_TOKEN_KEY)) || undefined
    return { url, official: NPM_REGISTRY_OFFICIAL, authToken }
  }

  /** Effective raw base for registry files; manual `githubRawBaseUrl` wins. */
  async registryRawBase(): Promise<{ url: string; official: string }> {
    const settings = await this.deps.readSettings()
    const url = effectiveRegistryRawBase(settings)
    return { url, official: REGISTRY_RAW_OFFICIAL }
  }

  // ---------------------------------------------------------------------------
  // Fetching with mirror → official fallback
  // ---------------------------------------------------------------------------

  private async fetchOk(url: string, headers?: Record<string, string>, timeoutMs = JSON_TIMEOUT_MS): Promise<HttpResponse> {
    const res = await this.deps.http({ url, headers, timeoutMs })
    if (res.status >= 400) {
      throw new NpmPluginError('DOWNLOAD_FAILED', `请求 ${url} 失败：HTTP ${res.status}`)
    }
    return res
  }

  /**
   * GET JSON with one fallback: the configured endpoint first, then the
   * official endpoint (without the auth token). Both failures are named.
   */
  private async getJson<T>(url: string, officialUrl: string | undefined, authToken?: string): Promise<T> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined
    try {
      return await (await this.fetchOk(url, headers)).json<T>()
    } catch (err) {
      if (officialUrl && officialUrl !== url) {
        try {
          return await (await this.fetchOk(officialUrl)).json<T>()
        } catch (err2) {
          throw new NpmPluginError(
            'INDEX_FETCH_FAILED',
            `请求失败，已尝试 ${url} 与官方源 ${officialUrl}：${errMessage(err2)}（首次失败：${errMessage(err)}）`,
          )
        }
      }
      throw err instanceof NpmPluginError
        ? err
        : new NpmPluginError('INDEX_FETCH_FAILED', `请求 ${url} 失败：${errMessage(err)}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Registry index
  // ---------------------------------------------------------------------------

  private parseIndexEntry(item: unknown, i: number): RegistryPluginEntry {
    const e = item as Record<string, unknown>
    for (const f of ['id', 'name', 'npm'] as const) {
      if (typeof e[f] !== 'string' || !(e[f] as string).trim()) {
        throw new NpmPluginError('INDEX_INVALID', `registry 索引第 ${i} 项缺少字段 "${f}"`)
      }
    }
    return {
      id: e.id as string,
      name: e.name as string,
      repo: (e.repo as string) ?? '',
      npm: e.npm as string,
      npmUrl: typeof e.npmUrl === 'string' ? e.npmUrl : undefined,
      author: (e.author as string) ?? '',
      description: (e.description as string) ?? '',
      services: Array.isArray(e.services) ? (e.services as string[]) : [],
      provides: Array.isArray(e.provides) ? (e.provides as string[]) : undefined,
      platforms: Array.isArray(e.platforms) ? (e.platforms as string[]) : [],
      category: (e.category as string) ?? '',
      dependencies: Array.isArray(e.dependencies) ? (e.dependencies as string[]) : [],
      compositors: Array.isArray(e.compositors) ? (e.compositors as string[]) : [],
      i18n: Array.isArray(e.i18n) ? (e.i18n as string[]) : undefined,
      minAppVersion: typeof e.minAppVersion === 'string' ? e.minAppVersion : undefined,
      screenshot: typeof e.screenshot === 'string' ? e.screenshot : undefined,
      homepage: typeof e.homepage === 'string' ? e.homepage : undefined,
      engines: (e.engines as RegistryPluginEntry['engines']) ?? undefined,
      reviewedVersion: typeof e.reviewedVersion === 'string' ? e.reviewedVersion : undefined,
      reviewedIntegrity: typeof e.reviewedIntegrity === 'string' ? e.reviewedIntegrity : undefined,
    } satisfies RegistryPluginEntry
  }

  /**
   * Parses the registry index document. Current wire format is the
   * object form `{ entries: [...], blocked: [{id, reason}] }`; the
   * legacy bare-array form (pre-W4 registries and old caches) is still
   * accepted and yields an empty blocked channel.
   */
  private parseIndexDocument(data: unknown): RegistryIndexDocument {
    if (Array.isArray(data)) {
      return { entries: data.map((item, i) => this.parseIndexEntry(item, i)), blocked: [] }
    }
    if (!data || typeof data !== 'object') {
      throw new NpmPluginError('INDEX_INVALID', 'registry 索引既不是条目数组也不是索引文档对象')
    }
    const doc = data as Record<string, unknown>
    if (!Array.isArray(doc.entries)) {
      throw new NpmPluginError('INDEX_INVALID', 'registry 索引文档缺少 entries 数组')
    }
    const entries = doc.entries.map((item, i) => this.parseIndexEntry(item, i))
    const blocked: RegistryBlockedEntry[] = []
    if (doc.blocked !== undefined) {
      if (!Array.isArray(doc.blocked)) {
        throw new NpmPluginError('INDEX_INVALID', 'registry 索引文档的 blocked 不是数组')
      }
      for (const [i, item] of doc.blocked.entries()) {
        const b = item as Record<string, unknown>
        if (typeof b?.id !== 'string' || !(b.id as string).trim()) {
          throw new NpmPluginError('INDEX_INVALID', `registry 索引 blocked 第 ${i} 项缺少字段 "id"`)
        }
        blocked.push({
          id: b.id as string,
          reason: typeof b.reason === 'string' ? b.reason : '',
        })
      }
    }
    return { entries, blocked }
  }

  /** Plugin index via raw file fetch (24h cache). Never the GitHub Contents API. */
  async fetchIndex(opts?: { force?: boolean }): Promise<RegistryPluginEntry[]> {
    return (await this.fetchIndexDocument(opts)).entries
  }

  /**
   * The full index document (entries + the blocked channel). Shares
   * fetchIndex's cache; documents cached by older clients (bare entry
   * arrays) are read as documents with an empty blocked channel.
   */
  async fetchIndexDocument(opts?: { force?: boolean }): Promise<RegistryIndexDocument> {
    if (!opts?.force) {
      const cached = await this.deps.cache.get<RegistryIndexDocument | RegistryPluginEntry[]>('index')
      if (cached && this.now() - cached.fetchedAt < INDEX_CACHE_TTL_MS) {
        return Array.isArray(cached.value) ? { entries: cached.value, blocked: [] } : cached.value
      }
    }
    const { url, official } = await this.registryRawBase()
    const data = await this.getJson<unknown>(`${url}/${REGISTRY_INDEX_PATH}`, `${official}/${REGISTRY_INDEX_PATH}`)
    const doc = this.parseIndexDocument(data)
    await this.deps.cache.set('index', doc)
    return doc
  }

  // ---------------------------------------------------------------------------
  // Packument & version selection (D5)
  // ---------------------------------------------------------------------------

  /** Packument via the effective npm registry (15min cache). */
  async fetchPackument(npmName: string, opts?: { force?: boolean }): Promise<Packument> {
    const key = `packument:${npmName}`
    if (!opts?.force) {
      const cached = await this.deps.cache.get<Packument>(key)
      if (cached && this.now() - cached.fetchedAt < PACKUMENT_CACHE_TTL_MS) return cached.value
    }
    const { url, official, authToken } = await this.effectiveNpmRegistry()
    // Scoped names encode the slash: `@t/a` → `%40t%2Fa` (npm registry convention).
    const encoded = encodeURIComponent(npmName)
    const pack = await this.getJson<Packument>(`${url}/${encoded}`, `${official}/${encoded}`, authToken)
    if (!pack || typeof pack !== 'object' || !pack.versions || typeof pack.versions !== 'object') {
      throw new NpmPluginError('PACKUMENT_INVALID', `包 "${npmName}" 的元数据非法`)
    }
    await this.deps.cache.set(key, pack)
    return pack
  }

  /**
   * Version selection (D5): no range → `dist-tags.latest`; otherwise the
   * highest version satisfying the range. The tarball URL is used as-is
   * from the packument (a mirror's packument already points at the mirror).
   */
  selectVersion(
    npmName: string,
    pack: Packument,
    range?: string,
  ): { version: string; tarball: string; integrity?: string; peerDependencies?: Record<string, string> } {
    const versions = Object.keys(pack.versions ?? {})
    let version: string | undefined
    if (range) {
      version = maxSatisfying(versions, range)
      if (!version) {
        throw new NpmPluginError(
          'VERSION_NOT_FOUND',
          `包 "${npmName}" 没有满足 "${range}" 的版本（共 ${versions.length} 个版本）`,
        )
      }
    } else {
      const latest = pack['dist-tags']?.latest
      version = (latest && pack.versions?.[latest] ? latest : maxSatisfying(versions)) ?? undefined
      if (!version) {
        throw new NpmPluginError('VERSION_NOT_FOUND', `包 "${npmName}" 没有可用版本`)
      }
    }
    const dist = pack.versions?.[version]?.dist
    if (!dist?.tarball) {
      throw new NpmPluginError('VERSION_NOT_FOUND', `包 "${npmName}@${version}" 缺少 dist.tarball`)
    }
    return {
      version,
      tarball: dist.tarball,
      integrity: dist.integrity,
      peerDependencies: pack.versions?.[version]?.peerDependencies,
    }
  }

  /**
   * Applies an entry's reviewed pin (audit W5) to a plain resolution.
   *
   * Split by path, deliberately:
   *  - INSTALL paths (`allowUnreviewedRoot`) resolve the ROOT node to
   *    the latest version directly and flag it `unreviewed` when it
   *    overshoots the pin — never a silent cap that leaves the user
   *    installing the reviewed version and then updating again. The
   *    flag is part of the plan the confirm dialogs show, so the
   *    overshoot is never honoured silently.
   *  - UPDATE paths and dependency (non-root) nodes keep the ceiling:
   *    a resolution above the pin is re-resolved to the highest
   *    version at or below the pin that still satisfies the range,
   *    and resolution fails loudly when no such version exists rather
   *    than jumping the pin. The one update-side exception is the
   *    ROOT node with an exact-version range: the caller named the
   *    precise build (the market UI's confirmed unreviewed update) —
   *    the overshoot is kept and flagged `unreviewed`.
   * Entries without a pin pass through unchanged.
   */
  private applyReviewedPin(
    entry: RegistryPluginEntry,
    pack: Packument,
    sel: { version: string; tarball: string; integrity?: string; peerDependencies?: Record<string, string> },
    range: string | undefined,
    isRoot: boolean,
    allowUnreviewedRoot = false,
  ): typeof sel & { unreviewed?: boolean } {
    const reviewed = entry.reviewedVersion
    if (!reviewed) return sel
    if (compareVersions(sel.version, reviewed) <= 0) return sel
    // Install paths: keep the resolved (latest) version, flagged
    // unreviewed for the confirm dialog — never silently cap the
    // user's own install to the reviewed version.
    if (isRoot && allowUnreviewedRoot) {
      return { ...sel, unreviewed: true }
    }
    // Update paths: only an exact-version range names the precise
    // build, so only that overshoot is kept and flagged.
    if (isRoot && range && EXACT_VERSION_RE.test(range.trim())) {
      return { ...sel, unreviewed: true }
    }
    const candidates = Object.keys(pack.versions ?? {}).filter((v) => compareVersions(v, reviewed) <= 0)
    const version = range
      ? maxSatisfying(candidates, range)
      : candidates.includes(reviewed)
        ? reviewed
        : maxSatisfying(candidates)
    if (!version) {
      throw new NpmPluginError(
        isRoot ? 'VERSION_NOT_FOUND' : 'DEPENDENCY_CONFLICT',
        `包 "${entry.npm}" 的注册表已审版本为 ${reviewed}，但没有不高于该版本且满足 ${range ? `"${range}"` : '默认解析'} 的可用版本（最新为 ${sel.version}），拒绝越过已审钉扎`,
      )
    }
    const dist = pack.versions?.[version]?.dist
    if (!dist?.tarball) {
      throw new NpmPluginError('VERSION_NOT_FOUND', `包 "${entry.npm}@${version}" 缺少 dist.tarball`)
    }
    return {
      version,
      tarball: dist.tarball,
      integrity: dist.integrity,
      peerDependencies: pack.versions?.[version]?.peerDependencies,
    }
  }

  // ---------------------------------------------------------------------------
  // Dependency closure (D4)
  // ---------------------------------------------------------------------------

  /**
   * Resolves the full dependency tree to pinned versions. Throws on cycles
   * and on conflicting ranges, naming every party. Returns install order
   * (dependencies before dependents).
   */
  async resolveTree(
    entry: RegistryPluginEntry,
    range: string | undefined,
    index: RegistryPluginEntry[],
    opts?: { allowUnreviewedRoot?: boolean },
  ): Promise<{ target: ResolvedEntry; closure: ResolvedEntry[] }> {
    const resolved = new Map<string, ResolvedEntry>()
    const order: ResolvedEntry[] = []
    const visit = async (e: RegistryPluginEntry, r: string | undefined, path: string[]): Promise<void> => {
      if (path.includes(e.id)) {
        throw new NpmPluginError('DEPENDENCY_CYCLE', `插件依赖成环：${[...path, e.id].join(' → ')}`)
      }
      const pack = await this.fetchPackument(e.npm)
      const sel = this.applyReviewedPin(e, pack, this.selectVersion(e.npm, pack, r), r, path.length === 0, opts?.allowUnreviewedRoot)
      const existing = resolved.get(e.id)
      if (existing) {
        if (r && !satisfiesRange(existing.pkg.version, r)) {
          throw new NpmPluginError(
            'DEPENDENCY_CONFLICT',
            `版本冲突：${path.join(' → ') || '(根)'} 要求 "${e.id}@${r}"，但已为其选定 ${existing.pkg.version}`,
          )
        }
        return
      }
      const node: ResolvedEntry = {
        entry: e,
        pkg: {
          id: e.id,
          npm: e.npm,
          version: sel.version,
          tarball: sel.tarball,
          integrity: sel.integrity,
          ...(e.reviewedVersion ? { reviewedVersion: e.reviewedVersion } : {}),
          ...(sel.unreviewed ? { unreviewed: true } : {}),
        },
        peerDependencies: sel.peerDependencies,
      }
      resolved.set(e.id, node)
      for (const depSpec of e.dependencies ?? []) {
        const { id: depId, range: depRange } = parseDepSpecifier(depSpec)
        const depEntry = index.find((x) => x.id === depId)
        if (!depEntry) {
          throw new NpmPluginError('DEPENDENCY_NOT_FOUND', `插件 "${e.id}" 依赖 "${depId}"，但 registry 中没有该条目`)
        }
        await visit(depEntry, depRange, [...path, e.id])
      }
      order.push(node)
    }
    await visit(entry, range, [])
    const target = resolved.get(entry.id)!
    return { target, closure: order.filter((n) => n.entry.id !== entry.id) }
  }

  // ---------------------------------------------------------------------------
  // Download, integrity, extraction (D7)
  // ---------------------------------------------------------------------------

  /**
   * Downloads a tarball. Two guards before any byte moves: the tarball
   * URL's host must be in `tarballAllowedHosts` (the packument is
   * mirror-controlled data, not a trusted pointer), and the auth token
   * only goes to the effective registry's own host.
   */
  async downloadPackage(
    pkg: NpmResolvedPackage,
    onProgress?: (loaded: number, total?: number) => void,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {}
    let registry: { url: string; authToken?: string } | undefined
    try {
      registry = await this.effectiveNpmRegistry()
    } catch {
      // Settings unreadable: fall back to the built-in allowlist below
      // and no auth — the built-in registries/CDNs remain reachable, a
      // custom-registry tarball is refused rather than chased blindly.
      registry = undefined
    }
    // The allowlist derives from the same settings the endpoints do —
    // read them independently of the registry resolution above so a
    // settings failure degrades to the built-in set, never to "allow
    // everything" and never to a second, drifted list.
    let settings: AppSettings | undefined
    try {
      settings = await this.deps.readSettings()
    } catch {
      settings = undefined
    }
    let tarballUrl: URL
    try {
      tarballUrl = new URL(pkg.tarball)
    } catch {
      throw new NpmPluginError('DOWNLOAD_FAILED', `包 ${pkg.npm}@${pkg.version} 的 tarball 地址非法："${pkg.tarball}"`)
    }
    if (!tarballAllowedHosts(settings).has(tarballUrl.hostname)) {
      throw new NpmPluginError(
        'DOWNLOAD_FAILED',
        `包 ${pkg.npm}@${pkg.version} 的 tarball 主机 "${tarballUrl.hostname}" 不在允许集合内，拒绝下载`,
      )
    }
    if (registry?.authToken) {
      try {
        if (tarballUrl.host === new URL(registry.url).host) {
          headers.Authorization = `Bearer ${registry.authToken}`
        }
      } catch {
        // Unparseable registry URL — no auth header.
      }
    }
    let res: HttpResponse
    try {
      res = await this.deps.http({ url: pkg.tarball, headers, timeoutMs: TARBALL_TIMEOUT_MS, onProgress })
    } catch (err) {
      throw new NpmPluginError('DOWNLOAD_FAILED', `下载 ${pkg.npm}@${pkg.version} 失败：${errMessage(err)}`)
    }
    if (res.status >= 400) {
      throw new NpmPluginError('DOWNLOAD_FAILED', `下载 ${pkg.npm}@${pkg.version} 失败：HTTP ${res.status}`)
    }
    // Prefer streaming so the size cap aborts mid-download instead of
    // after a full buffered read; hosts without a stream implementation
    // fall back to bytes() + the same cap check.
    let stream: ReadableStream<Uint8Array> | undefined
    try {
      stream = typeof res.stream === 'function' ? res.stream() : undefined
    } catch {
      stream = undefined
    }
    if (stream) {
      const totalHeader = Number(res.headers?.['content-length'] ?? res.headers?.['Content-Length'])
      const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
      try {
        return await concatStreamWithLimit(stream, TARBALL_SIZE_LIMIT_BYTES, `包 ${pkg.npm}@${pkg.version}`, onProgress, total)
      } catch (err) {
        throw err instanceof NpmPluginError
          ? err
          : new NpmPluginError('DOWNLOAD_FAILED', `下载 ${pkg.npm}@${pkg.version} 失败：${errMessage(err)}`)
      }
    }
    const bytes = await res.bytes()
    if (bytes.length > TARBALL_SIZE_LIMIT_BYTES) {
      throw new NpmPluginError(
        'SIZE_LIMIT',
        `包 ${pkg.npm}@${pkg.version} 体积 ${(bytes.length / 1048576).toFixed(1)}MB，超过上限 ${TARBALL_SIZE_LIMIT_BYTES / 1048576}MB，拒绝安装`,
      )
    }
    return bytes
  }

  /**
   * Resolves one exact version's tarball through the entry's `npmUrl` —
   * the canonical official packument address. This is the fallback leg
   * for a mirror-aware download that proved ineffective (see
   * `preparePackage`): npmUrl IS the official address, so it is fetched
   * directly with no mirror hop and no auth (registry entries are
   * public packages). The version is never re-resolved — the plan's
   * exact version is what gets fetched, so a fallback cannot silently
   * substitute a different build. Only an npmUrl on the official
   * registry host is honoured; anything else is refused rather than
   * chased.
   */
  async resolveOfficialTarball(
    entry: RegistryPluginEntry,
    version: string,
  ): Promise<{ tarball: string; integrity?: string }> {
    const raw = entry.npmUrl
    let url: URL
    try {
      url = new URL(raw ?? '')
    } catch {
      throw new NpmPluginError(
        'DOWNLOAD_FAILED',
        `包 ${entry.npm}@${version} 的条目 npmUrl 非法（"${raw ?? ''}"），无法回落到官方地址`,
      )
    }
    if (url.protocol !== 'https:' || url.host !== new URL(NPM_REGISTRY_OFFICIAL).host) {
      throw new NpmPluginError(
        'DOWNLOAD_FAILED',
        `包 ${entry.npm}@${version} 的条目 npmUrl 不是官方 registry 地址（"${url.host}"），拒绝回落`,
      )
    }
    let res: HttpResponse
    try {
      res = await this.deps.http({ url: raw as string, timeoutMs: JSON_TIMEOUT_MS })
    } catch (err) {
      throw new NpmPluginError('DOWNLOAD_FAILED', `回落抓取官方 packument 失败：${errMessage(err)}`)
    }
    if (res.status >= 400) {
      throw new NpmPluginError('DOWNLOAD_FAILED', `回落抓取官方 packument 失败：HTTP ${res.status}`)
    }
    let pack: { versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }> }
    try {
      pack = await res.json()
    } catch {
      throw new NpmPluginError('DOWNLOAD_FAILED', '回落抓取的官方 packument 非法 JSON')
    }
    const dist = pack?.versions?.[version]?.dist
    if (!dist?.tarball) {
      throw new NpmPluginError(
        'VERSION_NOT_FOUND',
        `官方 packument 中没有 ${entry.npm}@${version} 的 dist.tarball，无法回落`,
      )
    }
    return { tarball: dist.tarball, integrity: dist.integrity }
  }

  /** Verifies `dist.integrity` (`sha512-<base64>`). Missing integrity warns upstream, not here. */
  verifyIntegrity(bytes: Uint8Array, integrity: string | undefined, label: string): void {
    if (!integrity) return
    const m = INTEGRITY_RE.exec(integrity.trim())
    if (!m) {
      throw new NpmPluginError('INTEGRITY_MISMATCH', `${label} 的 integrity 格式不支持（仅支持 sha512）：${integrity}`)
    }
    const digest = base64Encode(sha512(bytes))
    if (digest !== m[1]) {
      throw new NpmPluginError('INTEGRITY_MISMATCH', `${label} 完整性校验失败（sha512 不匹配），拒绝安装`)
    }
  }

  /**
   * Verifies the downloaded bytes against the registry entry's
   * reviewed pin hash (audit W5). This is a SECOND, independent anchor:
   * the pin lives in the registry repo while `dist.integrity` travels
   * with the (possibly mirrored) packument, so a mirror that swaps
   * both the tarball and its packument hash still fails here. Callers
   * invoke it only when the resolved version IS the reviewed version —
   * the pin says nothing about any other version's bytes.
   */
  verifyReviewedIntegrity(bytes: Uint8Array, entry: RegistryPluginEntry, label: string): void {
    const expected = entry.reviewedIntegrity
    if (!expected) return
    const m = INTEGRITY_RE.exec(expected.trim())
    if (!m) {
      throw new NpmPluginError(
        'INTEGRITY_MISMATCH',
        `${label} 的注册表已审哈希格式不支持（仅支持 sha512）：${expected}`,
      )
    }
    const digest = base64Encode(sha512(bytes))
    if (digest !== m[1]) {
      throw new NpmPluginError(
        'INTEGRITY_MISMATCH',
        `${label} 与注册表已审哈希不符（reviewedIntegrity）：下载到的字节不是注册表审核过的 ${entry.reviewedVersion ?? ''} 版本，拒绝安装`,
      )
    }
  }

  /**
   * Fetches the version's npm attestations and judges them against the
   * registry entry's repo (audit W6). Never throws: the OFFICIAL
   * registry's 404 for a version without attestations IS the `none`
   * verdict, and every transport failure collapses to `unknown` so the
   * caller degrades (warn, proceed) instead of blocking installs on an
   * attestations outage. A mirror's 404 proves nothing — mirrors do not
   * carry the attestations endpoint and answer 404 for attested and
   * unattested packages alike — so it falls through to the official
   * base like any other mirror failure. The auth token rides along on
   * the effective-registry attempt only, exactly like packument fetches.
   */
  async checkProvenance(pkg: NpmResolvedPackage, entryRepo: string): Promise<ProvenanceVerdict> {
    let registry: { url: string; official: string; authToken?: string }
    try {
      registry = await this.effectiveNpmRegistry()
    } catch {
      registry = { url: NPM_REGISTRY_OFFICIAL, official: NPM_REGISTRY_OFFICIAL }
    }
    const path = `/-/npm/v1/attestations/${encodeURIComponent(pkg.npm)}@${encodeURIComponent(pkg.version)}`
    const bases = registry.url === registry.official ? [registry.url] : [registry.url, registry.official]
    for (const [i, base] of bases.entries()) {
      try {
        const res = await this.deps.http({
          url: `${base}${path}`,
          headers: i === 0 && registry.authToken ? { Authorization: `Bearer ${registry.authToken}` } : undefined,
          timeoutMs: JSON_TIMEOUT_MS,
        })
        if (res.status === 404) {
          // Terminal only from the official registry (see the doc
          // comment): a mirror 404 falls through to the official base.
          // Real-machine regression (2026-10-22): with the npmmirror
          // endpoint effective, @bbebee/plugin-visualizer@0.1.1 — which
          // HAS a provenance attestation on npmjs — was reported as
          // having none, because the mirror's blanket 404 was taken as
          // the verdict.
          if (base === registry.official) return { status: 'none' }
          continue
        }
        if (res.status >= 400) continue
        return provenanceVerdict(await res.json(), entryRepo)
      } catch {
        // Fall through to the official endpoint, then to `unknown`.
      }
    }
    return { status: 'unknown' }
  }

  /**
   * gunzip (fflate) + minimal ustar/pax tar reader below: strip the npm
   * `package/` prefix, reject path traversal, decode as UTF-8 (D10:
   * non-UTF-8 entries are refused), and parse `package.json` +
   * `BBeBee.plugin.json`.
   */
  extractPackage(pkg: NpmResolvedPackage, bytes: Uint8Array): ExtractedPackage {
    const label = `${pkg.npm}@${pkg.version}`
    const tar = gunzipCapped(bytes, TARBALL_MAX_EXTRACTED_BYTES, label)
    let raw: Record<string, Uint8Array>
    try {
      raw = readTar(tar)
    } catch (err) {
      throw err instanceof NpmPluginError
        ? err
        : new NpmPluginError('TARBALL_INVALID', `包 ${label} 不是合法的 tar：${errMessage(err)}`)
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const files: Record<string, string> = {}
    for (const [name, data] of Object.entries(raw)) {
      if (name.endsWith('/')) continue
      if (!name.startsWith('package/')) {
        throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 包含非法顶层路径 "${name}"`)
      }
      const rel = normalizeTarRelPath(name.slice('package/'.length))
      if (rel === undefined) {
        throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 包含非法路径 "${name}"（拒绝路径穿越）`)
      }
      if (Object.hasOwn(files, rel)) {
        throw new NpmPluginError(
          'TARBALL_INVALID',
          `包 ${label} 包含归一化后重名的路径 "${rel}"（"${name}"），拒绝安装`,
        )
      }
      let text: string
      try {
        text = decoder.decode(data)
      } catch {
        throw new NpmPluginError('BINARY_ASSET', `包 ${label} 包含非 UTF-8 文件 "${rel}"：v1 仅支持文本文件插件包`)
      }
      files[rel] = text
    }
    const packageJsonRaw = files['package.json']
    const manifestRaw = files['BBeBee.plugin.json']
    if (!packageJsonRaw) throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 缺少 package.json`)
    if (!manifestRaw) throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 缺少 BBeBee.plugin.json`)
    let packageJson: ExtractedPackage['packageJson']
    let manifest: PluginManifest
    try {
      packageJson = JSON.parse(packageJsonRaw) as ExtractedPackage['packageJson']
    } catch {
      throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 的 package.json 不是合法 JSON`)
    }
    try {
      manifest = JSON.parse(manifestRaw) as PluginManifest
    } catch {
      throw new NpmPluginError('TARBALL_INVALID', `包 ${label} 的 BBeBee.plugin.json 不是合法 JSON`)
    }
    return { files, packageJson, manifest, tarballSha256: sha256Hex(bytes) }
  }
}
