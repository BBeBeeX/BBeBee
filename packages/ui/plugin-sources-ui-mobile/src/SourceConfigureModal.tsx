import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SourcePingResult } from '@BBeBee/protocol'
import { useSourceParams } from '@BBeBee/plugin-sources/hooks'
import { Button, Sheet, Text, TextField, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface SourceConfigureModalProps {
  ctx: Context
  sourceId: string | undefined
  open: boolean
  onClose: () => void
}

interface ConfigField {
  id: string
  label: string
  placeholder?: string
  isPassword: boolean
}

function isPasswordKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('pass') || lower.includes('token') || lower.includes('secret')
}

export function SourceConfigureModal({
  ctx,
  sourceId,
  open,
  onClose,
}: SourceConfigureModalProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const { params, record, loading, pingState, testConnection, saveParams } = useSourceParams(
    ctx,
    sourceId,
  )

  const [host, setHost] = useState('')
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [vars, setVars] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [initializedSourceId, setInitializedSourceId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setInitializedSourceId(undefined)
      return
    }
    if (params && initializedSourceId !== sourceId) {
      setHost(params.host || record?.sourceUrl || '')
      setSecrets({ ...params.secrets })
      setVars({ ...params.vars })
      setInitializedSourceId(sourceId)
    }
  }, [open, params, record, sourceId, initializedSourceId])

  if (!open || !sourceId) return null

  // 1. Host parameter: only shown if mentioned in params or self-hosted/subsonic
  const hasHostParam = Boolean(
    record?.doc?.params?.some((p) => {
      const l = p.toLowerCase()
      return l === 'sourceurl' || l === 'source_url' || l === 'host' || l === 'server' || l === 'server_url'
    }) ||
    record?.doc?.sourceGroup?.includes('subsonic') ||
    record?.doc?.sourceGroup?.includes('self-hosted'),
  )

  // 2. Credential fields mentioned by the source
  const credentialFields: ConfigField[] = []
  const seenFieldIds = new Set<string>()

  if (record?.doc?.loginUi && record.doc.loginUi.length > 0) {
    for (const f of record.doc.loginUi) {
      if (!f.id || seenFieldIds.has(f.id)) continue
      seenFieldIds.add(f.id)
      credentialFields.push({
        id: f.id,
        label: f.label || f.id,
        placeholder: f.placeholder,
        isPassword: f.type === 'password' || isPasswordKey(f.id),
      })
    }
  } else {
    if (record?.doc?.loginType === 'variable') {
      seenFieldIds.add('var')
      credentialFields.push({
        id: 'var',
        label: record.doc.variableComment || 'var',
        placeholder: t('sources:sourceConfigure.enterKeyPlaceholder', { key: 'var' }),
        isPassword: true,
      })
    } else if (record?.doc?.sourceGroup?.includes('subsonic')) {
      seenFieldIds.add('user')
      seenFieldIds.add('password')
      credentialFields.push(
        {
          id: 'user',
          label: t('sources:sourceConfigure.username'),
          placeholder: t('sources:sourceConfigure.username'),
          isPassword: false,
        },
        {
          id: 'password',
          label: t('sources:sourceConfigure.password'),
          placeholder: t('sources:sourceConfigure.password'),
          isPassword: true,
        },
      )
    }

    if (record?.doc?.params) {
      for (const p of record.doc.params) {
        const lower = p.toLowerCase()
        if (
          lower === 'sourceurl' ||
          lower === 'source_url' ||
          lower === 'host' ||
          lower === 'server' ||
          lower === 'server_url'
        ) {
          continue
        }
        if ((lower === 'username' && seenFieldIds.has('user')) || (lower === 'user' && seenFieldIds.has('username'))) {
          continue
        }
        if (seenFieldIds.has(p)) continue

        const isSecret = isPasswordKey(p) || params?.secretKeys?.includes(p) || lower === 'user' || lower === 'username'
        if (isSecret) {
          seenFieldIds.add(p)
          credentialFields.push({
            id: p,
            label: p,
            placeholder: t('sources:sourceConfigure.enterKeyPlaceholder', { key: p }),
            isPassword: isPasswordKey(p),
          })
        }
      }
    }
  }

  // 3. Variable keys explicitly mentioned by the source
  const variableKeys: string[] = []
  if (record?.doc?.params) {
    for (const p of record.doc.params) {
      const lower = p.toLowerCase()
      if (
        lower === 'sourceurl' ||
        lower === 'source_url' ||
        lower === 'host' ||
        lower === 'server' ||
        lower === 'server_url'
      ) {
        continue
      }
      if (seenFieldIds.has(p)) continue
      seenFieldIds.add(p)
      variableKeys.push(p)
    }
  }

  // 4. Connectivity test capability
  const hasConnectivityTest = Boolean(
    record?.doc?.sourceGroup?.includes('subsonic') ||
    hasHostParam ||
    record?.doc?.loginUrl,
  )

  const hasAnyParams = hasHostParam || credentialFields.length > 0 || variableKeys.length > 0

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const targetHost = (hasHostParam ? host : (record?.sourceUrl ?? '')).trim()
      await saveParams({
        sourceUrl: targetHost,
        host: targetHost,
        secrets,
        vars,
      })
      onClose()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = () => {
    void testConnection({
      host: (hasHostParam ? host : (record?.sourceUrl ?? '')).trim(),
      user: secrets['user'] ?? secrets['username'],
      password: secrets['password'],
      vars,
    })
  }

  const renderPingBadge = (result: SourcePingResult) => {
    let statusText = t('sources:sourceConfigure.pingUnknown')
    let statusTone: 'ok' | 'warn' | 'error' = 'ok'

    if (result.status === 'ok') {
      statusText = t('sources:sourceConfigure.pingConnected')
      statusTone = 'ok'
    } else if (result.status === 'auth_failed') {
      statusText = t('sources:sourceConfigure.pingAuthFailed')
      statusTone = 'warn'
    } else if (result.status === 'network_error') {
      statusText = t('sources:sourceConfigure.pingNetworkError')
      statusTone = 'error'
    }

    return h(
      native.View as never,
      {
        testID: 'source-configure-ping-result',
        style: {
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          backgroundColor:
            statusTone === 'ok'
              ? 'rgba(52, 199, 89, 0.15)'
              : statusTone === 'warn'
                ? 'rgba(245, 158, 11, 0.15)'
                : 'rgba(239, 68, 68, 0.15)',
          gap: tokens.space[1],
        },
      },
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
        h(Text, { variant: 'sm', tone: statusTone }, statusText),
        result.serverVersion
          ? h(Text, { variant: 'xs', tone: 'muted' }, `v${result.serverVersion}`)
          : null,
        result.latencyMs !== undefined
          ? h(Text, { variant: 'xs', tone: 'muted' }, `${result.latencyMs}ms`)
          : null,
      ),
      result.message ? h(Text, { variant: 'xs', tone: statusTone }, result.message) : null,
    )
  }

  return h(
    Sheet,
    {
      open,
      onClose,
      title: t('sources:sourceConfigure.title', { name: record?.name ?? t('sources:test.sourceWord') }),
      testID: 'source-configure-modal',
    },
    h(
      native.View as never,
      {
        style: {
          gap: tokens.space[3],
          paddingTop: tokens.space[3],
        },
      },
      loading && !params
        ? h(Text, { variant: 'sm', tone: 'muted' }, t('sources:sourceConfigure.loadingParameters'))
        : h(
            native.View as never,
            { style: { gap: tokens.space[3] } },
            // Host Section (only if mentioned)
            ...(hasHostParam
              ? [
                  h(
                    native.View as never,
                    { style: { gap: tokens.space[1] } },
                    h(Text, { variant: 'sm' }, t('sources:sourceConfigure.serverHostLabel')),
                    h(TextField, {
                      value: host,
                      onChange: setHost,
                      placeholder: 'https://music.example.org',
                      accessibilityLabel: t('sources:sourceConfigure.serverHostLabel'),
                      testID: 'source-configure-host',
                    }),
                    h(
                      Text,
                      { variant: 'xs', tone: 'muted' },
                      t('sources:sourceConfigure.hostHint'),
                    ),
                  ),
                ]
              : []),

            // Credentials Section (only if mentioned)
            ...(credentialFields.length > 0
              ? [
                  h(
                    native.View as never,
                    {
                      style: {
                        gap: tokens.space[2],
                        borderTopWidth: hasHostParam ? 1 : 0,
                        borderTopColor: 'rgba(148, 163, 184, 0.14)',
                        paddingTop: hasHostParam ? tokens.space[2] : 0,
                      },
                    },
                    h(
                      native.View as never,
                      { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
                      h(Text, { variant: 'sm' }, t('sources:sourceConfigure.credentials')),
                      h(
                        Text,
                        { variant: 'xs', tone: 'accent' },
                        t('sources:sourceConfigure.keychainNote'),
                      ),
                    ),
                    ...credentialFields.map((field) => {
                      const placeholder =
                        field.placeholder ||
                        (secrets[field.id] && field.isPassword
                          ? '••••••••'
                          : t('sources:sourceConfigure.enterKeyPlaceholder', { key: field.label }))
                      return h(
                        native.View as never,
                        { key: field.id, style: { gap: tokens.space[1] } },
                        h(Text, { variant: 'xs', tone: 'muted' }, field.label),
                        h(TextField, {
                          value: secrets[field.id] ?? '',
                          onChange: (val) => setSecrets((prev) => ({ ...prev, [field.id]: val })),
                          placeholder,
                          secure: field.isPassword,
                          accessibilityLabel: field.label,
                          testID: `source-configure-${field.id}`,
                        }),
                      )
                    }),
                  ),
                ]
              : []),

            // Variables Section (only if explicitly declared in doc.params)
            ...(variableKeys.length > 0
              ? [
                  h(
                    native.View as never,
                    {
                      style: {
                        gap: tokens.space[2],
                        borderTopWidth: 1,
                        borderTopColor: 'rgba(148, 163, 184, 0.14)',
                        paddingTop: tokens.space[2],
                      },
                    },
                    h(Text, { variant: 'sm' }, t('sources:sourceConfigure.variables')),
                    ...variableKeys.map((k) =>
                      h(
                        native.View as never,
                        { key: k, style: { gap: tokens.space[1] } },
                        h(Text, { variant: 'xs', tone: 'muted' }, k),
                        h(TextField, {
                          value: vars[k] ?? '',
                          onChange: (val) => setVars((prev) => ({ ...prev, [k]: val })),
                          accessibilityLabel: t('sources:sourceConfigure.variableLabel', { k }),
                          testID: `source-configure-var-${k}`,
                        }),
                      ),
                    ),
                  ),
                ]
              : []),

            // No parameters notice
            ...(!hasAnyParams
              ? [
                  h(
                    native.View as never,
                    { style: { padding: tokens.space[2], alignItems: 'center' } },
                    h(Text, { variant: 'sm', tone: 'muted' }, t('sources:sourceConfigure.noConfigurableParams')),
                  ),
                ]
              : []),

            // Connectivity Probe Section
            ...(hasConnectivityTest
              ? [
                  h(
                    native.View as never,
                    {
                      style: {
                        gap: tokens.space[2],
                        borderTopWidth: 1,
                        borderTopColor: 'rgba(148, 163, 184, 0.14)',
                        paddingTop: tokens.space[2],
                      },
                    },
                    h(
                      native.View as never,
                      { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
                      h(Text, { variant: 'sm' }, t('sources:sourceConfigure.connectivityTest')),
                      h(Button, {
                        variant: 'secondary',
                        loading: pingState.loading,
                        onPress: handleTest,
                        testID: 'source-configure-test-btn',
                        children: pingState.loading ? t('sources:sourceConfigure.testing') : t('sources:sourceConfigure.testConnection'),
                      }),
                    ),
                    pingState.result ? renderPingBadge(pingState.result) : null,
                  ),
                ]
              : []),

            saveError ? h(Text, { variant: 'sm', tone: 'error' }, saveError) : null,

            // Action Buttons
            h(
              native.View as never,
              {
                style: {
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  gap: tokens.space[2],
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(148, 163, 184, 0.14)',
                  paddingTop: tokens.space[2],
                },
              },
              h(Button, {
                variant: 'ghost',
                onPress: onClose,
                testID: 'source-configure-cancel-btn',
                children: t('app:common.cancel'),
              }),
              h(Button, {
                variant: 'primary',
                loading: saving,
                onPress: handleSave,
                testID: 'source-configure-save-btn',
                children: t('sources:sourceConfigure.saveParameters'),
              }),
            ),
          ),
    ),
  )
}
