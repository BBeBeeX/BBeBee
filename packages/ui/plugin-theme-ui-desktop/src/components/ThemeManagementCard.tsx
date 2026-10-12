import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Sheet, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'

/**
 * The theme management card: theme swatches, custom-theme import and delete.
 * Owns nothing but view state — themes live in `ctx.theme`, the selected id
 * in the settings document.
 */
export function ThemeManagementCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
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
      setImportError(t('theme:themeManagement.importFailedReadFile'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImportSubmit = () => {
    try {
      if (!importJson.trim()) {
        throw new Error(t('theme:themeManagement.importEmptyJson'))
      }
      const parsed = JSON.parse(importJson) as Partial<ThemeDefinition>
      if (!parsed || typeof parsed !== 'object') throw new Error(t('theme:themeManagement.importInvalidJson'))
      if (!parsed.id || typeof parsed.id !== 'string') throw new Error(t('theme:themeManagement.importMissingId'))
      if (!parsed.name || typeof parsed.name !== 'string') throw new Error(t('theme:themeManagement.importMissingName'))

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
    'section',
    { 'data-testid': 'theme-management-card', style: { marginBottom: 32 } },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        t('theme:themeManagement.appearanceMode'),
      ),
      h(
        'p',
        {
          style: {
            fontSize: 12,
            color: 'var(--text-secondary, #8E8E93)',
            margin: '3px 0 0',
            lineHeight: 1.4,
          },
        },
        t('theme:themeManagement.appearanceModeDesc'),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '16px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
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
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('theme:themeManagement.theme')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', lineHeight: 1.45 } },
            t('theme:themeManagement.themeModeDesc'),
          ),
        ),
        h(
          'div',
          {
            role: 'radiogroup',
            'aria-label': t('theme:themeManagement.appearanceMode'),
            style: {
              display: 'inline-flex',
              padding: 3,
              borderRadius: 20,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              gap: 4,
            },
          },
          ([
            { id: 'system', labelKey: 'theme:themeManagement.followSystem' },
            { id: 'dark', labelKey: 'theme:themeManagement.darkMode' },
            { id: 'light', labelKey: 'theme:themeManagement.lightMode' },
          ] as const).map((mode) => {
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
              t(mode.labelKey),
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
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('theme:themeManagement.interfaceTheme')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', lineHeight: 1.45 } },
            t('theme:themeManagement.interfaceThemeDesc'),
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
              background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
              color: 'var(--text-secondary, #C5CAD8)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--color-primary, #5F87FF)'
              e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.25))'
              e.currentTarget.style.color = 'var(--text-secondary, #C5CAD8)'
            },
          },
          tablerIcon('plus', { size: 14 }),
          t('theme:themeManagement.importTheme'),
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
        themes.map((theme) => {
          const isSelected = currentThemeId === theme.id
          const isMidnight = theme.id === 'midnight-purple'
          const isSpotify = theme.id === 'spotify'
          const isCrimson = theme.id === 'crimson-night'
          const isOcean = theme.id === 'ocean-abyss'
          const isCustom = !isMidnight && !isSpotify && !isCrimson && !isOcean
          const swatchBg = isMidnight
            ? 'linear-gradient(135deg, #5F87FF 0%, #7C86FF 50%, #A99CFF 100%)'
            : isSpotify
              ? '#1DB954'
              : isCrimson
                ? '#FF2D55'
                : isOcean
                  ? '#06B6D4'
                  : theme.tokens?.brand?.primary ?? 'var(--color-primary, #5F87FF)'

          return h(
            'button',
            {
              key: theme.id,
              type: 'button',
              onClick: () => handleThemeChange(theme.id),
              'aria-pressed': isSelected,
              'data-testid': `theme-option-${theme.id}`,
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
                  : 'var(--surface-1, rgba(255, 255, 255, 0.04))',
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
            theme.name,
            isCustom
              ? h(
                  'span',
                  {
                    role: 'button',
                    tabIndex: 0,
                    title: t('theme:themeManagement.deleteTheme', { name: theme.name }),
                    'aria-label': t('theme:themeManagement.deleteTheme', { name: theme.name }),
                    'data-testid': `delete-theme-${theme.id}`,
                    onClick: (e: { stopPropagation(): void }) => {
                      e.stopPropagation()
                      handleDeleteTheme(theme.id)
                    },
                    onKeyDown: (e: { key: string; stopPropagation(): void }) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        handleDeleteTheme(theme.id)
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
        title: t('theme:themeManagement.importTheme'),
        accessibilityLabel: t('theme:themeManagement.importTheme'),
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'p',
          { style: { margin: 0, fontSize: 13, color: 'var(--text-secondary, #C5CAD8)', lineHeight: 1.5 } },
          t('theme:themeManagement.importHint'),
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
            t('theme:themeManagement.chooseLocalJsonFile'),
          ),
        ),
        h('textarea', {
          value: importJson,
          onChange: (e: { target: { value: string } }) => {
            setImportJson(e.target.value)
            setImportError(null)
          },
          placeholder: t('theme:themeManagement.importPlaceholder'),
          rows: 8,
          'data-testid': 'import-theme-textarea',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            borderRadius: 8,
            background: 'var(--color-bg-tertiary, rgba(0, 0, 0, 0.35))',
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
            t('app:common.cancel'),
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
                color: 'var(--bb-accent-on, #FFFFFF)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            t('theme:themeManagement.importAndEnable'),
          ),
        ),
      ),
    ),
  )
}
