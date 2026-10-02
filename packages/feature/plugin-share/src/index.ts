/**
 * @BBeBee/plugin-share
 *
 * Share service for third-party music sources, songs, playlists, and lyrics,
 * with Base64 JSON metadata and LSB image steganography.
 */

import type { Context } from "cordis"
import { Share, type ShareConfig } from "./service.js"
import { SHARE_COMMANDS } from "./views.js"

export { Share, type ShareConfig }
export * from "./steganography.js"
export * from "./metadata.js"
export * from "./views.js"
export * from "./hooks.js"

export const name = "plugin-share"

/**
 * Main plugin entry point.
 */
export async function apply(ctx: Context, config: ShareConfig = {}) {
  ctx.logger.info("plugin-share: loaded")
  const fiber = await ctx.plugin(Share, config)

  // Register command and tray when ctx.ui is available
  const uiFiber = ctx.inject(["ui"], (innerCtx) => {
    return innerCtx.effect(function* () {
      yield innerCtx.ui.contribute({
        kind: "command",
        id: SHARE_COMMANDS.openImport,
        title: "读取分享卡片",
        run: () => {
          innerCtx.share?.openImport()
        },
      })
      yield innerCtx.ui.contribute({
        kind: "tray",
        id: "share.import",
        title: "导入分享",
        icon: "share-box",
        order: 40,
        action: () => {
          innerCtx.share?.openImport()
        },
      })
    }, "share-ui-contributions")
  })

  return () => {
    fiber.dispose()
    uiFiber.dispose()
  }
}

export default { name, apply }
