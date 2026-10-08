/**
 * Desktop Debug Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Shows debug status, environment details, and navigation to discover/HTTP logs.
 */

import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { UiService, DeviceService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'

interface WindowWithBBeBee {
  BBeBee?: {
    platform?: string
    versions?: { electron?: string; node?: string }
    isDebug?: boolean
    devtools?: { open(): Promise<void> }
  }
}

export function DebugScreen({ ctx }: { ctx: Context }): ReactElement {
  const ui = serviceOf<UiService>(ctx, 'ui')
  const device = serviceOf<DeviceService>(ctx, 'device')
  const bbebee = typeof window !== 'undefined' ? (window as unknown as WindowWithBBeBee).BBeBee : undefined
  const nodeProc = typeof process !== 'undefined' ? process : undefined

  const [platformInfo, setPlatformInfo] = useState(() => ({
    platform: bbebee?.platform ?? device?.platform ?? nodeProc?.platform ?? 'desktop',
    arch: nodeProc?.arch ?? 'x64',
    node: bbebee?.versions?.node ?? nodeProc?.versions?.node ?? 'embedded',
    electron:
      bbebee?.versions?.electron ??
      (nodeProc?.versions as Record<string, string> | undefined)?.electron ??
      'N/A',
    chrome:
      (typeof navigator !== 'undefined' && /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1]) ||
      'N/A',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: device?.appVersion ?? '0.1.0-alpha',
  }))

  useEffect(() => {
    if (nodeProc) {
      setPlatformInfo({
        platform: bbebee?.platform ?? device?.platform ?? nodeProc.platform ?? 'desktop',
        arch: nodeProc.arch ?? 'x64',
        node: bbebee?.versions?.node ?? nodeProc.versions?.node ?? 'embedded',
        electron:
          bbebee?.versions?.electron ??
          (nodeProc.versions as Record<string, string> | undefined)?.electron ??
          'N/A',
        chrome:
          (typeof navigator !== 'undefined' &&
            /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1]) ||
          'N/A',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        appVersion: device?.appVersion ?? '0.1.0-alpha',
      })
    }
  }, [nodeProc, bbebee, device])

  const envNodeEnv = nodeProc?.env?.['NODE_ENV']
  const envDebug = nodeProc?.env?.['DEBUG']
  const isDebugMode = Boolean(
    bbebee?.isDebug || (envNodeEnv && envNodeEnv !== 'production') || Boolean(envDebug),
  )

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-app, #0D0E15)',
        color: 'var(--text-primary, #E2E8F0)',
        padding: '32px 48px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      },
    },
    // Top bar / Back navigation
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 28,
        },
      },
      h(Button, {
        variant: 'secondary',
        children: '← 返回设置',
        onPress: () => ui?.navigate?.('settings.view'),
      }),
      h(
        'h1',
        {
          style: {
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            color: 'var(--text-primary, #F8FAFC)',
            letterSpacing: '-0.02em',
          },
        },
        '调试与诊断 (Debug)',
      ),
    ),

    // Card 1: Debug Status
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          },
        },
        h(
          'div',
          null,
          h('div', { style: cardTitleStyle }, '当前调试状态'),
          h('div', { style: cardSubtitleStyle }, '检查内核与渲染进程的调试运行标志位'),
        ),
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 600,
              background: isDebugMode ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-3, rgba(148, 163, 184, 0.15))',
              color: isDebugMode ? 'var(--color-success, #4ADE80)' : 'var(--text-secondary, #94A3B8)',
              border: `1px solid ${isDebugMode ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-subtle, rgba(148, 163, 184, 0.2))'}`,
            },
          },
          h('span', {
            style: {
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isDebugMode ? '#22C55E' : 'var(--text-secondary, #94A3B8)',
            },
          }),
          isDebugMode ? 'Debug 模式已激活' : '生产环境 (Production)',
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
          },
        },
        renderInfoItem('Node 环境', envNodeEnv || 'production'),
        renderInfoItem('日志输出', 'RingBuffer (2000 lines)'),
        renderInfoItem('隔离沙箱', 'QuickJS Realm Isolation'),
      ),
    ),

    // Card 2: Environment Details
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        { style: { marginBottom: 16 } },
        h('div', { style: cardTitleStyle }, '当前运行环境'),
        h('div', { style: cardSubtitleStyle }, '硬件平台、引擎与宿主容器版本'),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
          },
        },
        renderInfoItem('操作系统平台', platformInfo.platform),
        renderInfoItem('处理器架构', platformInfo.arch),
        renderInfoItem('Node.js 版本', platformInfo.node),
        renderInfoItem('Electron 版本', platformInfo.electron),
        renderInfoItem('Chromium 版本', platformInfo.chrome),
        renderInfoItem('应用构建版本', platformInfo.appVersion),
      ),
      h(
        'div',
        {
          style: {
            marginTop: 12,
            padding: '8px 12px',
            background: 'var(--surface-2, rgba(0, 0, 0, 0.25))',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--text-secondary, #94A3B8)',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        `UA: ${platformInfo.userAgent || 'Desktop App Shell'}`,
      ),
    ),

    // Card 3: Diagnostic tools navigation
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        { style: { marginBottom: 20 } },
        h('div', { style: cardTitleStyle }, '诊断工具与系统开发面板'),
        h('div', { style: cardSubtitleStyle }, '排查内核事件、网络抓包、单步测试音源与监控系统架构拓扑'),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
          },
        },
        // Discover Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '系统日志 (Discover)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '查看 Cordis 微内核生命周期、服务装配及所有已注册插件输出的实时日志流。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '进入 Discover 日志页 →',
            onPress: () => ui?.navigate?.('debug.logs'),
          }),
        ),
        // HTTP Logs Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '第三方源网络日志 (HTTP Logs)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '捕获由第三方音源插件发起的所有网络请求，实时分析请求方法、状态码及往返耗时。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '进入 HTTP Logs 页面 →',
            onPress: () => ui?.navigate?.('debug.http-logs'),
          }),
        ),
        // Theme Palette Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '主题变量色板 (Theme Palette)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '查看和检验当前激活主题的 themeToCssVariables 全部颜色令牌、透明度变体及 CSS 变量映射。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '进入主题色板 →',
            onPress: () => ui?.navigate?.(SETTINGS_VIEWS.themePalette),
          }),
        ),
        // Test Sources Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '测试音源 (Test Sources)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '单步调试与验证第三方音源的搜索规则、播放流直链解析与内置 JS 沙箱执行。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '进入音源测试 →',
            onPress: () => ui?.navigate?.('sources.test'),
          }),
        ),
        // Inspector Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '系统架构与插件拓扑 (Inspector)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '以 PCB 电路主板与芯片走线视觉，实时监控系统 Layer 1~5 节点与 Cordis 服务装配。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '打开架构拓扑 (Inspector) →',
            onPress: () => ui?.navigate?.('inspector.panel'),
          }),
        ),
        // DevTools Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, '开发者工具 (DevTools)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              '在独立窗口中打开当前窗口的 Chromium DevTools，检查渲染进程 DOM、网络与控制台输出。',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: '打开开发者工具 →',
            disabled: !bbebee?.devtools,
            onPress: () => void bbebee?.devtools?.open(),
          }),
        ),
      ),
    ),
  )
}

function renderInfoItem(label: string, value: string): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
    },
    h('span', { style: { fontSize: 12, color: 'var(--text-secondary, #64748B)' } }, label),
    h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #E2E8F0)', fontFamily: 'monospace' } }, value),
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
  border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
  borderRadius: 12,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--settings-card-shadow, none)',
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text-primary, #F8FAFC)',
}

const cardSubtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #94A3B8)',
  marginTop: 4,
}

const actionCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
  borderRadius: 8,
  padding: 20,
}
