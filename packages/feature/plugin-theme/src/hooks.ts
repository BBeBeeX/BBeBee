/**
 * React hooks for `@BBeBee/plugin-theme`.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@BBeBee/kernel'
import type { ColorTokens, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import { defaultTheme } from '@BBeBee/ui-tokens'
import { serviceOf } from '@BBeBee/toolkit/hooks'

export function useTheme(ctx: Context): {
  theme: ThemeDefinition
  setTheme: (id: string) => Promise<void>
  registerTheme: (theme: ThemeDefinition) => () => void
} {
  const service = serviceOf<ThemeService>(ctx, 'theme')
  const [theme, setLocalTheme] = useState<ThemeDefinition>(() =>
    service ? service.getCurrentTheme() : defaultTheme,
  )

  useEffect(() => {
    const s = serviceOf<ThemeService>(ctx, 'theme')
    if (!s) return
    setLocalTheme(s.getCurrentTheme())

    const off = ctx.on('theme/changed', (next: ThemeDefinition) => {
      setLocalTheme(next)
    })
    return () => void off()
  }, [ctx])

  const setTheme = useCallback(
    async (id: string) => {
      const s = serviceOf<ThemeService>(ctx, 'theme')
      if (s) {
        await s.setTheme(id)
      }
    },
    [ctx],
  )

  const registerTheme = useCallback(
    (newTheme: ThemeDefinition) => {
      const s = serviceOf<ThemeService>(ctx, 'theme')
      if (s) {
        return s.registerTheme(newTheme)
      }
      return () => {}
    },
    [ctx],
  )

  return { theme, setTheme, registerTheme }
}

export function useThemeTokens(ctx: Context): ColorTokens {
  const { theme } = useTheme(ctx)
  return theme.tokens
}

export function useThemeList(ctx: Context): readonly ThemeDefinition[] {
  const service = serviceOf<ThemeService>(ctx, 'theme')
  const [list, setList] = useState<readonly ThemeDefinition[]>(() =>
    service ? service.getThemes() : [defaultTheme],
  )

  useEffect(() => {
    const s = serviceOf<ThemeService>(ctx, 'theme')
    if (!s) return
    setList(s.getThemes())

    const off = ctx.on('theme/registry-changed', (themes: readonly ThemeDefinition[]) => {
      setList(themes)
    })
    return () => void off()
  }, [ctx])

  return list
}
