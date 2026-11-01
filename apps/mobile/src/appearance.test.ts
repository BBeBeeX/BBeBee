import { describe, expect, it } from 'vitest'
import { appearanceModeLabelKey, isAppearanceMode, nextAppearanceMode } from './appearance.js'

describe('nextAppearanceMode', () => {
  it('cycles dark → light → system (auto) → dark', () => {
    expect(nextAppearanceMode('dark')).toBe('light')
    expect(nextAppearanceMode('light')).toBe('system')
    expect(nextAppearanceMode('system')).toBe('dark')
  })
})

describe('appearanceModeLabelKey', () => {
  it('names the mode the button is in', () => {
    expect(appearanceModeLabelKey('dark')).toBe('theme:themeManagement.darkMode')
    expect(appearanceModeLabelKey('light')).toBe('theme:themeManagement.lightMode')
    expect(appearanceModeLabelKey('system')).toBe('theme:themeManagement.followSystem')
  })
})

describe('isAppearanceMode', () => {
  it('guards raw AppSettings.theme reads', () => {
    expect(isAppearanceMode('dark')).toBe(true)
    expect(isAppearanceMode('light')).toBe(true)
    expect(isAppearanceMode('system')).toBe(true)
    expect(isAppearanceMode('auto')).toBe(false)
    expect(isAppearanceMode(undefined)).toBe(false)
  })
})
