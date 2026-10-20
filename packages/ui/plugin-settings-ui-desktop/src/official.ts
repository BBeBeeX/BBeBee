/**
 * The official badge (policy decided 2026-10-20, audit W5): a registry
 * entry is official content when — and only when — the owner of its
 * `repo` URL is the `BBeBeeX` GitHub account (compared
 * case-insensitively, as GitHub itself treats account names).
 *
 * Nothing self-declared counts: the entry id (`bbebeex-…` prefixes are
 * claimable by any submitter), the `author` string, and the npm scope
 * are all attacker-controlled text and are deliberately never read
 * here. The hostname must be exactly `github.com` — lookalike hosts
 * (`github.com.evil.com`, subdomains, URL shorteners) do not qualify.
 */
export const OFFICIAL_REPO_OWNER = 'bbebeex'

/** True when the entry's repo is owned by the official GitHub account. */
export function isOfficialEntry(entry: { repo?: string }): boolean {
  const repo = entry.repo?.trim()
  if (!repo) return false
  let url: URL
  try {
    url = new URL(repo)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.hostname.toLowerCase() !== 'github.com') return false
  const owner = url.pathname.split('/').filter(Boolean)[0]
  return owner !== undefined && owner.toLowerCase() === OFFICIAL_REPO_OWNER
}
