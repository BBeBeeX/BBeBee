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
  sha256Hex,
  sha512,
  type AppSettings,
  type HttpResponse,
  type HttpService,
  type NpmResolvedPackage,
  type PluginManifest,
  type RegistryPluginEntry,
} from '@BBeBee/protocol'
import { maxSatisfying, satisfiesRange } from '@BBeBee/toolkit'

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

export const NPM_REGISTRY_OFFICIAL = 'https://registry.npmjs.org'
export const NPM_REGISTRY_CHINA = 'https://registry.npmmirror.com'
export const REGISTRY_RAW_OFFICIAL = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main'
export const REGISTRY_RAW_CHINA = 'https://cdn.jsdelivr.net/gh/BBeBeeX/B_Be_Bee-registry@main'
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

export interface ExtractedPackage {
  /** File path → UTF-8 text (`package/` prefix stripped). */
  files: Record<string, string>
  packageJson: { name?: string; version?: string; [key: string]: unknown }
  manifest: PluginManifest
  /** SHA-256 of the raw tarball, for the lock record. */
  tarballSha256: string
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
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
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
    const manual = settings?.npmRegistryUrl?.trim()
    const url = (manual || (settings?.downloadRegion === 'mainland-china' ? NPM_REGISTRY_CHINA : NPM_REGISTRY_OFFICIAL)).replace(
      /\/+$/,
      '',
    )
    const authToken = (await this.deps.readSecret(NPM_AUTH_TOKEN_KEY)) || undefined
    return { url, official: NPM_REGISTRY_OFFICIAL, authToken }
  }

  /** Effective raw base for registry files; manual `githubRawBaseUrl` wins. */
  async registryRawBase(): Promise<{ url: string; official: string }> {
    const settings = await this.deps.readSettings()
    const manual = settings?.githubRawBaseUrl?.trim()
    const url = (manual || (settings?.downloadRegion === 'mainland-china' ? REGISTRY_RAW_CHINA : REGISTRY_RAW_OFFICIAL)).replace(
      /\/+$/,
      '',
    )
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

  private parseIndex(data: unknown): RegistryPluginEntry[] {
    if (!Array.isArray(data)) {
      throw new NpmPluginError('INDEX_INVALID', 'registry 索引不是数组')
    }
    return data.map((item, i) => {
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
      } satisfies RegistryPluginEntry
    })
  }

  /** Plugin index via raw file fetch (24h cache). Never the GitHub Contents API. */
  async fetchIndex(opts?: { force?: boolean }): Promise<RegistryPluginEntry[]> {
    if (!opts?.force) {
      const cached = await this.deps.cache.get<RegistryPluginEntry[]>('index')
      if (cached && this.now() - cached.fetchedAt < INDEX_CACHE_TTL_MS) return cached.value
    }
    const { url, official } = await this.registryRawBase()
    const data = await this.getJson<unknown>(`${url}/${REGISTRY_INDEX_PATH}`, `${official}/${REGISTRY_INDEX_PATH}`)
    const entries = this.parseIndex(data)
    await this.deps.cache.set('index', entries)
    return entries
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
  ): Promise<{ target: ResolvedEntry; closure: ResolvedEntry[] }> {
    const resolved = new Map<string, ResolvedEntry>()
    const order: ResolvedEntry[] = []
    const visit = async (e: RegistryPluginEntry, r: string | undefined, path: string[]): Promise<void> => {
      if (path.includes(e.id)) {
        throw new NpmPluginError('DEPENDENCY_CYCLE', `插件依赖成环：${[...path, e.id].join(' → ')}`)
      }
      const pack = await this.fetchPackument(e.npm)
      const sel = this.selectVersion(e.npm, pack, r)
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
        pkg: { id: e.id, npm: e.npm, version: sel.version, tarball: sel.tarball, integrity: sel.integrity },
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

  /** Downloads a tarball; the auth token only goes to the registry's own host. */
  async downloadPackage(
    pkg: NpmResolvedPackage,
    onProgress?: (loaded: number, total?: number) => void,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {}
    try {
      const { url: regUrl, authToken } = await this.effectiveNpmRegistry()
      if (authToken && new URL(pkg.tarball).host === new URL(regUrl).host) {
        headers.Authorization = `Bearer ${authToken}`
      }
    } catch {
      // Unparseable URL — proceed without auth; the fetch will fail loudly if needed.
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
