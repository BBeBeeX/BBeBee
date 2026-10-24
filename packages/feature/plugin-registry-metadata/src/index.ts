/**
 * `plugin-registry-metadata` — lazy repo stats for registry entries.
 *
 * Implements `ctx.registryMetadata`: the Discover page's sort controls want star
 * and contributor numbers the registry index itself never carries, and plugin
 * cards want npm download counts. Stars/contributors are read lazily from the
 * GitHub API; downloads come from the npm API when the caller passes a package
 * name (npm-published packages rarely have GitHub release assets, so the old
 * release-asset sum showed 0 for exactly the packages users asked about) and
 * fall back to the GitHub release sum otherwise. Everything is cached in the
 * store for 24 hours, merged across concurrent callers, and capped at three
 * simultaneous requests — the rest queue. Every failure degrades (a stale
 * cached value, or a result carrying `error`) and never throws, because the
 * caller is a render path: a sort control must never be able to reject.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type {
  HttpService,
  RegistryMetadataService,
  RegistryRepoStats,
  StoreService,
} from '@BBeBee/protocol'

/** Store key: `{ 'owner/repo': { stars?, contributors?, fetchedAt } }`. */
const CACHE_KEY = 'registry-metadata.cache'
/** Store key: `{ '<npm package>': { downloads, fetchedAt } }`. */
const NPM_CACHE_KEY = 'registry-metadata.npm-downloads'
/** npm's last-month downloads endpoint (no auth, generous limits). */
const NPM_DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-month'
/** How long a cached value is served without touching the network. */
const TTL_MS = 24 * 60 * 60 * 1000
/** Local backoff window after a GitHub rate-limit response (403/429). */
const BACKOFF_MS = 60 * 60 * 1000
/** At most this many repos are fetched at once; the rest queue. */
const MAX_CONCURRENT = 3

const GITHUB_API = 'https://api.github.com'
const GITHUB_ACCEPT = 'application/vnd.github+json'

/** One cached entry. `stars`/`contributors` stay absent when unknown. */
interface CachedStats {
  stars?: number
  contributors?: number
  downloads?: number
  fetchedAt: number
}

type StatsCache = Record<string, CachedStats>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Case-normalized cache/in-flight key for one repository. */
function cacheKey(owner: string, repo: string): string {
  return `${owner.trim()}/${repo.trim()}`.toLowerCase()
}

/** Read one stored cache entry, dropping malformed shapes rather than trusting them. */
function readCachedEntry(raw: unknown): CachedStats | undefined {
  if (!isRecord(raw)) return undefined
  const fetchedAt = raw['fetchedAt']
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return undefined
  const stars = optionalCount(raw['stars'])
  const contributors = optionalCount(raw['contributors'])
  const downloads = optionalCount(raw['downloads'])
  return {
    fetchedAt,
    ...(stars !== undefined ? { stars } : {}),
    ...(contributors !== undefined ? { contributors } : {}),
    ...(downloads !== undefined ? { downloads } : {}),
  }
}

function toStats(owner: string, repo: string, cached: CachedStats, stale = false): RegistryRepoStats {
  return {
    owner,
    repo,
    ...cached,
    ...(stale ? { stale: true } : {}),
  }
}

export class RegistryMetadataPlugin extends Service implements RegistryMetadataService {
  static override readonly name = 'registryMetadata'
  static readonly inject = ['http']

  private readonly ownCtx: Context
  private readonly http: HttpService

  /** Optional collaborator captured in init; its absence means memory-only caching. */
  private storeService?: StoreService

  private cache: StatsCache = {}
  /** Per-package npm downloads cache (a repo can host several packages). */
  private npmCache: Record<string, { downloads: number; fetchedAt: number }> = {}
  /** One in-flight npm lookup per package — concurrent callers share it. */
  private readonly npmInFlight = new Map<string, Promise<number | undefined>>()
  /** While `Date.now()` is before this, GitHub fetches degrade instead of requesting. */
  private backoffUntil = 0

  /** One in-flight promise per repo — concurrent callers share the fetch. */
  private readonly inFlight = new Map<string, Promise<RegistryRepoStats>>()
  /** How many repos are mid-fetch; the rest wait in `queue`. */
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(ctx: Context) {
    super(ctx, 'registryMetadata')
    this.ownCtx = ctx
    this.http = ctx.http
  }

  async [Service.init]() {
    this.ownCtx.logger.info('[registry-metadata] initialized')

    this.ownCtx.inject(['store'], (scoped) => {
      this.storeService = scoped.store
      void scoped.store
        .get<StatsCache>(CACHE_KEY)
        .then((stored) => {
          this.cache = this.sanitizeCache(stored)
        })
        .catch(() => {
          // A store that cannot be read leaves the in-memory cache empty.
        })
      void scoped.store
        .get<Record<string, { downloads: number; fetchedAt: number }>>(NPM_CACHE_KEY)
        .then((stored) => {
          this.npmCache = this.sanitizeNpmCache(stored)
        })
        .catch(() => {
          // Same: a store that cannot be read leaves the npm cache empty.
        })
    })
  }

  async getRepoStats(owner: string, repo: string, npmName?: string): Promise<RegistryRepoStats> {
    const key = cacheKey(owner, repo)
    const cached = this.cache[key]
    // Within TTL the cache is the answer — no network, no queue. With an npm
    // name, only the npm downloads still need fetching (per-package cache);
    // the GitHub fields come from the repo cache untouched, and a failed npm
    // lookup leaves downloads absent rather than falling back to a GitHub
    // release sum that means something else for an npm package.
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      if (!npmName) return toStats(owner, repo, cached)
      const downloads = await this.fetchNpmDownloadsCached(npmName)
      // The repo cache's downloads (a GitHub sum, when present) must not leak
      // into an npm answer: rebuild the repo fields without it.
      const repoFields: CachedStats = {
        fetchedAt: cached.fetchedAt,
        ...(cached.stars !== undefined ? { stars: cached.stars } : {}),
        ...(cached.contributors !== undefined ? { contributors: cached.contributors } : {}),
      }
      return toStats(owner, repo, {
        ...repoFields,
        ...(downloads !== undefined ? { downloads } : {}),
      })
    }

    // In-flight merging keyed by repo + package: two callers for the same
    // repo but different packages must not share one answer (their npm
    // downloads differ), while identical callers still share the fetch.
    const flightKey = npmName ? `${key}|${npmName.trim().toLowerCase()}` : key
    const pending = this.inFlight.get(flightKey)
    if (pending) return pending

    const fetch = this.enqueue(() => this.fetchStats(owner, repo, key, npmName)).finally(() => {
      this.inFlight.delete(flightKey)
    })
    this.inFlight.set(flightKey, fetch)
    return fetch
  }

  peekRepoStats(owner: string, repo: string): RegistryRepoStats | undefined {
    const cached = this.cache[cacheKey(owner, repo)]
    if (!cached) return undefined
    return toStats(owner, repo, cached, Date.now() - cached.fetchedAt >= TTL_MS)
  }

  /* ── the fetch, and its graceful failures ──────────────────────────────── */

  private async fetchStats(owner: string, repo: string, key: string, npmName?: string): Promise<RegistryRepoStats> {
    // Request the canonical (lowercase) owner/repo: GitHub answers either
    // casing, and one spelling keeps the cache, the in-flight map and the
    // URLs consistent. The result still reports the caller's spelling.
    const [urlOwner, urlRepo] = key.split('/')
    // Each field is isolated: a contributors or downloads failure must not
    // discard the stars that already arrived. The old all-or-nothing fetch
    // degraded the whole result on any single failure, so one flaky
    // endpoint hid every number — including stars that had succeeded.
    // The first failure reason is kept for the error result, so a total
    // failure still says *why* (HTTP status, backoff, transport) instead of
    // a generic message.
    // Whether the backoff was already active when this fetch started: only
    // then is "backoff" the honest error. A call that *trips* the backoff
    // mid-flight reports the status that tripped it (403/429) instead.
    const backoffAtStart = Date.now() < this.backoffUntil
    let firstError: string | undefined
    const attempt = async <T>(fetch: () => Promise<T>): Promise<T | undefined> => {
      if (Date.now() < this.backoffUntil) return undefined
      try {
        return await fetch()
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err)
        return undefined
      }
    }
    const stars = await attempt(() => this.fetchStarCount(urlOwner!, urlRepo!))
    const contributors = await attempt(() => this.fetchContributorCount(urlOwner!, urlRepo!))
    // npm downloads are a different API with their own quota, so they are
    // never gated by the GitHub backoff; without a package name the GitHub
    // release sum is the only downloads number available.
    const downloads = npmName
      ? await this.fetchNpmDownloadsCached(npmName)
      : await attempt(() => this.fetchDownloadCount(urlOwner!, urlRepo!))
    const previous = this.cache[key]
    if (stars === undefined && contributors === undefined && downloads === undefined) {
      // Nothing fresh: a cached copy serves as stale, otherwise the error
      // result. Never a throw — the caller is a render path.
      if (previous) {
        this.ownCtx.logger.warn(`[registry-metadata] ${key}: all stat fetches failed; serving the cached copy as stale`)
        return toStats(owner, repo, previous, true)
      }
      const reason = backoffAtStart
        ? `rate-limit backoff until ${new Date(this.backoffUntil).toISOString()}`
        : (firstError ?? 'all stat fetches failed')
      this.ownCtx.logger.warn(`[registry-metadata] ${key}: all stat fetches failed; no cached copy, reporting the failure`)
      return { owner, repo, fetchedAt: Date.now(), error: reason }
    }
    const entry: CachedStats = {
      fetchedAt: Date.now(),
      ...(stars !== undefined ? { stars } : {}),
      ...(contributors !== undefined ? { contributors } : {}),
      // npm downloads live in their own per-package cache (one repo can host
      // several packages); the repo cache keeps a GitHub release sum when it
      // has one, for callers without a package name.
      ...(npmName
        ? (previous?.downloads !== undefined ? { downloads: previous.downloads } : {})
        : downloads !== undefined
          ? { downloads }
          : {}),
    }
    this.cache[key] = entry
    await this.persist()
    this.ownCtx.logger.info(
      `[registry-metadata] ${key}: ${stars ?? '?'} stars, ${downloads ?? '?'} downloads, ${contributors ?? '?'} contributors`,
    )
    // The returned downloads are the npm number when a package name was
    // given (absent when that lookup failed), never the repo cache's
    // GitHub sum.
    return toStats(owner, repo, {
      ...entry,
      ...(npmName ? (downloads !== undefined ? { downloads } : {}) : {}),
    })
  }

  private async fetchJson<T>(url: string, accept: string = GITHUB_ACCEPT): Promise<T> {
    const response = await this.http({ url, method: 'GET', headers: { Accept: accept }, timeoutMs: 3_000 })
    if (response.status === 403 || response.status === 429) {
      // GitHub answers 403 (primary) or 429 when rate limited; back off
      // locally either way, so a blocked caller stops hammering the API.
      // The backoff belongs to GitHub only — an npm 429 must not silence
      // GitHub lookups, or vice versa.
      if (url.startsWith(GITHUB_API)) {
        this.backoffUntil = Date.now() + BACKOFF_MS
        this.ownCtx.logger.warn(
          `[registry-metadata] rate limited (HTTP ${response.status}); backing off until ${new Date(this.backoffUntil).toISOString()}`,
        )
      }
      throw new Error(`request rate limited (HTTP ${response.status}) for ${url}`)
    }
    if (response.status >= 400) {
      throw new Error(`request failed (HTTP ${response.status}) for ${url}`)
    }
    return (await response.json<T>()) as T
  }

  private async fetchStarCount(owner: string, repo: string): Promise<number | undefined> {
    const body = await this.fetchJson<{ stargazers_count?: unknown }>(
      `${GITHUB_API}/repos/${owner}/${repo}`,
    )
    return optionalCount(body?.stargazers_count)
  }

  private async fetchContributorCount(owner: string, repo: string): Promise<number | undefined> {
    const body = await this.fetchJson<unknown[]>(
      `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=100`,
    )
    return Array.isArray(body) ? body.length : undefined
  }

  private async fetchDownloadCount(owner: string, repo: string): Promise<number | undefined> {
    try {
      const releases = await this.fetchJson<Array<{ assets?: Array<{ download_count?: unknown }> }>>(
        `${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=100`,
      )
      if (!Array.isArray(releases)) return undefined
      let total = 0
      for (const rel of releases) {
        if (Array.isArray(rel.assets)) {
          for (const asset of rel.assets) {
            const count = optionalCount(asset.download_count)
            if (count !== undefined) total += count
          }
        }
      }
      return total
    } catch {
      return undefined
    }
  }

  /* ── npm downloads: per-package cache, same TTL, same failure policy ─── */

  private async fetchNpmDownloadsCached(npmName: string): Promise<number | undefined> {
    const key = npmName.trim().toLowerCase()
    const cached = this.npmCache[key]
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.downloads
    const pending = this.npmInFlight.get(key)
    if (pending) return pending
    const fetch = this.fetchNpmDownloads(npmName).finally(() => {
      this.npmInFlight.delete(key)
    })
    this.npmInFlight.set(key, fetch)
    return fetch
  }

  private async fetchNpmDownloads(npmName: string): Promise<number | undefined> {
    try {
      const body = await this.fetchJson<{ downloads?: unknown }>(
        `${NPM_DOWNLOADS_API}/${encodeURIComponent(npmName)}`,
        'application/json',
      )
      const downloads = optionalCount(body?.downloads)
      if (downloads !== undefined) {
        this.npmCache[npmName.trim().toLowerCase()] = { downloads, fetchedAt: Date.now() }
        await this.persist()
      }
      return downloads
    } catch {
      return undefined
    }
  }

  /* ── global concurrency cap: at most MAX_CONCURRENT repos mid-fetch ────── */

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.active++
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            this.queue.shift()?.()
          })
      }
      if (this.active < MAX_CONCURRENT) run()
      else this.queue.push(run)
    })
  }

  /* ── persistence ───────────────────────────────────────────────────────── */

  private async persist(): Promise<void> {
    if (!this.storeService) return
    try {
      await this.storeService.set<StatsCache>(CACHE_KEY, this.cache)
      await this.storeService.set(NPM_CACHE_KEY, this.npmCache)
    } catch (err) {
      this.ownCtx.logger.warn(`[registry-metadata] failed to persist the stats cache: ${String(err)}`)
    }
  }

  private sanitizeCache(raw: StatsCache | undefined): StatsCache {
    if (!isRecord(raw)) return {}
    const out: StatsCache = {}
    for (const [key, value] of Object.entries(raw)) {
      const entry = readCachedEntry(value)
      if (entry) out[key] = entry
    }
    return out
  }

  private sanitizeNpmCache(
    raw: Record<string, { downloads: number; fetchedAt: number }> | undefined,
  ): Record<string, { downloads: number; fetchedAt: number }> {
    if (!isRecord(raw)) return {}
    const out: Record<string, { downloads: number; fetchedAt: number }> = {}
    for (const [key, value] of Object.entries(raw)) {
      if (!isRecord(value)) continue
      const downloads = optionalCount(value['downloads'])
      const fetchedAt = value['fetchedAt']
      if (downloads !== undefined && typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)) {
        out[key] = { downloads, fetchedAt }
      }
    }
    return out
  }
}

export const name = 'plugin-registry-metadata'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-registry-metadata: loaded')
  const fiber = await ctx.plugin(RegistryMetadataPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
