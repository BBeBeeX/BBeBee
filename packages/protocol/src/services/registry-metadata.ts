/**
 * Registry extension metadata: per-repository GitHub stats (stars, contributor
 * count) surfaced on the 发现 page's sort controls. The registry repo itself
 * never carries these numbers — they are read lazily from the GitHub API and
 * cached client-side, so entries render without blocking on the network.
 */

/** GitHub stats for one `owner/repo`. Absent numeric fields mean "unknown this round". */
export interface RegistryRepoStats {
  readonly owner: string
  readonly repo: string
  /** `stargazers_count` from `GET /repos/{owner}/{repo}`. */
  readonly stars?: number
  /** Approximate contributor count (one page of up to 100 from `/contributors?per_page=100`). */
  readonly contributors?: number
  /** Epoch ms when the stats were fetched. */
  readonly fetchedAt: number
  /** True when the value came from cache past its TTL because a fresh fetch failed. */
  readonly stale?: boolean
  /** Set when the lookup could not produce data (rate limit, network failure, missing repo). */
  readonly error?: string
}

export interface RegistryMetadataService {
  /**
   * Lazily fetches — or reads from the 24h cache — GitHub stats for one
   * repository. Never throws: failures degrade into `error` on the result.
   */
  getRepoStats(owner: string, repo: string): Promise<RegistryRepoStats>
  /** Cached stats only, no network. Undefined when nothing has been fetched yet. */
  peekRepoStats(owner: string, repo: string): RegistryRepoStats | undefined
}

declare module 'cordis' {
  interface Context {
    registryMetadata: RegistryMetadataService
  }
}
