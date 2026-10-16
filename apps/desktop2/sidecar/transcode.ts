import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { toNativePath } from './fs-path.js'
import { findFfmpegPath } from './helpers.js'

export interface TranscodeOptions {
  jobId?: string
  inputUri: string
  outputUri: string
  targetFormat: string
  bitrate?: string
  sampleRate?: number
  channels?: number
  bitDepth?: number
  vbr?: boolean
  quality?: number
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
  startTimeSeconds?: number
  endTimeSeconds?: number
}

export interface TranscodeProgress {
  jobId?: string
  progress: number
  currentTimeSeconds: number
}

export class TranscodeManager {
  private activeTranscodes = new Map<string, ChildProcess>()

  cancelTranscode(jobId: string): boolean {
    if (typeof jobId === 'string' && this.activeTranscodes.has(jobId)) {
      const proc = this.activeTranscodes.get(jobId)
      this.activeTranscodes.delete(jobId)
      try {
        proc?.kill('SIGKILL')
      } catch {
        // ignore
      }
      return true
    }
    return false
  }

  async transcode(
    opts: TranscodeOptions,
    onProgress?: (progress: TranscodeProgress) => void,
    addExtraRoot?: (path: string) => void,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const inPath = toNativePath(opts.inputUri)
      const outPath = toNativePath(opts.outputUri)
      const fmt = opts.targetFormat.toLowerCase()
      const ffmpegBin = findFfmpegPath()

      addExtraRoot?.(inPath)
      const inLastSlash = Math.max(inPath.lastIndexOf('/'), inPath.lastIndexOf('\\'))
      if (inLastSlash > 0) {
        addExtraRoot?.(inPath.slice(0, inLastSlash))
      }

      addExtraRoot?.(outPath)
      const outLastSlash = Math.max(outPath.lastIndexOf('/'), outPath.lastIndexOf('\\'))
      if (outLastSlash > 0) {
        const outParent = outPath.slice(0, outLastSlash)
        addExtraRoot?.(outParent)
        try {
          mkdirSync(outParent, { recursive: true })
        } catch {
          // ignore if exists
        }
      }

      const args = ['-y']

      if (typeof opts.startTimeSeconds === 'number' && opts.startTimeSeconds > 0) {
        args.push('-ss', opts.startTimeSeconds.toFixed(3))
      }
      if (typeof opts.endTimeSeconds === 'number' && opts.endTimeSeconds > 0) {
        args.push('-to', opts.endTimeSeconds.toFixed(3))
      }

      args.push('-i', inPath)

      const formatsWithCover = new Set(['mp3', 'flac', 'm4a', 'aac', 'mp4', 'alac', 'aiff', 'wma'])
      if (formatsWithCover.has(fmt)) {
        args.push('-map', '0:a', '-map', '0:v?', '-c:v', 'copy')
        if (fmt === 'mp3' || fmt === 'aiff') {
          args.push('-id3v2_version', '3')
        } else if (fmt === 'm4a' || fmt === 'aac' || fmt === 'mp4' || fmt === 'alac') {
          args.push('-disposition:v', 'attached_pic')
        }
      } else {
        args.push('-map', '0:a', '-vn')
      }
      args.push('-map_metadata', '0')

      const filters: string[] = []
      if (typeof opts.volumeGainDb === 'number' && opts.volumeGainDb !== 0) {
        filters.push(`volume=${opts.volumeGainDb}dB`)
      }
      if (typeof opts.fadeInSeconds === 'number' && opts.fadeInSeconds > 0) {
        filters.push(`afade=t=in:st=0:d=${opts.fadeInSeconds}`)
      }
      if (typeof opts.fadeOutSeconds === 'number' && opts.fadeOutSeconds > 0) {
        if (typeof opts.endTimeSeconds === 'number' && opts.endTimeSeconds > opts.fadeOutSeconds) {
          const startFade = opts.endTimeSeconds - opts.fadeOutSeconds
          filters.push(`afade=t=out:st=${startFade}:d=${opts.fadeOutSeconds}`)
        }
      }
      if (filters.length > 0) {
        args.push('-af', filters.join(','))
      }

      const q = typeof opts.vbrQuality === 'number' ? opts.vbrQuality : opts.quality

      if (fmt === 'flac') {
        args.push('-c:a', 'flac')
        if (opts.bitDepth === 24) args.push('-sample_fmt', 's32')
        else if (opts.bitDepth === 16) args.push('-sample_fmt', 's16')
      } else if (fmt === 'mp3') {
        args.push('-c:a', 'libmp3lame')
        if (opts.vbr && typeof q === 'number') {
          args.push('-q:a', String(q))
        } else {
          args.push('-b:a', opts.bitrate || '320k')
        }
      } else if (fmt === 'm4a' || fmt === 'aac' || fmt === 'mp4') {
        args.push('-c:a', 'aac')
        if (opts.vbr && typeof q === 'number') {
          args.push('-q:a', String(q))
        } else {
          args.push('-b:a', opts.bitrate || '320k')
        }
      } else if (fmt === 'ogg' || fmt === 'opus') {
        args.push('-c:a', 'libopus', '-b:a', opts.bitrate || '256k')
      } else if (fmt === 'wav') {
        if (opts.bitDepth === 24) args.push('-c:a', 'pcm_s24le')
        else if (opts.bitDepth === 32) args.push('-c:a', 'pcm_s32le')
        else args.push('-c:a', 'pcm_s16le')
      } else if (fmt === 'aiff') {
        if (opts.bitDepth === 24) args.push('-c:a', 'pcm_s24be')
        else if (opts.bitDepth === 32) args.push('-c:a', 'pcm_s32be')
        else args.push('-c:a', 'pcm_s16be')
      } else if (fmt === 'alac') {
        args.push('-c:a', 'alac')
      } else if (fmt === 'wma') {
        args.push('-c:a', 'wmav2', '-b:a', opts.bitrate || '192k')
      } else if (fmt === 'webm') {
        args.push('-c:a', 'libopus', '-b:a', opts.bitrate || '128k')
      } else if (fmt === 'pcm') {
        args.push('-c:a', 'pcm_s16le', '-f', 's16le')
      }

      if (opts.sampleRate) {
        args.push('-ar', String(opts.sampleRate))
      }
      if (opts.channels) {
        args.push('-ac', String(opts.channels))
      }

      args.push(outPath)

      return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const proc = spawn(ffmpegBin, args)
        if (opts.jobId) {
          this.activeTranscodes.set(opts.jobId, proc)
        }

        let stderr = ''
        let totalDurationSec = 0

        proc.stderr?.on('data', (d) => {
          const chunk = d.toString()
          stderr += chunk

          if (opts.jobId && onProgress) {
            if (!totalDurationSec) {
              const matchDuration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(chunk)
              if (matchDuration) {
                const hours = parseFloat(matchDuration[1]!)
                const mins = parseFloat(matchDuration[2]!)
                const secs = parseFloat(matchDuration[3]!)
                totalDurationSec = hours * 3600 + mins * 60 + secs
              }
            }

            const matchTime = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(chunk)
            if (matchTime) {
              const h = parseFloat(matchTime[1]!)
              const m = parseFloat(matchTime[2]!)
              const s = parseFloat(matchTime[3]!)
              const curSec = h * 3600 + m * 60 + s
              const pct = totalDurationSec > 0
                ? Math.min(99, Math.max(0, Math.round((curSec / totalDurationSec) * 100)))
                : 0
              onProgress({
                jobId: opts.jobId,
                progress: pct,
                currentTimeSeconds: curSec,
              })
            }
          }
        })

        proc.on('close', (code) => {
          if (opts.jobId) {
            this.activeTranscodes.delete(opts.jobId)
          }
          if (code === 0 && existsSync(outPath)) {
            resolve({ ok: true })
          } else {
            resolve({ ok: false, error: stderr.slice(-500) || `ffmpeg exited with code ${code}` })
          }
        })

        proc.on('error', (err) => {
          if (opts.jobId) {
            this.activeTranscodes.delete(opts.jobId)
          }
          resolve({ ok: false, error: String(err) })
        })
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
}
