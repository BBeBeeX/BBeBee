import type { Context } from 'cordis'
import type { SourcesService } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

/**
 * Resolves the display name of a track's source (e.g. '哔哩哔哩', '本地', etc.).
 */
export function resolveTrackSourceName(ctx: Context, urn?: string): string {
  if (!urn) return '-'
  if (
    urn.startsWith('local:') ||
    urn.startsWith('BBeBee:local:') ||
    urn.startsWith('file:') ||
    urn.startsWith('bbebee-file:')
  ) {
    return '本地'
  }
  const parsed = tryParseUrn(urn)
  if (!parsed || !parsed.sourceId || parsed.sourceId === 'local') {
    return '本地'
  }

  const sources = serviceOf<SourcesService>(ctx, 'sources') ?? (ctx as unknown as { sources?: SourcesService }).sources
  if (sources) {
    const record =
      (sources.sources ? sources.sources.find((s) => s.id === parsed.sourceId) : undefined) ??
      (typeof sources.source === 'function' ? sources.source(parsed.sourceId) : undefined) ??
      (typeof (sources as unknown as { get?: (id: string) => { displayName?: string; name?: string } }).get === 'function'
        ? (sources as unknown as { get: (id: string) => { displayName?: string; name?: string } }).get(parsed.sourceId)
        : undefined)

    if (record) {
      return (
        (record as { displayName?: string }).displayName ||
        (record as { name?: string }).name ||
        (record as { doc?: { sourceName?: string } }).doc?.sourceName ||
        parsed.sourceId
      )
    }
  }

  return parsed.sourceId
}
