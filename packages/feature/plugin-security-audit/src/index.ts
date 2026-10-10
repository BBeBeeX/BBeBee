/**
 * `plugin-security-audit` — built-in security audit and static scanning service.
 *
 * Implements `ctx.securityAudit` to scan third-party code before installation
 * and activation, safeguarding against arbitrary code execution and exfiltration.
 */

import { Service, type Context } from '@BBeBee/kernel'
import type {
  SecurityAuditContext,
  SecurityAuditReport,
  SecurityAuditService,
} from '@BBeBee/protocol'
import { scanCode } from './scanner.js'

export { scanCode } from './scanner.js'

export class SecurityAuditPlugin extends Service implements SecurityAuditService {
  static override readonly name = 'securityAudit'
  static readonly inject = []

  constructor(ctx: Context) {
    super(ctx, 'securityAudit')
  }

  scan(code: string, context?: SecurityAuditContext): SecurityAuditReport {
    return scanCode(code, context)
  }
}

export const name = 'plugin-security-audit'
export const inject = []

export async function apply(ctx: Context): Promise<() => void> {
  ctx.logger.info('plugin-security-audit: applied')
  const fiber = await ctx.plugin(SecurityAuditPlugin)
  return () => void fiber.dispose()
}

export default { name, inject, apply }
