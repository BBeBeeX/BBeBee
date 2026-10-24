import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { FsService, ScannerService, UiService, Uri } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

const LIBRARY_LOCAL_VIEW = 'library.local'
const REGISTRY_SCREEN_VIEW = 'registry.screen'

export interface OnboardingHeroProps {
  ctx: Context
  onOpenGuide?: () => void
}

export function OnboardingHero({ ctx, onOpenGuide }: OnboardingHeroProps): ReactElement {
  const { t } = useI18n(ctx)
  const ui = serviceOf<UiService>(ctx, 'ui')

  const handleAddFolder = async () => {
    let uri: string | undefined = undefined
    const fs = serviceOf<FsService>(ctx, 'fs')
    if (fs?.pickDirectory) {
      try {
        uri = await fs.pickDirectory()
      } catch (err) {
        ctx.logger?.warn?.(`fs.pickDirectory failed: ${String(err)}`)
      }
    }
    if (!uri) {
      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as { BBeBee?: { dialog?: { pickDirectory?: () => Promise<string | undefined> } } }).BBeBee
          : undefined
      if (bridge?.dialog?.pickDirectory) {
        try {
          const picked = await bridge.dialog.pickDirectory()
          if (picked) {
            const normalized = picked.replace(/\\/g, '/')
            uri = normalized.startsWith('file://')
              ? normalized
              : normalized.startsWith('/')
                ? `file://${normalized}`
                : `file:///${normalized}`
          }
        } catch (err) {
          ctx.logger?.warn?.(`bridge.dialog.pickDirectory failed: ${String(err)}`)
        }
      }
    }

    const scanner = serviceOf<ScannerService>(ctx, 'scanner')
    if (uri && scanner) {
      try {
        const dir = await scanner.addSpecifiedDir(uri as Uri)
        void scanner.scan({ specifiedDirId: dir.id })
      } catch (err) {
        ctx.logger?.warn?.(`scanner.addSpecifiedDir failed: ${String(err)}`)
      }
    } else {
      ui?.navigate?.('scanner.settings')
    }
  }

  return h(
    'div',
    {
      'data-testid': 'onboarding-hero',
      style: {
        maxWidth: 880,
        width: '100%',
        margin: '16px auto',
        padding: '32px 28px',
        borderRadius: tokens.radius.lg,
        background: 'var(--surface-1, rgba(255, 255, 255, 0.03))',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        boxSizing: 'border-box',
      },
    },
    // Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 8,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 54,
            height: 54,
            borderRadius: 999,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            color: 'var(--color-primary, #5F87FF)',
            boxShadow: '0 0 24px rgba(95, 135, 255, 0.15)',
            marginBottom: 4,
          },
        },
        tablerIcon('sparkles', { size: 28 }),
      ),
      h(
        'h2',
        {
          style: {
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary, #F5F7FF)',
            margin: 0,
            letterSpacing: '-0.02em',
          },
        },
        t('sources:recommend.onboarding.welcomeTitle'),
      ),
      h(
        'p',
        {
          style: {
            fontSize: 14,
            color: 'var(--text-secondary, #A0A6BA)',
            margin: 0,
            maxWidth: 620,
            lineHeight: 1.6,
          },
        },
        t('sources:recommend.onboarding.welcomeSubtitle'),
      ),
    ),
    // Section 1: Music Sources
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        tablerIcon('database', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
        h(
          'span',
          {
            style: {
              fontWeight: 600,
              fontSize: 15,
              color: 'var(--text-primary, #F5F7FF)',
            },
          },
          t('sources:recommend.onboarding.stepDataSources'),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          },
        },
        // Card 1A: Local Music
        h(
          'div',
          {
            style: {
              padding: '20px',
              borderRadius: tokens.radius.md,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            tablerIcon('folder', { size: 22, color: 'var(--color-primary, #5F87FF)' }),
            h(
              'span',
              { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
              t('sources:recommend.onboarding.localMusicTitle'),
            ),
          ),
          h(
            'p',
            {
              style: {
                fontSize: 13,
                color: 'var(--text-tertiary, #8B95B0)',
                margin: 0,
                lineHeight: 1.5,
                flex: 1,
              },
            },
            t('sources:recommend.onboarding.localMusicDesc'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 4 } },
            h(Button, {
              testID: 'onboarding-add-folder',
              onPress: handleAddFolder,
              children: t('sources:recommend.onboarding.addFolder'),
            }),
            h(Button, {
              variant: 'ghost',
              testID: 'onboarding-manage-local',
              onPress: () => ui?.navigate?.(LIBRARY_LOCAL_VIEW),
              children: t('sources:recommend.onboarding.manageLocal'),
            }),
          ),
        ),
        // Card 1B: Third-party sources
        h(
          'div',
          {
            style: {
              padding: '20px',
              borderRadius: tokens.radius.md,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            tablerIcon('world-download', { size: 22, color: 'var(--color-primary, #5F87FF)' }),
            h(
              'span',
              { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
              t('sources:recommend.onboarding.thirdPartyTitle'),
            ),
          ),
          h(
            'p',
            {
              style: {
                fontSize: 13,
                color: 'var(--text-tertiary, #8B95B0)',
                margin: 0,
                lineHeight: 1.5,
                flex: 1,
              },
            },
            t('sources:recommend.onboarding.thirdPartyDesc'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 4 } },
            h(Button, {
              testID: 'onboarding-import-source',
              onPress: () => ui?.navigate?.(SOURCES_VIEWS.sourceImport),
              children: t('sources:recommend.onboarding.importSource'),
            }),
          ),
        ),
      ),
    ),
    // Section 2: Plugins
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        tablerIcon('puzzle', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
        h(
          'span',
          {
            style: {
              fontWeight: 600,
              fontSize: 15,
              color: 'var(--text-primary, #F5F7FF)',
            },
          },
          t('sources:recommend.onboarding.stepPlugins'),
        ),
      ),
      h(
        'div',
        {
          style: {
            padding: '20px',
            borderRadius: tokens.radius.md,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 } },
          h(
            'span',
            { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
            t('sources:recommend.onboarding.pluginsTitle'),
          ),
          h(
            'p',
            {
              style: {
                fontSize: 13,
                color: 'var(--text-tertiary, #8B95B0)',
                margin: 0,
                lineHeight: 1.5,
              },
            },
            t('sources:recommend.onboarding.pluginsDesc'),
          ),
        ),
        h(Button, {
          variant: 'secondary',
          testID: 'onboarding-explore-plugins',
          onPress: () => ui?.navigate?.(REGISTRY_SCREEN_VIEW),
          children: t('sources:recommend.onboarding.explorePlugins'),
        }),
      ),
    ),
    // Footer Guide Trigger
    onOpenGuide
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'center',
              marginTop: 4,
            },
          },
          h(Button, {
            variant: 'ghost',
            testID: 'onboarding-open-modal-btn',
            onPress: onOpenGuide,
            children: `💡 ${t('sources:recommend.onboarding.quickStartGuide')}`,
          }),
        )
      : null,
  )
}
