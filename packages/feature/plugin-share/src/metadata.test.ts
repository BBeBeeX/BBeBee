import { describe, it, expect } from "vitest"
import { encodeMetadata, decodeMetadata, toBase64, fromBase64 } from "./metadata.js"
import type { ShareLyricsData, SharePlaylistData, ShareTrackData } from "@BBeBee/protocol"

describe("metadata codec", () => {
  it("encodes and decodes utf-8 base64 strings with unicode and special symbols", () => {
    const text = "Demo Artist - Demo Song 🎶 (BBeBee 2026! @#$%)"
    const b64 = toBase64(text)
    const back = fromBase64(b64)
    expect(back).toBe(text)
  })

  it("encodes and decodes track metadata envelope", () => {
    const track: ShareTrackData = {
      urn: "source:netease:song:123456",
      title: "Demo Song",
      artist: "Demo Artist",
      albumTitle: "Demo Album",
      artwork: "https://example.com/cover.jpg",
      duration: 258000,
      source: "netease",
    }

    const b64 = encodeMetadata("track", track)
    expect(typeof b64).toBe("string")

    const decoded = decodeMetadata(b64)
    expect(decoded).not.toBeNull()
    expect(decoded?.app).toBe("BBeBee")
    expect(decoded?.version).toBe(1)
    expect(decoded?.type).toBe("track")
    expect(decoded?.data).toEqual(track)
  })

  it("encodes and decodes lyrics metadata envelope", () => {
    const lyrics: ShareLyricsData = {
      trackUrn: "source:local:track:1",
      title: "Demo Song",
      artist: "Demo Artist",
      lines: [
        "Life has its setbacks, glad that letting go brings gain",
        "What was given with a true heart will be worth it",
        "Yet it cannot pause, leaving only all the joy",
      ],
    }

    const b64 = encodeMetadata("lyrics", lyrics)
    const decoded = decodeMetadata(b64)

    expect(decoded).not.toBeNull()
    expect(decoded?.type).toBe("lyrics")
    expect(decoded?.data).toEqual(lyrics)
  })

  it("encodes and decodes album metadata envelope", () => {
    const album = {
      urn: "source:netease:album:7788",
      title: "Demo Album",
      artist: "Demo Artist",
      year: 2013,
      trackCount: 1,
      tracks: [
        {
          urn: "source:netease:song:123456",
          title: "Demo Song",
          artist: "Demo Artist",
          albumTitle: "Demo Album",
          duration: 258000,
        },
      ],
    }

    const b64 = encodeMetadata("album", album)
    const decoded = decodeMetadata(b64)

    expect(decoded).not.toBeNull()
    expect(decoded?.type).toBe("album")
    expect(decoded?.data).toEqual(album)
  })

  it("returns null for malformed base64 or invalid json", () => {
    expect(decodeMetadata("invalid-base-64!!")).toBeNull()
    expect(decodeMetadata(toBase64("not a json"))).toBeNull()
    expect(decodeMetadata(toBase64(JSON.stringify({ some: "other" })))).toBeNull()
    expect(
      decodeMetadata(
        toBase64(JSON.stringify({ app: "OtherApp", version: 1, type: "track", data: {} }))
      )
    ).toBeNull()
  })
})
