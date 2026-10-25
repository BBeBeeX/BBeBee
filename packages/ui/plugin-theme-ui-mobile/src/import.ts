/**
 * Custom theme import — the pure half of the desktop card's import flow,
 * shared shape for both platforms.
 *
 * A theme document arrives as JSON text, either a single legacy
 * `ThemeDefinition` or a `ThemePack` (`{ id, name, variants: [...] }`).
 * Partial tokens are completed against the default theme so a pack that only
 * declares `brand.primary` still paints a coherent screen — the same
 * completion the desktop card performs, kept here as data-in/data-out so the
 * UI package holds no parsing of its own.
 */

import type { ThemeDefinition, ThemePack } from '@BBeBee/protocol'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'

/** The i18n keys an import failure can name (catalogue: `plugin-i18n/theme.json`). */
export type ThemeImportErrorKey =
  | 'theme:themeManagement.importEmptyJson'
  | 'theme:themeManagement.importInvalidJson'
  | 'theme:themeManagement.importMissingId'
  | 'theme:themeManagement.importMissingName'

export class ThemeImportError extends Error {
  readonly key: ThemeImportErrorKey
  constructor(key: ThemeImportErrorKey) {
    super(key)
    this.key = key
    this.name = 'ThemeImportError'
  }
}

/** Completes a partial variant's tokens against the default theme. */
function fillTokens(partial: Partial<ThemeDefinition>): ThemeDefinition['tokens'] {
  const base = midnightPurpleTheme.tokens
  const t: Partial<ThemeDefinition['tokens']> = partial.tokens ?? {}
  return {
    ...base,
    ...t,
    bg: { ...base.bg, ...(t.bg ?? {}) },
    surface: { ...base.surface, ...(t.surface ?? {}) },
    brand: { ...base.brand, ...(t.brand ?? {}) },
    gradient: { ...base.gradient, ...(t.gradient ?? {}) },
    text: { ...base.text, ...(t.text ?? {}) },
    border: { ...base.border, ...(t.border ?? {}) },
    semantic: { ...base.semantic, ...(t.semantic ?? {}) },
    music: { ...base.music, ...(t.music ?? {}) },
    glow: { ...base.glow, ...(t.glow ?? {}) },
  }
}

function toVariant(raw: Partial<ThemeDefinition>): ThemeDefinition {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new ThemeImportError('theme:themeManagement.importMissingId')
  }
  const id = raw.id.trim()
  return {
    id,
    name: (typeof raw.name === 'string' && raw.name.trim()) || id,
    description: raw.description,
    isDark: raw.isDark ?? true,
    tokens: fillTokens(raw),
    lightTokens: raw.lightTokens,
    cssVariables: raw.cssVariables,
    lightCssVariables: raw.lightCssVariables,
    effects: raw.effects,
  }
}

export type ThemeImportResult =
  | { kind: 'pack'; pack: ThemePack; label: string }
  | { kind: 'theme'; theme: ThemeDefinition; label: string }

/**
 * Parses a pasted or picked theme document.
 *
 * Throws {@link ThemeImportError} with a catalogue key for every rejection —
 * the caller renders it through `t()`; this module never touches i18n.
 */
export function parseThemeDocument(text: string): ThemeImportResult {
  if (!text.trim()) throw new ThemeImportError('theme:themeManagement.importEmptyJson')
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new ThemeImportError('theme:themeManagement.importInvalidJson')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ThemeImportError('theme:themeManagement.importInvalidJson')
  }
  const doc = parsed as Record<string, unknown> & Partial<ThemeDefinition>

  // Pack document: { id, name, variants: [...] }.
  if (Array.isArray(doc.variants)) {
    if (typeof doc.id !== 'string' || !doc.id.trim()) {
      throw new ThemeImportError('theme:themeManagement.importMissingId')
    }
    const variants = (doc.variants as Partial<ThemeDefinition>[]).map(toVariant)
    const pack: ThemePack = {
      id: doc.id.trim(),
      name: (typeof doc.name === 'string' && doc.name) || doc.id.trim(),
      description: typeof doc.description === 'string' ? doc.description : undefined,
      author: typeof doc.author === 'string' ? doc.author : undefined,
      version: typeof doc.version === 'string' ? doc.version : undefined,
      origin: 'custom',
      variants,
    }
    return { kind: 'pack', pack, label: pack.name }
  }

  // Single theme document (legacy shape).
  if (typeof doc.id !== 'string' || !doc.id.trim()) {
    throw new ThemeImportError('theme:themeManagement.importMissingId')
  }
  if (typeof doc.name !== 'string' || !doc.name.trim()) {
    throw new ThemeImportError('theme:themeManagement.importMissingName')
  }
  const theme = toVariant(doc)
  return { kind: 'theme', theme, label: theme.name }
}
