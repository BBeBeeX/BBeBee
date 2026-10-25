/**
 * `ctx.codec` on iOS and Android.
 *
 * ## Why this extends the desktop implementation rather than duplicating it
 *
 * docs/11 §4.1 sketches this package as "`AudioDecoder` plus a native tag
 * reader". Half of that is right and half of it is not, and the difference is
 * worth stating because the file looks surprisingly short.
 *
 * Tag reading in `core-codec-node` is `music-metadata` over `ctx.fs` — no
 * `node:fs`, no Node API, nothing platform-shaped anywhere in it. Its own
 * header says so: "pure JavaScript … the same implementation works in the
 * desktop webview and in the sidecar host". A *native* tag reader here would add a
 * native module to every mobile build in order to produce a second answer to a
 * question that already has one, and the risk register's second-loudest entry
 * is two implementations of one service drifting apart. So the tag half is
 * inherited, and the bounded head read — the property that decides whether a
 * 5,000 file scan takes minutes or an afternoon — is inherited with it.
 *
 * What genuinely differs is the two things that are actually about the device:
 *
 * - **`supportedFormats()`**, which is the OS decoder's answer and differs by
 *   OS version. It is configured by the shell, which knows its engine.
 * - **`decode()`**, which is `react-native-audio-api`'s `decodeAudioData`
 *   rather than the renderer's — the one place a platform SDK is genuinely
 *   required.
 *
 * ⚠️ `music-metadata` on Hermes needs more than the runtime's UTF-8-only
 * `TextDecoder`: a Latin-1 ID3v2.3 tag written by a 2004 ripper, and the
 * codec's GBK recovery, both need legacy encodings. The mobile shell
 * installs the full WHATWG `text-encoding` implementation at boot, before
 * anything reads a tag (see `apps/mobile/src/boot.ts`); without that
 * install, GBK recovery is skipped and old Latin-1 titles mangle (docs/11 §8).
 *
 * See docs/04 §13 and docs/11 §4.1.
 */

import { decodeAudioData } from 'react-native-audio-api'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DecodedAudio, Uri } from '@BBeBee/protocol'
import { CodecNode, type CodecNodeConfig } from '@bbebee/core-codec-node'

export interface CodecRnConfig extends CodecNodeConfig {
  /**
   * Formats the device can decode.
   *
   * ⚠️ Not a guess. iOS decodes ALAC and refuses Vorbis; Android's list moves
   * with the OS version and the vendor. The shell configures this from what it
   * knows about its engine, and the scanner *reports* what it could not
   * decode rather than skipping it silently (docs/04 §13).
   */
  supportedFormats?: string[]
}

/**
 * What both mobile platforms decode without an extra codec.
 *
 * The intersection, deliberately: reporting a format one platform lacks means
 * a track that imports and then will not play, which is the worse of the two
 * errors. `ogg`/`vorbis` is absent because iOS has never shipped it.
 */
const MOBILE_FORMATS = ['mp3', 'flac', 'm4a', 'aac', 'wav', 'aiff']

export class CodecRn extends CodecNode {
  constructor(ctx: Context, config: CodecRnConfig = {}) {
    super(ctx, { supportedFormats: config.supportedFormats ?? MOBILE_FORMATS })
  }

  /**
   * Decode to PCM through the audio engine.
   *
   * Desktop refuses this outright and sends callers to `ctx.audio`, because
   * the renderer's `decodeAudioData` is right there. Mobile has the same
   * decoder behind an import rather than behind a graph, so answering here
   * costs nothing and saves every caller a platform branch.
   */
  override async decode(data: Uint8Array | Uri): Promise<DecodedAudio> {
    const bytes =
      typeof data === 'string'
        ? await this.ctx.fs.readBytes(data)
        : data

    // A copy, because `decodeAudioData` takes ownership of the buffer it is
    // given and a `Uint8Array` view onto a larger allocation would hand it
    // more than it was offered.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    const decoded = await decodeAudioData(buffer)
    const channels: Float32Array[] = []
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(decoded.getChannelData(channel))
    }
    return {
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      pcm: channels,
    }
  }
}

export const name = 'core-codec-rn'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.codec` is usable.
 */
export async function apply(ctx: Context, config: CodecRnConfig = {}) {
  ctx.logger.info('core-codec-rn: loaded')
  const fiber = await ctx.plugin(CodecRn, config)
  return () => void fiber.dispose()
}

export default { name, apply }
