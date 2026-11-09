/**
 * `ctx.updater` — application updates and hot-updates coordinator.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below resolves.
import type {} from 'cordis'
import type { Uri } from '../common.js'

export type UpdateChannel = 'main' | 'dev'

export interface VersionInfo {
  major: number
  minor: number
  patch: number
  channel: UpdateChannel
  prerelease?: string
  raw: string
}

export type UpdateAssetKind = 'installer' | 'hot-update' | 'checksum' | 'other'

export interface UpdateAsset {
  name: string
  browserDownloadUrl: string
  size: number
  contentType: string
  kind: UpdateAssetKind
  platform?: 'desktop' | 'mobile'
  os?: 'windows' | 'macos' | 'linux' | 'android' | 'ios'
  arch?: 'x64' | 'arm64' | 'universal'
}

export interface UpdateRelease {
  version: string
  parsedVersion: VersionInfo
  channel: UpdateChannel
  publishedAt: string
  releaseNotes?: string
  htmlUrl: string
  assets: UpdateAsset[]
  isPrerelease: boolean
  hotUpdate?: UpdateAsset
  nativePackage?: UpdateAsset
}

export type UpdateType = 'native' | 'hot' | 'both'

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  channel: UpdateChannel
  latestRelease?: UpdateRelease
  updateType?: UpdateType
  eligibleForMain?: boolean
  reason?: string
}

export type UpdateDownloadStatus = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error'

export interface UpdateDownloadProgress {
  bytesDownloaded: number
  totalBytes: number
  percent: number
  status: UpdateDownloadStatus
  error?: string
}

export interface UpdaterConfig {
  channel: UpdateChannel
  githubRepo: string
  autoCheck: boolean
  checkIntervalMs: number
  autoApplyHotUpdate: boolean
}

export type UpdaterStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface UpdaterService {
  readonly status: UpdaterStatus
  readonly config: UpdaterConfig

  /** Change active release channel (`main` | `dev`). */
  setChannel(channel: UpdateChannel): void

  /** Check for available updates on the current channel. */
  checkUpdate(options?: { channel?: UpdateChannel; force?: boolean }): Promise<UpdateCheckResult>

  /** Download an update asset (hot update or native installer). */
  downloadUpdate(
    release: UpdateRelease,
    kind?: 'hot' | 'native',
    onProgress?: (p: UpdateDownloadProgress) => void,
  ): Promise<Uri | undefined>

  /** Apply a downloaded hot update bundle. */
  applyHotUpdate(bundleUri: Uri): Promise<boolean>
}

declare module 'cordis' {
  interface Context {
    updater: UpdaterService
  }
}
