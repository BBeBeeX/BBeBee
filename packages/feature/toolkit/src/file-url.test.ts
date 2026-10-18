import { afterEach, describe, expect, it, vi } from 'vitest'
import { toServableFileUrl } from './file-url.js'

const g = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  delete g['BBeBee']
  vi.unstubAllGlobals()
})

describe('toServableFileUrl', () => {
  it('returns undefined/empty inputs unchanged', () => {
    expect(toServableFileUrl(undefined)).toBeUndefined()
    expect(toServableFileUrl('')).toBe('')
  })

  it('passes the URI through when the host surface is absent (non-Windows)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
    const uri = 'bbebee-file:///C:/music/cover.jpg'
    expect(toServableFileUrl(uri)).toBe(uri)
  })

  it('applies the Windows mapping as fallback when host surface is absent', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(toServableFileUrl('bbebee-file:///C:/music/cover.jpg')).toBe(
      'http://bbebee-file.localhost/C:/music/cover.jpg',
    )
    expect(toServableFileUrl('bbebee-file://localhost/C:/music/cover.jpg')).toBe(
      'http://bbebee-file.localhost/C:/music/cover.jpg',
    )
    // Non bbebee-file: URIs pass through untouched even on Windows.
    expect(toServableFileUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('delegates to window.BBeBee.files.toServableUrl when present', () => {
    const toServableUrl = vi.fn((u: string) => `http://bbebee-file.localhost/${u}`)
    g['BBeBee'] = { files: { toServableUrl } }
    expect(toServableFileUrl('bbebee-file:///C:/a.jpg')).toBe(
      'http://bbebee-file.localhost/bbebee-file:///C:/a.jpg',
    )
    expect(toServableUrl).toHaveBeenCalledWith('bbebee-file:///C:/a.jpg')
  })

  it('falls back to the identity mapping when the host function throws', () => {
    g['BBeBee'] = {
      files: {
        toServableUrl: () => {
          throw new Error('boom')
        },
      },
    }
    const uri = 'bbebee-file:///C:/a.jpg'
    expect(toServableFileUrl(uri)).toBe(uri)
  })

  it('ignores a non-function toServableUrl', () => {
    g['BBeBee'] = { files: { toServableUrl: 'not-a-function' } }
    const uri = 'bbebee-file:///C:/a.jpg'
    expect(toServableFileUrl(uri)).toBe(uri)
  })
})
