import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { FsService, ScannerService, StoreService, UiService, Uri } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, Sheet, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

const LIBRARY_LOCAL_VIEW = 'library.local'
const REGISTRY_SCREEN_VIEW = 'registry.screen'

export interface OnboardingModalProps {
  ctx: Context
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ ctx, open, onClose }: OnboardingModalProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const ui = serviceOf<UiService>(ctx, 'ui')
  const [activeStep, setActiveStep] = useState<'sources' | 'plugins'>('sources')

  if (!open) return null

  const markCompleted = () => {
    const store = serviceOf<StoreService>(ctx, 'store')
    void store?.set?.('onboarding.completed', true)
    onClose()
  }

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
    markCompleted()
  }

  return h(
    Sheet,
    {
      open,
      onClose: markCompleted,
      title: t('sources:recommend.onboarding.modalTitle'),
    },
    h(
      'div',
      {
        'data-testid': 'onboarding-modal-content',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minWidth: 420,
          maxWidth: 540,
        },
      },
      // Step Selector Tabs
      h(
        'div',
        {
          style: {
            display: 'flex',
            background: 'var(--surface-2, rgba(255, 255, 255, 0.05))',
            borderRadius: tokens.radius.md,
            padding: 4,
            gap: 4,
          },
        },
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'onboarding-tab-sources',
            onClick: () => setActiveStep('sources'),
            style: {
              flex: 1,
              padding: '8px 12px',
              borderRadius: tokens.radius.sm,
              border: 'none',
              cursor: 'pointer',
              fontWeight: activeStep === 'sources' ? 600 : 400,
              fontSize: 13,
              background: activeStep === 'sources' ? 'var(--color-primary, #5F87FF)' : 'transparent',
              color: activeStep === 'sources' ? '#FFFFFF' : 'var(--text-secondary, #A0A6BA)',
              transition: 'all 0.15s ease',
            },
          },
          t('sources:recommend.onboarding.stepDataSources'),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'onboarding-tab-plugins',
            onClick: () => setActiveStep('plugins'),
            style: {
              flex: 1,
              padding: '8px 12px',
              borderRadius: tokens.radius.sm,
              border: 'none',
              cursor: 'pointer',
              fontWeight: activeStep === 'plugins' ? 600 : 400,
              fontSize: 13,
              background: activeStep === 'plugins' ? 'var(--color-primary, #5F87FF)' : 'transparent',
              color: activeStep === 'plugins' ? '#FFFFFF' : 'var(--text-secondary, #A0A6BA)',
              transition: 'all 0.15s ease',
            },
          },
          t('sources:recommend.onboarding.stepPlugins'),
        ),
      ),
      // Step Content
      activeStep === 'sources'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            // Local music
            h(
              'div',
              {
                style: {
                  padding: 14,
                  borderRadius: tokens.radius.md,
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                tablerIcon('folder', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
                h(
                  'span',
                  { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
                  t('sources:recommend.onboarding.localMusicTitle'),
                ),
              ),
              h(
                'p',
                { style: { fontSize: 13, color: 'var(--text-tertiary, #8B95B0)', margin: 0, lineHeight: 1.5 } },
                t('sources:recommend.onboarding.localMusicDesc'),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, marginTop: 4 } },
                h(Button, {
                  testID: 'modal-add-folder-btn',
                  onPress: handleAddFolder,
                  children: t('sources:recommend.onboarding.addFolder'),
                }),
                h(Button, {
                  variant: 'ghost',
                  testID: 'modal-view-local-btn',
                  onPress: () => {
                    markCompleted()
                    ui?.navigate?.(LIBRARY_LOCAL_VIEW)
                  },
                  children: t('sources:recommend.onboarding.manageLocal'),
                }),
              ),
            ),
            // Third-party source
            h(
              'div',
              {
                style: {
                  padding: 14,
                  borderRadius: tokens.radius.md,
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                tablerIcon('world-download', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
                h(
                  'span',
                  { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
                  t('sources:recommend.onboarding.thirdPartyTitle'),
                ),
              ),
              h(
                'p',
                { style: { fontSize: 13, color: 'var(--text-tertiary, #8B95B0)', margin: 0, lineHeight: 1.5 } },
                t('sources:recommend.onboarding.thirdPartyDesc'),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, marginTop: 4 } },
                h(Button, {
                  testID: 'modal-import-source-btn',
                  onPress: () => {
                    markCompleted()
                    ui?.navigate?.(SOURCES_VIEWS.sourceImport)
                  },
                  children: t('sources:recommend.onboarding.importSource'),
                }),
              ),
            ),
          )
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'div',
              {
                style: {
                  padding: 14,
                  borderRadius: tokens.radius.md,
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                tablerIcon('puzzle', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
                h(
                  'span',
                  { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #F5F7FF)' } },
                  t('sources:recommend.onboarding.pluginsTitle'),
                ),
              ),
              h(
                'p',
                { style: { fontSize: 13, color: 'var(--text-tertiary, #8B95B0)', margin: 0, lineHeight: 1.5 } },
                t('sources:recommend.onboarding.pluginsDesc'),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, marginTop: 4 } },
                h(Button, {
                  variant: 'secondary',
                  testID: 'modal-explore-plugins-btn',
                  onPress: () => {
                    markCompleted()
                    ui?.navigate?.(REGISTRY_SCREEN_VIEW)
                  },
                  children: t('sources:recommend.onboarding.explorePlugins'),
                }),
              ),
            ),
          ),
      // Modal Actions
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(Button, {
          testID: 'onboarding-finish-btn',
          onPress: markCompleted,
          children: t('sources:recommend.onboarding.getStarted'),
        }),
      ),
    ),
  )
}
