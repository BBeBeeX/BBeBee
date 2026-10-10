/**
 * `ctx.securityAudit` — static code analysis and security auditing service.
 *
 * Scans third-party code (audio sources, lyric sources, plugins) for
 * security hazards, unauthorized egress hosts, credential leaks, and obfuscation.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'

export type SecurityAuditLevel = 'block' | 'warn' | 'pass'

export interface Finding {
  readonly ruleId: string
  readonly category?: string
  readonly message: string
  readonly level: 'block' | 'warn'
  readonly line?: number
  readonly loc?: { readonly line: number; readonly column: number }
  readonly snippet?: string
}

export interface SecurityAuditReport {
  readonly findings: readonly Finding[]
  readonly level: SecurityAuditLevel
}

export interface SecurityAuditContext {
  readonly allowedHosts?: readonly string[]
  readonly fileName?: string
}

export interface SecurityAuditService {
  /**
   * Scans code statically and returns findings and the calculated severity level.
   */
  scan(code: string, context?: SecurityAuditContext): SecurityAuditReport
}

declare module 'cordis' {
  interface Context {
    securityAudit: SecurityAuditService
  }
}
