import { describe, expect, it } from 'vitest'
import { isOfficialEntry } from './official.js'

describe('isOfficialEntry (audit W5)', () => {
  it('accepts repos owned by the BBeBeeX GitHub account', () => {
    expect(isOfficialEntry({ repo: 'https://github.com/BBeBeeX/BBeBee' })).toBe(true)
    expect(isOfficialEntry({ repo: 'https://github.com/BBeBeeX/B_Be_Bee-visualizer-meters' })).toBe(true)
  })

  it('is case-insensitive about the owner segment, like GitHub', () => {
    expect(isOfficialEntry({ repo: 'https://github.com/bbebeex/repo' })).toBe(true)
    expect(isOfficialEntry({ repo: 'https://github.com/BBEBEEX/repo' })).toBe(true)
    expect(isOfficialEntry({ repo: 'https://github.com/BbEbEeX/repo/' })).toBe(true)
  })

  it('never trusts the entry id prefix or the author string', () => {
    // An entry id wearing the official-looking prefix, and an author
    // string claiming to be the project — but the repo belongs to
    // someone else.
    expect(
      isOfficialEntry({
        repo: 'https://github.com/someone-else/bbebeex-visualizer',
      }),
    ).toBe(false)
    expect(isOfficialEntry({ repo: 'https://github.com/bbebeex-fans/repo' })).toBe(false)
    expect(isOfficialEntry({ repo: 'https://github.com/notbbebeex/repo' })).toBe(false)
  })

  it('rejects lookalike hosts and non-GitHub URLs', () => {
    expect(isOfficialEntry({ repo: 'https://github.com.evil.com/BBeBeeX/repo' })).toBe(false)
    expect(isOfficialEntry({ repo: 'https://www.github.com/BBeBeeX/repo' })).toBe(false)
    expect(isOfficialEntry({ repo: 'https://gitlab.com/BBeBeeX/repo' })).toBe(false)
    expect(isOfficialEntry({ repo: 'https://evil.com/github.com/BBeBeeX/repo' })).toBe(false)
  })

  it('rejects missing, malformed and non-URL repos', () => {
    expect(isOfficialEntry({})).toBe(false)
    expect(isOfficialEntry({ repo: '' })).toBe(false)
    expect(isOfficialEntry({ repo: 'BBeBeeX/BBeBee' })).toBe(false)
    expect(isOfficialEntry({ repo: 'not a url' })).toBe(false)
    expect(isOfficialEntry({ repo: 'https://github.com/' })).toBe(false)
  })
})
