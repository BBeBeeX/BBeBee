/**
 * Desktop Theme Palette Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Inspects all `themeToCssVariables` color swatches, tokens, and CSS properties
 * for the active theme, with scheme toggling and search filtering.
 */

import { createElement as h, useState, useEffect, useMemo } from 'react'
import type { ReactElement, CSSProperties } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { themeToCssVariables, defaultTheme, builtInThemes, type Scheme } from '@BBeBee/ui-tokens'
import type { UiService, ThemeService, ThemeDefinition } from '@BBeBee/protocol'

const CATEGORY_MAP: Record<string, { label: string; match: (key: string) => boolean }> = {
  background: {
    label: '背景 (Background)',
    match: (k) => k.startsWith('--bg-') || k === '--player-bg' || k.startsWith('--color-bg-'),
  },
  surface: {
    label: '表面 (Surface)',
    match: (k) => k.startsWith('--surface-') || k.startsWith('--color-surface'),
  },
  text: {
    label: '文本 (Text)',
    match: (k) => k.startsWith('--text-') || k.startsWith('--color-text-'),
  },
  brand: {
    label: '品牌与高亮 (Brand & Accent)',
    match: (k) =>
      k.startsWith('--primary') ||
      k.startsWith('--accent') ||
      k.startsWith('--color-primary') ||
      k.startsWith('--color-accent'),
  },
  border: {
    label: '边框 (Border)',
    match: (k) => k.startsWith('--border-'),
  },
  cardsAndForms: {
    label: '卡片与表单 (Cards & Forms)',
    match: (k) =>
      k.startsWith('--card-') ||
      k.startsWith('--settings-card-') ||
      k.startsWith('--input-') ||
      k.startsWith('--switch-') ||
      k.startsWith('--shadow-') ||
      k.startsWith('--logo-'),
  },
  preview: {
    label: '通用预览与窗口 (Preview & Window)',
    match: (k) => k.startsWith('--preview-') || k.startsWith('--lyrics-preview-'),
  },
  semanticAndMusic: {
    label: '语义与音乐 (Semantic & Music)',
    match: (k) =>
      k === '--success' ||
      k === '--warning' ||
      k === '--error' ||
      k === '--info' ||
      k.startsWith('--music-') ||
      k.startsWith('--color-playing') ||
      k.startsWith('--color-lyrics') ||
      k.startsWith('--color-waveform'),
  },
  gradients: {
    label: '渐变色彩 (Gradients)',
    match: (k) => k.startsWith('--gradient-'),
  },
  glows: {
    label: '发光光晕 (Glows)',
    match: (k) => k.startsWith('--glow-'),
  },
  legacy: {
    label: '兼容传统变量 (Legacy --bb-*)',
    match: (k) => k.startsWith('--bb-'),
  },
}

export function ThemePaletteScreen({ ctx }: { ctx: Context }): ReactElement {
  const ui = serviceOf<UiService>(ctx, 'ui')
  const themeService = serviceOf<ThemeService>(ctx, 'theme')

  const [activeTheme, setActiveTheme] = useState<ThemeDefinition>(() => {
    return themeService?.getCurrentTheme?.() ?? defaultTheme
  })
  const [effectiveScheme, setEffectiveScheme] = useState<Scheme>(() => {
    return (themeService?.getEffectiveScheme?.() as Scheme) ?? 'dark'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!themeService || typeof themeService.onThemeChange !== 'function') return
    const off = themeService.onThemeChange((t, s) => {
      setActiveTheme(t)
      if (s) setEffectiveScheme(s)
    })
    return () => void off?.()
  }, [themeService])

  const cssVariables = useMemo(() => {
    return themeToCssVariables(activeTheme, effectiveScheme)
  }, [activeTheme, effectiveScheme])

  const entries = useMemo(() => {
    return Object.entries(cssVariables)
  }, [cssVariables])

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return entries.filter(([key, val]) => {
      if (selectedCategory !== 'all') {
        const cat = CATEGORY_MAP[selectedCategory]
        if (cat && !cat.match(key)) return false
      }
      if (!q) return true
      return key.toLowerCase().includes(q) || val.toLowerCase().includes(q)
    })
  }, [entries, searchQuery, selectedCategory])

  const groupedEntries = useMemo(() => {
    if (selectedCategory !== 'all' || searchQuery.trim() !== '') {
      return [{ categoryKey: 'filtered', label: `筛选结果 (${filteredEntries.length})`, items: filteredEntries }]
    }

    const groups: { categoryKey: string; label: string; items: [string, string][] }[] = []
    const handled = new Set<string>()

    for (const [catKey, catDef] of Object.entries(CATEGORY_MAP)) {
      const items = entries.filter(([k]) => catDef.match(k))
      if (items.length > 0) {
        groups.push({ categoryKey: catKey, label: catDef.label, items })
        items.forEach(([k]) => handled.add(k))
      }
    }

    const remaining = entries.filter(([k]) => !handled.has(k))
    if (remaining.length > 0) {
      groups.push({ categoryKey: 'other', label: '其他变量 (Other)', items: remaining })
    }

    return groups
  }, [entries, filteredEntries, selectedCategory, searchQuery])

  const handleCopy = (key: string, val: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(`var(${key}) /* ${val} */`)
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr))
      }, 1500)
    }
  }

  const isGradientOrGlow = (val: string) => {
    return val.includes('gradient(') || val.includes('0 0 ') || val.includes('px ')
  }

  return h(
    'div',
    {
      'data-testid': 'theme-palette-screen',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-app, #0D0E15)',
        color: 'var(--text-primary, #E2E8F0)',
        padding: '32px 48px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      },
    },
    // Top Bar: Back button, Title & Theme / Scheme switch
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 16,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(Button, {
          variant: 'secondary',
          children: '← 返回调试页',
          onPress: () => ui?.navigate?.('debug.view'),
        }),
        h(
          'div',
          null,
          h(
            'h1',
            {
              style: {
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                color: 'var(--text-primary, #F8FAFC)',
                letterSpacing: '-0.02em',
              },
            },
            '主题变量色板 (Theme Palette)',
          ),
          h(
            'div',
            { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', marginTop: 4 } },
            `当前主题: ${activeTheme.name} (${activeTheme.id}) · 模式: ${effectiveScheme.toUpperCase()} · 共 ${entries.length} 个 CSS 变量`,
          ),
        ),
      ),
      // Controls: Scheme switch & Theme dropdown
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        // Light / Dark preview toggle
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'palette-scheme-toggle',
            title: `切换为 ${effectiveScheme === 'dark' ? '浅色' : '深色'} 模式预览`,
            onClick: () => setEffectiveScheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
              color: 'var(--text-primary, #F8FAFC)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            },
          },
          effectiveScheme === 'dark' ? tablerIcon('moon', { size: 16 }) : tablerIcon('sun', { size: 16 }),
          h('span', null, effectiveScheme === 'dark' ? '深色模式 (Dark)' : '浅色模式 (Light)'),
        ),
        // Builtin theme switcher
        h(
          'select',
          {
            'data-testid': 'palette-theme-select',
            value: activeTheme.id,
            onChange: (e: { target: { value: string } }) => {
              const selected = builtInThemes[e.target.value]
              if (selected) {
                setActiveTheme(selected)
                if (themeService) {
                  void themeService.setTheme(selected.id)
                }
              }
            },
            style: {
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              background: 'var(--surface-2, #1A1C28)',
              color: 'var(--text-primary, #F8FAFC)',
              fontSize: 13,
              cursor: 'pointer',
            },
          },
          ...Object.entries(builtInThemes).map(([id, theme]) =>
            h('option', { key: id, value: id }, theme.name),
          ),
        ),
      ),
    ),

    // Search and Category filter toolbar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 28,
          flexWrap: 'wrap',
          background: 'var(--settings-card-bg, rgba(255, 255, 255, 0.03))',
          padding: '12px 16px',
          borderRadius: 10,
          border: '1px solid var(--settings-card-border, rgba(255, 255, 255, 0.06))',
        },
      },
      // Search Box
      h(
        'div',
        { style: { position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 220 } },
        h(
          'span',
          {
            style: {
              position: 'absolute',
              left: 10,
              color: 'var(--text-muted, #64748B)',
              pointerEvents: 'none',
              display: 'flex',
            },
          },
          tablerIcon('search', { size: 16 }),
        ),
        h('input', {
          type: 'text',
          'data-testid': 'palette-search-input',
          placeholder: '搜索变量名或色值 (如 --surface, #FFFFFF, rgba...)',
          value: searchQuery,
          onChange: (e: { target: { value: string } }) => setSearchQuery(e.target.value),
          style: {
            width: '100%',
            padding: '8px 12px 8px 34px',
            borderRadius: 6,
            border: '1px solid var(--input-border, var(--border-subtle, rgba(255, 255, 255, 0.12)))',
            background: 'var(--input-bg, var(--surface-2, rgba(0, 0, 0, 0.35)))',
            color: 'var(--text-primary, #F8FAFC)',
            fontSize: 13,
            outline: 'none',
          },
        }),
      ),
      // Category pills
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h(
          'button',
          {
            type: 'button',
            onClick: () => setSelectedCategory('all'),
            style: categoryButtonStyle(selectedCategory === 'all'),
          },
          '全部',
        ),
        ...Object.entries(CATEGORY_MAP).map(([catKey, catDef]) =>
          h(
            'button',
            {
              key: catKey,
              type: 'button',
              onClick: () => setSelectedCategory(catKey),
              style: categoryButtonStyle(selectedCategory === catKey),
            },
            catDef.label.split(' ')[0],
          ),
        ),
      ),
    ),

    // Palette Groups
    groupedEntries.map((group) =>
      h(
        'div',
        {
          key: group.categoryKey,
          style: { marginBottom: 32 },
        },
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #94A3B8)',
              marginBottom: 12,
              paddingBottom: 6,
              borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
          },
          h('span', null, group.label),
          h('span', { style: { fontSize: 12, color: 'var(--text-secondary, #64748B)' } }, `${group.items.length} 项`),
        ),
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            },
          },
          ...group.items.map(([key, val]) =>
            h(SwatchCard, {
              key,
              varName: key,
              value: val,
              isCopied: copiedKey === key,
              onCopy: () => handleCopy(key, val),
              isComplex: isGradientOrGlow(val),
            }),
          ),
        ),
      ),
    ),
  )
}

function categoryButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    border: `1px solid ${active ? 'var(--primary, #3B66F5)' : 'var(--border-subtle, rgba(255, 255, 255, 0.08))'}`,
    background: active ? 'var(--surface-selected, rgba(59, 102, 245, 0.2))' : 'var(--surface-2, rgba(255, 255, 255, 0.03))',
    color: active ? 'var(--primary, #93C5FD)' : 'var(--text-secondary, #94A3B8)',
    transition: 'all 0.15s ease',
  }
}

function SwatchCard({
  varName,
  value,
  isCopied,
  onCopy,
}: {
  varName: string
  value: string
  isCopied: boolean
  onCopy: () => void
  isComplex: boolean
}): ReactElement {
  const isGlow = value.includes('0 0 ') && !value.includes('gradient(')

  return h(
    'div',
    {
      'data-testid': `palette-swatch-${varName}`,
      onClick: onCopy,
      title: '点击复制 var(...)',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'var(--surface-1, rgba(255, 255, 255, 0.02))',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.background = 'var(--surface-2, rgba(255, 255, 255, 0.05))'
        e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.15))'
        e.currentTarget.style.transform = 'translateY(-1px)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.background = 'var(--surface-1, rgba(255, 255, 255, 0.02))'
        e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.06))'
        e.currentTarget.style.transform = 'translateY(0)'
      },
    },
    // Swatch preview box with checkerboard background for transparency
    h(
      'div',
      {
        style: {
          width: 36,
          height: 36,
          borderRadius: 6,
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          background:
            'repeating-conic-gradient(#262626 0% 25%, #181818 0% 50%) 50% / 10px 10px',
        },
      },
      h('div', {
        style: {
          width: '100%',
          height: '100%',
          borderRadius: 5,
          background: isGlow ? '#181818' : value,
          boxShadow: isGlow ? value : undefined,
        },
      }),
    ),
    // Details
    h(
      'div',
      { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
      h(
        'div',
        {
          style: {
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary, #F8FAFC)',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        varName,
      ),
      h(
        'div',
        {
          style: {
            fontSize: 11,
            color: 'var(--text-secondary, #94A3B8)',
            marginTop: 2,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        value,
      ),
    ),
    // Copied feedback badge
    isCopied
      ? h(
          'span',
          {
            style: {
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: '#22C55E',
              color: '#000000',
              fontWeight: 700,
            },
          },
          '已复制',
        )
      : null,
  )
}
