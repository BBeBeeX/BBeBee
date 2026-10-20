/**
 * The plugin-manager download pipeline's legitimate host set, DERIVED
 * from the user's network settings.
 *
 * This module is the single source for that set. Two consumers must
 * never be allowed to drift apart again, so both read exactly this
 * derivation:
 *
 *  - the capability gate: the shells' `resolveGrants` merges the set
 *    into plugin-manager's granted capabilities as `net:host/<host>`
 *    entries (see `withManagerPipelineGrants` in the kernel and the
 *    two boots), and
 *  - the manager itself: its tarball pre-download allowlist
 *    (`tarballAllowedHosts` in plugin-manager's npm client).
 *
 * The drift this prevents is not hypothetical: the two lists used to
 * be maintained separately, both named only the pipeline's ENTRY
 * hosts, and both missed `cdn.npmmirror.com` — the CDN host
 * `registry.npmmirror.com` 302-redirects tarball downloads to — so
 * mainland installs died at the gate on the redirect hop
 * (field report, 2026-10-20).
 *
 * Derivation inputs are exactly three things, nothing else:
 *
 *  1. the built-in endpoints below (the app's own infrastructure —
 *     both regions' defaults and the official fallbacks between them),
 *  2. the hardcoded companion table {@link KNOWN_HOST_COMPANIONS}
 *     (known mirrors' CDN redirect targets — companions are NEVER
 *     learned from remote data), and
 *  3. the user's own settings values (`npmRegistryUrl`,
 *     `githubRawBaseUrl`).
 *
 * Remote data — a packument's `dist.tarball`, a redirect target —
 * can never expand this set: the gate keeps refusing derived-set
 * outsiders on every hop, and an unknown custom registry is granted
 * its own host only (fail-closed; the refusal names the host).
 *
 * The built-in hosts are unconditional: `downloadRegion` is a routing
 * preference among them, not a trust boundary, and every one of them
 * is also statically granted in plugin-manager's manifest (the
 * settings-unreadable fallback). What the settings actually change is
 * the CUSTOM hosts: configure a mirror and its host joins the set at
 * the manager's next grant resolution; remove it and it leaves.
 */

import type { DownloadRegion } from './settings.js'

/** The plugin-manager's own plugin id — the one plugin the shells derive extra grants for. */
export const PLUGIN_MANAGER_ID = '@BBeBee/plugin-manager'

/** The settings plugin's id; also the store namespace its preferences persist under. */
export const PLUGIN_SETTINGS_ID = '@BBeBee/plugin-settings'

/** The store key the settings plugin persists the `AppSettings` document under. */
export const APP_SETTINGS_STORE_KEY = 'preferences'

export const NPM_REGISTRY_OFFICIAL = 'https://registry.npmjs.org'
export const NPM_REGISTRY_CHINA = 'https://registry.npmmirror.com'
export const REGISTRY_RAW_OFFICIAL = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main'
export const REGISTRY_RAW_CHINA = 'https://cdn.jsdelivr.net/gh/BBeBeeX/B_Be_Bee-registry@main'

/** The slice of `AppSettings` the download pipeline's endpoints derive from. */
export interface ManagerNetworkSettings {
  downloadRegion?: DownloadRegion
  npmRegistryUrl?: string
  githubRawBaseUrl?: string
}

/**
 * Effective npm registry base URL: a manual `npmRegistryUrl` always
 * wins; otherwise `downloadRegion === 'mainland-china'` selects
 * npmmirror and anything else the official registry. Trailing slashes
 * are stripped, exactly as the npm client has always normalized it.
 */
export function effectiveNpmRegistryBase(settings?: ManagerNetworkSettings): string {
  const manual = settings?.npmRegistryUrl?.trim()
  return (manual || (settings?.downloadRegion === 'mainland-china' ? NPM_REGISTRY_CHINA : NPM_REGISTRY_OFFICIAL)).replace(
    /\/+$/,
    '',
  )
}

/**
 * Effective raw base URL for community-registry files: a manual
 * `githubRawBaseUrl` always wins; otherwise the region selects
 * jsDelivr (mainland) or the official raw host.
 */
export function effectiveRegistryRawBase(settings?: ManagerNetworkSettings): string {
  const manual = settings?.githubRawBaseUrl?.trim()
  return (manual || (settings?.downloadRegion === 'mainland-china' ? REGISTRY_RAW_CHINA : REGISTRY_RAW_OFFICIAL)).replace(
    /\/+$/,
    '',
  )
}

/**
 * Known companion hosts: hosts a listed host is known to hand
 * downloads to, which must therefore be legitimate pipeline targets
 * in their own right. Hardcoded on purpose — this table is the ONLY
 * source of companions.
 *
 *  - `registry.npmmirror.com` answers tarball GETs with a 302 to its
 *    CDN, `cdn.npmmirror.com` (captured on a real machine).
 *  - jsDelivr's two hostnames are interchangeable faces of the same
 *    CDN (the client's flows already treat them as a pair).
 */
export const KNOWN_HOST_COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  'registry.npmmirror.com': ['cdn.npmmirror.com'],
  'cdn.jsdelivr.net': ['fastly.jsdelivr.net'],
  'fastly.jsdelivr.net': ['cdn.jsdelivr.net'],
}

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.toLowerCase() || undefined
  } catch {
    // An unparseable configured URL contributes no host.
    return undefined
  }
}

/**
 * The complete set of hosts the plugin-manager's download pipeline
 * may legitimately touch under `settings` (absent settings = the
 * built-in set — the same set the manifest statically grants, used
 * when settings cannot be read at all). Bare hostnames, lowercased,
 * deduplicated, sorted. Hostname granularity matches the capability
 * gate's own matching (`assertHost` compares hostnames; ports are
 * not part of a grant).
 */
export function derivePluginManagerDownloadHosts(settings?: ManagerNetworkSettings): string[] {
  const hosts = new Set<string>()
  const add = (url: string | undefined) => {
    const host = hostnameOf(url)
    if (host) hosts.add(host)
  }
  // (1) Built-in infrastructure: both regions' endpoint defaults and
  // the official endpoints the fallbacks always keep in play.
  add(NPM_REGISTRY_OFFICIAL)
  add(NPM_REGISTRY_CHINA)
  add(REGISTRY_RAW_OFFICIAL)
  add(REGISTRY_RAW_CHINA)
  // (3) The settings-selected endpoints — this is where a configured
  // mirror / acceleration base contributes its (custom) host.
  add(effectiveNpmRegistryBase(settings))
  add(effectiveRegistryRawBase(settings))
  // (2) Companion expansion, closed transitively over the table.
  const queue = [...hosts]
  while (queue.length > 0) {
    const host = queue.pop()!
    for (const companion of KNOWN_HOST_COMPANIONS[host] ?? []) {
      if (!hosts.has(companion)) {
        hosts.add(companion)
        queue.push(companion)
      }
    }
  }
  return [...hosts].sort()
}
