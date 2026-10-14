/**
 * Live integration test against Subsonic server.
 *
 * Verifies that the compiled B_Be_Bee-subsonic source runs end-to-end inside
 * plugin-sources and plugin-source-runtime:
 * - URL normalization strips /index.view
 * - Authentication succeeds with loginCheckJs validation
 * - Recommend returns default playlist ('默认歌单') first, then randomized directory playlists
 * - Tracks in root playlist and directory playlists are fetched via ruleTrackList
 * - Search finds songs
 * - Stream URL is resolved with fresh MD5 auth token and streams audio
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@BBeBee/core-http-node'
import jsPlugin from '@BBeBee/core-js-quickjs-node'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import runtimePlugin from './index.js'

const TEST_HOST = 'http://192.168.1.100:4040/subsonic/index.view'
const SUBSONIC_INDEX_JSON_PATH = resolve('/home/revers/project/B_Be_Bee-subsonic/index.json')

async function isServerLive(): Promise<boolean> {
  try {
    const res = await fetch(
      'http://192.168.1.100:4040/subsonic/rest/ping.view?u=admin&p=admin&v=1.16.1&c=BBeBee&f=json',
      { signal: AbortSignal.timeout(2000) },
    )
    return res.ok
  } catch {
    return false
  }
}

describe('Subsonic live integration', () => {
  it('connects, authenticates, recommends playlists, browses tracks, searches, and resolves streams', async () => {
    const live = await isServerLive()
    if (!live || !existsSync(SUBSONIC_INDEX_JSON_PATH)) {
      console.log('Skipping Subsonic live integration test: server or source not available')
      return
    }

    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-subsonic-live') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(httpPlugin, {})
    await ctx.plugin(jsPlugin)
    await ctx.plugin(SecretsNode)
    await ctx.plugin(sourcesPlugin, {})
    await tick()
    await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
    await ctx.plugin(runtimePlugin, {})
    await tick()

    // 1. Import Subsonic document
    const docContent = readFileSync(SUBSONIC_INDEX_JSON_PATH, 'utf-8')
    const report = await ctx.sources.import(docContent)
    expect(report.added.length + report.updated.length + report.unchanged.length).toBeGreaterThan(0)
    const entry = report.added[0] ?? report.updated[0] ?? report.unchanged[0]!
    const record = 'record' in entry ? entry.record : entry
    const sourceId = record.id
    expect(sourceId).toBeDefined()

    // 2. Test Connection with /index.view URL (verifies URL normalization)
    const connCheckValid = await ctx.sources.testConnection(sourceId, {
      host: TEST_HOST,
      user: 'admin',
      password: 'admin',
    })
    expect(connCheckValid.status).toBe('ok')

    // Test connection with wrong credentials fails (verifies loginCheckJs)
    const connCheckInvalid = await ctx.sources.testConnection(sourceId, {
      host: TEST_HOST,
      user: 'admin',
      password: 'wrong-password',
    })
    expect(connCheckInvalid.status).toBe('auth_failed')

    // 2b. Before configuring credentials, calling recommend fails with session invalid
    await expect(ctx.sources.recommend(sourceId)).rejects.toThrow(/no longer valid|404|fetch failed/i)

    // 3. Update source params and verify hot-reload + auth recovery
    await ctx.sources.updateSourceParams(sourceId, {
      sourceUrl: TEST_HOST,
      secrets: {
        user: 'admin',
        password: 'admin',
      },
    })
    await tick()

    const provider = ctx.sources.providers.find((p) => p.sourceId === sourceId)
    expect(provider).toBeDefined()
    expect(provider!.capabilities.recommend).toBe(true)
    expect(provider!.capabilities.search.tracks).toBe(true)
    expect(provider!.auth.status.state).toBe('authenticated')

    // 4. Recommend playlists succeeds after hot reload without manual signIn call
    const recommendResult = await ctx.sources.recommend(sourceId)
    expect(recommendResult.items.length).toBeGreaterThan(1)

    // 4a. First playlist MUST be the default playlist ("默认歌单")
    const firstItem = recommendResult.items[0]!
    expect(firstItem.title).toBe('默认歌单')
    expect(firstItem.kind).toBe('album')

    // 4b. Subsequent playlists must be directory playlists
    const otherItems = recommendResult.items.slice(1)
    expect(otherItems.length).toBeGreaterThan(0)
    const titles = otherItems.map((i) => i.title)
    expect(titles.length).toBeGreaterThan(0)

    // 5. Fetch default playlist tracks
    const defaultAlbum = await ctx.sources.getAlbum(firstItem.urn!)
    expect(defaultAlbum).toBeDefined()
    expect(defaultAlbum!.title).toBe('默认歌单')
    expect(defaultAlbum!.tracks.length).toBe(6)
    const defaultSongTitles = defaultAlbum!.tracks.map((t) => t.title)
    expect(defaultSongTitles).toContain('成都')
    expect(defaultSongTitles).toContain('真的愛妳')

    // 6. Fetch directory playlist tracks
    const dirItem = otherItems[0]!
    const dirAlbum = await ctx.sources.getAlbum(dirItem.urn!)
    expect(dirAlbum).toBeDefined()
    expect(dirAlbum!.tracks.length).toBeGreaterThan(0)

    // 7. Search tracks
    const searchResult = await ctx.sources.searchAll({ text: '真的' })
    expect(searchResult.bySource.length).toBe(1)
    const sourceSearch = searchResult.bySource[0]!
    expect(sourceSearch.error).toBeUndefined()
    expect(sourceSearch.result).toBeDefined()
    const tracks = sourceSearch.result?.tracks?.items ?? []
    expect(tracks.length).toBeGreaterThan(0)
    const foundTrack = tracks.find((t) => t.title.includes('真的'))
    expect(foundTrack).toBeDefined()

    // 8. Resolve stream
    const trackToStream = defaultAlbum!.tracks[0]!
    const trackId = trackToStream.urn.split(':').pop()!
    const stream = await provider!.resolveStream(trackId, {
      quality: 'high',
      saveData: false,
      acceptFormats: ['audio/mpeg', 'audio/flac'],
    })
    expect(stream.kind).toBe('remote')
    expect(stream.target).toContain('/rest/stream.view?')
    expect(stream.target).toContain('u=admin')
    expect(stream.target).toContain('&t=')
    expect(stream.target).toContain('&s=')

    // 8b. Test streaming from server
    const streamHead = await fetch(stream.target, { method: 'HEAD' })
    expect(streamHead.ok).toBe(true)
    expect(streamHead.headers.get('content-type')).toContain('audio')
  })
})
