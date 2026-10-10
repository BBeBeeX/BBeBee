import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ScanSpecifiedDir, ScannerService, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  isLocalSource,
  useLocalFolders,
  useSources,
} from '@BBeBee/plugin-sources/hooks'
import { Button, EmptyState, IconButton, Text } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { SourceConfigureModal } from '../components/SourceConfigureModal.js'

const p = () => palettes.dark

export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
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
    h(Text, { variant: 'lg' }, 'Music sources'),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceImport),
        testID: 'sources-list-import',
        children: 'Import a source',
      }),
    ),
    sources.length === 0
      ? h(EmptyState, {
          title: 'No sources yet',
          description: 'Import a source string to add a music backend.',
        })
      : h(
          'ul',
          {
            'aria-label': 'Imported sources',
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
                    ? [h(Text, { variant: 'sm', tone: 'muted' }, 'disabled')]
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
                    children: 'Test',
                  }),
                  !local
                    ? h(Button, {
                        variant: 'secondary',
                        onPress: () => setConfiguringSourceId(source.id),
                        testID: `sources-list-configure-${source.id}`,
                        children: 'Configure',
                      })
                    : null,
                  !local
                    ? h(Button, {
                        variant: source.enabled ? 'ghost' : 'secondary',
                        onPress: () => void ctx.sources.setEnabled(source.id, !source.enabled),
                        accessibilityLabel: source.enabled ? `Stop using ${source.name}` : `Use ${source.name}`,
                        testID: `sources-list-toggle-${source.id}`,
                        children: source.enabled ? 'Disable' : 'Enable',
                      })
                    : null,
                  !local
                    ? confirming === source.id
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                          h(Text, { variant: 'sm', tone: 'warn' }, 'Delete source and its cached tracks?'),
                          h(Button, {
                            onPress: () => removeSource(source.id),
                            accessibilityLabel: `Delete ${source.name} and its cached tracks`,
                            testID: `sources-list-delete-confirm-${source.id}`,
                            children: 'Delete',
                          }),
                          h(Button, {
                            variant: 'ghost',
                            onPress: () => setConfirming(undefined),
                            children: 'Cancel',
                          }),
                        )
                      : h(IconButton, {
                          icon: 'trash',
                          accessibilityLabel: `Delete ${source.name}`,
                          onPress: () => setConfirming(source.id),
                          testID: `sources-list-delete-${source.id}`,
                        })
                    : null,
                ),
              ),
              local ? h(LocalFolders, { folders, scanner }) : null,
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
}: {
  folders: readonly ScanSpecifiedDir[]
  scanner: ScannerService | undefined
}): ReactElement | null {
  const scheme = p()
  if (!scanner) return null
  if (folders.length === 0) {
    return h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: 'No folders yet — add one under Settings → Music folders.',
    })
  }
  return h(
    'ul',
    {
      'aria-label': 'Local music folders',
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
            accessibilityLabel: dir.enabled ? `Disable ${dir.uri}` : `Enable ${dir.uri}`,
            testID: `source-folder-toggle-${dir.id}`,
            children: dir.enabled ? 'Disable' : 'Enable',
          }),
          h(IconButton, {
            icon: 'trash',
            accessibilityLabel: `Remove ${dir.uri}`,
            onPress: () => void scanner.removeSpecifiedDir(dir.id),
            testID: `source-folder-remove-${dir.id}`,
          }),
        ),
      ),
    ),
  )
}
