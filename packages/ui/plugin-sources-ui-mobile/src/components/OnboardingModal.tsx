/**
 * The onboarding guide — the mobile transcription of the desktop twin's
 * `OnboardingModal`, with a deliberate cut: **the plugins step does not
 * exist here.** Plugin management is a desktop surface, so the mobile guide
 * renders the sources step's two cards (local scanner, third-party import)
 * directly, with no step tabs to show a single entry.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { FsService, ScannerService, StoreService, UiService, Uri } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, Sheet, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

const LIBRARY_LOCAL_VIEW = 'library.local'

export interface OnboardingModalProps {
  ctx: Context
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ ctx, open, onClose }: OnboardingModalProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  // `addFolder` runs once; the state exists so a second tap can't double-add.
  const [adding, setAdding] = useState(false)

  if (!open) return null

  const markCompleted = () => {
    const store = serviceOf<StoreService>(ctx, 'store')
    void store?.set?.('onboarding.completed', true)
    onClose()
  }

  const handleAddFolder = async () => {
    if (adding) return
    setAdding(true)
    try {
      let uri: string | undefined = undefined
      const fs = serviceOf<FsService>(ctx, 'fs')
      if (fs?.pickDirectory) {
        try {
          uri = await fs.pickDirectory()
        } catch (err) {
          ctx.logger?.warn?.(`fs.pickDirectory failed: ${String(err)}`)
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
        serviceOf<UiService>(ctx, 'ui')?.navigate?.('scanner.settings')
      }
      markCompleted()
    } finally {
      setAdding(false)
    }
  }

  return h(
    Sheet,
    {
      open,
      onClose: markCompleted,
      title: t('sources:recommend.onboarding.modalTitle'),
    },
    h(
      native.View as never,
      { testID: 'onboarding-modal-content', style: { gap: tokens.space[4], paddingTop: tokens.space[3] } },
      // Step 1: Music sources — the only step on mobile.
      h(Text, { variant: 'sm', tone: 'accent', children: t('sources:recommend.onboarding.stepDataSources') }),
      // Local music
      h(
        native.View as never,
        {
          style: {
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.06)',
            gap: tokens.space[2],
          },
        },
        h(Text, { variant: 'md', children: t('sources:recommend.onboarding.localMusicTitle') }),
        h(Text, { variant: 'xs', tone: 'muted', children: t('sources:recommend.onboarding.localMusicDesc') }),
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[1] } },
          h(Button, {
            testID: 'modal-add-folder-btn',
            onPress: () => void handleAddFolder(),
            loading: adding,
            children: t('sources:recommend.onboarding.addFolder'),
          }),
          h(Button, {
            variant: 'ghost',
            testID: 'modal-view-local-btn',
            onPress: () => {
              markCompleted()
              serviceOf<UiService>(ctx, 'ui')?.navigate?.(LIBRARY_LOCAL_VIEW)
            },
            children: t('sources:recommend.onboarding.manageLocal'),
          }),
        ),
      ),
      // Third-party source
      h(
        native.View as never,
        {
          style: {
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.06)',
            gap: tokens.space[2],
          },
        },
        h(Text, { variant: 'md', children: t('sources:recommend.onboarding.thirdPartyTitle') }),
        h(Text, { variant: 'xs', tone: 'muted', children: t('sources:recommend.onboarding.thirdPartyDesc') }),
        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[1] } },
          h(Button, {
            testID: 'modal-import-source-btn',
            onPress: () => {
              markCompleted()
              serviceOf<UiService>(ctx, 'ui')?.navigate?.(SOURCES_VIEWS.sourceImport)
            },
            children: t('sources:recommend.onboarding.importSource'),
          }),
        ),
      ),
      h(Button, {
        testID: 'onboarding-finish-btn',
        onPress: markCompleted,
        children: t('sources:recommend.onboarding.getStarted'),
      }),
    ),
  )
}
