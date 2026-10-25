/**
 * The theme document parser — the same acceptance rules as the desktop
 * card's import flow, asserted as data-in/data-out.
 */

import { describe, expect, it } from 'vitest'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import { parseThemeDocument, ThemeImportError } from './import.js'

const KEY = {
  empty: 'theme:themeManagement.importEmptyJson',
  invalid: 'theme:themeManagement.importInvalidJson',
  missingId: 'theme:themeManagement.importMissingId',
  missingName: 'theme:themeManagement.importMissingName',
}

describe('parseThemeDocument', () => {
  it('parses a single theme document and completes partial tokens', () => {
    const result = parseThemeDocument(
      JSON.stringify({ id: 'neon-cyber', name: 'Neon Cyber', tokens: { brand: { primary: '#00FFCC' } } }),
    )
    expect(result.kind).toBe('theme')
    if (result.kind !== 'theme') return
    expect(result.theme.id).toBe('neon-cyber')
    expect(result.theme.tokens.brand.primary).toBe('#00FFCC')
    // Everything the author did not declare is completed from the default theme.
    expect(result.theme.tokens.bg.app).toBe(midnightPurpleTheme.tokens.bg.app)
    expect(result.theme.tokens.semantic.error).toBe(midnightPurpleTheme.tokens.semantic.error)
    expect(result.label).toBe('Neon Cyber')
  })

  it('parses a multi-variant pack document with origin custom', () => {
    const result = parseThemeDocument(
      JSON.stringify({
        id: 'acme-pack',
        name: 'Acme Pack',
        author: 'Acme',
        variants: [
          { id: 'acme-a', name: 'Acme A', tokens: { brand: { primary: '#FF0000' } } },
          { id: 'acme-b', name: 'Acme B', isDark: false, tokens: { brand: { primary: '#00FF00' } } },
        ],
      }),
    )
    expect(result.kind).toBe('pack')
    if (result.kind !== 'pack') return
    expect(result.pack.id).toBe('acme-pack')
    expect(result.pack.origin).toBe('custom')
    expect(result.pack.variants).toHaveLength(2)
    expect(result.pack.variants[0]!.tokens.brand.primary).toBe('#FF0000')
    expect(result.pack.variants[1]!.isDark).toBe(false)
  })

  it('derives the name from the id when the name is missing on a pack variant', () => {
    const result = parseThemeDocument(
      JSON.stringify({ id: 'solo', variants: [{ id: 'solo-dark' }] }),
    )
    expect(result.kind).toBe('pack')
    if (result.kind !== 'pack') return
    expect(result.pack.variants[0]!.name).toBe('solo-dark')
  })

  it('rejects with catalogue keys, never raw parser errors', () => {
    expect(() => parseThemeDocument('')).toThrowError(expect.objectContaining({ key: KEY.empty }))
    expect(() => parseThemeDocument('   ')).toThrowError(expect.objectContaining({ key: KEY.empty }))
    expect(() => parseThemeDocument('{not json')).toThrowError(expect.objectContaining({ key: KEY.invalid }))
    expect(() => parseThemeDocument('42')).toThrowError(expect.objectContaining({ key: KEY.invalid }))
    expect(() => parseThemeDocument('{"name":"No id"}')).toThrowError(
      expect.objectContaining({ key: KEY.missingId }),
    )
    expect(() => parseThemeDocument('{"id":"x","variants":[{"name":"no id"}]}')).toThrowError(
      expect.objectContaining({ key: KEY.missingId }),
    )
    expect(() => parseThemeDocument('{"id":"x"}')).toThrowError(
      expect.objectContaining({ key: KEY.missingName }),
    )
    const error = (() => {
      try {
        parseThemeDocument('{"id":"x"}')
      } catch (err) {
        return err as ThemeImportError
      }
      throw new Error('expected a throw')
    })()
    expect(error).toBeInstanceOf(ThemeImportError)
    expect(error.key).toBe(KEY.missingName)
  })
})
