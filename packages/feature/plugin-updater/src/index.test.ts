import { describe, expect, it, vi } from 'vitest'
import { Context } from '@BBeBee/kernel'
import type {
  FsService,
  HttpService,
  PathsService,
  UpdateRelease,
} from '@BBeBee/protocol'
import {
  compareVersions,
  isDevEligibleForMain,
  isPatchOnlyUpdate,
  ONE_MONTH_MS,
  parseVersion,
  resolveLatestPatchForSeries,
} from './semver.js'
import { classifyAsset } from './github.js'
import { apply } from './index.js'

describe('semver parsing and rules', () => {
  it('parses standard x.y.z versions', () => {
    const v1 = parseVersion('1.2.3')
    expect(v1).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      channel: 'main',
      prerelease: undefined,
      raw: '1.2.3',
    })

    const v2 = parseVersion('v0.5.1')
    expect(v2?.major).toBe(0)
    expect(v2?.minor).toBe(5)
    expect(v2?.patch).toBe(1)
    expect(v2?.channel).toBe('main')
  })

  it('parses dev prerelease versions and sets channel to dev', () => {
    const dev1 = parseVersion('1.2.0-dev')
    expect(dev1).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
      channel: 'dev',
      prerelease: 'dev',
      raw: '1.2.0-dev',
    })

    const dev2 = parseVersion('v1.2.1-dev.3')
    expect(dev2?.channel).toBe('dev')
    expect(dev2?.patch).toBe(1)
  })

  it('rejects invalid version strings', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('invalid')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })

  it('compares versions correctly across major, minor, patch and prerelease', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.2', '1.2.1')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.2.0-dev')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0-dev.1', '1.2.0-dev.2')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('verifies that patch-only updates increment only z without changing major or minor', () => {
    const current = parseVersion('1.2.0')!
    const patchFix = parseVersion('1.2.1')!
    const minorFeature = parseVersion('1.3.0')!
    const majorChange = parseVersion('2.0.0')!

    expect(isPatchOnlyUpdate(current, patchFix)).toBe(true)
    expect(isPatchOnlyUpdate(current, minorFeature)).toBe(false)
    expect(isPatchOnlyUpdate(current, majorChange)).toBe(false)
  })

  it('verifies dev-to-main 1-month stabilization window', () => {
    const freezeDate = new Date('2026-01-01T00:00:00Z')
    const beforeOneMonth = new Date('2026-01-20T00:00:00Z')
    const exactlyOneMonth = new Date(freezeDate.getTime() + ONE_MONTH_MS)
    const afterOneMonth = new Date('2026-02-15T00:00:00Z')

    expect(isDevEligibleForMain(freezeDate, beforeOneMonth)).toBe(false)
    expect(isDevEligibleForMain(freezeDate, exactlyOneMonth)).toBe(true)
    expect(isDevEligibleForMain(freezeDate, afterOneMonth)).toBe(true)
  })

  it('resolves the latest patch version for a given x.y series', () => {
    const releases: UpdateRelease[] = [
      {
        version: '1.2.0',
        parsedVersion: parseVersion('1.2.0')!,
        channel: 'main',
        publishedAt: '2026-01-01T00:00:00Z',
        htmlUrl: 'https://github.com/test/rel/1',
        assets: [],
        isPrerelease: false,
      },
      {
        version: '1.2.2',
        parsedVersion: parseVersion('1.2.2')!,
        channel: 'main',
        publishedAt: '2026-01-15T00:00:00Z',
        htmlUrl: 'https://github.com/test/rel/2',
        assets: [],
        isPrerelease: false,
      },
      {
        version: '1.2.1',
        parsedVersion: parseVersion('1.2.1')!,
        channel: 'main',
        publishedAt: '2026-01-10T00:00:00Z',
        htmlUrl: 'https://github.com/test/rel/3',
        assets: [],
        isPrerelease: false,
      },
    ]

    const latest = resolveLatestPatchForSeries(releases, { major: 1, minor: 2 })
    expect(latest?.version).toBe('1.2.2')
  })
})

describe('asset classification', () => {
  it('classifies desktop hot-update bundles and native installers', () => {
    const hotBundle = classifyAsset({
      name: 'bbebee-desktop-bundle.zip',
      browser_download_url: 'https://example.com/bundle.zip',
      size: 1024,
      content_type: 'application/zip',
    })
    expect(hotBundle.kind).toBe('hot-update')
    expect(hotBundle.platform).toBe('desktop')

    const debInstaller = classifyAsset({
      name: 'BBeBee_0.2.0_amd64.deb',
      browser_download_url: 'https://example.com/app.deb',
      size: 50000000,
      content_type: 'application/vnd.debian.binary-package',
    })
    expect(debInstaller.kind).toBe('installer')
    expect(debInstaller.platform).toBe('desktop')
    expect(debInstaller.os).toBe('linux')
  })

  it('classifies mobile packages', () => {
    const apk = classifyAsset({
      name: 'bbebee-release.apk',
      browser_download_url: 'https://example.com/app.apk',
      size: 30000000,
      content_type: 'application/vnd.android.package-archive',
    })
    expect(apk.kind).toBe('installer')
    expect(apk.platform).toBe('mobile')
    expect(apk.os).toBe('android')
  })
})

describe('Updater service in Cordis context', () => {
  function createTestContext(appVersion = '1.0.0') {
    const ctx = new Context()

    const mockHttpFn = vi.fn()
    const mockHttp = Object.assign(mockHttpFn, {
      get: vi.fn(),
      post: vi.fn(),
      download: vi.fn().mockResolvedValue({ bytes: 1024 }),
      cookies: {} as any,
    }) as unknown as HttpService

    const mockDevice = {
      platform: 'linux',
      formFactor: 'desktop',
      appVersion,
      locale: 'en',
      network: vi.fn(),
      onNetworkChange: vi.fn(),
      battery: vi.fn(),
      onMediaKey: vi.fn(),
      registerHotkey: vi.fn(),
    }

    const mockPaths: PathsService = {
      appData: 'file:///appData' as any,
      cache: 'file:///cache' as any,
      temp: 'file:///temp' as any,
      logs: 'file:///logs' as any,
      downloads: 'file:///downloads' as any,
      pluginData: (id) => `file:///appData/${id}` as any,
      get: (k) => `file:///${k}` as any,
    }

    const mockFs: FsService = {
      join: (...parts: string[]) => parts.join('/') as any,
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as FsService

    ctx.provide('http', mockHttp)
    ctx.provide('device', mockDevice as any)
    ctx.provide('paths', mockPaths)
    ctx.provide('fs', mockFs)

    return { ctx, mockHttp, mockHttpFn, mockFs }
  }

  it('initializes and manages status and channel', async () => {
    const { ctx } = createTestContext()
    await ctx.plugin(apply)

    expect(ctx.updater.status).toBe('idle')
    expect(ctx.updater.config.channel).toBe('main')

    ctx.updater.setChannel('dev')
    expect(ctx.updater.config.channel).toBe('dev')
  })

  it('checks updates on main channel selecting latest patch of eligible series', async () => {
    const { ctx, mockHttpFn } = createTestContext('1.0.0')

    const mockReleases = [
      {
        id: 1,
        tag_name: 'v1.1.0',
        prerelease: false,
        published_at: '2026-02-01T00:00:00Z',
        html_url: 'https://github.com/BBeBee/BBeBee/releases/tag/v1.1.0',
        assets: [
          {
            name: 'bbebee-desktop-bundle.zip',
            browser_download_url: 'https://example.com/bundle.zip',
            size: 2048,
            content_type: 'application/zip',
          },
          {
            name: 'bbebee.deb',
            browser_download_url: 'https://example.com/bbebee.deb',
            size: 40000000,
            content_type: 'application/octet-stream',
          },
        ],
      },
      {
        id: 2,
        tag_name: 'v1.1.2',
        prerelease: false,
        published_at: '2026-02-15T00:00:00Z',
        html_url: 'https://github.com/BBeBee/BBeBee/releases/tag/v1.1.2',
        assets: [
          {
            name: 'bbebee-desktop-bundle.zip',
            browser_download_url: 'https://example.com/bundle-1.1.2.zip',
            size: 2048,
            content_type: 'application/zip',
          },
        ],
      },
    ]

    mockHttpFn.mockResolvedValue({
      status: 200,
      headers: {},
      url: 'https://api.github.com/repos/BBeBee/BBeBee/releases',
      json: async () => mockReleases,
    })

    await ctx.plugin(apply)

    const availableEvent = vi.fn()
    ctx.on('updater/available', availableEvent)

    const checkResult = await ctx.updater.checkUpdate({ channel: 'main' })

    expect(checkResult.hasUpdate).toBe(true)
    // Must select latest patch version 1.1.2 over 1.1.0
    expect(checkResult.latestRelease?.version).toBe('v1.1.2')
    expect(checkResult.updateType).toBe('hot')
    expect(availableEvent).toHaveBeenCalledWith(checkResult)
  })

  it('downloads an update asset and applies hot update', async () => {
    const { ctx, mockFs } = createTestContext('1.0.0')
    await ctx.plugin(apply)

    const release: UpdateRelease = {
      version: '1.1.0',
      parsedVersion: parseVersion('1.1.0')!,
      channel: 'main',
      publishedAt: '2026-01-01T00:00:00Z',
      htmlUrl: 'https://github.com/test/rel',
      assets: [
        {
          name: 'hotupdate.zip',
          browserDownloadUrl: 'https://example.com/hotupdate.zip',
          size: 1024,
          contentType: 'application/zip',
          kind: 'hot-update',
          platform: 'desktop',
        },
      ],
      isPrerelease: false,
      hotUpdate: {
        name: 'hotupdate.zip',
        browserDownloadUrl: 'https://example.com/hotupdate.zip',
        size: 1024,
        contentType: 'application/zip',
        kind: 'hot-update',
        platform: 'desktop',
      },
    }

    const onProgress = vi.fn()
    const targetUri = await ctx.updater.downloadUpdate(release, 'hot', onProgress)

    expect(targetUri).toBeDefined()
    expect(onProgress).toHaveBeenCalled()
    expect(ctx.updater.status).toBe('ready')

    const appliedEvent = vi.fn()
    ctx.on('updater/hot-update-applied', appliedEvent)

    const applied = await ctx.updater.applyHotUpdate(targetUri!)
    expect(applied).toBe(true)
    expect(mockFs.writeFile).toHaveBeenCalled()
    expect(appliedEvent).toHaveBeenCalled()
  })
})
