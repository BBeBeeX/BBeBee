/**
 * Session baseline for the download-endpoint settings
 * (`downloadRegion` / `npmRegistryUrl` / `githubRawBaseUrl`).
 *
 * These three values decide which hosts plugin-manager's download pipeline
 * may reach, but the capability gate's side of that allowlist is baked when
 * plugin-manager's fiber is created (see `derivePluginManagerDownloadHosts`
 * and docs/plugins/capabilities.md): a mirror the user configures mid-session
 * is only admitted by the gate at the manager's next load — in practice the
 * next app launch. The network section compares the saved values against
 * this baseline to warn about exactly that lag.
 *
 * The baseline is the value the session *started* with, frozen on the first
 * read in this renderer session. It deliberately lives in module state, not
 * in a component: the settings screen unmounts and remounts as the user
 * navigates, and re-freezing on every mount would mistake "the value I just
 * saved" for "the value the app booted with" and hide the warning.
 *
 * Both sides of the comparison are post-normalization values (the settings
 * service's `mergeSettings` output, with unset overrides rendered as `''`),
 * so cosmetic differences the service already erased (trailing slashes,
 * surrounding whitespace) can never read as a change.
 */

import type { DownloadRegion } from '@BBeBee/protocol'

export interface DownloadEndpointValues {
  downloadRegion: DownloadRegion
  /** Manual npm registry override as saved; `''` means "derive from region". */
  npmRegistryUrl: string
  /** Manual registry raw base override as saved; `''` means "derive from region". */
  githubRawBaseUrl: string
}

let sessionBaseline: DownloadEndpointValues | null = null

/**
 * Freeze the session baseline on first call, then report whether the saved
 * endpoint values have moved away from it. Changing every field back to the
 * baseline value reports `false` again — the warning tracks the delta, not
 * the act of editing.
 */
export function downloadEndpointsChangedSinceSessionStart(
  current: DownloadEndpointValues,
): boolean {
  if (!sessionBaseline) {
    sessionBaseline = { ...current }
    return false
  }
  return (
    current.downloadRegion !== sessionBaseline.downloadRegion ||
    current.npmRegistryUrl !== sessionBaseline.npmRegistryUrl ||
    current.githubRawBaseUrl !== sessionBaseline.githubRawBaseUrl
  )
}

/** Test-only: each test harness boots a fresh "app", so it re-arms the freeze. */
export function resetDownloadEndpointBaselineForTests(): void {
  sessionBaseline = null
}
