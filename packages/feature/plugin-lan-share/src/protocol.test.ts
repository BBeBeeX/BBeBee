import { describe, expect, it } from 'vitest'
import {
  decodeAnnounce,
  decodePrepare,
  decodePrepareReply,
  encodeAnnounce,
  encodePrepare,
  encodePrepareReply,
  isId,
  mimeForFileName,
  parseCancelPath,
  parseUploadPath,
  sanitizeFileName,
  uploadPath,
  type PrepareRequest,
} from './protocol.js'

const VALID_ID = 'device-node-a'

describe('announce codec', () => {
  const msg = {
    v: 1,
    app: 'bbebee',
    id: VALID_ID,
    name: 'Living Room',
    platform: 'desktop',
    httpPort: 53318,
    ts: 1_700_000_000_000,
  }

  it('round-trips a well-formed announce', () => {
    expect(decodeAnnounce(encodeAnnounce(msg))).toEqual(msg)
  })

  it('round-trips a leave', () => {
    const decoded = decodeAnnounce(encodeAnnounce({ ...msg, bye: true }))
    expect(decoded?.bye).toBe(true)
    expect(decoded?.id).toBe(VALID_ID)
  })

  it('refuses a foreign app or version', () => {
    expect(decodeAnnounce(encodeAnnounce({ ...msg, app: 'localsend' }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...msg, v: 2 }))).toBeUndefined()
  })

  it('refuses a bad id, an empty name, and a nonsense port', () => {
    expect(decodeAnnounce(encodeAnnounce({ ...msg, id: '../etc/passwd' }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...msg, name: '' }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...msg, httpPort: 0 }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...msg, httpPort: 70_000 }))).toBeUndefined()
  })

  it('drops garbage instead of throwing', () => {
    expect(decodeAnnounce(new TextEncoder().encode('not json at all'))).toBeUndefined()
    expect(decodeAnnounce(new TextEncoder().encode('[1,2,3]'))).toBeUndefined()
  })
})

describe('prepare codec', () => {
  const offer: PrepareRequest = {
    id: 'session-1234',
    sender: { id: VALID_ID, name: 'Sender', platform: 'desktop' },
    files: [{ id: 'file-abcdef', fileName: 'song.mp3', sizeBytes: 1024, mime: 'audio/mpeg' }],
  }

  it('round-trips an offer', () => {
    expect(decodePrepare(encodePrepare(offer))).toEqual(offer)
  })

  it('round-trips replies in both shapes', () => {
    expect(decodePrepareReply(encodePrepareReply({ status: 'accepted', sessionId: 'session-1234' }))).toEqual({
      status: 'accepted',
      sessionId: 'session-1234',
    })
    expect(decodePrepareReply(encodePrepareReply({ status: 'declined' }))).toEqual({ status: 'declined' })
  })

  it('sanitises the file name on parse — traversal arrives as a bare basename', () => {
    const hostile: PrepareRequest = {
      ...offer,
      files: [{ id: 'file-abcdef', fileName: '../../../etc/shadow', sizeBytes: 1 }],
    }
    const decoded = decodePrepare(encodePrepare(hostile))
    // Directory components are dropped entirely, so whatever the sender
    // writes, the name that reaches disk is a single safe basename.
    expect(decoded?.files[0]?.fileName).toBe('shadow')
  })

  it('refuses an offer with a bad session id or empty files', () => {
    expect(decodePrepare(encodePrepare({ ...offer, id: 'x!' }))).toBeUndefined()
    expect(decodePrepare(encodePrepare({ ...offer, files: [] }))).toBeUndefined()
  })
})

describe('path grammar', () => {
  it('parses upload and cancel paths built from ids', () => {
    expect(parseUploadPath(uploadPath('session-1234', 'file-abcdef'))).toEqual({
      sessionId: 'session-1234',
      fileId: 'file-abcdef',
    })
    expect(parseCancelPath('/api/bbebee-lan/v1/cancel/session-1234')).toBe('session-1234')
  })

  it('rejects traversal and non-id segments', () => {
    expect(parseUploadPath('/api/bbebee-lan/v1/upload/../../etc/passwd/x')).toBeUndefined()
    expect(parseUploadPath('/api/bbebee-lan/v1/upload/session-1234/file%2F..%2F..%2Fetc')).toBeUndefined()
    expect(parseCancelPath('/api/bbebee-lan/v1/cancel/..')).toBeUndefined()
  })

  it('uploadPath refuses to build an unsafe path in the first place', () => {
    expect(() => uploadPath('../evil', 'file-abcdef')).toThrow(/invalid id/)
  })
})

describe('file-name safety', () => {
  it('drops directory components', () => {
    expect(sanitizeFileName('a/b/c.mp3')).toBe('c.mp3')
    expect(sanitizeFileName('..\\..\\windows\\system32\\evil.flac')).toBe('evil.flac')
  })

  it('defuses dots and control characters', () => {
    expect(sanitizeFileName('..')).toBe('')
    expect(sanitizeFileName('...hidden')).toBe('hidden')
    expect(sanitizeFileName('tr\u0000icky.ogg')).toBe('tricky.ogg')
  })

  it('keeps ordinary names byte-identical', () => {
    expect(sanitizeFileName(' preference 01 - Last Train (Live) [Remaster].flac ')).toBe(
      'preference 01 - Last Train (Live) [Remaster].flac',
    )
  })
})

describe('mime mapping and ids', () => {
  it('maps the common audio types and falls back to octet-stream', () => {
    expect(mimeForFileName('a.mp3')).toBe('audio/mpeg')
    expect(mimeForFileName('a.flac')).toBe('audio/flac')
    expect(mimeForFileName('a.m4a')).toBe('audio/mp4')
    expect(mimeForFileName('a.WAV')).toBe('audio/wav')
    expect(mimeForFileName('no-extension')).toBe('application/octet-stream')
  })

  it('accepts minted ids only', () => {
    expect(isId('session-1234')).toBe(true)
    expect(isId(randomShape())).toBe(true)
    expect(isId('')).toBe(false)
    expect(isId('../x')).toBe(false)
    expect(isId('a'.repeat(80))).toBe(false)
  })
})

function randomShape(): string {
  // What randomId mints: `id-<base36>-<rand>-<rand>` or a UUID.
  return 'id-lz3k1x9q-ab12cd34'
}
