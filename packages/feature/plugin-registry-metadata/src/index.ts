/**
 * `plugin-registry-metadata` — lazy GitHub stats for registry entries.
 *
 * Implements `ctx.registryMetadata`: the 发现 page's sort controls want star
 * and contributor numbers the registry index itself never carries. They are
 * read lazily from the GitHub API, cached in the store for 24 hours, merged
 * per-repo across concurrent callers, and capped at three simultaneous
 * requests — the rest queue. Every failure degrades (a stale cached value, or
 * a result carrying `error`) and never throws, because the caller is a render
 * path: a sort control must never be able to reject.
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
  return {
    fetchedAt,
    ...(stars !== undefined ? { stars } : {}),
    ...(contributors !== undefined ? { contributors } : {}),
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
  /** While `Date.now()` is before this, every fetch degrades instead of requesting. */
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
    })
  }

  async getRepoStats(owner: string, repo: string): Promise<RegistryRepoStats> {
    const key = cacheKey(owner, repo)
    const cached = this.cache[key]
    // Within TTL the cache is the answer — no network, no queue, no merging.
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return toStats(owner, repo, cached)
    }

    const pending = this.inFlight.get(key)
    if (pending) return pending

    const fetch = this.enqueue(() => this.fetchStats(owner, repo, key)).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, fetch)
    return fetch
  }

  peekRepoStats(owner: string, repo: string): RegistryRepoStats | undefined {
    const cached = this.cache[cacheKey(owner, repo)]
    if (!cached) return undefined
    return toStats(owner, repo, cached, Date.now() - cached.fetchedAt >= TTL_MS)
  }

  /* ── the fetch, and its graceful failures ──────────────────────────────── */

  private async fetchStats(owner: string, repo: string, key: string): Promise<RegistryRepoStats> {
    if (Date.now() < this.backoffUntil) {
      return this.degrade(
        owner,
        repo,
        key,
        `rate-limit backoff until ${new Date(this.backoffUntil).toISOString()}`,
      )
    }
    try {
      // Request the canonical (lowercase) owner/repo: GitHub answers either
      // casing, and one spelling keeps the cache, the in-flight map and the
      // URLs consistent. The result still reports the caller's spelling.
      const [urlOwner, urlRepo] = key.split('/')
      const stars = await this.fetchStarCount(urlOwner!, urlRepo!)
      const contributors = await this.fetchContributorCount(urlOwner!, urlRepo!)
      const entry: CachedStats = {
        fetchedAt: Date.now(),
        ...(stars !== undefined ? { stars } : {}),
        ...(contributors !== undefined ? { contributors } : {}),
      }
      this.cache[key] = entry
      await this.persist()
      this.ownCtx.logger.info(
        `[registry-metadata] ${key}: ${stars ?? '?'} stars, ${contributors ?? '?'} contributors`,
      )
      return toStats(owner, repo, entry)
    } catch (err) {
      return this.degrade(owner, repo, key, err instanceof Error ? err.message : String(err))
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.http({ url, method: 'GET', headers: { Accept: GITHUB_ACCEPT } })
    if (response.status === 403 || response.status === 429) {
      // GitHub answers 403 (primary) or 429 when rate limited; back off
      // locally either way, so a blocked caller stops hammering the API.
      this.backoffUntil = Date.now() + BACKOFF_MS
      this.ownCtx.logger.warn(
        `[registry-metadata] rate limited (HTTP ${response.status}); backing off until ${new Date(this.backoffUntil).toISOString()}`,
      )
      throw new Error(`github rate limited (HTTP ${response.status})`)
    }
    if (response.status >= 400) {
      throw new Error(`github request failed (HTTP ${response.status}) for ${url}`)
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

  /**
   * The only failure shape: a stale cached copy when one exists, an `error`
   * result otherwise. Never throws, never leaves the caller waiting.
   */
  private degrade(owner: string, repo: string, key: string, reason: string): RegistryRepoStats {
    const cached = this.cache[key]
    if (cached) {
      this.ownCtx.logger.warn(`[registry-metadata] ${key}: ${reason}; serving the cached copy as stale`)
      return toStats(owner, repo, cached, true)
    }
    this.ownCtx.logger.warn(`[registry-metadata] ${key}: ${reason}; no cached copy, reporting the failure`)
    return { owner, repo, fetchedAt: Date.now(), error: reason }
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
}

export const name = 'plugin-registry-metadata'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-registry-metadata: loaded')
  const fiber = await ctx.plugin(RegistryMetadataPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
