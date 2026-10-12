import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ScanSpecifiedDir, ScannerService, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  isLocalSource,
  useLocalFolders,
  useSources,
} from '@BBeBee/plugin-sources/hooks'
import { Button, EmptyState, IconButton, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import type { I18nService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { SourceConfigureModal } from '../components/SourceConfigureModal.js'

const p = () => palettes.dark

export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const scheme = p()
  const sources = useSources(ctx)
  const folders = useLocalFolders(ctx)
  const scanner = serviceOf<ScannerService>(ctx, 'scanner')
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const [configuringSourceId, setConfiguringSourceId] = useState<string | undefined>(undefined)

  const removeSource = (id: string) => {
    setConfirming(undefined)
    void ctx.sources.remove(id, { forgetCatalogue: true })
  }

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, t('sources:sourcesList.musicSources')),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceImport),
        testID: 'sources-list-import',
        children: t('sources:import.importASource'),
      }),
    ),
    sources.length === 0
      ? h(EmptyState, {
          title: t('sources:sourcesList.noSourcesYet'),
          description: t('sources:sourcesList.importASourceStringTo'),
        })
      : h(
          'ul',
          {
            'aria-label': t('sources:sourcesList.importedSources'),
            style: {
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
            },
          },
          ...sources.map((source) => {
            const local = isLocalSource(source)
            return h(
              'li',
              {
                key: source.id,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  background: scheme.bg.raised,
                  opacity: source.enabled ? 1 : 0.6,
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: tokens.space[3],
                  },
                },
                h(
                  'div',
                  { style: { minWidth: 0 } },
                  h(Text, { variant: 'md' }, source.name),
                  h(Text, { variant: 'sm', tone: 'muted' }, source.sourceUrl),
                  ...(!source.enabled
                    ? [h(Text, { variant: 'sm', tone: 'muted' }, t('sources:sourcesList.disabled'))]
                    : source.lastError
                      ? [h(Text, { variant: 'sm', tone: 'muted' }, source.lastError)]
                      : []),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
                  h(Button, {
                    variant: 'secondary',
                    onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceTest, { sourceId: source.id }),
                    testID: `sources-list-test-${source.id}`,
                    children: t('sources:sourcesList.test'),
                  }),
                  !local
                    ? h(Button, {
                        variant: 'secondary',
                        onPress: () => setConfiguringSourceId(source.id),
                        testID: `sources-list-configure-${source.id}`,
                        children: t('sources:sourcesList.configure'),
                      })
                    : null,
                  !local
                    ? h(Button, {
                        variant: source.enabled ? 'ghost' : 'secondary',
                        onPress: () => void ctx.sources.setEnabled(source.id, !source.enabled),
                        accessibilityLabel: source.enabled ? t('sources:sourcesList.stopUsing', { name: source.name }) : t('sources:sourcesList.useSource', { name: source.name }),
                        testID: `sources-list-toggle-${source.id}`,
                        children: source.enabled ? t('sources:sourcesList.disable') : t('sources:sourcesList.enable'),
                      })
                    : null,
                  !local
                    ? confirming === source.id
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                          h(Text, { variant: 'sm', tone: 'warn' }, t('sources:sourcesList.deleteSourceConfirm')),
                          h(Button, {
                            onPress: () => removeSource(source.id),
                            accessibilityLabel: t('sources:sourcesList.deleteAndItsCachedTracks', { name: source.name }),
                            testID: `sources-list-delete-confirm-${source.id}`,
                            children: t('app:common.delete'),
                          }),
                          h(Button, {
                            variant: 'ghost',
                            onPress: () => setConfirming(undefined),
                            children: t('app:common.cancel'),
                          }),
                        )
                      : h(IconButton, {
                          icon: 'trash',
                          accessibilityLabel: t('sources:sourcesList.deleteSource', { name: source.name }),
                          onPress: () => setConfirming(source.id),
                          testID: `sources-list-delete-${source.id}`,
                        })
                    : null,
                ),
              ),
              local ? h(LocalFolders, { folders, scanner, t }) : null,
            )
          }),
        ),
    h(SourceConfigureModal, {
      ctx,
      sourceId: configuringSourceId,
      open: configuringSourceId !== undefined,
      onClose: () => setConfiguringSourceId(undefined),
    }),
  )
}

function LocalFolders({
  folders,
  scanner,
  t,
}: {
  folders: readonly ScanSpecifiedDir[]
  scanner: ScannerService | undefined
  t: I18nService['t']
}): ReactElement | null {
  const scheme = p()
  if (!scanner) return null
  if (folders.length === 0) {
    return h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: t('sources:sourcesList.noFoldersYet'),
    })
  }
  return h(
    'ul',
    {
      'aria-label': t('sources:sourcesList.localMusicFolders'),
      style: {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        borderTop: `1px solid ${scheme.border.subtle}`,
        paddingTop: tokens.space[2],
      },
    },
    ...folders.map((dir) =>
      h(
        'li',
        {
          key: dir.id,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: tokens.space[3],
            opacity: dir.enabled ? 1 : 0.5,
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(Text, { variant: 'sm', numberOfLines: 1 }, dir.uri),
          dir.lastError
            ? h(Text, { variant: 'sm', tone: 'error', numberOfLines: 1, children: dir.lastError })
            : null,
        ),
        h(
          'div',
          { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
          h(Button, {
            variant: 'ghost',
            onPress: () => void scanner.setEnabled(dir.id, !dir.enabled),
            accessibilityLabel: dir.enabled ? `${t('sources:sourcesList.disable')} ${dir.uri}` : `${t('sources:sourcesList.enable')} ${dir.uri}`,
            testID: `source-folder-toggle-${dir.id}`,
            children: dir.enabled ? t('sources:sourcesList.disable') : t('sources:sourcesList.enable'),
          }),
          h(IconButton, {
            icon: 'trash',
            accessibilityLabel: t('sources:sourcesList.removeFolder', { uri: dir.uri }),
            onPress: () => void scanner.removeSpecifiedDir(dir.id),
            testID: `source-folder-remove-${dir.id}`,
          }),
        ),
      ),
    ),
  )
}
