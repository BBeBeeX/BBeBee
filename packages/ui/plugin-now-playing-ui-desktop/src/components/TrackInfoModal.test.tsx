// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { TrackInfoModal } from './TrackInfoModal.js'

afterEach(() => {
  cleanup()
})

class DbStub extends Service {
  public data: Record<string, any> = {}

  constructor(ctx: Context) {
    super(ctx, 'db')
  }

  async get(query: string, _params: any[]) {
    if (query.includes('media_bindings')) {
      return this.data['binding']
    }
    if (query.includes('scan_entries')) {
      return this.data['scan']
    }
    return undefined
  }
}

class CodecStub extends Service {
  public meta: any = null

  constructor(ctx: Context) {
    super(ctx, 'codec')
  }

  async readMetadata(_uri: string) {
    return this.meta
  }
}

class PlayerStub extends Service {
  public currentStream: any = null
  public state: any = { durationMs: 180000 }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }
}

class FsStub extends Service {
  public statData: Record<string, any> = {}

  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  async stat(uri: string) {
    return this.statData[uri]
  }
}

class AudioStub extends Service {
  public activeEngineName: 'wasapi' | 'webaudio' | 'mpv' = 'wasapi'
  public sampleRate = 96000
  public hardwareBitDepth = 24
  public hardwareChannels = 2
  public currentDeviceLabel = 'USB DAC Hi-Res Audio'

  constructor(ctx: Context) {
    super(ctx, 'audio')
  }

  async listOutputDevices() {
    return [{ id: 'default', label: this.currentDeviceLabel, isDefault: true }]
  }
}

const makeArtists = (name: string) => [
  { urn: `BBeBee:local:artist:${name}`, name, role: 'main' as const, ordinal: 0 },
]

describe('TrackInfoModal', () => {
  it('renders nothing when not open or track is null', () => {
    const ctx = new Context()
    const { container, rerender } = render(
      h(TrackInfoModal, { ctx, track: null, open: false, onClose: () => {} }),
    )
    expect(container.firstChild).toBeNull()

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Local Track',
      artists: makeArtists('Local Artist'),
    }
    rerender(h(TrackInfoModal, { ctx, track, open: false, onClose: () => {} }))
    expect(container.firstChild).toBeNull()
  })

  it('renders local file info and audio specifications', async () => {
    const ctx = new Context()
    const db = new DbStub(ctx)
    db.data['binding'] = {
      uri: 'file:///Music/Eagles/Hotel%20California.flac',
      format: 'flac',
      codec: 'FLAC',
      bitrate_kbps: 920,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      size_bytes: 42000000,
    }
    db.data['scan'] = {
      uri: 'file:///Music/Eagles/Hotel%20California.flac',
      size: 42000000,
      mtime: 1700000000000,
    }

    const codec = new CodecStub(ctx)
    codec.meta = {
      tagTypes: ['Vorbis', 'ID3v2.3'],
      sampleRate: 44100,
      channels: 2,
      bitrateKbps: 920,
      codec: 'FLAC',
    }
    new PlayerStub(ctx)

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Hotel California',
      artists: makeArtists('Eagles'),
      albumTitle: 'Hotel California',
      durationMs: 391000,
    }

    const { getByText, getAllByText, findByText, queryByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('播放内容详情')).toBeTruthy()
    expect(getAllByText('Hotel California').length).toBe(2)
    expect(getByText('Eagles')).toBeTruthy()
    expect(getByText('本地音乐文件')).toBeTruthy()
    expect(getByText('Hotel California.flac')).toBeTruthy()
    expect(getByText('/Music/Eagles/Hotel California.flac')).toBeTruthy()
    expect(getByText('42 MB')).toBeTruthy()
    expect(getByText('6:31')).toBeTruthy()
    expect(getAllByText('44,100 Hz').length).toBeGreaterThanOrEqual(1)
    expect(getAllByText('2 (立体声 Stereo)').length).toBeGreaterThanOrEqual(1)
    expect(getByText('920 kbps')).toBeTruthy()
    expect(getByText('FLAC')).toBeTruthy()
    expect(getByText('Vorbis, ID3v2.3')).toBeTruthy()

    // Third party fields should not be present
    expect(queryByText('第三方源 ID')).toBeNull()
  })

  it('renders third-party source details', async () => {
    const ctx = new Context()
    const player = new PlayerStub(ctx)
    player.currentStream = {
      format: 'm4a',
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 320,
    }

    const track: Track = {
      urn: 'BBeBee:bilibili:track:BV1xx411c7mD',
      title: 'Bilibili Audio',
      artists: makeArtists('UP Master'),
      durationMs: 125000,
    }

    let closed = false
    const { getByText, getAllByText, findByText, queryByText, getByLabelText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => { closed = true } }),
    )

    expect(await findByText('播放内容详情')).toBeTruthy()
    expect(getByText('Bilibili Audio')).toBeTruthy()
    expect(getByText('UP Master')).toBeTruthy()
    expect(getByText('第三方网络音乐源')).toBeTruthy()
    expect(getByText('第三方源 ID')).toBeTruthy()
    expect(getByText('bilibili')).toBeTruthy()
    expect(getByText('当前歌曲源 ID')).toBeTruthy()
    expect(getByText('BV1xx411c7mD')).toBeTruthy()
    expect(getAllByText('48,000 Hz').length).toBeGreaterThanOrEqual(1)
    expect(getByText('320 kbps')).toBeTruthy()
    expect(getByText('M4A')).toBeTruthy()

    // Local fields should not be present
    expect(queryByText('文件路径')).toBeNull()

    // Test close button
    const closeBtn = getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(closed).toBe(true)
  })

  it('copies file path when clicking copy button', async () => {
    const ctx = new Context()
    const db = new DbStub(ctx)
    db.data['binding'] = {
      uri: 'file:///Music/test.mp3',
    }
    new PlayerStub(ctx)

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Test',
      artists: makeArtists('Artist'),
    }

    const { findByTitle } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    const copyBtn = await findByTitle('复制')
    fireEvent.click(copyBtn)
    expect(writeTextMock).toHaveBeenCalledWith('/Music/test.mp3')
  })

  it('functions correctly without throwing under a scoped context where db/codec are not injected', async () => {
    const root = new Context()
    new PlayerStub(root)
    let scopedCtx!: Context
    await root.plugin({
      name: 'test-scoped-plugin',
      inject: ['player'],
      apply(c) {
        scopedCtx = c
      },
    })

    // Confirm that accessing un-injected property directly throws
    expect(() => (scopedCtx as any).db).toThrow(/cannot get property "db" without inject/)

    const track: Track = {
      urn: 'BBeBee:local:track:scoped-1',
      title: 'Scoped Track',
      artists: makeArtists('Scoped Artist'),
    }

    const { findByText } = render(
      h(TrackInfoModal, { ctx: scopedCtx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('Scoped Track')).toBeTruthy()
    expect(await findByText('播放内容详情')).toBeTruthy()
  })

  it('recovers local file info via stream.target and fs.stat when DB has no binding', async () => {
    const ctx = new Context()
    new DbStub(ctx) // empty DB
    const player = new PlayerStub(ctx)
    player.currentStream = {
      target: 'file:///D:/Music/MySong.flac',
      codec: 'flac',
      sampleRate: 44100,
    }

    const fs = new FsStub(ctx)
    fs.statData['file:///D:/Music/MySong.flac'] = {
      size: 25000000,
      mtime: 1700000000000,
    }

    const track: Track = {
      urn: 'BBeBee:local:track:unbound-1',
      title: 'MySong',
      artists: makeArtists('Unknown Artist'),
      durationMs: 200000,
    }

    const { findByText, getByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('MySong.flac')).toBeTruthy()
    expect(getByText('D:/Music/MySong.flac')).toBeTruthy()
    expect(getByText('25 MB')).toBeTruthy()
    expect(getByText('FLAC')).toBeTruthy()
    expect(getByText('1,000 kbps')).toBeTruthy()
  })

  it('calculates third-party bitrate dynamically and renders WASAPI output specs', async () => {
    const ctx = new Context()
    new AudioStub(ctx) // activeEngineName: wasapi, sampleRate: 96000
    const player = new PlayerStub(ctx)
    player.currentStream = {
      byteLength: 9600000,
      format: 'm4a',
    }

    const track: Track = {
      urn: 'BBeBee:bilibili:track:BV12345678',
      title: 'Bilibili Audio Stream',
      artists: makeArtists('Artist'),
      durationMs: 240000,
    }

    const { findByText, getByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('320 kbps')).toBeTruthy()
    expect(getByText('USB DAC Hi-Res Audio')).toBeTruthy()
    expect(getByText('WASAPI (系统共享混音)')).toBeTruthy()
    expect(getByText('96,000 Hz')).toBeTruthy()
    expect(getByText('24-bit Float')).toBeTruthy()
    expect(getByText('4,608 kbps (未压缩 PCM 带宽)')).toBeTruthy()
  })

  it('corrects abnormal truncated bitrate (< 32 kbps) using physical file calculation', async () => {
    const ctx = new Context()
    const db = new DbStub(ctx)
    db.data['binding'] = {
      uri: 'file:///Music/HiRes.flac',
      format: 'flac',
      bitrate_kbps: 8, // Abnormal artifact from 256KB truncated buffer
      size_bytes: 40000000,
    }
    const codec = new CodecStub(ctx)
    codec.meta = {
      codec: 'FLAC',
      bitrateKbps: 8, // Abnormal artifact
      sampleRate: 96000,
      channels: 2,
    }
    new PlayerStub(ctx)

    const track: Track = {
      urn: 'BBeBee:local:track:hires-1',
      title: 'HiRes Song',
      artists: makeArtists('Artist'),
      durationMs: 240000, // 4 minutes -> (40,000,000 * 8) / 240,000 = 1,333 kbps
    }

    const { findByText, getByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('HiRes Song')).toBeTruthy()
    expect(getByText('1,333 kbps')).toBeTruthy()
  })

  it('displays MPV Hi-Fi output engine label when activeEngine is mpv', async () => {
    const ctx = new Context()
    new DbStub(ctx)
    new CodecStub(ctx)
    new PlayerStub(ctx)
    const audio = new AudioStub(ctx)
    audio.activeEngineName = 'mpv'

    const track: Track = {
      urn: 'BBeBee:local:track:mpv-1',
      title: 'Audiophile Track',
      artists: makeArtists('Artist'),
      durationMs: 180000,
    }

    const { findByText, getByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('Audiophile Track')).toBeTruthy()
    expect(getByText('MPV Hi-Fi (原生崩溃隔离 & WASAPI 直通)')).toBeTruthy()
  })
})


