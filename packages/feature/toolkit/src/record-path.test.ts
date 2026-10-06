import { describe, expect, it } from 'vitest'
import { getPath, setPath } from './record-path.js'

describe('getPath', () => {
  it('reads nested values by dot path', () => {
    expect(getPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7)
  })

  it('returns undefined for missing segments and empty paths', () => {
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined()
    expect(getPath({ a: { b: 1 } }, 'x.y')).toBeUndefined()
    expect(getPath({ a: 1 }, '')).toBeUndefined()
    expect(getPath(null, 'a')).toBeUndefined()
  })

  it('does not traverse into non-records', () => {
    expect(getPath({ a: 'text' }, 'a.length')).toBeUndefined()
  })
})

describe('setPath', () => {
  it('writes a top-level key without mutating the input', () => {
    const source = { a: 1 }
    expect(setPath(source, 'b', 2)).toEqual({ a: 1, b: 2 })
    expect(source).toEqual({ a: 1 })
  })

  it('creates intermediate levels', () => {
    expect(setPath({}, 'a.b.c', true)).toEqual({ a: { b: { c: true } } })
  })

  it('replaces a leaf regardless of its previous shape', () => {
    expect(setPath({ a: { b: { c: 1, d: 2 } } }, 'a.b', 9)).toEqual({ a: { b: 9 } })
    expect(setPath({ a: 'text' }, 'a.x', 1)).toEqual({ a: { x: 1 } })
  })

  it('keeps sibling keys of intermediate levels', () => {
    expect(setPath({ a: { b: 1, c: 2 } }, 'a.c', 3)).toEqual({ a: { b: 1, c: 3 } })
  })
})
