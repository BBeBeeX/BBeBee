/**
 * `plugin-updater` — Application updates and hot updates coordinator.
 *
 * Implements `ctx.updater`:
 * - Supports `main` and `dev` release channels.
 * - Releases hosted on GitHub Releases.
 * - Semantic versioning `x.y.z`, where `z` is the bug-fix patch version (no new features).
 * - Implements 1-month dev stabilization rule before main release.
 * - Adopts the latest patch `z` for that `x.y` series when releasing on `main`.
 * - Coordinates hot-update bundle staging and native package downloads.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type {
  AppSettings,
  Disposable,
  UpdateChannel,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateRelease,
  UpdaterConfig,
  UpdaterService,
  UpdaterStatus,
  UpdateType,
  Uri,
} from '@BBeBee/protocol'
import { fetchGitHubReleases, type PlatformCategory } from './github.js'
import {
  compareVersions,
  getReleaseSeries,
  isDevEligibleForMain,
  parseVersion,
  resolveLatestPatchForSeries,
} from './semver.js'

export const DEFAULT_GITHUB_REPO = 'BBeBee/BBeBee'

export class Updater extends Service implements UpdaterService {
  static inject = ['http', 'device', 'paths', 'fs']

  private readonly ownCtx: Context
  private _status: UpdaterStatus = 'idle'
  private _config: UpdaterConfig
  private autoCheckTimer?: ReturnType<typeof setTimeout>
  private offSettings?: Disposable

  constructor(ctx: Context, initialConfig?: Partial<UpdaterConfig>) {
    super(ctx, 'updater')
    this.ownCtx = ctx

    this._config = {
      channel: initialConfig?.channel ?? 'main',
      githubRepo: initialConfig?.githubRepo ?? DEFAULT_GITHUB_REPO,
      autoCheck: initialConfig?.autoCheck ?? true,
      checkIntervalMs: initialConfig?.checkIntervalMs ?? 24 * 60 * 60 * 1000,
      autoApplyHotUpdate: initialConfig?.autoApplyHotUpdate ?? false,
    }
  }

  [Service.init]() {
    this.ownCtx.logger.info(
      'plugin-updater: initialized (channel: %s, repo: %s)',
      this._config.channel,
      this._config.githubRepo,
    )

    // Listen to settings changes if settings service is present
    this.ownCtx.inject(['settings'], (scoped) => {
      const updateFromSettings = (settings: AppSettings) => {
        if (settings.updater) {
          if (settings.updater.channel) this._config.channel = settings.updater.channel
          if (settings.updater.autoCheck !== undefined) this._config.autoCheck = settings.updater.autoCheck
          if (settings.updater.checkIntervalMs) this._config.checkIntervalMs = settings.updater.checkIntervalMs
          if (settings.updater.autoApplyHotUpdate !== undefined) {
            this._config.autoApplyHotUpdate = settings.updater.autoApplyHotUpdate
          }
        }
      }

      updateFromSettings(scoped.settings.getSync())
      this.offSettings = scoped.on('settings/changed', (s) => updateFromSettings(s))
    })

    // Schedule background non-blocking auto check (5s post-boot)
    if (this._config.autoCheck) {
      this.autoCheckTimer = setTimeout(() => {
        this.runAutoCheck()
      }, 5000)
    }

    return () => {
      this.clearTimers()
      this.offSettings?.()
    }
  }

  get status(): UpdaterStatus {
    return this._status
  }

  get config(): UpdaterConfig {
    return { ...this._config }
  }

  setChannel(channel: UpdateChannel): void {
    if (this._config.channel === channel) return
    this._config.channel = channel
    this.ownCtx.logger.info('plugin-updater: channel changed to %s', channel)

    // Save channel to settings if available
    this.ownCtx.inject(['settings'], (scoped) => {
      const current = scoped.settings.getSync()
      void scoped.settings.update({
        updater: {
          ...current.updater,
          channel,
        },
      })
    })
  }

  private setStatus(status: UpdaterStatus): void {
    if (this._status !== status) {
      this._status = status
      this.ownCtx.emit('updater/status-changed', status)
    }
  }

  /**
   * Check for updates on GitHub Releases.
   */
  async checkUpdate(options?: {
    channel?: UpdateChannel
    force?: boolean
  }): Promise<UpdateCheckResult> {
    const targetChannel = options?.channel ?? this._config.channel
    const currentVersion = this.ownCtx.device.appVersion || '0.1.0'
    const currentParsed = parseVersion(currentVersion)

    this.setStatus('checking')
    this.ownCtx.logger.info(
      'plugin-updater: checking for updates (current: %s, channel: %s)',
      currentVersion,
      targetChannel,
    )

    try {
      // Gather acceleration prefixes if settings available
      let prefixes: readonly string[] = []
      this.ownCtx.inject(['settings'], (scoped) => {
        prefixes = scoped.settings.getSync().githubAccelerationPrefixes ?? []
      })

      // Normalize high-level platform ('desktop' vs 'mobile')
      const isDesktop =
        this.ownCtx.device.formFactor === 'desktop' ||
        ['macos', 'windows', 'linux'].includes(this.ownCtx.device.platform)
      const platformCategory: PlatformCategory = isDesktop ? 'desktop' : 'mobile'

      const releases = await fetchGitHubReleases(
        this.ownCtx.http,
        this._config.githubRepo,
        platformCategory,
        prefixes,
      )

      let candidate: UpdateRelease | undefined

      if (targetChannel === 'main') {
        // Strategy for main channel:
        // 1. Consider all unique x.y series
        // 2. For each series, check if dev releases have passed 1 month freeze window (or already tagged as main)
        // 3. For an eligible series, pick the latest patch version z
        const seriesList = getReleaseSeries(releases)
        const eligibleMainReleases: UpdateRelease[] = []

        for (const series of seriesList) {
          const seriesReleases = releases.filter(
            (r) =>
              r.parsedVersion.major === series.major &&
              r.parsedVersion.minor === series.minor,
          )

          // Direct published main releases for this series
          const mainReleases = seriesReleases.filter((r) => r.channel === 'main')
          if (mainReleases.length > 0) {
            // Main releases exist for this series -> pick the latest patch z
            const latestMainPatch = resolveLatestPatchForSeries(mainReleases, series)
            if (latestMainPatch) {
              eligibleMainReleases.push(latestMainPatch)
            }
          } else {
            // No direct main release yet: check dev releases for 1-month stabilization window
            const devReleases = seriesReleases.filter((r) => r.channel === 'dev')
            if (devReleases.length > 0) {
              // Earliest dev release marks freeze/stabilization start
              devReleases.sort(
                (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
              )
              const firstDev = devReleases[0]!
              if (isDevEligibleForMain(firstDev.publishedAt)) {
                // Eligible! Pick latest patch release in this dev series
                const latestDevPatch = resolveLatestPatchForSeries(devReleases, series)
                if (latestDevPatch) {
                  eligibleMainReleases.push({
                    ...latestDevPatch,
                    channel: 'main',
                  })
                }
              }
            }
          }
        }

        // Filter eligible releases newer than current version
        const newer = eligibleMainReleases.filter((r) => {
          if (!currentParsed) return true
          return compareVersions(r.parsedVersion, currentParsed) > 0
        })

        newer.sort((a, b) => compareVersions(b.parsedVersion, a.parsedVersion))
        candidate = newer[0]
      } else {
        // Channel === 'dev': consider all releases (both dev and main), pick highest
        const newer = releases.filter((r) => {
          if (!currentParsed) return true
          return compareVersions(r.parsedVersion, currentParsed) > 0
        })

        newer.sort((a, b) => compareVersions(b.parsedVersion, a.parsedVersion))
        candidate = newer[0]
      }

      this.setStatus('idle')

      if (!candidate) {
        this.ownCtx.logger.info('plugin-updater: no update found (up to date)')
        const result: UpdateCheckResult = {
          hasUpdate: false,
          currentVersion,
          channel: targetChannel,
          reason: 'Already up to date',
        }
        return result
      }

      // Determine update type
      let updateType: UpdateType = 'native'
      if (candidate.hotUpdate && candidate.nativePackage) {
        updateType = 'both'
      } else if (candidate.hotUpdate) {
        updateType = 'hot'
      } else {
        updateType = 'native'
      }

      const result: UpdateCheckResult = {
        hasUpdate: true,
        currentVersion,
        channel: targetChannel,
        latestRelease: candidate,
        updateType,
        eligibleForMain: true,
      }

      this.ownCtx.logger.info(
        'plugin-updater: update available %s (type: %s)',
        candidate.version,
        updateType,
      )
      this.ownCtx.emit('updater/available', result)

      // Auto-apply hot update if enabled
      if (this._config.autoApplyHotUpdate && candidate.hotUpdate) {
        void this.downloadUpdate(candidate, 'hot').then((uri) => {
          if (uri) void this.applyHotUpdate(uri)
        })
      }

      return result
    } catch (err) {
      this.setStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      this.ownCtx.logger.error('plugin-updater: update check failed: %s', msg)
      return {
        hasUpdate: false,
        currentVersion,
        channel: targetChannel,
        reason: msg,
      }
    }
  }

  /**
   * Download an update asset (hot-update bundle or native installer).
   */
  async downloadUpdate(
    release: UpdateRelease,
    kind?: 'hot' | 'native',
    onProgress?: (p: UpdateDownloadProgress) => void,
  ): Promise<Uri | undefined> {
    const isHot = kind === 'hot' || (!kind && Boolean(release.hotUpdate))
    const asset = isHot
      ? release.hotUpdate || release.assets.find((a) => a.kind === 'hot-update')
      : release.nativePackage || release.assets.find((a) => a.kind === 'installer') || release.assets[0]

    if (!asset) {
      this.ownCtx.logger.warn('plugin-updater: no downloadable asset found for release %s', release.version)
      return undefined
    }

    this.setStatus('downloading')
    const destinationDir = isHot
      ? this.ownCtx.fs.join(this.ownCtx.paths.cache, 'updates')
      : this.ownCtx.paths.downloads

    const destination = this.ownCtx.fs.join(destinationDir, asset.name)

    this.ownCtx.logger.info(
      'plugin-updater: downloading %s (%d bytes) to %s',
      asset.name,
      asset.size,
      destination,
    )

    try {
      const emitProgress = (progress: UpdateDownloadProgress) => {
        onProgress?.(progress)
        this.ownCtx.emit('updater/download-progress', progress)
      }

      emitProgress({
        bytesDownloaded: 0,
        totalBytes: asset.size,
        percent: 0,
        status: 'downloading',
      })

      await this.ownCtx.http.download({
        url: asset.browserDownloadUrl,
        to: destination,
        onProgress: (loaded, total) => {
          const totalBytes = total && total > 0 ? total : asset.size
          const percent = totalBytes > 0 ? Math.min(100, Math.round((loaded / totalBytes) * 100)) : 0
          emitProgress({
            bytesDownloaded: loaded,
            totalBytes,
            percent,
            status: 'downloading',
          })
        },
      })

      emitProgress({
        bytesDownloaded: asset.size,
        totalBytes: asset.size,
        percent: 100,
        status: 'ready',
      })

      this.setStatus('ready')
      this.ownCtx.logger.info('plugin-updater: downloaded asset to %s', destination)

      if (isHot) {
        this.ownCtx.emit('updater/hot-update-ready', destination)
      }

      return destination
    } catch (err) {
      this.setStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      this.ownCtx.logger.error('plugin-updater: download failed: %s', msg)
      onProgress?.({
        bytesDownloaded: 0,
        totalBytes: asset.size,
        percent: 0,
        status: 'error',
        error: msg,
      })
      return undefined
    }
  }

  /**
   * Apply a downloaded hot update bundle to the application's patch staging directory.
   */
  async applyHotUpdate(bundleUri: Uri): Promise<boolean> {
    try {
      this.ownCtx.logger.info('plugin-updater: applying hot update bundle from %s', bundleUri)

      const exists = await this.ownCtx.fs.exists(bundleUri)
      if (!exists) {
        throw new Error(`Hot update bundle does not exist at ${bundleUri}`)
      }

      // Stage bundle to hot-update runtime patch directory
      const patchDir = this.ownCtx.fs.join(this.ownCtx.paths.appData, 'hot-update')
      const stagingFile = this.ownCtx.fs.join(patchDir, 'active-bundle.zip')

      // Read bundle bytes and write to staging location
      const bytes = await this.ownCtx.fs.readFile(bundleUri)
      await this.ownCtx.fs.writeFile(stagingFile, bytes)

      this.ownCtx.logger.info('plugin-updater: staged hot update bundle to %s', stagingFile)
      this.ownCtx.emit('updater/hot-update-applied')
      return true
    } catch (err) {
      this.ownCtx.logger.error('plugin-updater: failed to apply hot update: %s', String(err))
      return false
    }
  }

  private async runAutoCheck(): Promise<void> {
    try {
      await this.checkUpdate()
    } catch (err) {
      this.ownCtx.logger.warn('plugin-updater: auto-check failed: %s', String(err))
    } finally {
      if (this._config.autoCheck) {
        this.autoCheckTimer = setTimeout(() => {
          this.runAutoCheck()
        }, this._config.checkIntervalMs)
      }
    }
  }

  private clearTimers(): void {
    if (this.autoCheckTimer) {
      clearTimeout(this.autoCheckTimer)
      this.autoCheckTimer = undefined
    }
  }
}

export const name = 'plugin-updater'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-updater: loaded')
  const fiber = await ctx.plugin(Updater)
  return () => void fiber.dispose()
}

export default { name, apply }
export * from './semver.js'
export * from './github.js'
