/**
 * Pure option-mapping tests for the mobile converter workbench — no React, no
 * DOM. The preset patches must stay byte-identical to the desktop
 * `CompressionSection.handlePresetChange`, because both shells feed the same
 * `AudioConvertOptions` into the same queue.
 */

import { describe, expect, it } from 'vitest'
import type { AudioConvertOptions } from '@BBeBee/protocol'
import {
  applyPreset,
  BIT_DEPTH_OPTIONS,
  BITRATE_OPTIONS,
  defaultConvertOptions,
  FORMAT_OPTIONS,
  parseNumberField,
  withOption,
} from './options.js'
import { isAudioExtension, pickFilesCapability, toStagedFiles } from './pick.js'

const BASE: AudioConvertOptions = {
  targetFormat: 'mp3',
  preset: 'balanced',
  bitrateKbps: 192,
  sampleRate: 44100,
  channels: 2,
  vbr: false,
  overwrite: false,
}

describe('converter option mapping', () => {
  it('defaults mirror the desktop workbench initial state', () => {
    expect(defaultConvertOptions('flac')).toMatchObject({
      targetFormat: 'flac',
      preset: 'balanced',
      bitrateKbps: 192,
      sampleRate: 44100,
      channels: 2,
      vbr: false,
    })
  })

  it('high_quality sets 320 kbps stereo 24-bit and disables vbr', () => {
    const next = applyPreset(BASE, 'high_quality', false)
    expect(next.bitrateKbps).toBe(320)
    expect(next.sampleRate).toBe(44100)
    expect(next.channels).toBe(2)
    expect(next.bitDepth).toBe(24)
    expect(next.vbr).toBe(false)
    expect(next.preset).toBe('high_quality')
  })

  it('speech forces mono 22050 Hz 64 kbps vbr', () => {
    const next = applyPreset(BASE, 'speech', false)
    expect(next).toMatchObject({
      bitrateKbps: 64,
      sampleRate: 22050,
      channels: 1,
      vbr: true,
      preset: 'speech',
    })
  })

  it('a lossless target drops the bitrate instead of carrying a meaningless value', () => {
    for (const preset of ['high_quality', 'balanced', 'small_size', 'speech'] as const) {
      const next = applyPreset(BASE, preset, true)
      expect(next.bitrateKbps, `${preset} on lossless`).toBeUndefined()
      expect(next.preset).toBe(preset)
    }
  })

  it('balanced keeps vbr on with 192 kbps', () => {
    const next = applyPreset(BASE, 'balanced', false)
    expect(next.vbr).toBe(true)
    expect(next.bitrateKbps).toBe(192)
  })

  it('small_size halves to 128 kbps with vbr', () => {
    const next = applyPreset(BASE, 'small_size', false)
    expect(next.bitrateKbps).toBe(128)
    expect(next.vbr).toBe(true)
  })

  it('custom only retags the preset, leaving parameters untouched', () => {
    const next = applyPreset(BASE, 'custom', false)
    expect(next.preset).toBe('custom')
    expect(next.bitrateKbps).toBe(BASE.bitrateKbps)
    expect(next.sampleRate).toBe(BASE.sampleRate)
    expect(next.channels).toBe(BASE.channels)
    expect(next.vbr).toBe(BASE.vbr)
  })

  it('any manual chip edit marks the preset custom', () => {
    const next = withOption(BASE, 'bitrateKbps', 256)
    expect(next.bitrateKbps).toBe(256)
    expect(next.preset).toBe('custom')
    expect(BASE.preset, 'the source options are not mutated').toBe('balanced')
  })

  it('parses text fields leniently: blank and NaN unset, numbers survive', () => {
    expect(parseNumberField('')).toBeUndefined()
    expect(parseNumberField('  ')).toBeUndefined()
    expect(parseNumberField('abc')).toBeUndefined()
    expect(parseNumberField('-3.5')).toBe(-3.5)
    expect(parseNumberField(' 12 ')).toBe(12)
  })
})

describe('file picking', () => {
  it('resolves the optional pickFiles capability only when the method exists', () => {
    const withPick = pickFilesCapability({ pickFiles: () => Promise.resolve([]) })
    expect(typeof withPick).toBe('function')
    expect(pickFilesCapability({})).toBeUndefined()
    expect(pickFilesCapability(null)).toBeUndefined()
    expect(pickFilesCapability({ pickFiles: 42 })).toBeUndefined()
  })

  it('maps picked files to staged rows with derived names and formats', () => {
    const staged = toStagedFiles([
      { uri: '/storage/music/Song One.mp3', size: 1024 },
      { uri: 'content://media/track.flac', name: 'track.flac', size: 5 },
    ])
    expect(staged).toHaveLength(2)
    expect(staged[0]).toMatchObject({
      uri: '/storage/music/Song One.mp3',
      name: 'Song One.mp3',
      format: 'MP3',
      size: 1024,
    })
    expect(staged[1]).toMatchObject({ name: 'track.flac', format: 'FLAC' })
    expect(new Set(staged.map((f) => f.id)).size, 'ids are unique').toBe(2)
  })

  it('drops non-audio picks rather than enqueueing a codec rejection', () => {
    const staged = toStagedFiles([
      { uri: '/storage/notes.txt' },
      { uri: '/storage/cover.jpg' },
      { uri: '/storage/music/keep.opus' },
    ])
    expect(staged).toHaveLength(1)
    expect(staged[0]!.format).toBe('OPUS')
  })

  it('knows the audio extension set', () => {
    expect(isAudioExtension('mp3')).toBe(true)
    expect(isAudioExtension('ALAC')).toBe(true)
    expect(isAudioExtension('txt')).toBe(false)
    expect(isAudioExtension('')).toBe(false)
  })
})

describe('option catalogues match the service surface', () => {
  it('exposes the twelve formats the feature validates', () => {
    expect(FORMAT_OPTIONS).toHaveLength(12)
    expect(FORMAT_OPTIONS).toContain('mp3')
    expect(FORMAT_OPTIONS).toContain('alac')
  })

  it('exposes the desktop bitrate, sample-rate and bit-depth ladders', () => {
    expect(BITRATE_OPTIONS).toEqual([64, 96, 128, 192, 256, 320])
    expect(BIT_DEPTH_OPTIONS).toEqual([16, 24, 32])
    expect(BITRATE_OPTIONS).toHaveLength(6)
  })
})
