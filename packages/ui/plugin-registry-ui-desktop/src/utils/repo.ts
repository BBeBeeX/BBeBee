/**
 * Repository helpers for the registry views: parsing `owner/repo` shorthands
 * and full GitHub URLs out of a registry entry, and deciding whether an entry
 * is official.
 *
 * Pure and local to this view package on purpose: the headless service has its
 * own parser for its own purposes, and a view package reads other features
 * through service keys, never by importing their runtime.
 */

import type { RegistryEntry } from '@BBeBee/protocol'

/** The GitHub organization that publishes official registry content. */
const OFFICIAL_OWNER = 'bbebeex'

export interface RepoRef {
  owner: string
  repo: string
}

/**
 * `https://github.com/owner/repo(.git)…` or the `owner/repo` shorthand →
 * `{ owner, repo }`; anything else (a bare download URL, an empty value) →
 * `undefined`.
 */
export function parseRepoOwner(repoUrlOrShorthand: string | undefined): RepoRef | undefined {
  if (!repoUrlOrShorthand || typeof repoUrlOrShorthand !== 'string') return undefined
  const cleaned = repoUrlOrShorthand.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const match =
    cleaned.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)$/) ??
    cleaned.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/)
  if (match?.[1] && match?.[2]) return { owner: match[1], repo: match[2] }
  return undefined
}

/** The entry's repository ref, or `undefined` when it publishes none. */
export function entryRepo(entry: RegistryEntry): RepoRef | undefined {
  return parseRepoOwner(entry.repo ?? entry.repoUrl)
}

/**
 * Case-normalized map key for one repository, so screen-side lookups match
 * what the metadata service caches and merges under.
 */
export function repoKey(ref: RepoRef): string {
  return `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
}

/**
 * Official entries: the built-in lyric sources, and anything published under
 * the official organization. An entry with no repository is third-party.
 */
export function isOfficialEntry(entry: RegistryEntry): boolean {
  if (entry.id.startsWith('builtin-')) return true
  const ref = entryRepo(entry)
  return ref !== undefined && ref.owner.toLowerCase() === OFFICIAL_OWNER
}
