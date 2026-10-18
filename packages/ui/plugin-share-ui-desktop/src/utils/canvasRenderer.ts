import type {
  ShareAlbumData,
  ShareLyricsData,
  SharePlaylistData,
  ShareTrackData,
} from "@BBeBee/protocol"
import { encodeSteganography } from "@BBeBee/plugin-share/steganography"
import { encodeMetadata } from "@BBeBee/plugin-share/metadata"
import { toBbebeeFileUri } from "@BBeBee/ui-kit-desktop"
import { BBEBEE_LOGO_DATA_URL } from "../assets/logo.js"

export type BackgroundMode = "cover" | "gradient" | "black"

export interface RenderTrackCardOptions {
  track: ShareTrackData
  themeColor: string
  backgroundMode: BackgroundMode
  renderArtwork?: string
}

export interface RenderPlaylistCardOptions {
  playlist: SharePlaylistData & { subtitle?: string }
  themeColor: string
  backgroundMode: BackgroundMode
  renderArtwork?: string
}

export interface RenderAlbumCardOptions {
  album: ShareAlbumData & { subtitle?: string }
  themeColor: string
  backgroundMode: BackgroundMode
  renderArtwork?: string
}

export interface RenderLyricsCardOptions {
  lyrics: ShareLyricsData
  themeColor: string
  backgroundMode: BackgroundMode
  renderArtwork?: string
  cardOnly?: boolean
}

/** Helper to safely load an image URL with CORS and fallback */
/** Helper to safely load an image URL with CORS and fallback */
export async function loadImage(src: string): Promise<HTMLImageElement | null> {
  // Normalizes to the bbebee-file: scheme and maps it to the webview-loadable
  // serving URL for the current platform. On Windows the raw custom scheme is
  // not fetchable (WebView2 rejects it at the renderer CORS layer), so the
  // host rewrites it to http://bbebee-file.localhost.
  const normalized = toBbebeeFileUri(src) ?? src
  // Local artwork, whichever serving form the platform uses.
  const isLocalArtwork =
    normalized.startsWith('bbebee-file:') ||
    normalized.startsWith('http://bbebee-file.localhost/')

  // For data: and blob: URLs, load directly without CORS
  if (normalized.startsWith("data:") || normalized.startsWith("blob:")) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = normalized
    })
  }

  // For local artwork URLs, fetch as Blob to get a same-origin Blob URL
  // This completely eliminates CORS issues and canvas tainting on desktop
  if (isLocalArtwork) {
    try {
      if (typeof fetch === "function") {
        const res = await fetch(normalized)
        if (res.ok) {
          const blob = await res.blob()
          const blobUrl = URL.createObjectURL(blob)
          return new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => {
              URL.revokeObjectURL(blobUrl)
              resolve(null)
            }
            img.src = blobUrl
          })
        }
      }
    } catch {
      // Fall through to regular loading
    }
  }

  // Standard remote or local image loading with CORS anonymous, with fallbacks
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.referrerPolicy = "no-referrer"
    img.onload = () => resolve(img)
    img.onerror = () => {
      // If direct image load failed, try fetching as blob
      if (typeof fetch === "function" && (normalized.startsWith("http://") || normalized.startsWith("https://"))) {
        fetch(normalized, { referrerPolicy: "no-referrer" })
          .then((res) => {
            if (!res.ok) throw new Error("Fetch failed")
            return res.blob()
          })
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob)
            const blobImg = new Image()
            blobImg.onload = () => resolve(blobImg)
            blobImg.onerror = () => {
              URL.revokeObjectURL(blobUrl)
              resolve(null)
            }
            blobImg.src = blobUrl
          })
          .catch(() => {
            // Last resort: load without crossOrigin
            const fallback = new Image()
            fallback.referrerPolicy = "no-referrer"
            fallback.onload = () => resolve(fallback)
            fallback.onerror = () => resolve(null)
            fallback.src = normalized
          })
      } else {
        const fallback = new Image()
        fallback.referrerPolicy = "no-referrer"
        fallback.onload = () => resolve(fallback)
        fallback.onerror = () => resolve(null)
        fallback.src = normalized
      }
    }
    img.src = normalized
  })
}

/** Draws a rounded rectangle path on 2D context */
export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Draws an image inside a destination rect with center-crop object-fit cover (no aspect ratio distortion) */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgW = img.naturalWidth || img.width
  const imgH = img.naturalHeight || img.height
  if (!imgW || !imgH) return

  const targetRatio = w / h
  const sourceRatio = imgW / imgH

  let sx = 0
  let sy = 0
  let sw = imgW
  let sh = imgH

  if (sourceRatio > targetRatio) {
    sw = Math.round(imgH * targetRatio)
    sx = Math.round((imgW - sw) / 2)
  } else if (sourceRatio < targetRatio) {
    sh = Math.round(imgW / targetRatio)
    sy = Math.round((imgH - sh) / 2)
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/**
 * Wraps text into up to maxLines (default 3), truncating the last line with ellipsis if needed.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 3,
): string[] {
  if (!text) return []
  const clean = text.trim()
  if (!clean) return []

  if (ctx.measureText(clean).width <= maxWidth) {
    return [clean]
  }

  const lines: string[] = []
  let remaining = clean

  while (remaining.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      if (ctx.measureText(remaining).width <= maxWidth) {
        lines.push(remaining)
        break
      }
      let truncated = remaining
      while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxWidth) {
        truncated = truncated.slice(0, -1)
      }
      lines.push(truncated + "…")
      break
    }

    let low = 1
    let high = remaining.length
    let bestFit = 1

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const sub = remaining.slice(0, mid)
      if (ctx.measureText(sub).width <= maxWidth) {
        bestFit = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    let breakIndex = bestFit
    if (breakIndex < remaining.length) {
      const lastSpace = remaining.slice(0, breakIndex).lastIndexOf(" ")
      if (lastSpace > 0 && lastSpace > breakIndex - 12) {
        breakIndex = lastSpace
      }
    }

    const line = remaining.slice(0, breakIndex).trim()
    if (line) {
      lines.push(line)
    }
    remaining = remaining.slice(breakIndex).trimStart()
  }

  return lines
}

/**
 * Renders the background according to backgroundMode.
 * In gradient mode, the gradient transitions to black at half of the share content height.
 */
function renderBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  themeColor: string,
  mode: BackgroundMode,
  contentMidY = 480,
) {
  if (mode === "black") {
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, width, height)
  } else if (mode === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, contentMidY)
    grad.addColorStop(0, themeColor)
    grad.addColorStop(0.35, themeColor)
    grad.addColorStop(1, "#000000")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, contentMidY)
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, contentMidY, width, height - contentMidY)
  } else {
    // Solid cover theme color
    ctx.fillStyle = themeColor
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Draws the track card layout directly onto any provided HTMLCanvasElement.
 */
export async function drawTrackCard(
  canvas: HTMLCanvasElement,
  options: RenderTrackCardOptions,
): Promise<void> {
  const { track, themeColor, backgroundMode } = options
  const width = 540
  const height = 960
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return

  const cardW = 440
  const artW = 392
  const artH = 392
  const textW = artW

  // Measure wrapped title & artist up to 3 lines
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const titleLines = wrapText(ctx, track.title, textW, 3)
  const titleLineH = 34
  const titleTotalH = Math.max(1, titleLines.length) * titleLineH

  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistLines = wrapText(ctx, track.artist, textW, 3)
  const artistLineH = 26
  const artistTotalH = Math.max(1, artistLines.length) * artistLineH

  // Logo: larger and more prominent, tight vertical spacing
  const logoW = 110
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  const logoH = logoImg ? Math.round((logoW / logoImg.width) * logoImg.height) : 24

  const gapCoverTitle = 16
  const gapTitleArtist = 8
  const gapAboveLogo = 10
  const gapBelowLogo = 18

  // Calculate natural height: tight padding around logo
  const naturalCardH = 24 + artH + gapCoverTitle + titleTotalH + gapTitleArtist + artistTotalH + gapAboveLogo + logoH + gapBelowLogo
  const cardH = naturalCardH
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  // 1. Draw overall background
  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // 2. Draw card container: pure black container with drop shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  // 3. Draw Cover inside card (1:1 center-cropped without distortion/stretching)
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const artworkSrc = options.renderArtwork || track.artwork
  const coverImg = artworkSrc ? await loadImage(artworkSrc) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    drawImageCover(ctx, coverImg, artX, artY, artW, artH)
  } else {
    // Placeholder
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♪", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // 4. Song Title (larger font, wraps up to 3 lines)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + gapCoverTitle
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, textX, titleY + idx * titleLineH)
  })

  // 5. Artist (larger font, wraps up to 3 lines)
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistY = titleY + titleTotalH + gapTitleArtist
  artistLines.forEach((line, idx) => {
    ctx.fillText(line, textX, artistY + idx * artistLineH)
  })
  ctx.restore()

  // 6. Logo: directly below artist with compact gap
  if (logoImg) {
    const logoX = textX
    const logoY = artistY + artistTotalH + gapAboveLogo
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }
}

/**
 * Draws the playlist card layout directly onto any provided HTMLCanvasElement.
 */
export async function drawPlaylistCard(
  canvas: HTMLCanvasElement,
  options: RenderPlaylistCardOptions,
): Promise<void> {
  const { playlist, themeColor, backgroundMode } = options
  const width = 540
  const height = 960
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return

  const cardW = 440
  const artW = 392
  const artH = 392
  const textW = artW

  // Measure wrapped title & subtitle up to 3 lines
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const titleLines = wrapText(ctx, playlist.name, textW, 3)
  const titleLineH = 34
  const titleTotalH = Math.max(1, titleLines.length) * titleLineH

  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const subtitle = playlist.subtitle || (playlist.trackCount > 0 ? `Playlist • ${playlist.trackCount} songs` : "Playlist")
  const subtitleLines = wrapText(ctx, subtitle, textW, 3)
  const subtitleLineH = 26
  const subtitleTotalH = Math.max(1, subtitleLines.length) * subtitleLineH

  // Logo: larger and more prominent, tight vertical spacing
  const logoW = 110
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  const logoH = logoImg ? Math.round((logoW / logoImg.width) * logoImg.height) : 24

  const gapCoverTitle = 16
  const gapTitleArtist = 8
  const gapAboveLogo = 10
  const gapBelowLogo = 18

  // Calculate natural height: tight padding around logo
  const naturalCardH = 24 + artH + gapCoverTitle + titleTotalH + gapTitleArtist + subtitleTotalH + gapAboveLogo + logoH + gapBelowLogo
  const cardH = naturalCardH
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  // 1. Draw overall background
  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // 2. Draw card container: pure black container with drop shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  // 3. Draw Cover inside card (1:1 center-cropped without distortion/stretching)
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const artworkSrc = options.renderArtwork || playlist.artwork
  const coverImg = artworkSrc ? await loadImage(artworkSrc) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    drawImageCover(ctx, coverImg, artX, artY, artW, artH)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♫", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // 4. Playlist Name (larger font, wraps up to 3 lines)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + gapCoverTitle
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, textX, titleY + idx * titleLineH)
  })

  // 5. Subtitle (larger font, wraps up to 3 lines)
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const subtitleY = titleY + titleTotalH + gapTitleArtist
  subtitleLines.forEach((line, idx) => {
    ctx.fillText(line, textX, subtitleY + idx * subtitleLineH)
  })
  ctx.restore()

  // 6. Logo: directly below subtitle with compact gap
  if (logoImg) {
    const logoX = textX
    const logoY = subtitleY + subtitleTotalH + gapAboveLogo
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }
}

/**
 * Draws the album card layout directly onto any provided HTMLCanvasElement.
 */
export async function drawAlbumCard(
  canvas: HTMLCanvasElement,
  options: RenderAlbumCardOptions,
): Promise<void> {
  const { album, themeColor, backgroundMode } = options
  const width = 540
  const height = 960
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return

  const cardW = 440
  const artW = 392
  const artH = 392
  const textW = artW

  // Measure wrapped title & subtitle up to 3 lines
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const titleLines = wrapText(ctx, album.title, textW, 3)
  const titleLineH = 34
  const titleTotalH = Math.max(1, titleLines.length) * titleLineH

  let subtitle = album.subtitle
  if (!subtitle) {
    const subtitleParts = ["Album"]
    if (album.artist) subtitleParts.push(album.artist)
    if (album.trackCount > 0) subtitleParts.push(`${album.trackCount} songs`)
    if (album.year) subtitleParts.push(String(album.year))
    subtitle = subtitleParts.join(" • ")
  }

  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const subtitleLines = wrapText(ctx, subtitle, textW, 3)
  const subtitleLineH = 26
  const subtitleTotalH = Math.max(1, subtitleLines.length) * subtitleLineH

  // Logo: larger and more prominent, tight vertical spacing
  const logoW = 110
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  const logoH = logoImg ? Math.round((logoW / logoImg.width) * logoImg.height) : 24

  const gapCoverTitle = 16
  const gapTitleArtist = 8
  const gapAboveLogo = 10
  const gapBelowLogo = 18

  // Calculate natural height: tight padding around logo
  const naturalCardH = 24 + artH + gapCoverTitle + titleTotalH + gapTitleArtist + subtitleTotalH + gapAboveLogo + logoH + gapBelowLogo
  const cardH = naturalCardH
  const cardX = (width - cardW) / 2
  const cardY = Math.round((height - cardH) / 2)
  const cardRadius = 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  // 1. Draw overall background
  renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

  // 2. Draw card container: pure black container with drop shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000000"
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fill()
  ctx.restore()

  // 3. Draw Cover inside card (1:1 center-cropped without distortion/stretching)
  const artX = cardX + (cardW - artW) / 2
  const artY = cardY + 24
  const artRadius = 16

  const artworkSrc = options.renderArtwork || album.artwork
  const coverImg = artworkSrc ? await loadImage(artworkSrc) : null
  ctx.save()
  drawRoundRect(ctx, artX, artY, artW, artH, artRadius)
  ctx.clip()
  if (coverImg) {
    drawImageCover(ctx, coverImg, artX, artY, artW, artH)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(artX, artY, artW, artH)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 64px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("💿", artX + artW / 2, artY + artH / 2)
  }
  ctx.restore()

  // 4. Album Title (larger font, wraps up to 3 lines)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const textX = artX
  const titleY = artY + artH + gapCoverTitle
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, textX, titleY + idx * titleLineH)
  })

  // 5. Subtitle (larger font, wraps up to 3 lines)
  ctx.fillStyle = "#B3B9C9"
  ctx.font = "500 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const subtitleY = titleY + titleTotalH + gapTitleArtist
  subtitleLines.forEach((line, idx) => {
    ctx.fillText(line, textX, subtitleY + idx * subtitleLineH)
  })
  ctx.restore()

  // 6. Logo: directly below subtitle with compact gap
  if (logoImg) {
    const logoX = textX
    const logoY = subtitleY + subtitleTotalH + gapAboveLogo
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }
}

/**
 * Draws the lyrics card layout directly onto any provided HTMLCanvasElement.
 */
export async function drawLyricsCard(
  canvas: HTMLCanvasElement,
  options: RenderLyricsCardOptions,
): Promise<void> {
  const { lyrics, themeColor, backgroundMode, cardOnly = false } = options

  const cardW = 440
  const miniCoverSize = 52
  const miniRadius = 10
  const maxMetaW = cardW - 44 - miniCoverSize - 14

  const measureCtx = canvas.getContext("2d", { willReadFrequently: true })
  if (!measureCtx) return

  // Wrap title & artist (up to 3 lines each)
  measureCtx.font = "bold 19px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const titleLines = wrapText(measureCtx, lyrics.title, maxMetaW, 3)
  const titleLineH = 25
  const titleTotalH = Math.max(1, titleLines.length) * titleLineH

  measureCtx.font = "500 15px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistLines = wrapText(measureCtx, lyrics.artist, maxMetaW, 3)
  const artistLineH = 21
  const artistTotalH = Math.max(1, artistLines.length) * artistLineH

  const headerTextH = titleTotalH + 4 + artistTotalH
  const headerH = Math.max(miniCoverSize, headerTextH)

  // Measure lyric lines (wrap each line up to 3 lines)
  measureCtx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const lyricLineH = 34
  const lyricMaxW = cardW - 44
  const linesToRender = lyrics.lines.slice(0, 6)
  const wrappedParagraphs = linesToRender.map((line) => wrapText(measureCtx, line, lyricMaxW, 3))
  const totalLyricLineCount = wrappedParagraphs.reduce((acc, lines) => acc + lines.length, 0)
  const paragraphSpacing = 10
  const totalLyricsH = totalLyricLineCount * lyricLineH + Math.max(0, wrappedParagraphs.length - 1) * paragraphSpacing

  // Logo: larger and more prominent, tight vertical spacing
  const logoW = 105
  const logoImg = await loadImage(BBEBEE_LOGO_DATA_URL)
  const logoH = logoImg ? Math.round((logoW / logoImg.width) * logoImg.height) : 24

  const gapHeaderLyrics = 16
  const gapAboveLogo = 10
  const gapBelowLogo = 18

  // Calculate natural height for lyrics card: tight padding around logo
  const naturalCardH = 22 + headerH + gapHeaderLyrics + totalLyricsH + gapAboveLogo + logoH + gapBelowLogo
  const cardH = naturalCardH

  const width = cardOnly ? cardW : 540
  const height = cardOnly ? cardH : 960
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return

  const cardX = cardOnly ? 0 : (width - cardW) / 2
  const cardY = cardOnly ? 0 : Math.round((height - cardH) / 2)
  const cardRadius = cardOnly ? 20 : 24
  const contentMidY = Math.round(cardY + cardH * 0.5)

  if (!cardOnly) {
    // 1. Draw overall background
    renderBackground(ctx, width, height, themeColor, backgroundMode, contentMidY)

    // 2. Draw Floating Card with bright cover theme color
    ctx.save()
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)"
    ctx.shadowBlur = 40
    ctx.shadowOffsetY = 16
    ctx.fillStyle = themeColor
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
    ctx.fill()
    ctx.restore()
  } else {
    // 2. Draw Pure Card with bright cover theme color
    ctx.save()
    ctx.fillStyle = themeColor
    drawRoundRect(ctx, 0, 0, cardW, cardH, cardRadius)
    ctx.fill()
    ctx.restore()
  }

  // 3. Top Section: Mini cover + Title + Artist
  const miniX = cardX + 22
  const miniY = cardY + 22

  const artworkSrc = options.renderArtwork || lyrics.artwork
  const coverImg = artworkSrc ? await loadImage(artworkSrc) : null
  ctx.save()
  drawRoundRect(ctx, miniX, miniY, miniCoverSize, miniCoverSize, miniRadius)
  ctx.clip()
  if (coverImg) {
    drawImageCover(ctx, coverImg, miniX, miniY, miniCoverSize, miniCoverSize)
  } else {
    ctx.fillStyle = "#1e2230"
    ctx.fillRect(miniX, miniY, miniCoverSize, miniCoverSize)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.font = "bold 20px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♪", miniX + miniCoverSize / 2, miniY + miniCoverSize / 2)
  }
  ctx.restore()

  // Title next to mini cover (crisp white)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 19px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const metaX = miniX + miniCoverSize + 14
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, metaX, miniY + idx * titleLineH)
  })

  // Artist (high contrast bright text)
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)"
  ctx.font = "500 15px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  const artistY = miniY + titleTotalH + 4
  artistLines.forEach((line, idx) => {
    ctx.fillText(line, metaX, artistY + idx * artistLineH)
  })
  ctx.restore()

  // 4. Middle Section: Lyric Lines (Bold white text)
  ctx.save()
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const lyricStartX = cardX + 22
  const lyricStartY = miniY + headerH + gapHeaderLyrics

  let currentY = lyricStartY
  wrappedParagraphs.forEach((paraLines) => {
    paraLines.forEach((line) => {
      ctx.fillText(line, lyricStartX, currentY)
      currentY += lyricLineH
    })
    currentY += paragraphSpacing
  })
  ctx.restore()

  // 5. Bottom Section: BBeBee Logo (directly below lyrics with compact gap)
  if (logoImg) {
    const logoX = cardX + 22
    const logoY = lyricStartY + totalLyricsH + gapAboveLogo
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  }
}

/**
 * Generates an HTMLCanvasElement with the rendered track share card
 * and embeds the Base64 metadata steganographically into its pixels.
 */
export async function generateTrackCardCanvas(
  options: RenderTrackCardOptions,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas")
  await drawTrackCard(canvas, options)

  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    const b64Payload = encodeMetadata("track", options.track)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`Failed to embed steganographic data: ${String(err)}`, { cause: err })
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered playlist share card.
 */
export async function generatePlaylistCardCanvas(
  options: RenderPlaylistCardOptions,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas")
  await drawPlaylistCard(canvas, options)

  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    const b64Payload = encodeMetadata("playlist", options.playlist)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`Failed to embed steganographic data: ${String(err)}`, { cause: err })
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered album share card.
 */
export async function generateAlbumCardCanvas(
  options: RenderAlbumCardOptions,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas")
  await drawAlbumCard(canvas, options)

  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    const b64Payload = encodeMetadata("album", options.album)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`Failed to embed steganographic data: ${String(err)}`, { cause: err })
  }

  return canvas
}

/**
 * Generates an HTMLCanvasElement with the rendered lyric share card (Matching reference image 2)
 * and embeds the metadata steganographically into its pixels.
 */
export async function generateLyricsCardCanvas(
  options: RenderLyricsCardOptions,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas")
  await drawLyricsCard(canvas, options)

  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    const b64Payload = encodeMetadata("lyrics", options.lyrics)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const encoded = encodeSteganography(imgData, b64Payload)
    imgData.data.set(encoded.data)
    ctx.putImageData(imgData, 0, 0)
  } catch (err) {
    throw new Error(`Failed to embed steganographic data: ${String(err)}`, { cause: err })
  }

  return canvas
}

/**
 * Downloads a canvas as a PNG file.
 */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  const dataUrl = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename.endsWith(".png") ? filename : filename + ".png"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
