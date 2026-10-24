import { describe, expect, it } from 'vitest'
import { MOBILE_LAYOUT_MODE_KEY, isMobileLayoutMode, resolveMobileLayout } from './layout.js'

/*
 * The classifier is pure precisely so these cases can run in Node — every
 * boundary below is one the product decision called out by name, which is why
 * each pins an exact edge rather than sampling a few random sizes.
 */
describe('resolveMobileLayout', () => {
  it('a narrow window is a phone regardless of mode', () => {
    expect(resolveMobileLayout({ width: 360, height: 800, layoutMode: 'auto' })).toBe('phone')
    expect(resolveMobileLayout({ width: 360, height: 800, layoutMode: 'tablet' })).toBe('phone')
  })

  it('wide landscape with a tall height floor is a tablet', () => {
    // 800×600 hits all three tablet conditions exactly: width and height at
    // the 600dp floor, width strictly greater than height.
    expect(resolveMobileLayout({ width: 800, height: 600, layoutMode: 'auto' })).toBe('tablet')
    expect(resolveMobileLayout({ width: 1280, height: 800, layoutMode: 'tablet' })).toBe('tablet')
  })

  it('a phone in landscape (wide but short) stays a phone', () => {
    // 800×360: wide enough for the tablet width check, but the height floor
    // exists to keep exactly this window out of two columns.
    expect(resolveMobileLayout({ width: 800, height: 360, layoutMode: 'auto' })).toBe('phone')
  })

  it('a wide portrait window (height > width) stays a phone', () => {
    // 600×900: both axes at or above the floor, but portrait — columns need
    // landscape, so it falls through.
    expect(resolveMobileLayout({ width: 600, height: 900, layoutMode: 'auto' })).toBe('phone')
  })

  it('foldable only takes effect on an explicit foldable mode', () => {
    // Same size that yields foldable when chosen explicitly must yield
    // tablet for auto/tablet — foldable is a user decision, never inferred.
    expect(resolveMobileLayout({ width: 800, height: 600, layoutMode: 'auto' })).toBe('tablet')
    expect(resolveMobileLayout({ width: 800, height: 600, layoutMode: 'tablet' })).toBe('tablet')
    expect(resolveMobileLayout({ width: 800, height: 600, layoutMode: 'foldable' })).toBe('foldable')
  })

  it('an explicit foldable on a narrow window falls back to phone', () => {
    // Cover-screen posture: the choice survives, but the window cannot host
    // two panes, so the layout degrades instead of cramming.
    expect(resolveMobileLayout({ width: 400, height: 800, layoutMode: 'foldable' })).toBe('phone')
  })

  it('foldable does not require landscape — wide portrait is still foldable', () => {
    // The dual-pane foldable layout is a portrait posture; demanding
    // landscape would forbid the very screens it was chosen for.
    expect(resolveMobileLayout({ width: 600, height: 900, layoutMode: 'foldable' })).toBe('foldable')
    expect(resolveMobileLayout({ width: 900, height: 600, layoutMode: 'foldable' })).toBe('foldable')
  })
})

/*
 * The guard and the store key, pinned beside the classifier they feed. The
 * key matters because two independent writers — the shell's rail/pane buttons
 * and the Settings row in boot.ts — meet only through the persisted string;
 * a change to it would fail no import, just silently split one setting in
 * two (and orphan every value already on disk). The guard matters because a
 * corrupt or legacy store read must fall back to 'auto', not reach the
 * classifier with a value it was never taught.
 */
describe('isMobileLayoutMode and MOBILE_LAYOUT_MODE_KEY', () => {
  it('the key is the literal both writers meet through', () => {
    expect(MOBILE_LAYOUT_MODE_KEY).toBe('mobile.layoutMode')
  })

  it('the three legal modes pass', () => {
    expect(isMobileLayoutMode('auto')).toBe(true)
    expect(isMobileLayoutMode('tablet')).toBe(true)
    expect(isMobileLayoutMode('foldable')).toBe(true)
  })

  it('undefined, numbers, and case variants are rejected', () => {
    // undefined is the store's "never set"; the rest are corruption or a
    // hand-edit. Matching is exact — normalizing case would silently mint a
    // fourth mode out of a typo.
    expect(isMobileLayoutMode(undefined)).toBe(false)
    expect(isMobileLayoutMode(1)).toBe(false)
    expect(isMobileLayoutMode('Auto')).toBe(false)
    expect(isMobileLayoutMode('TABLET')).toBe(false)
  })
})
