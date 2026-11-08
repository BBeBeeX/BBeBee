import { describe, expect, it } from 'vitest'
import {
  artworkPath,
  decodeAnnounce,
  decodeCommand,
  decodeJoinReply,
  decodeLeave,
  decodeSnapshot,
  encodeAnnounce,
  encodeCommand,
  encodeLeave,
  encodeSnapshot,
  isId,
  parseArtworkPath,
  parseRange,
  parseStreamPath,
  randomToken,
  statePath,
  streamPath,
} from './protocol.js'

const snapshot = {
  v: 1 as const,
  leaderId: 'leader-1234',
  leaderName: 'Leader',
  platform: 'linux',
  version: 7,
  serverTimeMs: 1_000,
  status: 'playing' as const,
  positionMs: 42_000,
  durationMs: 200_000,
  track: { urn: 'BBeBee:local:track:abc', title: 'Song', artist: 'Artist', durationMs: 200_000 },
  stream: { mode: 'serve' as const, path: '/api/bbebee-lan-sync/v1/stream/tokentokentok', byteLength: 1234 },
  queue: [{ urn: 'BBeBee:local:track:next', title: 'Next' }],
  repeat: 'off' as const,
  shuffle: false,
}

describe('announce', () => {
  it('round-trips a valid announce', () => {
    const msg = { v: 1, app: 'bbebee-sync', id: 'device-1234', name: 'Desk', platform: 'linux', httpPort: 53318, ts: 5 }
    expect(decodeAnnounce(encodeAnnounce(msg))).toEqual(msg)
  })

  it('refuses the transfer feature announce by app id', () => {
    const foreign = { v: 1, app: 'bbebee', id: 'device-1234', name: 'Desk', platform: 'linux', httpPort: 53318, ts: 5 }
    expect(decodeAnnounce(encodeAnnounce(foreign))).toBeUndefined()
  })

  it('refuses wrong version, bad ids, bad ports', () => {
    const base = { app: 'bbebee-sync', id: 'device-1234', name: 'Desk', platform: 'linux', httpPort: 53318, ts: 5 }
    expect(decodeAnnounce(encodeAnnounce({ ...base, v: 2 }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...base, v: 1, id: '../etc' }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...base, v: 1, httpPort: 0 }))).toBeUndefined()
    expect(decodeAnnounce(encodeAnnounce({ ...base, v: 1, name: '' }))).toBeUndefined()
    expect(decodeAnnounce(new TextEncoder().encode('not json'))).toBeUndefined()
  })

  it('accepts a bye with only the id', () => {
    const bye = { v: 1, app: 'bbebee-sync', id: 'device-1234', name: '', platform: '', httpPort: 0, ts: 5, bye: true }
    expect(decodeAnnounce(encodeAnnounce(bye))?.bye).toBe(true)
  })
})

describe('paths', () => {
  it('builds and parses stream paths', () => {
    const token = 'abc123def456'
    expect(parseStreamPath(streamPath(token))).toBe(token)
    expect(parseStreamPath('/api/bbebee-lan-sync/v1/stream/../../etc')).toBeUndefined()
    expect(parseStreamPath('/api/bbebee-lan-sync/v1/other/abc123def456')).toBeUndefined()
  })

  it('round-trips a urn through the artwork path', () => {
    const urn = 'BBeBee:local:track:abc/def?x=1'
    expect(parseArtworkPath(artworkPath(urn))).toBe(urn)
    expect(parseArtworkPath('/api/bbebee-lan-sync/v1/artwork/')).toBeUndefined()
  })

  it('builds a state path with a since cursor', () => {
    expect(statePath()).toBe('/api/bbebee-lan-sync/v1/state')
    expect(statePath(7)).toBe('/api/bbebee-lan-sync/v1/state?since=7')
    expect(statePath(-3)).toBe('/api/bbebee-lan-sync/v1/state?since=0')
  })
})

describe('snapshot', () => {
  it('round-trips a full snapshot', () => {
    expect(decodeSnapshot(new TextDecoder().decode(encodeSnapshot(snapshot)))).toEqual(snapshot)
  })

  it('refuses malformed snapshots', () => {
    expect(decodeSnapshot('not json')).toBeUndefined()
    expect(decodeSnapshot(JSON.stringify({ ...snapshot, v: 2 }))).toBeUndefined()
    expect(decodeSnapshot(JSON.stringify({ ...snapshot, status: 'dancing' }))).toBeUndefined()
    expect(decodeSnapshot(JSON.stringify({ ...snapshot, version: 'seven' }))).toBeUndefined()
    expect(decodeSnapshot(JSON.stringify({ ...snapshot, leaderId: 'bad id' }))).toBeUndefined()
  })

  it('accepts a minimal idle snapshot', () => {
    const idle = { ...snapshot, status: 'idle' as const, track: undefined, stream: undefined, queue: [] }
    expect(decodeSnapshot(JSON.stringify(idle))?.status).toBe('idle')
  })
})

describe('join / leave / command', () => {
  it('round-trips a join reply with its snapshot', () => {
    const reply = { sessionId: 'sess-12345678', snapshot }
    const raw = new TextEncoder().encode(JSON.stringify(reply))
    expect(decodeJoinReply(raw)).toEqual(reply)
  })

  it('refuses a join reply whose snapshot is malformed', () => {
    const raw = new TextEncoder().encode(JSON.stringify({ sessionId: 'sess-12345678', snapshot: { v: 9 } }))
    expect(decodeJoinReply(raw)).toBeUndefined()
  })

  it('round-trips leave', () => {
    expect(decodeLeave(encodeLeave('sess-12345678'))).toBe('sess-12345678')
    expect(decodeLeave(encodeLeave('bad ../id'))).toBeUndefined()
  })

  it('round-trips commands and refuses unknown actions', () => {
    const cmd = { sessionId: 'sess-12345678', action: 'seek' as const, positionMs: 5_000 }
    expect(decodeCommand(encodeCommand(cmd))).toEqual(cmd)
    expect(decodeCommand(encodeCommand({ sessionId: 'sess-12345678', action: 'play' }))).toEqual({
      sessionId: 'sess-12345678',
      action: 'play',
    })
    expect(decodeCommand(new TextEncoder().encode(JSON.stringify({ sessionId: 'sess-12345678', action: 'eject' })))).toBeUndefined()
    expect(decodeCommand(new TextEncoder().encode(JSON.stringify({ sessionId: 'sess-12345678', action: 'seek', positionMs: -1 })))).toBeUndefined()
  })
})

describe('parseRange', () => {
  it('parses bounded, open-ended, and suffix ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseRange('bytes=990-2000', 1000)).toEqual({ start: 990, end: 999 })
  })

  it('returns undefined for absent, malformed, or unsatisfiable headers', () => {
    expect(parseRange(undefined, 1000)).toBeUndefined()
    expect(parseRange('items=0-9', 1000)).toBeUndefined()
    expect(parseRange('bytes=a-b', 1000)).toBeUndefined()
    expect(parseRange('bytes=-', 1000)).toBeUndefined()
    expect(parseRange('bytes=5-2', 1000)).toBeUndefined()
    // A start past the size yields the unsatisfiable marker the caller turns into a 416.
    expect(parseRange('bytes=2000-', 1000)).toEqual({ start: 1000, end: 999 })
  })

  it('treats a suffix range on an empty file as unsatisfiable', () => {
    expect(parseRange('bytes=-10', 0)).toEqual({ start: 0, end: -1 })
  })
})

describe('ids', () => {
  it('mints ids that pass the path grammar', () => {
    expect(isId(randomToken())).toBe(true)
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/)
  })
})
