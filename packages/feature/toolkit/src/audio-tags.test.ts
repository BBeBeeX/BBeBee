import { describe, expect, it } from 'vitest'
import {
  detectAudioFormat,
  detectImageDimensions,
  embedAudioTags,
  embedMp3Tags,
  sanitizeFileName,
  type AudioTagMetadata,
} from './audio-tags.js'

describe('sanitizeFileName', () => {
  it('replaces forbidden filesystem characters with underscore', () => {
    expect(sanitizeFileName('AC/DC - Back in Black')).toBe('AC_DC - Back in Black')
    expect(sanitizeFileName('What? "Yes" <No> | * :')).toBe('What_ _Yes_ _No_ _ _ _')
    expect(sanitizeFileName('Track: Subtitle')).toBe('Track_ Subtitle')
  })

  it('trims whitespace and trailing periods', () => {
    expect(sanitizeFileName('   Song Title ...  ')).toBe('Song Title')
    expect(sanitizeFileName('...')).toBe('track')
    expect(sanitizeFileName('')).toBe('track')
  })

  it('keeps normal unicode and Chinese characters intact', () => {
    expect(sanitizeFileName('周杰伦 - 晴天')).toBe('周杰伦 - 晴天')
    expect(sanitizeFileName('YOASOBI - 夜に駆ける')).toBe('YOASOBI - 夜に駆ける')
  })
})

describe('embedAudioTags', () => {
  const meta: AudioTagMetadata = {
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    year: 2003,
    trackNo: 3,
    comment: 'BBeBee',
  }

  describe('MP3 (ID3v2.3)', () => {
    it('prepends an ID3v2.3 tag to a raw MP3 stream', () => {
      // Mock dummy MP3 audio payload
      const mockMp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00])
      const tagged = embedAudioTags(mockMp3, 'mp3', meta)

      expect(tagged.length).toBeGreaterThan(mockMp3.length)
      // Check ID3 header magic
      expect(tagged[0]).toBe(0x49) // 'I'
      expect(tagged[1]).toBe(0x44) // 'D'
      expect(tagged[2]).toBe(0x33) // '3'
      expect(tagged[3]).toBe(0x03) // version 2.3
      expect(tagged[4]).toBe(0x00) // revision 0

      // Read tag size
      const b6 = tagged[6] ?? 0
      const b7 = tagged[7] ?? 0
      const b8 = tagged[8] ?? 0
      const b9 = tagged[9] ?? 0
      const tagSize =
        ((b6 & 0x7f) << 21) |
        ((b7 & 0x7f) << 14) |
        ((b8 & 0x7f) << 7) |
        (b9 & 0x7f)
      expect(tagSize).toBeGreaterThan(0)

      // Audio data follows tag
      const audioEnd = tagged.subarray(10 + tagSize)
      expect(audioEnd).toEqual(mockMp3)
    })

    it('replaces an existing ID3v2 tag cleanly without duplicating headers', () => {
      const mockMp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00])
      const tagged1 = embedMp3Tags(mockMp3, { title: 'Old Title' })
      const tagged2 = embedMp3Tags(tagged1, meta)

      expect(tagged2[0]).toBe(0x49)
      expect(tagged2[1]).toBe(0x44)
      expect(tagged2[2]).toBe(0x33)

      const b6 = tagged2[6] ?? 0
      const b7 = tagged2[7] ?? 0
      const b8 = tagged2[8] ?? 0
      const b9 = tagged2[9] ?? 0
      const tagSize =
        ((b6 & 0x7f) << 21) |
        ((b7 & 0x7f) << 14) |
        ((b8 & 0x7f) << 7) |
        (b9 & 0x7f)
      const audioEnd = tagged2.subarray(10 + tagSize)
      expect(audioEnd).toEqual(mockMp3)
    })
  })

  describe('FLAC (Vorbis Comment)', () => {
    it('inserts a Vorbis Comment block into a mock FLAC stream', () => {
      // Mock FLAC: 'fLaC' + STREAMINFO block (34 bytes, isLast=1) + mock frames
      const streamInfoData = new Uint8Array(34)
      const mockFlac = new Uint8Array(4 + 4 + 34 + 10)
      mockFlac.set([0x66, 0x4c, 0x61, 0x43], 0) // 'fLaC'
      mockFlac[4] = 0x80 // isLast = 1, type = 0 (STREAMINFO)
      mockFlac[5] = 0x00
      mockFlac[6] = 0x00
      mockFlac[7] = 34 // length 34
      mockFlac.set(streamInfoData, 8)
      mockFlac.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 42) // audio frames

      const tagged = embedAudioTags(mockFlac, 'flac', meta)
      expect(tagged[0]).toBe(0x66)
      expect(tagged[1]).toBe(0x4c)
      expect(tagged[2]).toBe(0x61)
      expect(tagged[3]).toBe(0x43)

      // STREAMINFO should now have isLast = 0
      expect((tagged[4] ?? 0) & 0x80).toBe(0)
      expect((tagged[4] ?? 0) & 0x7f).toBe(0)

      // Second block is VORBIS_COMMENT (type 4) and isLast = 1
      const block2Header = tagged.subarray(42, 46)
      expect((block2Header[0] ?? 0) & 0x7f).toBe(4) // VORBIS_COMMENT
      expect((block2Header[0] ?? 0) & 0x80).toBe(0x80) // isLast = 1

      // Vorbis comments should contain ARTIST, PERFORMER, and ALBUMARTIST
      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('TITLE=晴天')
      expect(asString).toContain('ARTIST=周杰伦')
      expect(asString).toContain('PERFORMER=周杰伦')
      expect(asString).toContain('ALBUMARTIST=周杰伦')
      expect(asString).toContain('DATE=2003')
      expect(asString).toContain('YEAR=2003')
      expect(asString).toContain('TRACKNUMBER=3')
    })

    it('strips prepended ID3v2 tag on FLAC and outputs clean FLAC', () => {
      // Construct ID3v2 header of 10 bytes + 10 bytes payload
      const id3Header = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 10])
      const id3Payload = new Uint8Array(10)
      // Followed by valid FLAC
      const mockFlac = new Uint8Array(4 + 4 + 34 + 10)
      mockFlac.set([0x66, 0x4c, 0x61, 0x43], 0)
      mockFlac[4] = 0x80
      mockFlac[7] = 34

      const combined = new Uint8Array(id3Header.length + id3Payload.length + mockFlac.length)
      combined.set(id3Header, 0)
      combined.set(id3Payload, id3Header.length)
      combined.set(mockFlac, id3Header.length + id3Payload.length)

      // detectAudioFormat should identify as flac
      expect(detectAudioFormat(combined)).toBe('flac')

      const tagged = embedAudioTags(combined, 'flac', meta)
      // Must start with 'fLaC', NOT 'ID3'
      expect(tagged[0]).toBe(0x66)
      expect(tagged[1]).toBe(0x4c)
      expect(tagged[2]).toBe(0x61)
      expect(tagged[3]).toBe(0x43)

      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('PERFORMER=周杰伦')
    })
  })

  describe('MP4 / M4A (ilst)', () => {
    it('injects udta/meta/ilst into mock moov atom', () => {
      // Mock MP4: ftyp (16 bytes) + moov (16 bytes) + mdat (16 bytes)
      const ftyp = new Uint8Array(16)
      new DataView(ftyp.buffer).setUint32(0, 16)
      ftyp.set([0x66, 0x74, 0x79, 0x70], 4) // 'ftyp'

      const moov = new Uint8Array(16)
      new DataView(moov.buffer).setUint32(0, 16)
      moov.set([0x6d, 0x6f, 0x6f, 0x76], 4) // 'moov'

      const mdat = new Uint8Array(16)
      new DataView(mdat.buffer).setUint32(0, 16)
      mdat.set([0x6d, 0x64, 0x61, 0x74], 4) // 'mdat'

      const mockMp4 = new Uint8Array(ftyp.length + moov.length + mdat.length)
      mockMp4.set(ftyp, 0)
      mockMp4.set(moov, ftyp.length)
      mockMp4.set(mdat, ftyp.length + moov.length)

      const tagged = embedAudioTags(mockMp4, 'm4a', meta)
      expect(tagged.length).toBeGreaterThan(mockMp4.length)

      // Check that moov atom size increased
      const view = new DataView(tagged.buffer)
      const moovSize = view.getUint32(ftyp.length)
      expect(moovSize).toBeGreaterThan(16)
    })

    it('embeds picture into mock moov atom when provided', () => {
      const ftyp = new Uint8Array(16)
      new DataView(ftyp.buffer).setUint32(0, 16)
      ftyp.set([0x66, 0x74, 0x79, 0x70], 4)
      const moov = new Uint8Array(16)
      new DataView(moov.buffer).setUint32(0, 16)
      moov.set([0x6d, 0x6f, 0x6f, 0x76], 4)
      const mockMp4 = new Uint8Array(ftyp.length + moov.length)
      mockMp4.set(ftyp, 0)
      mockMp4.set(moov, ftyp.length)

      const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
      const tagged = embedAudioTags(mockMp4, 'm4a', {
        ...meta,
        picture: { data: fakeImage, mimeType: 'image/jpeg' },
      })
      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('covr')
    })
  })

  describe('Picture embedding across formats', () => {
    it('embeds APIC frame in MP3', () => {
      const mockMp3 = new Uint8Array(200)
      const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
      const tagged = embedAudioTags(mockMp3, 'mp3', {
        ...meta,
        picture: { data: fakeImage, mimeType: 'image/jpeg' },
      })
      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('APIC')
    })

    it('embeds PICTURE block (type 6) in FLAC with genuine non-zero dimensions', () => {
      const mockFlac = new Uint8Array(100)
      mockFlac[0] = 0x66
      mockFlac[1] = 0x4c
      mockFlac[2] = 0x61
      mockFlac[3] = 0x43
      mockFlac[4] = 0x80 // STREAMINFO isLast = 1
      mockFlac[7] = 34

      // Mock a valid 100x200 PNG
      const pngHeader = new Uint8Array(33)
      pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) // PNG signature
      // IHDR length 13
      new DataView(pngHeader.buffer).setUint32(8, 13)
      pngHeader.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
      new DataView(pngHeader.buffer).setUint32(16, 100) // width = 100
      new DataView(pngHeader.buffer).setUint32(20, 200) // height = 200
      pngHeader[24] = 8 // bit depth
      pngHeader[25] = 2 // RGB color type

      const tagged = embedAudioTags(mockFlac, 'flac', {
        ...meta,
        picture: { data: pngHeader, mimeType: 'image/png' },
      })
      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('image/png')

      // Locate PICTURE block (type 6) in tagged bytes
      let offset = 4
      let picBlockOffset = -1
      while (offset < tagged.length) {
        const b0 = tagged[offset]!
        const isLast = (b0 & 0x80) !== 0
        const type = b0 & 0x7f
        const length = (tagged[offset + 1]! << 16) | (tagged[offset + 2]! << 8) | tagged[offset + 3]!
        if (type === 6) {
          picBlockOffset = offset + 4
          break
        }
        offset += 4 + length
        if (isLast) break
      }

      expect(picBlockOffset).toBeGreaterThan(0)
      const picView = new DataView(tagged.buffer, picBlockOffset)
      const picType = picView.getUint32(0) // type 3 (Cover front)
      expect(picType).toBe(3)
      const mimeLen = picView.getUint32(4)
      const width = picView.getUint32(4 + 4 + mimeLen + 4)
      const height = picView.getUint32(4 + 4 + mimeLen + 4 + 4)
      expect(width).toBe(100)
      expect(height).toBe(200)
    })
  })

  describe('detectAudioFormat', () => {
    it('detects native FLAC and ID3-prefixed FLAC', () => {
      expect(detectAudioFormat(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2]))).toBe('flac')

      const id3Header = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 4])
      const id3Payload = new Uint8Array([0, 0, 0, 0])
      const flacBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43])
      const combined = new Uint8Array(id3Header.length + id3Payload.length + flacBytes.length)
      combined.set(id3Header, 0)
      combined.set(id3Payload, id3Header.length)
      combined.set(flacBytes, id3Header.length + id3Payload.length)

      expect(detectAudioFormat(combined)).toBe('flac')
    })

    it('detects MP3, M4A, OGG, and WAV', () => {
      expect(detectAudioFormat(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3')
      expect(detectAudioFormat(new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]))).toBe('mp3')
      expect(detectAudioFormat(new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]))).toBe('m4a')
      expect(detectAudioFormat(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBe('ogg')
      expect(
        detectAudioFormat(
          new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
        ),
      ).toBe('wav')
    })
  })

  describe('detectImageDimensions', () => {
    it('detects PNG dimensions', () => {
      const png = new Uint8Array(26)
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
      new DataView(png.buffer).setUint32(8, 13)
      png.set([0x49, 0x48, 0x44, 0x52], 12)
      new DataView(png.buffer).setUint32(16, 500)
      new DataView(png.buffer).setUint32(20, 400)
      const dims = detectImageDimensions(png)
      expect(dims.width).toBe(500)
      expect(dims.height).toBe(400)
    })

    it('falls back to safe dimensions when image is invalid', () => {
      const dims = detectImageDimensions(new Uint8Array([1, 2, 3]))
      expect(dims.width).toBe(600)
      expect(dims.height).toBe(600)
      expect(dims.depth).toBe(24)
    })
  })

  it('returns original bytes when format is unrecognized', () => {
    const raw = new Uint8Array([1, 2, 3, 4])
    expect(embedAudioTags(raw, 'unknown', meta)).toBe(raw)
  })
})
