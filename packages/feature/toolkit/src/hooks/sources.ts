/**
 * Source-name resolution shared by every view that shows a "来源" column.
 *
 * A track's URN knows which source imported it, but a row shows the source's
 * *display* name, and the read goes through the `sources` service with
 * deliberate tolerance for the shapes older service versions expose. Written
 * once here so two view packages cannot grow two different spellings of
 * "本地" (docs/08 §4: if two view packages would write the same `if`, it
 * belongs here).
 *
 * No feature package is imported — the service is reached through
 * `serviceOf`, and an absent sources service degrades to the parsed source id
 * or the local name, never a throw.
 */

import type { Context } from 'cordis'
import type { SourcesService } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { serviceOf } from './react.js'

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
