/**
 * Security audit static code analyzer.
 *
 * Implements pattern detection library (§1.4c) for scanning untrusted code
 * before installation or execution.
 */

import type { Finding, SecurityAuditContext, SecurityAuditReport, SecurityAuditLevel } from '@BBeBee/protocol'

interface RegexRule {
  readonly id: string
  readonly name: string
  readonly level: 'block' | 'warn'
  readonly pattern: RegExp
  readonly message: (match: RegExpExecArray) => string
}

function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / str.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function getLineAndColumn(code: string, index: number): { line: number; column: number; snippet: string } {
  const lines = code.slice(0, index).split('\n')
  const line = lines.length
  const column = lines[lines.length - 1]!.length + 1
  const allLines = code.split('\n')
  const snippet = (allLines[line - 1] ?? '').trim()
  return { line, column, snippet }
}

const STATIC_RULES: readonly RegexRule[] = [
  // 1. eval / Function constructor
  {
    id: 'eval-function-constructor',
    name: 'eval / Function 构造器',
    level: 'block',
    pattern: /\b(?:eval|Function|new\s+Function)\s*\(|(?:window|globalThis|global)\.eval\s*\(/g,
    message: (m) => `检测到危险代码执行构造器: "${m[0].trim()}"`,
  },
  // 2. Dynamic code execution (vm / string execution in timers)
  {
    id: 'dynamic-code-execution',
    name: '动态代码执行',
    level: 'block',
    pattern: /\b(?:setTimeout|setInterval)\s*\(\s*['"`]|(?:vm\.(?:runInContext|runInNewContext|runInThisContext|Script))\b|require\s*\(\s*['"](?:node:)?vm['"]\s*\)/g,
    message: (m) => `检测到动态代码或沙箱突破特征: "${m[0].trim()}"`,
  },
  // 4. Hardcoded credentials
  {
    id: 'credential-private-key',
    name: '私钥硬编码',
    level: 'block',
    pattern: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    message: () => '检测到硬编码的私钥凭据 (Private Key)',
  },
  {
    id: 'credential-api-token',
    name: 'API 密钥 / Token 泄露',
    level: 'block',
    pattern: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,})\b/g,
    message: (m) => `检测到高风险硬编码平台密钥或凭证: "${m[0].slice(0, 8)}..."`,
  },
  {
    id: 'credential-generic-secret',
    name: '敏感凭证特征',
    level: 'warn',
    pattern: /(?:api_key|apiKey|secret_key|private_key|auth_token)\s*[:=]\s*['"][a-zA-Z0-9_-]{24,}['"]/gi,
    message: () => '检测到可能硬编码的 API 密钥或敏感凭据',
  },
  // 5. Prototype pollution
  {
    id: 'prototype-pollution',
    name: '原型污染风险',
    level: 'block',
    pattern: /\b__proto__\b|\bconstructor\s*\.\s*prototype\b|Object\s*\.\s*prototype\s*\[/g,
    message: (m) => `检测到原型污染危险语法: "${m[0].trim()}"`,
  },
  // 6. Remote dynamic import
  {
    id: 'remote-dynamic-import',
    name: '远程或动态 import() 执行',
    level: 'block',
    pattern: /\bimport\s*\(\s*['"`]https?:\/\/|\bimport\s*\(\s*[a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+|\([^)]*\))?\s*\)/g,
    message: (m) => `检测到远程或未确定的动态代码导入: "${m[0].trim()}"`,
  },
  // 7. Obfuscation signatures
  {
    id: 'obfuscation-packer',
    name: '代码打包器混淆特征',
    level: 'block',
    pattern: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/g,
    message: () => '检测到已知的 JS Packer / 混淆加密执行外壳',
  },
]

function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const normalized = host.toLowerCase()
  for (const allowed of allowedHosts) {
    const normAllowed = allowed.toLowerCase().trim()
    if (normAllowed === '*' || normAllowed === '*.*') return true
    if (normAllowed.startsWith('*.')) {
      const suffix = normAllowed.slice(2)
      if (normalized === suffix || normalized.endsWith(`.${suffix}`)) return true
    } else if (normalized === normAllowed) {
      return true
    }
  }
  return false
}

function scanUndeclaredHosts(code: string, context?: SecurityAuditContext): Finding[] {
  const findings: Finding[] = []
  const urlPattern = /\b(?:https?|wss?):\/\/([a-zA-Z0-9._-]+(?::\d+)?)(?:[/?#\s'"`]|$)/g
  const allowed = context?.allowedHosts ?? []

  let match: RegExpExecArray | null
  const seenHosts = new Set<string>()

  while ((match = urlPattern.exec(code)) !== null) {
    const rawHost = match[1]
    if (!rawHost) continue
    const host = rawHost.split(':')[0]!.toLowerCase()

    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      continue
    }

    if (seenHosts.has(host)) continue
    seenHosts.add(host)

    if (!isHostAllowed(host, allowed)) {
      const { line, column, snippet } = getLineAndColumn(code, match.index)
      findings.push({
        ruleId: 'undeclared-host-egress',
        message: `检测到未声明的外发网络请求主机: "${host}" (允许列表: [${allowed.join(', ') || '无'}])`,
        level: 'block',
        loc: { line, column },
        snippet,
      })
    }
  }

  return findings
}

function scanObfuscationFeatures(code: string): Finding[] {
  const findings: Finding[] = []

  const hexMatches = code.match(/\\x[0-9a-fA-F]{2}/g)
  if (hexMatches && hexMatches.length >= 6) {
    const firstIndex = code.indexOf(hexMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-dense-hex',
      message: `检测到密集十六进制转义特征 (${hexMatches.length} 处)，疑似代码混淆`,
      level: 'block',
      loc: { line, column },
      snippet,
    })
  } else if (hexMatches && hexMatches.length >= 3) {
    const firstIndex = code.indexOf(hexMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-dense-hex',
      message: `检测到多处十六进制转义字符 (${hexMatches.length} 处)`,
      level: 'warn',
      loc: { line, column },
      snippet,
    })
  }

  const unicodeMatches = code.match(/\\u00[0-9a-fA-F]{2}/g)
  if (unicodeMatches && unicodeMatches.length >= 8) {
    const firstIndex = code.indexOf(unicodeMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-dense-unicode',
      message: `检测到密集 Unicode 转义字符 (${unicodeMatches.length} 处)，疑似代码混淆`,
      level: 'warn',
      loc: { line, column },
      snippet,
    })
  }

  const hexIdentMatches = code.match(/\b_0x[a-f0-9]{4,}\b/g)
  if (hexIdentMatches && hexIdentMatches.length >= 5) {
    const firstIndex = code.indexOf(hexIdentMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-packer-identifiers',
      message: `检测到代码混淆特征标识符 (_0x... 出现 ${hexIdentMatches.length} 次)`,
      level: 'block',
      loc: { line, column },
      snippet,
    })
  }

  const stringLiterals = code.match(/['"`][A-Za-z0-9+/=_-]{40,}['"`]/g)
  if (stringLiterals) {
    for (const lit of stringLiterals) {
      const content = lit.slice(1, -1)
      const entropy = shannonEntropy(content)
      if (entropy >= 4.8) {
        const idx = code.indexOf(lit)
        const { line, column, snippet } = getLineAndColumn(code, idx)
        findings.push({
          ruleId: 'high-entropy-string',
          message: `检测到超高信息熵字符串 (长度 ${content.length}, 熵值 ${entropy.toFixed(2)})，疑似编码后载荷`,
          level: 'warn',
          loc: { line, column },
          snippet,
        })
        break
      }
    }
  }

  return findings
}

export function scanCode(code: string, context?: SecurityAuditContext): SecurityAuditReport {
  const findings: Finding[] = []

  for (const rule of STATIC_RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(code)) !== null) {
      const { line, column, snippet } = getLineAndColumn(code, match.index)
      findings.push({
        ruleId: rule.id,
        message: rule.message(match),
        level: rule.level,
        loc: { line, column },
        snippet,
      })
    }
  }

  findings.push(...scanUndeclaredHosts(code, context))
  findings.push(...scanObfuscationFeatures(code))

  let level: SecurityAuditLevel = 'pass'
  for (const f of findings) {
    if (f.level === 'block') {
      level = 'block'
      break
    }
    if (f.level === 'warn') {
      level = 'warn'
    }
  }

  return {
    findings,
    level,
  }
}
