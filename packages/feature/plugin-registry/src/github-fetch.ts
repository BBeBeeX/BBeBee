/**
 * Unified GitHub download layer for the registry.
 *
 * Every GitHub request is turned into an ordered candidate chain and walked
 * until one candidate answers:
 *
 * 1. **official** — the original URL, always first;
 * 2. **jsdelivr** — the system-built-in `cdn.jsdelivr.net/gh/` mirror, only
 *    for `raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` URLs with
 *    a pinned ref (`api.github.com` URLs and anything else never get one);
 * 3. **prefix** — one candidate per user-configured acceleration prefix, in
 *    the user's order, gh-proxy style (`prefix + original full URL`).
 *
 * A candidate is only abandoned when it actually fails (transport error or
 * HTTP status >= 400); each switch is logged through `ctx.logger` so the
 * fallback stays observable without bothering the user. URLs on hosts other
 * than GitHub keep exactly one candidate — an author's own `downloadUrl` is
 * never rewritten.
 *
 * The download-region preference is storage-only for now: it is read and
 * surfaced in the log lines, but the official-first rule never changes.
 */

import type { HttpService, HttpResponse } from '@BBeBee/protocol'

/** The system-built-in jsDelivr GitHub CDN base. */
export const JSDELIVR_GH_BASE = 'https://cdn.jsdelivr.net/gh/'

const RAW_GITHUB_HOST = 'raw.githubusercontent.com'
const API_GITHUB_HOST = 'api.github.com'

/** The slice of `AppSettings` the download layer reads. */
export interface GitHubFetchSettings {
  downloadRegion?: 'global' | 'mainland-china'
  githubAccelerationPrefixes?: readonly string[]
}

/** The `ctx.logger` surface the layer needs. */
export interface GitHubFetchLogger {
  info(message: string): void
  warn(message: string): void
}

export interface GitHubFetchDeps {
  http: HttpService
  logger: GitHubFetchLogger
  /** Read the current settings snapshot on every request (never cached here). */
  getSettings: () => GitHubFetchSettings | undefined
}

export interface GitHubFetchOptions {
  /**
   * Treat the URL as a user-configured override (e.g. `registry.prefs.endpoint`):
   * the given URL is the only candidate and is never accelerated.
   */
  onlyOfficial?: boolean
}

/** One request whose entire candidate chain failed, kept for diagnostics. */
export interface GitHubChainFailure {
  /** When the chain was exhausted. */
  at: number
  /** The original (official) URL that was requested. */
  url: string
  /** Human-readable description of the last candidate's failure. */
  error: string
}

export interface GitHubFetchLayer {
  /** Fetch JSON, walking the candidate chain on failure. */
  getJson<T = unknown>(url: string, opts?: GitHubFetchOptions): Promise<T>
  /** Fetch a document (any body kind), walking the candidate chain on failure. */
  fetchDocument(url: string, opts?: GitHubFetchOptions): Promise<HttpResponse>
  /**
   * The most recent request whose whole candidate chain failed, or
   * `undefined` while every request has at least one answering candidate.
   * A lightweight status record — diagnostics read it, nothing else.
   */
  lastChainFailure?(): GitHubChainFailure | undefined
}

export interface GitHubCandidate {
  /** The URL to request. */
  url: string
  /** Which chain link produced this candidate. */
  kind: 'official' | 'jsdelivr' | 'prefix'
  /** For `prefix` candidates: the prefix that generated it. */
  prefix?: string
}

export interface RawGitHubUrl {
  owner: string
  repo: string
  /** The pinned ref segment (a commit SHA, tag or branch). */
  ref: string
  /** Remaining path segments joined by `/`. */
  path: string
}

/** Parse `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path…}`. */
export function parseRawGitHubUrl(url: string): RawGitHubUrl | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== RAW_GITHUB_HOST) return undefined
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0)
  if (segments.length < 4) return undefined
  const [owner, repo, ref, ...path] = segments
  if (!owner || !repo || !ref || path.length === 0) return undefined
  return { owner, repo, ref, path: path.join('/') }
}

/** Build the jsDelivr form of a raw GitHub URL: `…/gh/{owner}/{repo}@{ref}/{path}`. */
export function toJsDelivrUrl(raw: RawGitHubUrl): string {
  return `${JSDELIVR_GH_BASE}${raw.owner}/${raw.repo}@${raw.ref}/${raw.path}`
}

/** Normalize a user-entered acceleration prefix to an HTTPS base with a trailing slash. */
export function normalizeAccelerationPrefix(prefix: string): string {
  const trimmed = prefix.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/**
 * Compute the candidate chain for a URL: official → jsDelivr (only for
 * pinned raw.githubusercontent.com URLs) → one candidate per prefix, in
 * order. Non-GitHub hosts keep exactly one candidate.
 */
export function githubCandidates(
  url: string,
  prefixes: readonly string[] = [],
): readonly GitHubCandidate[] {
  const candidates: GitHubCandidate[] = [{ url, kind: 'official' }]

  let host: string | undefined
  try {
    host = new URL(url).hostname
  } catch {
    return candidates
  }
  if (host !== RAW_GITHUB_HOST && host !== API_GITHUB_HOST) return candidates

  const raw = parseRawGitHubUrl(url)
  if (raw) {
    candidates.push({ url: toJsDelivrUrl(raw), kind: 'jsdelivr' })
  }

  for (const prefix of prefixes) {
    if (typeof prefix !== 'string' || prefix.trim().length === 0) continue
    candidates.push({
      url: `${normalizeAccelerationPrefix(prefix)}${url}`,
      kind: 'prefix',
      prefix: normalizeAccelerationPrefix(prefix),
    })
  }

  return candidates
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    const status = /status (\d+)/.exec(err.message)?.[1]
    if (status) return status
    return err.message
  }
  return String(err)
}

/** A status failure carries the same message shape the registry has always thrown. */
function statusFailure(status: number, url: string): Error {
  return new Error(`registry: download failed with status ${status} for ${url}`)
}

export function createGitHubFetch(deps: GitHubFetchDeps): GitHubFetchLayer {
  const { http, logger } = deps

  /** The last request whose whole candidate chain failed. Never cleared by the layer itself. */
  let lastChainFailure: GitHubChainFailure | undefined

  async function request(url: string, opts: GitHubFetchOptions = {}): Promise<HttpResponse> {
    const settings = deps.getSettings() ?? {}
    const region = settings.downloadRegion ?? 'global'
    const prefixes = opts.onlyOfficial ? [] : (settings.githubAccelerationPrefixes ?? [])
    const candidates = opts.onlyOfficial
      ? [{ url, kind: 'official' as const }]
      : githubCandidates(url, prefixes)

    let lastError: unknown
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i] as GitHubCandidate
      const next = candidates[i + 1]
      let response: HttpResponse | undefined
      let failure: unknown
      try {
        response = await http({ url: candidate.url, method: 'GET' })
        if (response.status >= 400) {
          failure = statusFailure(response.status, candidate.url)
          response = undefined
        }
      } catch (err) {
        failure = err
      }

      if (response) {
        if (i > 0) {
          logger.info(
            `[github-fetch] ${candidate.kind} succeeded for ${candidate.url} (region=${region})`,
          )
        }
        return response
      }

      lastError = failure
      if (next) {
        logger.warn(
          `[github-fetch] ${candidate.kind} failed (${describeFailure(failure)}), falling back to ${next.kind}: ${candidate.url} (region=${region})`,
        )
      }
    }
    // The chain always contains at least the official candidate, so the loop
    // ran at least once and left a failure behind.
    const exhausted = lastError ?? new Error(`[github-fetch] no candidate answered for ${url}`)
    lastChainFailure = { at: Date.now(), url, error: describeFailure(exhausted) }
    throw exhausted
  }

  return {
    async getJson<T = unknown>(url: string, opts?: GitHubFetchOptions): Promise<T> {
      const response = await request(url, opts)
      return (await response.json()) as T
    },
    fetchDocument(url: string, opts?: GitHubFetchOptions): Promise<HttpResponse> {
      return request(url, opts)
    },
    lastChainFailure(): GitHubChainFailure | undefined {
      return lastChainFailure
    },
  }
}
