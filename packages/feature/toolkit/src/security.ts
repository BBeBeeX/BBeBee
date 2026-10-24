/**
 * Security audit static code analyzer.
 *
 * Implements pattern detection library (§1.4c) for scanning untrusted code
 * before installation or execution.
 *
 * Advisory policy (2026-10-24): only findings that name an opaque payload
 * or a leaked credential block an install — a `data:`/`blob:`/remote
 * dynamic import, or a hardcoded private key / platform token. Everything
 * else (eval, dynamic execution, prototype-pollution writes, undeclared
 * egress, obfuscation heuristics) is a warning: these regexes are a review
 * aid, not containment — a determined author evades them, and bundled
 * production code trips them — so wiring them as hard blocks bought
 * friction without buying safety. Installers log warnings and proceed.
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
  // 1. eval / Function constructor — warn, not block (advisory policy above).
  {
    id: 'eval-function-constructor',
    name: 'eval / Function constructor',
    level: 'warn',
    pattern: /\b(?:eval|Function|new\s+Function)\s*\(|(?:window|globalThis|global)\.eval\s*\(/g,
    message: (m) => `Detected dangerous code execution constructor: "${m[0].trim()}"`,
  },
  // 2. Dynamic code execution (vm / string execution in timers) — warn.
  {
    id: 'dynamic-code-execution',
    name: 'Dynamic code execution',
    level: 'warn',
    pattern: /\b(?:setTimeout|setInterval)\s*\(\s*['"`]|(?:vm\.(?:runInContext|runInNewContext|runInThisContext|Script))\b|require\s*\(\s*['"](?:node:)?vm['"]\s*\)/g,
    message: (m) => `Detected dynamic code execution or sandbox escape pattern: "${m[0].trim()}"`,
  },
  // 4. Hardcoded credentials
  {
    id: 'credential-private-key',
    name: 'Hardcoded private key',
    level: 'block',
    pattern: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    message: () => 'Detected hardcoded private key credential (Private Key)',
  },
  {
    id: 'credential-api-token',
    name: 'API key / token leak',
    level: 'block',
    pattern: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,})\b/g,
    message: (m) => `Detected high-risk hardcoded platform key or credential: "${m[0].slice(0, 8)}..."`,
  },
  {
    id: 'credential-generic-secret',
    name: 'Sensitive credential pattern',
    level: 'warn',
    pattern: /(?:api_key|apiKey|secret_key|private_key|auth_token)\s*[:=]\s*['"][a-zA-Z0-9_-]{24,}['"]/gi,
    message: () => 'Detected possibly hardcoded API key or sensitive credential',
  },
  // 5. Prototype pollution. Calibrated to pollution *writes*: a bare
  // `__proto__` reference, or an assignment through a
  // `constructor.prototype` / `Object.prototype[...]` chain. Read-only
  // prototype-chain walks (`x.constructor.prototype?.constructor`, a
  // common library instanceof helper) are not pollution and must not
  // even warn — bundled production code contains them routinely.
  // Pollution writes warn (advisory policy above).
  {
    id: 'prototype-pollution',
    name: 'Prototype pollution risk',
    level: 'warn',
    pattern:
      /\b__proto__\b|Object\s*\.\s*prototype\s*\[[^\]]*\]\s*=(?!=)|\bconstructor\s*\.\s*prototype\s*(?:\.\s*[A-Za-z_$][\w$]*\s*=(?!=)|\[[^\]]*\]\s*=(?!=))/g,
    message: (m) => `Detected dangerous prototype pollution syntax: "${m[0].trim()}"`,
  },
  // 6. Remote dynamic import
  {
    id: 'remote-dynamic-import',
    name: 'Remote or dynamic import() execution',
    level: 'block',
    pattern: /\bimport\s*\(\s*['"`]https?:\/\/|\bimport\s*\(\s*[a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+|\([^)]*\))?\s*\)/g,
    message: (m) => `Detected remote or unresolved dynamic code import: "${m[0].trim()}"`,
  },
  // 6b. Inline-payload dynamic import: a `data:` URL carries the whole
  // payload inside the string (no host for the egress rules to judge),
  // and a `blob:` URL names an object minted at runtime from who knows
  // what bytes. Neither has a legitimate place in a plugin bundle —
  // relative specifiers cover every honest case — so a literal
  // data:/blob: import() blocks outright (audit sample S1 sailed past
  // every other rule with exactly this shape).
  {
    id: 'data-blob-dynamic-import',
    name: 'data:/blob: dynamic import',
    level: 'block',
    pattern: /\bimport\s*\(\s*['"`](?:data|blob):/gi,
    message: (m) => `Detected dynamic import of an inline/opaque payload: "${m[0].trim()}"`,
  },
  // 7. Obfuscation signatures — warn (heuristic, not a block).
  {
    id: 'obfuscation-packer',
    name: 'JavaScript packer obfuscation pattern',
    level: 'warn',
    pattern: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/g,
    message: () => 'Detected a known JS Packer / obfuscated execution wrapper',
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

/**
 * Whether a URL literal sits in a network-call position — as the direct
 * argument of `fetch(`, `….open(`, `new WebSocket(`, `import(`, etc. A
 * URL string anywhere else is a data constant (an SVG namespace, a
 * mirror default, a documentation example): worth a warning, but it is
 * not an outbound request, and treating it as one makes every bundled
 * artifact uninstallable. Evasions (a constant fed to `fetch` through a
 * variable) are a known limit of any static heuristic — the runtime
 * capability gate is the enforcement layer for actual egress.
 */
function isNetworkCallPosition(code: string, urlIndex: number): boolean {
  const before = code.slice(Math.max(0, urlIndex - 64), urlIndex)
  return /(?:\bfetch|\.open|\bWebSocket\b|\bEventSource\b|sendBeacon|\bimport|\baxios\b|\bgot\b|\.request|\.ajax)\s*\(?\s*['"`][^'"`]*$/.test(
    before,
  )
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
      if (isNetworkCallPosition(code, match.index)) {
        // Warn, not block: the runtime capability gate is the enforcement
        // layer for actual egress; this static heuristic cannot see a URL
        // fed to fetch through a variable.
        findings.push({
          ruleId: 'undeclared-host-egress',
          message: `Detected an undeclared outbound network request host: "${host}" (allowlist: [${allowed.join(', ') || 'none'}])`,
          level: 'warn',
          loc: { line, column },
          snippet,
        })
      } else {
        findings.push({
          ruleId: 'undeclared-host-egress',
          message: `URL string constant with undeclared host: "${host}" (not in a network-call position; allowlist: [${allowed.join(', ') || 'none'}])`,
          level: 'warn',
          loc: { line, column },
          snippet,
        })
      }
    }
  }

  return findings
}

function scanObfuscationFeatures(code: string): Finding[] {
  const findings: Finding[] = []

  const hexMatches = code.match(/\\x[0-9a-fA-F]{2}/g)
  // Density, not the absolute count, is the obfuscation signal: a small
  // script whose strings are written as \xHH escapes is obfuscated; a
  // large bundled artifact crosses any absolute threshold with
  // incidental escapes from ordinary library code (a repeated `\xB7`
  // separator literal, regex character classes, …). Warn above one
  // escape per KiB; warn (more mildly) on a merely noticeable count.
  if (hexMatches && hexMatches.length >= 6 && hexMatches.length * 1024 > code.length) {
    const firstIndex = code.indexOf(hexMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-dense-hex',
      message: `Detected dense hex escape pattern (${hexMatches.length} occurrences), likely obfuscated code`,
      level: 'warn',
      loc: { line, column },
      snippet,
    })
  } else if (hexMatches && hexMatches.length >= 3) {
    const firstIndex = code.indexOf(hexMatches[0]!)
    const { line, column, snippet } = getLineAndColumn(code, firstIndex)
    findings.push({
      ruleId: 'obfuscation-dense-hex',
      message: `Detected multiple hex escape characters (${hexMatches.length} occurrences)`,
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
      message: `Detected dense Unicode escape characters (${unicodeMatches.length} occurrences), likely obfuscated code`,
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
      message: `Detected obfuscation-pattern identifiers (_0x... appeared ${hexIdentMatches.length} times)`,
      level: 'warn',
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
          message: `Detected a very high-entropy string (length ${content.length}, entropy ${entropy.toFixed(2)}), likely an encoded payload`,
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

/**
 * File extensions whose contents are executable plugin code and must
 * go through `scanCode` before install. The set is deliberately wider
 * than "what the loader happens to import today": the audit found an
 * `entry.main` pointing at a `.mjs` file sailed through unscanned
 * because selection stopped at `.js`/`.ts`, while the loader imported
 * it happily.
 */
export const SCANNABLE_FILE_EXTENSIONS: readonly string[] = ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx']

export function isScannableFile(path: string): boolean {
  const lower = path.toLowerCase()
  return SCANNABLE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** The entry shape both scan call sites work with (a manifest's `entry`). */
export interface ManifestEntryShape {
  main?: string
  ui?: { mobile?: string; desktop?: string }
}

/**
 * The manifest's entry files as package-relative paths (`./` and `/`
 * prefixes stripped, empties and duplicates removed). An entry file is
 * scanned *whatever* its extension: the loader will execute it, so the
 * extension list alone must never be the whole selection.
 */
export function manifestEntryFiles(entry: ManifestEntryShape | undefined): string[] {
  const out: string[] = []
  for (const raw of [entry?.main, entry?.ui?.mobile, entry?.ui?.desktop]) {
    if (typeof raw !== 'string') continue
    const rel = raw.replace(/^\.?\//, '')
    if (rel && !out.includes(rel)) out.push(rel)
  }
  return out
}

/** Whether a package file must be scanned: known code extension, or a manifest entry file. */
export function shouldScanFile(path: string, entryFiles: readonly string[] = []): boolean {
  return isScannableFile(path) || entryFiles.includes(path)
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
