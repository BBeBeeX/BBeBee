/**
 * The registry settings card ("Registry & updates"), React Native — the
 * mobile twin of the desktop package's `RegistrySettingsCard`, rendered
 * inside Settings → sources, filling the `registry.settings-card` descriptor
 * the headless plugin contributes (until this view registers, the mobile
 * settings screen shows a platform-gap placeholder in its place).
 *
 * Three things only: when the last check ran, the auto-check toggle (written
 * to the settings document), and a manual check whose result is listed inline
 * and navigates to the Discover screen. All domain behaviour stays in the
 * `contentRegistry` service — this card holds view state only.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, RegistryUpdate } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Button, nativePrimitives, Text, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { REGISTRY_VIEWS } from '@bbebee/plugin-registry/views'
import { formatDateTime } from '../utils/format.js'

interface RegistryServiceLike {
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  lastCheckedAt?(): number | undefined
}

interface SettingsServiceLike {
  getSync(): AppSettings
  update(patch: Partial<AppSettings>): Promise<unknown>
}

export function RegistrySettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const p = usePalette()

  const [lastCheckedAt, setLastCheckedAt] = useState<number | undefined>(() => {
    return serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')?.lastCheckedAt?.()
  })
  const [autoCheck, setAutoCheck] = useState<boolean>(() => {
    return serviceOf<SettingsServiceLike>(ctx, 'settings')?.getSync().registryAutoCheck !== false
  })
  const [checking, setChecking] = useState(false)
  const [updates, setUpdates] = useState<readonly RegistryUpdate[]>(() => {
    const svc = serviceOf<RegistryServiceLike & { updates?: () => readonly RegistryUpdate[] }>(
      ctx,
      'contentRegistry',
    )
    return svc?.updates?.() ?? []
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // ⚠️ `serviceOf` answers a fresh proxy per call, so services are read
    // inside the effect, keyed on `ctx` — never put one in a dep array.
    const readRegistry = () => serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')
    const syncSettings = (s: AppSettings) => setAutoCheck(s.registryAutoCheck !== false)
    const offSettings = ctx.on('settings/changed', syncSettings)
    const offUpdates = ctx.on('registry/updates-available', (list: readonly RegistryUpdate[]) => {
      setUpdates(list)
      setLastCheckedAt(readRegistry()?.lastCheckedAt?.())
    })
    return () => {
      offSettings()
      offUpdates()
    }
  }, [ctx])

  const toggleAutoCheck = (value: boolean) => {
    setAutoCheck(value)
    void serviceOf<SettingsServiceLike>(ctx, 'settings')?.update({ registryAutoCheck: value })
  }

  const runCheck = async () => {
    if (checking) return
    const svc = serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')
    if (!svc) return
    setChecking(true)
    setError(null)
    try {
      const result = await svc.checkUpdates()
      setUpdates(result)
      setLastCheckedAt(svc.lastCheckedAt?.())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const navigateToScreen = () => {
    serviceOf<{ navigate(id: string, params?: Record<string, unknown>): void }>(ctx, 'ui')?.navigate?.(
      REGISTRY_VIEWS.screen,
    )
  }

  return h(
    native.View as never,
    {
      testID: 'registry-settings-card',
      style: { gap: tokens.space[3], paddingVertical: tokens.space[1] },
    },
    // Last check + manual check.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flex: 1, gap: 2 } },
        h(Text, { variant: 'sm', children: t('registry:registrySettings.lastChecked') }),
        h(Text, {
          variant: 'xs',
          tone: 'muted',
          testID: 'registry-last-checked',
          children: formatDateTime(lastCheckedAt),
        }),
      ),
      h(Button, {
        testID: 'registry-check-updates',
        variant: 'primary',
        disabled: checking,
        loading: checking,
        onPress: () => void runCheck(),
        children: checking ? t('registry:registrySettings.checking') : t('registry:registrySettings.checkUpdates'),
      }),
    ),
    // Auto-check toggle.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flex: 1, gap: 2 } },
        h(Text, { variant: 'sm', children: t('registry:registrySettings.dailyAutoCheck') }),
        h(Text, { variant: 'xs', tone: 'muted', children: t('registry:registrySettings.checksForCommunityContentUpdates') }),
      ),
      h(Switch, {
        checked: autoCheck,
        accessibilityLabel: t('registry:registrySettings.dailyAutoCheck'),
        onChange: toggleAutoCheck,
      }),
    ),
    error
      ? h(
          native.View as never,
          {
            key: 'error',
            testID: 'registry-check-error',
            style: { padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.state.error },
          },
          h(Text, { variant: 'xs', tone: 'error', children: error }),
        )
      : null,
    // Update list — each row jumps to the Discover screen.
    updates.length > 0
      ? h(
          native.View as never,
          { key: 'updates', style: { gap: tokens.space[1] } },
          h(Text, { variant: 'sm', children: t('registry:registrySettings.updatesAvailableCount', { count: updates.length }) }),
          updates.map((update) =>
            h(
              native.Pressable as never,
              {
                key: `${update.kind}:${update.id}`,
                testID: `registry-update-item-${update.id}`,
                accessibilityRole: 'button',
                accessibilityLabel: update.name,
                onPress: navigateToScreen,
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: tokens.space[2],
                  padding: tokens.space[2],
                  borderRadius: tokens.radius.sm,
                  borderWidth: 1,
                  borderColor: p.border.subtle,
                },
              },
              update.builtin ? h(Text, { variant: 'xs', tone: 'muted', children: t('registry:registrySettings.builtIn') }) : null,
              h(Text, { variant: 'sm', children: update.name }),
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                `${update.installedVersion} → ${update.availableVersion}`,
              ),
            ),
          ),
        )
      : h(
          Text,
          { key: 'no-updates', variant: 'xs', tone: 'muted', testID: 'registry-updates-empty' },
          t('registry:registrySettings.everythingIsUpToDate'),
        ),
  )
}

/**
 * The card's toggle switch — the same presentation-only spelling as the
 * settings screen's schema form rows (this package cannot import a sibling
 * view package, and a switch is six lines of primitives).
 */
function Switch(props: {
  checked: boolean
  accessibilityLabel: string
  onChange: (checked: boolean) => void
}): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  return h(
    native.Pressable as never,
    {
      onPress: () => props.onChange(!props.checked),
      accessibilityRole: 'switch',
      accessibilityLabel: props.accessibilityLabel,
      accessibilityState: { checked: props.checked },
      style: {
        width: 48,
        height: 26,
        borderRadius: 13,
        backgroundColor: props.checked ? p.accent.base : p.bg.overlay,
        justifyContent: 'center',
        padding: 2,
      },
    },
    h(native.View as never, {
      style: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: props.checked ? p.accent.on : p.text.secondary,
        transform: [{ translateX: props.checked ? 22 : 0 }],
      },
    }),
  )
}
