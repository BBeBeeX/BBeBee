import { describe, expect, it } from 'vitest'
import {
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

    it('embeds PICTURE block (type 6) in FLAC', () => {
      const mockFlac = new Uint8Array(100)
      mockFlac[0] = 0x66
      mockFlac[1] = 0x4c
      mockFlac[2] = 0x61
      mockFlac[3] = 0x43
      mockFlac[4] = 0x80 // STREAMINFO isLast = 1
      mockFlac[7] = 34
      const fakeImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
      const tagged = embedAudioTags(mockFlac, 'flac', {
        ...meta,
        picture: { data: fakeImage, mimeType: 'image/png' },
      })
      // Should have STREAMINFO, VORBIS_COMMENT, and PICTURE
      const asString = new TextDecoder().decode(tagged)
      expect(asString).toContain('image/png')
    })
  })

  it('returns original bytes when format is unrecognized', () => {
    const raw = new Uint8Array([1, 2, 3, 4])
    expect(embedAudioTags(raw, 'wav', meta)).toBe(raw)
  })
})
