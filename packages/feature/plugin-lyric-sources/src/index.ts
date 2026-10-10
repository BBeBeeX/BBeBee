import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  HttpRequest,
  HttpService,
  JsService,
  Lyrics,
  LyricSearchQuery,
  LyricSourceDefinition,
  LyricSourcesService,
  LyricSourceTestResult,
  SettingsService,
  StoreService,
} from '@BBeBee/protocol'
import { executeLyricSource } from './sandbox.js'
import { normalizeToLyrics } from './normalizer.js'
import { compareVersions } from '@BBeBee/toolkit'
import { BUILTIN_LYRIC_SOURCES as GENERATED_LYRIC_SOURCES } from './generated/builtin-lyric-sources.generated.js'

export * from './sandbox.js'
export * from './normalizer.js'

export const STORE_LYRIC_SOURCES_KEY = 'lyric-sources.custom-sources'

/**
 * Every bundled lyric source document, compiled from `sources/<dir>/`
 * (source.json + source.js) by `pnpm build:sources`. This file carries no
 * per-platform code — a platform lives in its `sources/` folder.
 */
export const BUILTIN_LYRIC_SOURCES: readonly LyricSourceDefinition[] = GENERATED_LYRIC_SOURCES

function builtinLyricSource(id: string): LyricSourceDefinition {
  const found = BUILTIN_LYRIC_SOURCES.find((s) => s.id === id)
  if (!found) {
    throw new Error(`Builtin lyric source "${id}" is missing from the generated module; run \`pnpm build:sources\``)
  }
  return found
}

/** Built-in open-source LRCLIB provider (see `sources/lrclib/`). */
export const BUILTIN_LRCLIB_SOURCE: LyricSourceDefinition = builtinLyricSource('builtin-lrclib')

export class LyricSourcesPlugin extends Service implements LyricSourcesService {
  static override readonly name = 'lyricSources'

  private readonly ownCtx: Context
  private sources: LyricSourceDefinition[] = [...BUILTIN_LYRIC_SOURCES]
  private storeService?: StoreService
  private jsService?: JsService
  private httpService?: HttpService
  private settingsService?: SettingsService
  private loaded = false

  constructor(ctx: Context) {
    super(ctx, 'lyricSources')
    this.ownCtx = ctx

    // Optional injection of store
    this.ownCtx.inject(['store'], (scoped: Context) => {
      this.storeService = scoped.store
      void this.loadSourcesFromStore()
      return () => {
        this.storeService = undefined
      }
    })

    // Optional injection of js sandbox — wrap so Cordis proxy does not re-bind to the caller's context
    this.ownCtx.inject(['js'], (scoped: Context) => {
      const boundJs = scoped.js
      this.jsService = boundJs
        ? {
            get engine() {
              return boundJs.engine
            },
            createRealm: (limits) => boundJs.createRealm(limits),
          }
        : undefined
      return () => {
        this.jsService = undefined
      }
    })

    // Optional injection of http — wrap in a plain function so Cordis proxy does not re-bind to the caller's context
    this.ownCtx.inject(['http'], (scoped: Context) => {
      const boundHttp = scoped.http
      this.httpService = boundHttp
        ? (((req: HttpRequest) => boundHttp(req)) as unknown as HttpService)
        : undefined
      return () => {
        this.httpService = undefined
      }
    })

    // Optional injection of settings — carries the third-party master switch.
    // Read at lookup time rather than mirrored, so a toggle takes effect on
    // the next track without this plugin keeping a copy in step.
    this.ownCtx.inject(['settings'], (scoped: Context) => {
      this.settingsService = scoped.settings
      return () => {
        this.settingsService = undefined
      }
    })
  }

  async [Service.init](): Promise<void> {
    await this.loadSourcesFromStore()
  }

  private async loadSourcesFromStore(): Promise<void> {
    if (!this.storeService || this.loaded) return
    try {
      const saved = await this.storeService.get<LyricSourceDefinition[]>(STORE_LYRIC_SOURCES_KEY)
      if (Array.isArray(saved) && saved.length > 0) {
        // Merge or replace: a stored builtin whose version lags the compiled
        // document refreshes to it, keeping the user's enabled/sortOrder.
        // A user-installed newer version from the registry is kept.
        this.sources = saved.map((s) => {
          const builtin = BUILTIN_LYRIC_SOURCES.find((b) => b.id === s.id)
          if (builtin && compareVersions(builtin.version, s.version) > 0) {
            return {
              ...builtin,
              enabled: s.enabled ?? true,
              sortOrder: s.sortOrder ?? 0,
              config: s.config ?? builtin.config,
            }
          }
          return s
        })
        for (const builtin of [...BUILTIN_LYRIC_SOURCES].reverse()) {
          if (!this.sources.some((s) => s.id === builtin.id)) {
            this.sources.unshift(builtin)
          }
        }
      } else {
        this.sources = [...BUILTIN_LYRIC_SOURCES]
      }
      this.loaded = true
      this.emitChanged()
    } catch (e) {
      this.ownCtx.logger.warn(`lyricSources: failed to load from store: ${String(e)}`)
    }
  }

  private async persistSources(): Promise<void> {
    if (this.storeService) {
      try {
        await this.storeService.set(STORE_LYRIC_SOURCES_KEY, this.sources)
      } catch (e) {
        this.ownCtx.logger.warn(`lyricSources: failed to persist to store: ${String(e)}`)
      }
    }
    this.emitChanged()
  }

  private emitChanged(): void {
    const list = this.getSourcesSnapshot()
    this.ownCtx.emit('lyric-sources/changed', list)
  }

  private getSourcesSnapshot(): readonly LyricSourceDefinition[] {
    return [...this.sources].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  getSources(): readonly LyricSourceDefinition[] {
    return this.getSourcesSnapshot()
  }

  getSource(id: string): LyricSourceDefinition | undefined {
    return this.sources.find((s) => s.id === id)
  }

  async registerSource(source: LyricSourceDefinition): Promise<void> {
    if (!source.id || !source.name || !source.script) {
      throw new Error('Lyric source must contain id, name, and script')
    }

    const index = this.sources.findIndex((s) => s.id === source.id)
    if (index >= 0) {
      this.sources[index] = { ...source }
    } else {
      const maxOrder = this.sources.reduce((max, s) => Math.max(max, s.sortOrder), -1)
      this.sources.push({
        ...source,
        sortOrder: source.sortOrder ?? maxOrder + 1,
      })
    }

    await this.persistSources()
    this.ownCtx.logger.info(`lyricSources: registered source "${source.id}" (${source.name})`)
  }

  async removeSource(id: string): Promise<boolean> {
    const prevLen = this.sources.length
    this.sources = this.sources.filter((s) => s.id !== id)
    if (this.sources.length !== prevLen) {
      await this.persistSources()
      this.ownCtx.logger.info(`lyricSources: removed source "${id}"`)
      return true
    }
    return false
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const src = this.sources.find((s) => s.id === id)
    if (src) {
      src.enabled = enabled
      await this.persistSources()
      this.ownCtx.logger.info(`lyricSources: source "${id}" enabled=${enabled}`)
    }
  }

  async updateSourceConfig(id: string, config: Record<string, unknown>): Promise<void> {
    const src = this.sources.find((s) => s.id === id)
    if (!src) {
      throw new Error(`Lyric source "${id}" not found`)
    }
    src.config = { ...config }
    await this.persistSources()
    this.ownCtx.logger.info(`lyricSources: updated config for "${id}"`)
  }

  async reorder(sourceIds: string[]): Promise<void> {
    const orderMap = new Map<string, number>()
    sourceIds.forEach((id, index) => orderMap.set(id, index))

    for (const src of this.sources) {
      if (orderMap.has(src.id)) {
        src.sortOrder = orderMap.get(src.id)!
      }
    }

    this.sources.sort((a, b) => a.sortOrder - b.sortOrder)
    await this.persistSources()
    this.ownCtx.logger.info(`lyricSources: reordered sources (${sourceIds.join(', ')})`)
  }

  async searchLyrics(query: LyricSearchQuery): Promise<Lyrics | undefined> {
    /*
     * The master switch gates only *lookup*, not `testSource`: a user turning
     * lyric sources off wants the player to stop reaching out on its own, but
     * the settings page's test button must keep working so the sources can be
     * verified before (or after) re-enabling them.
     */
    if (this.settingsService?.getSync().thirdPartyLyricSourcesEnabled === false) {
      this.ownCtx.logger.debug('lyricSources: lookup skipped — third-party lyric sources are disabled')
      return undefined
    }

    const enabledSources = this.sources
      .filter((s) => s.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    for (const source of enabledSources) {
      try {
        const raw = await executeLyricSource(source, query, {
          js: this.jsService,
          http: this.httpService,
        })
        const lyrics = normalizeToLyrics(raw)
        if (lyrics && lyrics.content.trim()) {
          this.ownCtx.logger.info(
            `lyricSources: found lyrics for "${query.title}" via source "${source.id}"`,
          )
          return lyrics
        }
      } catch (err) {
        this.ownCtx.logger.debug(
          `lyricSources: source "${source.id}" failed for "${query.title}": ${String(err)}`,
        )
      }
    }

    return undefined
  }

  async testSource(id: string, query: LyricSearchQuery): Promise<LyricSourceTestResult> {
    const source = this.sources.find((s) => s.id === id)
    if (!source) {
      return {
        ok: false,
        durationMs: 0,
        error: `Lyric source "${id}" not found`,
      }
    }

    const start = Date.now()
    try {
      const raw = await executeLyricSource(source, query, {
        js: this.jsService,
        http: this.httpService,
      })
      const durationMs = Date.now() - start
      const lyrics = normalizeToLyrics(raw)

      if (lyrics && lyrics.content.trim()) {
        return {
          ok: true,
          durationMs,
          lyrics,
        }
      }

      const isRawEmpty = raw === null || raw === undefined || raw === ''
      return {
        ok: false,
        durationMs,
        error: isRawEmpty
          ? '未检索到匹配歌词 (该歌词源暂未收录该歌曲或搜索条件未命中)'
          : '歌词源已返回数据，但无法识别为有效歌词格式',
      }
    } catch (err) {
      const durationMs = Date.now() - start
      return {
        ok: false,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

export const name = 'plugin-lyric-sources'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lyric-sources: loaded')
  await ctx.plugin(LyricSourcesPlugin)
}

export default LyricSourcesPlugin

