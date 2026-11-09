/**
 * GitHub Releases API client and asset classifier.
 */

import type {
  HttpService,
  UpdateAsset,
  UpdateAssetKind,
  UpdateChannel,
  UpdateRelease,
} from '@BBeBee/protocol'
import { parseVersion } from './semver.js'

export type PlatformCategory = 'desktop' | 'mobile'

export interface GitHubRawAsset {
  name: string
  browser_download_url: string
  size: number
  content_type: string
}

export interface GitHubRawRelease {
  id: number
  tag_name: string
  name?: string
  body?: string
  prerelease: boolean
  published_at: string
  html_url: string
  assets: GitHubRawAsset[]
}

/**
 * Classify a release asset by kind, target platform, and OS.
 */
export function classifyAsset(
  raw: GitHubRawAsset,
  _currentCategory?: PlatformCategory,
): UpdateAsset {
  const name = raw.name.toLowerCase()
  let kind: UpdateAssetKind = 'other'
  let platform: 'desktop' | 'mobile' | undefined
  let os: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | undefined

  // Classify kind
  if (
    name.includes('bundle') ||
    name.includes('hotupdate') ||
    name.includes('hot-update') ||
    name.endsWith('.jsbundle.zip')
  ) {
    kind = 'hot-update'
  } else if (
    name.endsWith('.exe') ||
    name.endsWith('.msi') ||
    name.endsWith('.dmg') ||
    name.endsWith('.pkg') ||
    name.endsWith('.deb') ||
    name.endsWith('.appimage') ||
    name.endsWith('.apk') ||
    name.endsWith('.aab') ||
    name.endsWith('.ipa')
  ) {
    kind = 'installer'
  } else if (name.endsWith('.sha256') || name.endsWith('.sig') || name.endsWith('.md5')) {
    kind = 'checksum'
  }

  // Classify platform & OS
  if (name.endsWith('.exe') || name.endsWith('.msi') || name.includes('win')) {
    platform = 'desktop'
    os = 'windows'
  } else if (name.endsWith('.dmg') || name.endsWith('.pkg') || name.includes('mac') || name.includes('darwin')) {
    platform = 'desktop'
    os = 'macos'
  } else if (name.endsWith('.deb') || name.endsWith('.appimage') || name.includes('linux')) {
    platform = 'desktop'
    os = 'linux'
  } else if (name.endsWith('.apk') || name.endsWith('.aab') || name.includes('android')) {
    platform = 'mobile'
    os = 'android'
  } else if (name.endsWith('.ipa') || name.includes('ios')) {
    platform = 'mobile'
    os = 'ios'
  } else if (name.includes('desktop')) {
    platform = 'desktop'
  } else if (name.includes('mobile')) {
    platform = 'mobile'
  }

  return {
    name: raw.name,
    browserDownloadUrl: raw.browser_download_url,
    size: raw.size,
    contentType: raw.content_type,
    kind,
    platform,
    os,
  }
}

/**
 * Transform a GitHub raw release record into a normalized `UpdateRelease`.
 */
export function normalizeRelease(
  raw: GitHubRawRelease,
  currentCategory: PlatformCategory,
): UpdateRelease | null {
  const parsed = parseVersion(raw.tag_name)
  if (!parsed) return null

  const channel: UpdateChannel = raw.prerelease || parsed.channel === 'dev' ? 'dev' : 'main'
  const classifiedAssets = (raw.assets || []).map((a) => classifyAsset(a, currentCategory))

  // Find hot-update bundle matching current platform (or universal)
  const hotUpdate = classifiedAssets.find(
    (a) =>
      a.kind === 'hot-update' &&
      (!a.platform || a.platform === currentCategory),
  )

  // Find native package installer matching current platform
  const nativePackage = classifiedAssets.find(
    (a) =>
      a.kind === 'installer' &&
      (!a.platform || a.platform === currentCategory),
  )

  return {
    version: parsed.raw,
    parsedVersion: { ...parsed, channel },
    channel,
    publishedAt: raw.published_at,
    releaseNotes: raw.body,
    htmlUrl: raw.html_url,
    assets: classifiedAssets,
    isPrerelease: raw.prerelease,
    hotUpdate,
    nativePackage,
  }
}

/**
 * Fetch releases from GitHub Releases API for a repository.
 */
export async function fetchGitHubReleases(
  http: HttpService,
  repo: string,
  platformCategory: PlatformCategory,
  prefixes: readonly string[] = [],
): Promise<UpdateRelease[]> {
  const officialUrl = `https://api.github.com/repos/${repo}/releases`
  const candidates: string[] = [officialUrl]

  // Add acceleration prefixes if configured
  for (const prefix of prefixes) {
    if (prefix) {
      candidates.push(`${prefix.replace(/\/+$/, '')}/${officialUrl}`)
    }
  }

  let lastError: Error | undefined
  for (const url of candidates) {
    try {
      const res = await http({
        url,
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'BBeBee-Updater',
        },
      })

      if (res.status >= 200 && res.status < 300) {
        const rawList = await res.json<GitHubRawRelease[]>()

        if (Array.isArray(rawList)) {
          return rawList
            .map((r) => normalizeRelease(r, platformCategory))
            .filter((r): r is UpdateRelease => r !== null)
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (lastError) {
    throw lastError
  }
  return []
}
