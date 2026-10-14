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
  const [newVarKey, setNewVarKey] = useState('')
  const [newVarValue, setNewVarValue] = useState('')
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

  const declaredSecretKeys = (params?.secretKeys ?? []).filter(
    (key) =>
      key !== 'var' ||
      record?.doc?.loginType === 'variable' ||
      record?.doc?.variableComment ||
      record?.doc?.loginUi?.some((f) => f.id === 'var'),
  )

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveParams({
        sourceUrl: host.trim(),
        host: host.trim(),
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
      host: host.trim(),
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
            // Host Section
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

            // Credentials Section
            ...(declaredSecretKeys.length > 0
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
                      h(Text, { variant: 'sm' }, t('sources:sourceConfigure.credentials')),
                      h(
                        Text,
                        { variant: 'xs', tone: 'accent' },
                        t('sources:sourceConfigure.keychainNote'),
                      ),
                    ),
                    ...declaredSecretKeys.map((key) => {
                      const isPass = isPasswordKey(key)
                      return h(
                        native.View as never,
                        { key, style: { gap: tokens.space[1] } },
                        h(Text, { variant: 'xs', tone: 'muted' }, key),
                        h(TextField, {
                          value: secrets[key] ?? '',
                          onChange: (val) => setSecrets((prev) => ({ ...prev, [key]: val })),
                          placeholder: secrets[key] ? '••••••••' : t('sources:sourceConfigure.enterKeyPlaceholder', { key }),
                          secure: isPass,
                          accessibilityLabel: key,
                          testID: `source-configure-${key}`,
                        }),
                      )
                    }),
                  ),
                ]
              : []),

            // Custom Variables Section
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
              ...Object.entries(vars).map(([k, v]) =>
                h(
                  native.View as never,
                  {
                    key: k,
                    style: { flexDirection: 'row', gap: tokens.space[2], alignItems: 'center' },
                  },
                  h(
                    native.View as never,
                    { style: { width: 80 } },
                    h(Text, { variant: 'xs' }, k),
                  ),
                  h(
                    native.View as never,
                    { style: { flex: 1 } },
                    h(TextField, {
                      value: v,
                      onChange: (val) => setVars((prev) => ({ ...prev, [k]: val })),
                      accessibilityLabel: t('sources:sourceConfigure.variableLabel', { k }),
                      testID: `source-configure-var-${k}`,
                    }),
                  ),
                  h(Button, {
                    variant: 'ghost',
                    onPress: () => {
                      setVars((prev) => {
                        const next = { ...prev }
                        delete next[k]
                        return next
                      })
                    },
                    accessibilityLabel: t('sources:sourceConfigure.deleteVariable', { k }),
                    testID: `source-configure-var-del-${k}`,
                    children: '✕',
                  }),
                ),
              ),
              // Add variable row
              h(
                native.View as never,
                { style: { flexDirection: 'row', gap: tokens.space[2], alignItems: 'center' } },
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(TextField, {
                    value: newVarKey,
                    onChange: setNewVarKey,
                    placeholder: t('sources:sourceConfigure.newKey'),
                    accessibilityLabel: t('sources:sourceConfigure.newVariableKeyLabel'),
                    testID: 'source-configure-new-var-key',
                  }),
                ),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(TextField, {
                    value: newVarValue,
                    onChange: setNewVarValue,
                    placeholder: t('sources:sourceConfigure.value'),
                    accessibilityLabel: t('sources:sourceConfigure.newVariableValueLabel'),
                    testID: 'source-configure-new-var-val',
                  }),
                ),
                h(Button, {
                  variant: 'secondary',
                  disabled: !newVarKey.trim(),
                  onPress: () => {
                    if (!newVarKey.trim()) return
                    setVars((prev) => ({ ...prev, [newVarKey.trim()]: newVarValue }))
                    setNewVarKey('')
                    setNewVarValue('')
                  },
                  testID: 'source-configure-add-var-btn',
                  children: t('sources:sourceConfigure.add'),
                }),
              ),
            ),

            // Connectivity Probe Section
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
