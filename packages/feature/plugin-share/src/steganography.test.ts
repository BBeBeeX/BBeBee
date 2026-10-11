import { describe, it, expect } from "vitest"
import { encodeSteganography, decodeSteganography } from "./steganography.js"
import type { PixelBuffer } from "@BBeBee/protocol"

function createTestBuffer(width: number, height: number, initialColor = [128, 64, 32, 255]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = initialColor[0]!
    data[i * 4 + 1] = initialColor[1]!
    data[i * 4 + 2] = initialColor[2]!
    data[i * 4 + 3] = initialColor[3]!
  }
  return { width, height, data }
}

describe("steganography", () => {
  it("encodes and decodes an ASCII payload accurately", () => {
    const buffer = createTestBuffer(100, 100)
    const message = "Hello, BBeBee steganography test!"
    const encoded = encodeSteganography(buffer, message)
    const decoded = decodeSteganography(encoded)

    expect(decoded).toBe(message)
  })

  it("handles unicode characters and emojis in payload", () => {
    const buffer = createTestBuffer(200, 200)
    const message = "Sharing song: Demo Song - Demo Artist 🎵🐝 [BBeBee Music]"
    const encoded = encodeSteganography(buffer, message)
    const decoded = decodeSteganography(encoded)

    expect(decoded).toBe(message)
  })

  it("handles large JSON payloads", () => {
    const buffer = createTestBuffer(300, 300)
    const largeObj = {
      title: "Song Title",
      tracks: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Track number ${i} - test title with details`,
      })),
    }
    const message = JSON.stringify(largeObj)
    const encoded = encodeSteganography(buffer, message)
    const decoded = decodeSteganography(encoded)

    expect(decoded).toBe(message)
    expect(JSON.parse(decoded!)).toEqual(largeObj)
  })

  it("preserves alpha channel completely intact", () => {
    const buffer = createTestBuffer(50, 50, [100, 150, 200, 240])
    const message = "Preserve alpha"
    const encoded = encodeSteganography(buffer, message)

    for (let i = 0; i < 50 * 50; i++) {
      expect(encoded.data[i * 4 + 3]).toBe(240)
    }
  })

  it("throws an error when payload exceeds buffer capacity", () => {
    // 5x5 image = 25 pixels * 3 bits = 75 bits = 9.375 bytes
    // Header alone needs 6 + 1 + 4 = 11 bytes = 88 bits
    const tinyBuffer = createTestBuffer(5, 5)
    expect(() => {
      encodeSteganography(tinyBuffer, "Will not fit")
    }).toThrow(/Image capacity too small/)
  })

  it("returns null when buffer has no BBeBee magic header", () => {
    const plainBuffer = createTestBuffer(100, 100, [50, 50, 50, 255])
    const decoded = decodeSteganography(plainBuffer)
    expect(decoded).toBeNull()
  })

  it("returns null when length is invalid or header is corrupted", () => {
    const buffer = createTestBuffer(100, 100)
    const encoded = encodeSteganography(buffer, "Valid message")
    // Corrupt magic header byte
    encoded.data[0] = 0
    encoded.data[1] = 0
    const decoded = decodeSteganography(encoded)
    expect(decoded).toBeNull()
  })
})
