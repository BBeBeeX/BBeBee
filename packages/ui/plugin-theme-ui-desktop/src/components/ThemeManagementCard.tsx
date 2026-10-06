import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'

/**
 * The theme management card: theme swatches, custom-theme import and delete.
 * Owns nothing but view state — themes live in `ctx.theme`, the selected id
 * in the settings document.
 */
export function ThemeManagementCard({ ctx }: { ctx: Context }): ReactElement {
  const settings = serviceOf<{ getSync(): AppSettings; update(p: unknown): Promise<unknown> }>(
    ctx,
    'settings',
  )
  const themeService = serviceOf<ThemeService>(ctx, 'theme')

  const [themes, setThemes] = useState<readonly ThemeDefinition[]>(() => themeService?.getThemes?.() ?? [])
  const [currentThemeId, setCurrentThemeId] = useState<string>(
    () => settings?.getSync()?.themeId ?? themeService?.getCurrentTheme?.().id ?? 'midnight-purple',
  )
  const [appearanceMode, setAppearanceMode] = useState<'system' | 'dark' | 'light'>(
    () => (settings?.getSync()?.theme as 'system' | 'dark' | 'light') ?? 'dark',
  )
  const [showImportModal, setShowImportModal] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const updateThemes = () => {
      const svc = serviceOf<ThemeService>(ctx, 'theme')
      const list = svc?.getThemes?.()
      if (list) setThemes(list)
      const currentSettings = serviceOf<{ getSync(): AppSettings }>(ctx, 'settings')?.getSync()
      setCurrentThemeId(
        currentSettings?.themeId ??
          svc?.getCurrentTheme?.().id ??
          'midnight-purple',
      )
      if (currentSettings?.theme) {
        setAppearanceMode(currentSettings.theme as 'system' | 'dark' | 'light')
      }
    }
    updateThemes()
    const off1 = ctx.on('theme/registry-changed', updateThemes)
    const off2 = ctx.on('theme/changed', updateThemes)
    const off3 = ctx.on('settings/changed', updateThemes)
    return () => {
      off1()
      off2()
      off3()
    }
  }, [ctx])

  const handleAppearanceModeChange = (mode: 'system' | 'dark' | 'light') => {
    setAppearanceMode(mode)
    void settings?.update({ theme: mode })
  }

  const handleThemeChange = (themeId: string) => {
    void settings?.update({ themeId })
    const svc = serviceOf<ThemeService>(ctx, 'theme')
    void svc?.setTheme?.(themeId)
  }

  const handleDeleteTheme = (themeId: string) => {
    const svc = serviceOf<ThemeService>(ctx, 'theme')
    const success = svc?.removeTheme ? svc.removeTheme(themeId) : true
    if (success && currentThemeId === themeId) {
      handleThemeChange('midnight-purple')
    }
  }

  const handleFileChange = (e: { target: { files: FileList | null; value: string } }) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result
      if (typeof text === 'string') {
        setImportJson(text)
        setImportError(null)
      }
    }
    reader.onerror = () => {
      setImportError('读取文件失败')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImportSubmit = () => {
    try {
      if (!importJson.trim()) {
        throw new Error('请输入或选择色彩模式 JSON')
      }
      const parsed = JSON.parse(importJson) as Partial<ThemeDefinition>
      if (!parsed || typeof parsed !== 'object') throw new Error('无效的 JSON 格式')
      if (!parsed.id || typeof parsed.id !== 'string') throw new Error('缺少主题 id 字段')
      if (!parsed.name || typeof parsed.name !== 'string') throw new Error('缺少主题 name 字段')

      const newTheme: ThemeDefinition = {
        id: parsed.id.trim(),
        name: parsed.name.trim(),
        description: parsed.description,
        isDark: parsed.isDark ?? true,
        tokens: {
          ...midnightPurpleTheme.tokens,
          ...(parsed.tokens || {}),
          bg: { ...midnightPurpleTheme.tokens.bg, ...(parsed.tokens?.bg || {}) },
          surface: { ...midnightPurpleTheme.tokens.surface, ...(parsed.tokens?.surface || {}) },
          brand: { ...midnightPurpleTheme.tokens.brand, ...(parsed.tokens?.brand || {}) },
          gradient: { ...midnightPurpleTheme.tokens.gradient, ...(parsed.tokens?.gradient || {}) },
          text: { ...midnightPurpleTheme.tokens.text, ...(parsed.tokens?.text || {}) },
          border: { ...midnightPurpleTheme.tokens.border, ...(parsed.tokens?.border || {}) },
          semantic: { ...midnightPurpleTheme.tokens.semantic, ...(parsed.tokens?.semantic || {}) },
          music: { ...midnightPurpleTheme.tokens.music, ...(parsed.tokens?.music || {}) },
          glow: { ...midnightPurpleTheme.tokens.glow, ...(parsed.tokens?.glow || {}) },
        },
        cssVariables: parsed.cssVariables,
      }

      const svc = serviceOf<ThemeService>(ctx, 'theme')
      if (svc?.registerTheme) {
        svc.registerTheme(newTheme)
      } else {
        setThemes((prev) => [...prev, newTheme])
      }
      handleThemeChange(newTheme.id)
      setShowImportModal(false)
      setImportJson('')
      setImportError(null)
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  return h(
    'div',
    { 'data-testid': 'theme-management-card' },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 4px',
          gap: 16,
        },
      },
      // Appearance mode row
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            paddingBottom: 16,
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: '#F5F5F7' } }, '外观模式'),
          h(
            'div',
            { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.45 } },
            '切换应用深色、浅色或跟随系统外观',
          ),
        ),
        h(
          'div',
          {
            role: 'radiogroup',
            'aria-label': '外观模式',
            style: {
              display: 'inline-flex',
              padding: 3,
              borderRadius: 20,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              gap: 4,
            },
          },
          [
            { id: 'system', label: '跟随系统' },
            { id: 'dark', label: '深色模式' },
            { id: 'light', label: '浅色模式' },
          ].map((mode) => {
            const isSelected = appearanceMode === mode.id
            return h(
              'button',
              {
                key: mode.id,
                type: 'button',
                role: 'radio',
                'aria-checked': isSelected,
                'data-testid': `appearance-mode-${mode.id}`,
                onClick: () => handleAppearanceModeChange(mode.id as 'system' | 'dark' | 'light'),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '5px 14px',
                  borderRadius: 16,
                  border: isSelected
                    ? '1px solid var(--color-primary, #5F87FF)'
                    : '1px solid transparent',
                  background: isSelected
                    ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                    : 'transparent',
                  color: isSelected
                    ? 'var(--text-primary, #FFFFFF)'
                    : 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  boxShadow: isSelected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))' : 'none',
                  transition: 'all 0.15s ease',
                },
              },
              mode.label,
            )
          }),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: '#F5F5F7' } }, '界面主题'),
          h(
            'div',
            { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.45 } },
            '选择全应用色彩方案，或导入自定义主题',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'import-theme-button',
            onClick: () => {
              setImportJson('')
              setImportError(null)
              setShowImportModal(true)
            },
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 20,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: 'var(--border-default, rgba(255, 255, 255, 0.25))',
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--text-secondary, #C5CAD8)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--color-primary, #5F87FF)'
              e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.25))'
              e.currentTarget.style.color = 'var(--text-secondary, #C5CAD8)'
            },
          },
          tablerIcon('plus', { size: 14 }),
          '导入色彩模式',
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            width: '100%',
          },
        },
        themes.map((t) => {
          const isSelected = currentThemeId === t.id
          const isMidnight = t.id === 'midnight-purple'
          const isSpotify = t.id === 'spotify'
          const isCrimson = t.id === 'crimson-night'
          const isOcean = t.id === 'ocean-abyss'
          const isCustom = !isMidnight && !isSpotify && !isCrimson && !isOcean
          const swatchBg = isMidnight
            ? 'linear-gradient(135deg, #5F87FF 0%, #7C86FF 50%, #A99CFF 100%)'
            : isSpotify
              ? '#1DB954'
              : isCrimson
                ? '#FF2D55'
                : isOcean
                  ? '#06B6D4'
                  : t.tokens?.brand?.primary ?? 'var(--color-primary, #5F87FF)'

          return h(
            'button',
            {
              key: t.id,
              type: 'button',
              onClick: () => handleThemeChange(t.id),
              'aria-pressed': isSelected,
              'data-testid': `theme-option-${t.id}`,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 20,
                border: isSelected
                  ? '1px solid var(--color-primary, #5F87FF)'
                  : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                background: isSelected
                  ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                  : 'rgba(255, 255, 255, 0.04)',
                color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #C5CAD8)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isSelected ? 600 : 400,
                boxShadow: isSelected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))' : 'none',
                transition: 'all 0.15s ease',
              },
            },
            h('span', {
              style: {
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: swatchBg,
                flexShrink: 0,
                boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
              },
            }),
            t.name,
            isCustom
              ? h(
                  'span',
                  {
                    role: 'button',
                    tabIndex: 0,
                    title: `删除 ${t.name}`,
                    'aria-label': `删除 ${t.name}`,
                    'data-testid': `delete-theme-${t.id}`,
                    onClick: (e: { stopPropagation(): void }) => {
                      e.stopPropagation()
                      handleDeleteTheme(t.id)
                    },
                    onKeyDown: (e: { key: string; stopPropagation(): void }) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        handleDeleteTheme(t.id)
                      }
                    },
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 4,
                      padding: 2,
                      borderRadius: 4,
                      color: 'var(--text-tertiary, #8B95B0)',
                      cursor: 'pointer',
                      opacity: 0.8,
                    },
                  },
                  tablerIcon('trash', { size: 14 }),
                )
              : null,
          )
        }),
      ),
    ),
    h(
      Sheet,
      {
        open: showImportModal,
        onClose: () => {
          setShowImportModal(false)
          setImportError(null)
        },
        title: '导入色彩模式',
        accessibilityLabel: '导入色彩模式',
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'p',
          { style: { margin: 0, fontSize: 13, color: 'var(--text-secondary, #C5CAD8)', lineHeight: 1.5 } },
          '支持从本地选择包含主题配置的 JSON 文件，或直接在下方输入/粘贴 JSON 配置。导入成功后将自动应用。',
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: '.json,application/json',
            'data-testid': 'import-theme-file-input',
            style: { display: 'none' },
            onChange: handleFileChange,
          }),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'choose-theme-file-btn',
              onClick: () => fileInputRef.current?.click(),
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-primary, #FFFFFF)',
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            tablerIcon('upload', { size: 14 }),
            '选择本地 JSON 文件',
          ),
        ),
        h('textarea', {
          value: importJson,
          onChange: (e: { target: { value: string } }) => {
            setImportJson(e.target.value)
            setImportError(null)
          },
          placeholder:
            '在此粘贴色彩模式 JSON 配置，例如：\n{\n  "id": "my-neon",\n  "name": "霓虹幻彩",\n  "tokens": {\n    "brand": { "primary": "#00FFCC" }\n  }\n}',
          rows: 8,
          'data-testid': 'import-theme-textarea',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            borderRadius: 8,
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
            color: 'var(--text-primary, #F5F7FF)',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.4,
            resize: 'vertical',
          },
        }),
        importError
          ? h(
              'div',
              {
                'data-testid': 'import-theme-error',
                style: {
                  color: 'var(--color-error, #F43F5E)',
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'rgba(244, 63, 94, 0.1)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                },
              },
              importError,
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 } },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'cancel-import-theme',
              onClick: () => {
                setShowImportModal(false)
                setImportError(null)
              },
              style: {
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                background: 'transparent',
                color: 'var(--text-secondary, #C5CAD8)',
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            '取消',
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'submit-import-theme',
              onClick: handleImportSubmit,
              style: {
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                color: '#FFFFFF',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            '导入并启用',
          ),
        ),
      ),
    ),
  )
}
