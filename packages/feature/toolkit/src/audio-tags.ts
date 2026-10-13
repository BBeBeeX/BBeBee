/**
 * Audio metadata tagging and filename sanitization helpers.
 *
 * Provides pure TypeScript, zero-dependency functions to:
 * - Sanitize track titles into filesystem-safe filenames.
 * - Embed ID3v2.3 tags into MP3 files.
 * - Embed Vorbis Comment metadata blocks into FLAC files.
 * - Embed ilst metadata atoms into MP4/M4A files.
 */

export interface AudioTagMetadata {
  title?: string
  artist?: string
  album?: string
  year?: number
  trackNo?: number
  comment?: string
}

/**
 * Sanitize a string for safe usage as a file name across Windows, macOS, and Linux.
 * Removes forbidden characters: \ / : * ? " < > | and control characters.
 * Trims leading/trailing whitespace and periods.
 */
export function sanitizeFileName(name: string): string {
  if (!name) return 'track'
  // Replace illegal filename characters with '_'
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
    // Collapse multiple underscores
    .replace(/_{2,}/g, '_')
    .trim()
    // Windows forbids trailing dots or spaces
    .replace(/[. ]+$/, '')

  return cleaned.length > 0 ? cleaned : 'track'
}

/**
 * Encode string as UTF-16LE with BOM (0xFF, 0xFE).
 * Required by ID3v2.3 text frames for universal compatibility (e.g. Windows Explorer).
 */
function encodeUtf16LeWithBom(text: string): Uint8Array {
  const buf = new Uint8Array(2 + text.length * 2)
  buf[0] = 0xff
  buf[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    buf[2 + i * 2] = code & 0xff
    buf[2 + i * 2 + 1] = (code >> 8) & 0xff
  }
  return buf
}

/** Encode UTF-8 string. */
function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Encode 32-bit integer as 4 synchsafe bytes (MSB 0 in each byte). */
function encodeSynchsafe(size: number): Uint8Array {
  return new Uint8Array([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ])
}

/** Build an ID3v2.3 frame: [4-byte ID][4-byte BE size][2-byte flags][data]. */
function makeId3Frame(id: string, text: string): Uint8Array {
  const utf16 = encodeUtf16LeWithBom(text)
  // Byte 0: encoding flag 0x01 (UTF-16 with BOM)
  const body = new Uint8Array(1 + utf16.length)
  body[0] = 0x01
  body.set(utf16, 1)

  const frame = new Uint8Array(10 + body.length)
  for (let i = 0; i < 4; i++) {
    frame[i] = id.charCodeAt(i)
  }
  // Size (standard 32-bit big-endian integer in ID3v2.3)
  const len = body.length
  frame[4] = (len >> 24) & 0xff
  frame[5] = (len >> 16) & 0xff
  frame[6] = (len >> 8) & 0xff
  frame[7] = len & 0xff
  // Flags: 0x00, 0x00
  frame[8] = 0x00
  frame[9] = 0x00
  frame.set(body, 10)
  return frame
}

/** Build full ID3v2.3 tag buffer. */
export function buildId3v2Tag(metadata: AudioTagMetadata): Uint8Array {
  const frames: Uint8Array[] = []

  if (metadata.title) frames.push(makeId3Frame('TIT2', metadata.title))
  if (metadata.artist) frames.push(makeId3Frame('TPE1', metadata.artist))
  if (metadata.album) frames.push(makeId3Frame('TALB', metadata.album))
  if (metadata.year) frames.push(makeId3Frame('TYER', String(metadata.year)))
  if (metadata.trackNo !== undefined) frames.push(makeId3Frame('TRCK', String(metadata.trackNo)))
  if (metadata.comment) {
    // COMM frame: 1-byte encoding + 3-byte lang ('eng') + short desc BOM + null + text BOM
    const utf16Desc = encodeUtf16LeWithBom('')
    const utf16Text = encodeUtf16LeWithBom(metadata.comment)
    const body = new Uint8Array(1 + 3 + utf16Desc.length + 2 + utf16Text.length)
    body[0] = 0x01 // UTF-16
    body[1] = 0x65 // 'e'
    body[2] = 0x6e // 'n'
    body[3] = 0x67 // 'g'
    body.set(utf16Desc, 4)
    body[4 + utf16Desc.length] = 0x00
    body[4 + utf16Desc.length + 1] = 0x00
    body.set(utf16Text, 4 + utf16Desc.length + 2)

    const frame = new Uint8Array(10 + body.length)
    const id = 'COMM'
    for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i)
    const len = body.length
    frame[4] = (len >> 24) & 0xff
    frame[5] = (len >> 16) & 0xff
    frame[6] = (len >> 8) & 0xff
    frame[7] = len & 0xff
    frame[8] = 0x00
    frame[9] = 0x00
    frame.set(body, 10)
    frames.push(frame)
  }

  const framesTotalSize = frames.reduce((acc, f) => acc + f.length, 0)
  const tagSizeSync = encodeSynchsafe(framesTotalSize)

  const header = new Uint8Array(10)
  header[0] = 0x49 // 'I'
  header[1] = 0x44 // 'D'
  header[2] = 0x33 // '3'
  header[3] = 0x03 // v2.3
  header[4] = 0x00 // revision
  header[5] = 0x00 // flags
  header.set(tagSizeSync, 6)

  const fullTag = new Uint8Array(10 + framesTotalSize)
  fullTag.set(header, 0)
  let offset = 10
  for (const f of frames) {
    fullTag.set(f, offset)
    offset += f.length
  }
  return fullTag
}

/** Embed or replace ID3v2 tag on an MP3 byte stream. */
export function embedMp3Tags(bytes: Uint8Array, metadata: AudioTagMetadata): Uint8Array {
  const newTag = buildId3v2Tag(metadata)
  let audioOffset = 0

  // Check if existing ID3v2 tag is present
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const b6 = bytes[6] ?? 0
    const b7 = bytes[7] ?? 0
    const b8 = bytes[8] ?? 0
    const b9 = bytes[9] ?? 0
    const oldTagSize =
      ((b6 & 0x7f) << 21) |
      ((b7 & 0x7f) << 14) |
      ((b8 & 0x7f) << 7) |
      (b9 & 0x7f)
    audioOffset = 10 + oldTagSize
    if (audioOffset > bytes.length) audioOffset = 0
  }

  const audioData = bytes.subarray(audioOffset)
  const out = new Uint8Array(newTag.length + audioData.length)
  out.set(newTag, 0)
  out.set(audioData, newTag.length)
  return out
}

/** Build Vorbis Comment block body for FLAC. */
function buildVorbisCommentBlock(metadata: AudioTagMetadata): Uint8Array {
  const vendor = encodeUtf8('BBeBee')
  const comments: string[] = []
  if (metadata.title) comments.push(`TITLE=${metadata.title}`)
  if (metadata.artist) comments.push(`ARTIST=${metadata.artist}`)
  if (metadata.album) comments.push(`ALBUM=${metadata.album}`)
  if (metadata.year) comments.push(`DATE=${metadata.year}`)
  if (metadata.trackNo !== undefined) comments.push(`TRACKNUMBER=${metadata.trackNo}`)
  if (metadata.comment) comments.push(`COMMENT=${metadata.comment}`)

  const encodedComments = comments.map(encodeUtf8)
  let totalCommentsLen = 0
  for (const c of encodedComments) {
    totalCommentsLen += 4 + c.length
  }

  const totalLen = 4 + vendor.length + 4 + totalCommentsLen
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)

  let pos = 0
  view.setUint32(pos, vendor.length, true) // vendor length LE
  pos += 4
  buf.set(vendor, pos)
  pos += vendor.length

  view.setUint32(pos, encodedComments.length, true) // user comment list length LE
  pos += 4

  for (const c of encodedComments) {
    view.setUint32(pos, c.length, true)
    pos += 4
    buf.set(c, pos)
    pos += c.length
  }

  return buf
}

/** Embed or replace Vorbis Comment metadata block on a FLAC byte stream. */
export function embedFlacTags(bytes: Uint8Array, metadata: AudioTagMetadata): Uint8Array {
  // Check FLAC magic 'fLaC' (0x66, 0x4C, 0x61, 0x43)
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    return bytes
  }

  const vorbisData = buildVorbisCommentBlock(metadata)
  const newVorbisHeader = new Uint8Array(4)
  newVorbisHeader[0] = 0x04 // block type 4 (VORBIS_COMMENT), isLast = 0
  newVorbisHeader[1] = (vorbisData.length >> 16) & 0xff
  newVorbisHeader[2] = (vorbisData.length >> 8) & 0xff
  newVorbisHeader[3] = vorbisData.length & 0xff

  // Read existing metadata blocks
  interface Block {
    isLast: boolean
    type: number
    header: Uint8Array
    data: Uint8Array
  }
  const blocks: Block[] = []
  let offset = 4

  while (offset < bytes.length) {
    const b0 = bytes[offset] ?? 0
    const isLast = (b0 & 0x80) !== 0
    const type = b0 & 0x7f
    const b1 = bytes[offset + 1] ?? 0
    const b2 = bytes[offset + 2] ?? 0
    const b3 = bytes[offset + 3] ?? 0
    const length = (b1 << 16) | (b2 << 8) | b3
    const header = bytes.subarray(offset, offset + 4)
    const data = bytes.subarray(offset + 4, offset + 4 + length)
    offset += 4 + length
    blocks.push({ isLast, type, header, data })
    if (isLast) break
  }

  const audioFrames = bytes.subarray(offset)

  // Filter out existing VORBIS_COMMENT blocks
  const retained = blocks.filter((b) => b.type !== 4)

  // Insert our new VORBIS_COMMENT block after STREAMINFO (type 0)
  const streamInfoIndex = retained.findIndex((b) => b.type === 0)
  const insertIndex = streamInfoIndex >= 0 ? streamInfoIndex + 1 : 0

  retained.splice(insertIndex, 0, {
    isLast: false,
    type: 4,
    header: newVorbisHeader,
    data: vorbisData,
  })

  // Ensure isLast bit is accurately set on the final block
  for (let i = 0; i < retained.length; i++) {
    const isFinal = i === retained.length - 1
    const block = retained[i]
    if (block) {
      block.isLast = isFinal
      block.header[0] = (isFinal ? 0x80 : 0x00) | (block.type & 0x7f)
    }
  }

  // Calculate new total size
  let totalSize = 4 // 'fLaC'
  for (const b of retained) {
    totalSize += 4 + b.data.length
  }
  totalSize += audioFrames.length

  const out = new Uint8Array(totalSize)
  out.set(bytes.subarray(0, 4), 0) // 'fLaC'
  let outPos = 4
  for (const b of retained) {
    out.set(b.header, outPos)
    outPos += 4
    out.set(b.data, outPos)
    outPos += b.data.length
  }
  out.set(audioFrames, outPos)
  return out
}

/** Helper to build an MP4 ilst data box atom. */
function makeIlstTextAtom(name: string, text: string): Uint8Array {
  const utf8 = encodeUtf8(text)
  const dataAtomLen = 8 + 8 + utf8.length // 8 atom header + 4 type flags + 4 locale + text
  const atomLen = 8 + dataAtomLen

  const buf = new Uint8Array(atomLen)
  const view = new DataView(buf.buffer)

  // Outer atom [atomLen][name]
  view.setUint32(0, atomLen)
  for (let i = 0; i < 4; i++) buf[4 + i] = name.charCodeAt(i)

  // Inner 'data' atom [dataAtomLen]['data'][type=1][locale=0][utf8]
  view.setUint32(8, dataAtomLen)
  buf[12] = 0x64 // 'd'
  buf[13] = 0x61 // 'a'
  buf[14] = 0x74 // 't'
  buf[15] = 0x61 // 'a'
  view.setUint32(16, 1) // type 1 = UTF-8 text
  view.setUint32(20, 0) // locale
  buf.set(utf8, 24)

  return buf
}

/** Helper to build an MP4 ilst track number box atom. */
function makeIlstTrackAtom(trackNo: number): Uint8Array {
  const dataAtomLen = 8 + 8 + 8 // 8 header + 4 type + 4 locale + 8 payload
  const atomLen = 8 + dataAtomLen

  const buf = new Uint8Array(atomLen)
  const view = new DataView(buf.buffer)

  view.setUint32(0, atomLen)
  buf[4] = 0x74 // 't'
  buf[5] = 0x72 // 'r'
  buf[6] = 0x6b // 'k'
  buf[7] = 0x6e // 'n'

  view.setUint32(8, dataAtomLen)
  buf[12] = 0x64
  buf[13] = 0x61
  buf[14] = 0x74
  buf[15] = 0x61
  view.setUint32(16, 0) // type 0 = binary
  view.setUint32(20, 0)

  // 8 bytes: 2 reserved, 2 trackNo, 2 totalTracks, 2 reserved
  view.setUint16(24, 0)
  view.setUint16(26, trackNo)
  view.setUint16(28, 0)
  view.setUint16(30, 0)

  return buf
}

/**
 * Build ilst box buffer.
 */
function buildIlstBox(metadata: AudioTagMetadata): Uint8Array {
  const items: Uint8Array[] = []
  if (metadata.title) items.push(makeIlstTextAtom('\xA9nam', metadata.title))
  if (metadata.artist) items.push(makeIlstTextAtom('\xA9ART', metadata.artist))
  if (metadata.album) items.push(makeIlstTextAtom('\xA9alb', metadata.album))
  if (metadata.year) items.push(makeIlstTextAtom('\xA9day', String(metadata.year)))
  if (metadata.trackNo !== undefined) items.push(makeIlstTrackAtom(metadata.trackNo))
  if (metadata.comment) items.push(makeIlstTextAtom('\xA9cmt', metadata.comment))

  const totalLen = 8 + items.reduce((acc, it) => acc + it.length, 0)
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)
  view.setUint32(0, totalLen)
  buf[4] = 0x69 // 'i'
  buf[5] = 0x6c // 'l'
  buf[6] = 0x73 // 's'
  buf[7] = 0x74 // 't'

  let pos = 8
  for (const it of items) {
    buf.set(it, pos)
    pos += it.length
  }
  return buf
}

/**
 * Embed metadata tags into MP4/M4A byte stream.
 * Injects/replaces ilst box inside moov -> udta -> meta.
 */
export function embedMp4Tags(bytes: Uint8Array, metadata: AudioTagMetadata): Uint8Array {
  // Validate basic MP4 structure
  if (bytes.length < 8) return bytes

  const ilst = buildIlstBox(metadata)

  // Build meta box containing ilst (meta box in MP4 has 4-byte version/flags after header)
  const metaAtomLen = 8 + 4 + ilst.length
  const metaBuf = new Uint8Array(metaAtomLen)
  const metaView = new DataView(metaBuf.buffer)
  metaView.setUint32(0, metaAtomLen)
  metaBuf[4] = 0x6d // 'm'
  metaBuf[5] = 0x65 // 'e'
  metaBuf[6] = 0x74 // 't'
  metaBuf[7] = 0x61 // 'a'
  metaView.setUint32(8, 0) // version = 0, flags = 0
  metaBuf.set(ilst, 12)

  // Build udta box containing meta
  const udtaAtomLen = 8 + metaBuf.length
  const udtaBuf = new Uint8Array(udtaAtomLen)
  const udtaView = new DataView(udtaBuf.buffer)
  udtaView.setUint32(0, udtaAtomLen)
  udtaBuf[4] = 0x75 // 'u'
  udtaBuf[5] = 0x64 // 'd'
  udtaBuf[6] = 0x74 // 't'
  udtaBuf[7] = 0x61 // 'a'
  udtaBuf.set(metaBuf, 8)

  // Find 'moov' atom in top-level atoms
  let moovOffset = -1
  let moovSize = 0
  let offset = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  while (offset + 8 <= bytes.length) {
    const atomSize = view.getUint32(offset)
    const atomName = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    )
    if (atomSize < 8 || offset + atomSize > bytes.length) break
    if (atomName === 'moov') {
      moovOffset = offset
      moovSize = atomSize
      break
    }
    offset += atomSize
  }

  if (moovOffset < 0) return bytes

  // Inside moov, check if udta already exists
  let existingUdtaOffset = -1
  let existingUdtaSize = 0
  let innerOffset = moovOffset + 8
  const moovEnd = moovOffset + moovSize

  while (innerOffset + 8 <= moovEnd) {
    const innerSize = view.getUint32(innerOffset)
    const innerName = String.fromCharCode(
      bytes[innerOffset + 4] ?? 0,
      bytes[innerOffset + 5] ?? 0,
      bytes[innerOffset + 6] ?? 0,
      bytes[innerOffset + 7] ?? 0,
    )
    if (innerSize < 8 || innerOffset + innerSize > moovEnd) break
    if (innerName === 'udta') {
      existingUdtaOffset = innerOffset
      existingUdtaSize = innerSize
      break
    }
    innerOffset += innerSize
  }

  // Construct updated file bytes
  let newMoov: Uint8Array
  if (existingUdtaOffset >= 0) {
    const moovBeforeUdta = bytes.subarray(moovOffset, existingUdtaOffset)
    const moovAfterUdta = bytes.subarray(existingUdtaOffset + existingUdtaSize, moovEnd)
    const newMoovSize = moovBeforeUdta.length + udtaBuf.length + moovAfterUdta.length
    newMoov = new Uint8Array(newMoovSize)
    newMoov.set(moovBeforeUdta, 0)
    newMoov.set(udtaBuf, moovBeforeUdta.length)
    newMoov.set(moovAfterUdta, moovBeforeUdta.length + udtaBuf.length)
    new DataView(newMoov.buffer).setUint32(0, newMoovSize)
  } else {
    // Append udta to moov
    const moovContent = bytes.subarray(moovOffset, moovEnd)
    const newMoovSize = moovContent.length + udtaBuf.length
    newMoov = new Uint8Array(newMoovSize)
    newMoov.set(moovContent, 0)
    newMoov.set(udtaBuf, moovContent.length)
    new DataView(newMoov.buffer).setUint32(0, newMoovSize)
  }

  const beforeMoov = bytes.subarray(0, moovOffset)
  const afterMoov = bytes.subarray(moovEnd)
  const out = new Uint8Array(beforeMoov.length + newMoov.length + afterMoov.length)
  out.set(beforeMoov, 0)
  out.set(newMoov, beforeMoov.length)
  out.set(afterMoov, beforeMoov.length + newMoov.length)
  return out
}

/**
 * Embed audio metadata into an audio file based on container format.
 * Supports 'mp3', 'flac', 'm4a', 'mp4'.
 * Returns modified bytes or original bytes if format is unsupported or modification fails.
 */
export function embedAudioTags(
  bytes: Uint8Array,
  format: string | undefined,
  metadata: AudioTagMetadata,
): Uint8Array {
  if (!format || !bytes || bytes.length === 0) return bytes

  const fmt = format.toLowerCase().trim()
  try {
    if (fmt === 'mp3') {
      return embedMp3Tags(bytes, metadata)
    }
    if (fmt === 'flac') {
      return embedFlacTags(bytes, metadata)
    }
    if (fmt === 'm4a' || fmt === 'mp4') {
      return embedMp4Tags(bytes, metadata)
    }
  } catch {
    // If embedding fails, return untouched original bytes
    return bytes
  }
  return bytes
}
