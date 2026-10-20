import { Button, Sheet, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PluginInfo, RegistryPluginEntry } from '@BBeBee/protocol'

/** Opens a URL outside the app without touching platform SDKs (rules/ui.md §11.3). */
function openExternalUrl(url: string): void {
  const bbebee = (
    window as unknown as {
      BBeBee?: { shell?: { openExternal?: (url: string) => Promise<void> | void } }
    }
  ).BBeBee
  if (bbebee?.shell?.openExternal) {
    void bbebee.shell.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}

export interface PluginMarketDetailProps {
  ctx: Context
  entry: RegistryPluginEntry | null
  installed?: PluginInfo
  busyKind: 'install' | 'update' | 'uninstall' | null
  onClose: () => void
  onInstall?: () => void
}

/** Read-only detail view for one registry entry. */
export function PluginMarketDetail({
  ctx,
  entry,
  installed,
  busyKind,
  onClose,
  onInstall,
}: PluginMarketDetailProps): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    Sheet,
    {
      open: entry !== null,
      onClose,
      title: entry?.name ?? '',
      accessibilityLabel: entry ? t('settings:pluginMarket.details') : '',
    },
    entry
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              fontSize: 13,
              color: 'var(--bb-text-primary, #F8FAFC)',
            },
          },
          entry.screenshot
            ? h('img', {
                src: entry.screenshot,
                alt: entry.name,
                referrerPolicy: 'no-referrer',
                onError: (e: { currentTarget: HTMLImageElement }) => {
                  e.currentTarget.style.display = 'none'
                },
                style: {
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                },
              })
            : null,
          h('p', { style: { margin: 0, lineHeight: 1.5 } }, entry.description),
          h(DetailRow, {
            label: t('settings:pluginMarket.authorLabel'),
            value: entry.author,
          }),
          h(DetailRow, {
            label: t('settings:pluginMarket.categoryLabel'),
            value: entry.category,
          }),
          h(DetailRow, {
            label: t('settings:pluginMarket.platformsLabel'),
            value: entry.platforms.join(', '),
          }),
          installed
            ? h(DetailRow, {
                label: t('settings:pluginMarket.installedVersionLabel'),
                value: installed.version,
              })
            : null,
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { fontSize: 12, fontWeight: 600, color: 'var(--bb-text-secondary, #8E8E93)' } },
              t('settings:pluginMarket.servicesLabel'),
            ),
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              entry.services.map((s) =>
                h(
                  'code',
                  {
                    key: s,
                    style: {
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      fontFamily: 'ui-monospace, monospace',
                    },
                  },
                  s,
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { fontSize: 12, fontWeight: 600, color: 'var(--bb-text-secondary, #8E8E93)' } },
              t('settings:pluginMarket.dependenciesLabel'),
            ),
            h(
              'div',
              { style: { fontSize: 12, color: 'var(--bb-text-secondary, #8E8E93)' } },
              entry.dependencies.length > 0
                ? entry.dependencies.join(', ')
                : t('settings:pluginMarket.noDependencies'),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
            entry.homepage
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => openExternalUrl(entry.homepage as string),
                    style: linkStyle,
                  },
                  t('settings:pluginMarket.homepageLabel'),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: () => openExternalUrl(entry.repo),
                style: linkStyle,
              },
              t('settings:pluginMarket.repositoryLabel'),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 } },
            h(Button, {
              variant: 'secondary',
              children: t('app:common.close'),
              onPress: onClose,
            }),
            !installed && onInstall
              ? h(Button, {
                  variant: 'primary',
                  disabled: busyKind !== null,
                  loading: busyKind === 'install',
                  children: t('settings:pluginMarket.install'),
                  onPress: onInstall,
                })
              : null,
          ),
        )
      : null,
  )
}

const linkStyle: Record<string, string | number> = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--bb-accent, #6366F1)',
  textDecoration: 'underline',
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', gap: 8, fontSize: 12 } },
    h(
      'span',
      { style: { color: 'var(--bb-text-secondary, #8E8E93)', minWidth: 64 } },
      label,
    ),
    h('span', { style: { color: 'var(--bb-text-primary, #F8FAFC)' } }, value),
  )
}
