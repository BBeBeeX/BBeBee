#!/usr/bin/env node
/**
 * inventory-ui-strings.mjs — Group 1 只读盘点脚本。
 *
 * 扫描 apps/desktop、apps/mobile、packages/ui 下的 *.tsx（排除 *.test.*），
 * 启发式抽取候选的用户可见文案，输出 TSV（stdout）：
 *   file \t line \t classification \t namespace \t suggestedKey \t original
 *
 * classification ∈ { JSX文本, prop文案, 动态文案, 存疑 }
 * - JSX文本：同一行 `>文案<` 之间的文本节点
 * - prop文案：placeholder/title/aria-label/alt/label 等 prop，或对象字面量里
 *   label/title/text/message/description 等键的字符串值
 * - 动态文案：含 ${} 的模板字面量；传给 notify/toast/alert/confirm/dialog
 *   类调用的字符串实参
 * - 存疑：三元表达式里的字面量、疑似独立文本行、无法判定的单行
 *
 * 确定性：输入文件按字典序遍历，正则固定，输出不带时间戳 —— 两次运行
 * 的 stdout 必须完全一致（Group 1 验收项）。
 *
 * 位置说明：放在 plugin-i18n/scripts/ 而不是仓库根 scripts/ —— 根 scripts/
 * 是 shell 构建工具链（build-app.sh 等），i18n 工具（本脚本 +
 * check-locales.mjs）与 catalogue 同属一个包，放在一起。
 *
 * 用法：node packages/feature/plugin-i18n/scripts/inventory-ui-strings.mjs [--root <repo根>]
 *   > /tmp/i18n-inventory.tsv
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import console from 'node:console'

const args = process.argv.slice(2)
const rootIdx = args.indexOf('--root')
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd()

const SCAN_ROOTS = ['apps/desktop', 'apps/mobile', 'packages/ui']

/** 子包目录 → i18n namespace（§1.1 约定）。未列出的走 'app' 并标记存疑复核。 */
const NAMESPACE_BY_DIR = {
  'plugin-settings-ui-desktop': 'settings',
  'plugin-settings-ui-mobile': 'settings',
  'plugin-registry-ui-desktop': 'registry',
  'plugin-player-ui-desktop': 'player',
  'plugin-player-ui-mobile': 'player',
  'plugin-queue-ui-desktop': 'queue',
  'plugin-queue-ui-mobile': 'queue',
  'plugin-library-ui-desktop': 'library',
  'plugin-library-ui-mobile': 'library',
  'plugin-now-playing-ui-desktop': 'nowPlaying',
  'plugin-now-playing-ui-mobile': 'nowPlaying',
  'plugin-lyrics-ui-desktop': 'lyrics',
  'plugin-desktop-lyrics-ui-desktop': 'lyrics',
  'plugin-download-ui-desktop': 'download',
  'plugin-download-ui-mobile': 'download',
  'plugin-history-ui-desktop': 'history',
  'plugin-history-ui-mobile': 'history',
  'plugin-sources-ui-desktop': 'sources',
  'plugin-sources-ui-mobile': 'sources',
  'plugin-theme-ui-desktop': 'theme',
  'plugin-dsp-ui-desktop': 'dsp',
  'plugin-dsp-ui-mobile': 'dsp',
  'plugin-visualizer-ui-desktop': 'visualizer',
  'plugin-share-ui-desktop': 'share',
  'plugin-share-ui-mobile': 'share',
  'plugin-album-ui-desktop': 'album',
  'plugin-album-ui-mobile': 'album',
  'plugin-local-scanner-ui-desktop': 'localScanner',
  'plugin-local-scanner-ui-mobile': 'localScanner',
  'plugin-mini-player-ui-desktop': 'miniPlayer',
  'plugin-inspector-ui-desktop': 'inspector',
}

/** 文案型 prop 名（JSX attribute 或对象键）。 */
const TEXT_PROPS = [
  'placeholder', 'title', 'aria-label', 'ariaLabel', 'alt', 'label',
  'content', 'header', 'footer', 'emptyText', 'tooltip', 'okText',
  'cancelText', 'confirmText', 'message', 'description', 'text',
  'subtitle', 'caption', 'hint', 'emptyMessage', 'loadingText',
  'missingReason', 'disabledReason', 'errorMessage', 'errorText',
  'helperText', 'emptyTitle',
]

/** 运行时用户消息调用。 */
const MESSAGE_CALLS = ['notify', 'toast', 'showToast', 'showDisabledReason', 'showError', 'setError', 'setMessage', 'alert', 'confirm', 'showDialog', 'openDialog']

/** 匹配单行字符串字面量：允许内容含另一半引号（如 "Can't"）与转义。 */
const STRING_RE = `(["'])((?:\\\\.|(?!\\1)[^\\\\\\n])*?)\\1`

/** 文件名后缀 → 去掉，得到 key 的特征段（如 RegistryFilterBar → filter）。 */
const FILENAME_SUFFIXES = [
  'Editor', 'Section', 'Screen', 'Dialog', 'Modal', 'Drawer', 'Panel',
  'Card', 'List', 'Item', 'View', 'Page', 'Popover', 'Menu', 'Form',
  'Row', 'Cell', 'Header', 'Footer', 'Empty', 'State', 'Skeleton',
  'Tabs', 'Filter', 'Bar', 'Window',
]

/** 提取行内模板字面量（栈扫描，正确处理 ${} 内嵌套的模板）。 */
function extractTemplates(line) {
  const out = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '`' && (i === 0 || line[i - 1] !== '\\')) {
      let j = i + 1
      let depth = 0
      while (j < line.length) {
        const c = line[j]
        if (c === '\\') { j += 2; continue }
        if (c === '`' && depth === 0) break
        if (c === '$' && line[j + 1] === '{') { depth++; j += 2; continue }
        if (c === '}' && depth > 0) { depth--; j++; continue }
        j++
      }
      if (j < line.length) { out.push({ text: line.slice(i + 1, j), start: i }); i = j + 1 } else { i++ }
    } else { i++ }
  }
  return out
}
function looksLikeNonText(s) {
  if (!s || s.length < 2) return true
  if (/^[a-z][a-z0-9_-]*$/.test(s)) return true // 纯小写标识符：asc、sortKey…
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true
  if (/^-?\d+(\.\d+)?(px|rem|em|%|ms|s|vh|vw)?$/.test(s)) return true
  if (/^(rgba?|hsla?|var)\(/.test(s)) return true
  if (/^[A-Z_][A-Z0-9_]*$/.test(s) && s.length <= 12) return true // 常量名
  return false
}

/** 剥掉行内注释（字符串内的 // 不算注释）。返回 { code, inBlock }。 */
function stripComments(line, inBlock) {
  let out = ''
  let quote = null
  let i = 0
  while (i < line.length) {
    const c = line[i]
    const next = line[i + 1]
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i += 2 } else i += 1
      continue
    }
    if (quote) {
      out += c
      if (c === '\\') { out += next ?? ''; i += 2; continue }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '/' && next === '/') break
    if (c === '/' && next === '*') { inBlock = true; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') quote = c
    out += c
    i += 1
  }
  return { code: out, inBlock }
}

function featureSegment(fileBase) {
  let stem = fileBase.replace(/\.tsx$/, '')
  for (const suf of FILENAME_SUFFIXES) {
    if (stem.length > suf.length + 2 && stem.endsWith(suf)) { stem = stem.slice(0, -suf.length); break }
  }
  // GitHubAcceleration → githubAcceleration；RegistryFilter → filter
  return stem.charAt(0).toLowerCase() + stem.slice(1)
}

function namespaceFor(relPath) {
  const parts = relPath.split(sep)
  if (parts[0] === 'apps') return { namespace: 'app', mapped: true }
  // packages/<layer>/<pkg>/… —— 注意中间还有一层 layer（ui/feature/…）
  const pkg = parts[0] === 'packages' ? parts[2] : parts[1]
  if (pkg && NAMESPACE_BY_DIR[pkg]) return { namespace: NAMESPACE_BY_DIR[pkg], mapped: true }
  return { namespace: 'app', mapped: false } // ui-kit-*/ui-core/ui-tokens… → app，复核
}

function* walk(dir) {
  const entries = readdirSync(dir).sort()
  for (const e of entries) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === 'dist' || e === '__tests__') continue
      yield* walk(p)
    } else if (e.endsWith('.tsx') && !e.endsWith('.test.tsx') && !e.endsWith('.d.ts')) {
      yield p
    }
  }
}

const rows = []
const seen = new Set() // 去重：file:line:original

function emit(file, line, classification, namespace, key, original, mapped) {
  const k = `${file}:${line}:${original}`
  if (seen.has(k)) return
  seen.add(k)
  rows.push({
    file: relative(ROOT, file).split(sep).join('/'),
    line, classification, namespace, key,
    original: original.replace(/\t/g, ' ').slice(0, 200),
    note: mapped ? '' : 'namespace未映射，需复核',
  })
}

function suggestKey(namespace, fileBase, hint, index) {
  const seg = featureSegment(fileBase)
  const h = hint ? '.' + hint.charAt(0).toLowerCase() + hint.slice(1) : `.text${index}`
  return `${namespace}:${seg}${h}`
}

for (const scanRoot of SCAN_ROOTS) {
  const absRoot = join(ROOT, scanRoot)
  let files
  try {
    files = [...walk(absRoot)]
  } catch {
    continue
  }
  for (const file of files) {
    const rel = relative(ROOT, file)
    const { namespace, mapped } = namespaceFor(rel)
    const fileBase = rel.split('/').pop()
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    // 预剥离注释，供 rule 7 多行合并前瞻使用
    const stripped = []
    {
      let ib = false
      for (const raw of lines) {
        const r = stripComments(raw, ib)
        ib = r.inBlock
        stripped.push(r.code)
      }
    }
    let inBlock = false
    let idx = 0
    const consumedLines = new Set()

    /** 独立文本行判定（多行 JSX 文本的中间行）。 */
    const isTextLine = (t) =>
      /^[\p{Lu}\u4e00-\u9fff]/u.test(t) &&
      !/^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(t) &&
      !/[,()[\]{};=!?:|&+$#@<>/\\*]/.test(t) &&
      !/=>/.test(t) &&
      /^[^<>{}=/()*;:'"`]{2,}$/.test(t) &&
      /[A-Za-z\u4e00-\u9fff]{2,}/.test(t) &&
      t.length >= 4 && t.length <= 160

    /** 续行判定：首行已确认为文本后，续行允许小写开头（句子跨行）。 */
    const isTextContinuation = (t) =>
      /^[a-z]/.test(t) &&
      !/[,()[\]{};=!?:|&+$#@<>/\\*]/.test(t) &&
      !/=>/.test(t) &&
      /^[^<>{}=/()*;:'"`]{2,}$/.test(t) &&
      /[A-Za-z]{2,}/.test(t) &&
      t.length >= 2 && t.length <= 160

    lines.forEach((raw, li) => {
      const lineNo = li + 1
      const { code, inBlock: ib } = stripComments(raw, inBlock)
      inBlock = ib
      const line = code
      const trimmed = line.trim()
      if (!trimmed) return
      if (/^(import|export\s+type|export\s+interface)\b/.test(trimmed)) return
      if (/\bt\(['"]/.test(line)) return // 已迁移，跳过

      // 1) 同行 JSX 文本：>文案<
      // 排除：`=>` 箭头后的泛型（=> Promise<X>）、比较表达式（a > b < c）、
      // PascalCase 后跟 <大写（泛型实参），以及含代码符号的捕获。
      const jsxRe = />([^<>{}]+?)</g
      let m
      let found = false
      const PROSE_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s'’.,!?…—–\-:;，。！？、：；「」『』（）]*$/u
      while ((m = jsxRe.exec(line)) !== null) {
        const text = m[1].trim()
        const gtPos = m.index
        const beforeGt = line.slice(0, gtPos)
        const afterLt = line.slice(gtPos + m[0].length)
        const isArrow = beforeGt.endsWith('=')
        const isGeneric = /^[A-Z][A-Za-z0-9]*$/.test(text) && /^[A-Z]/.test(afterLt)
        if (!isArrow && !isGeneric && text && PROSE_RE.test(text) &&
            !looksLikeNonText(text) && /[\p{L}]{2,}/u.test(text)) {
          idx += 1
          emit(file, lineNo, 'JSX文本', namespace, suggestKey(namespace, fileBase, null, idx), text, mapped)
          found = true
        }
      }
      if (found) return

      // 1b) h('tag', props, '子字符串') —— 本仓主要用 createElement 而非 JSX 语法，
      // 第三个参数为纯字符串字面量时视为用户可见文本
      const hProps = String.raw`(?:null|\{[^{}\n]*(?:\{[^{}\n]*\}[^{}\n]*)*\})`
      const hChildRe = new RegExp(
        String.raw`\bh\(\s*['"][a-zA-Z][\w-]*['"]\s*,\s*` + hProps + String.raw`\s*,\s*(['"])((?:(?!\1)[^\\\n]|\\.){2,})\1`,
        'g',
      )
      for (const hm of line.matchAll(hChildRe)) {
        const text = hm[2].trim()
        if (!text || looksLikeNonText(text) || !/[\p{L}]{2,}/u.test(text)) continue
        idx += 1
        emit(file, lineNo, 'JSX文本', namespace, suggestKey(namespace, fileBase, null, idx), text, mapped)
      }

      // 2) prop 文案：placeholder="…" / title={'…'}
      const propNames = TEXT_PROPS.join('|')
      const propRe = new RegExp(`(?:${propNames})\\s*=\\s*(?:\\{\\s*)?${STRING_RE}`, 'g')
      while ((m = propRe.exec(line)) !== null) {
        const text = m[2].trim()
        const propName = (line.slice(0, m.index).match(/([A-Za-z-]+)\s*=\s*$/) || [])[1] || 'text'
        if (text && !looksLikeNonText(text)) {
          emit(file, lineNo, 'prop文案', namespace,
            suggestKey(namespace, fileBase, propName.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), 0),
            text, mapped)
          found = true
        }
      }
      if (found) return

      // 3) 对象字面量 label/title/message…: '…'（prop 名可带引号，如 'aria-label':）
      const objRe = new RegExp(`['"]?\\b(?:${propNames})\\b['"]?\\s*:\\s*${STRING_RE}`, 'g')
      while ((m = objRe.exec(line)) !== null) {
        const text = m[2].trim()
        const keyName = (line.slice(0, m.index).match(/([A-Za-z]+)\s*:\s*$/) || [])[1] || 'text'
        if (text && !looksLikeNonText(text)) {
          emit(file, lineNo, 'prop文案', namespace, suggestKey(namespace, fileBase, keyName, 0), text, mapped)
          found = true
        }
      }
      if (found) return

      // 4) 模板字面量含 ${} → 动态文案（排除 CSS/类名拼接/错误对象转字符串）
      //    用栈扫描器提取，支持 ${} 内嵌套模板；含嵌套/三元的复合模板整体收录，
      //    Group 3 再拆成多个 key。
      for (const { text: tplText, start } of extractTemplates(line)) {
        if (!tplText.includes('${')) continue
        if (/\bkey\s*[:=]\s*$/.test(line.slice(0, start))) continue // React key，非用户文案
        const text = tplText.trim()
        const cssy = /[()]/.test(text) || /px|rem|em\b|\b\d*ms\b|translate|rotate|scale|url\(|var\(--|#(?:[0-9a-fA-F]{3,8})\b|\b\d+fr\b|minmax|auto-fit|ease-in-out|\[data-|\btokens\.|\btheme\./.test(text)
        const erry = /\?\?|\?\.|\.stack\b|String\(|JSON\./.test(text)
        const bare = text.replace(/\$\{[^}]*\}/g, '').replace(/`/g, '').trim()
        const classy = bare !== '' && /^[\w:.-]*$/.test(bare) && !/\s/.test(bare)
        if (text.length >= 4 && !cssy && !erry && !classy &&
            /[A-Za-z\u4e00-\u9fff]{2,}/.test(bare)) {
          emit(file, lineNo, '动态文案', namespace, suggestKey(namespace, fileBase, 'dynamic', ++idx), text, mapped)
          found = true
        }
      }
      if (found) return

      // 5) 消息调用实参 → 动态文案
      const callRe = new RegExp(`\\b(?:${MESSAGE_CALLS.join('|')})\\s*\\(\\s*${STRING_RE}`)
      if ((m = callRe.exec(line)) !== null) {
        const text = m[2].trim()
        if (text && !looksLikeNonText(text)) {
          emit(file, lineNo, '动态文案', namespace, suggestKey(namespace, fileBase, 'message', ++idx), text, mapped)
        }
        return
      }

      // 6) 三元表达式里的字面量 → 存疑（排除 CSS 值与纯图标字形）
      const ternRe = new RegExp(`\\?\\s*${STRING_RE}\\s*:\\s*${STRING_RE}`, 'g')
      let anyTern = false
      const isCssVal = (s) => /[()]/.test(s) || /\b\d+(?:\.\d+)?(px|rem|em|%|ms|s|fr|deg)\b/.test(s) || /var\(--/.test(s) || /^(background|box-shadow|transition|transform|opacity|filter)[-\s]/.test(s) || /^[a-z0-9][a-z0-9_-]*(\s+[a-z0-9][a-z0-9_-]*)+$/.test(s)
      while ((m = ternRe.exec(line)) !== null) {
        for (const text of [m[2].trim(), m[4].trim()]) {
          if (text && !looksLikeNonText(text) && !isCssVal(text) && /[\p{L}\p{N}]/u.test(text)) {
            emit(file, lineNo, '存疑', namespace, suggestKey(namespace, fileBase, 'ternary', ++idx), text, mapped)
            anyTern = true
          }
        }
      }
      if (anyTern) return

      // 7) 独立文本行 → 存疑；连续多行合并为一条（多行 JSX 文本）
      if (!consumedLines.has(lineNo) && isTextLine(trimmed)) {
        let merged = trimmed
        let j = li + 1
        while (j < lines.length) {
          const t2 = stripped[j].trim()
          if (!t2) { j++; continue } // 空行跳过但继续看
          if (!(isTextLine(t2) || isTextContinuation(t2))) break
          merged += ' ' + t2
          consumedLines.add(j + 1)
          j++
          if (merged.length > 400) break
        }
        emit(file, lineNo, merged === trimmed ? '存疑' : 'JSX文本', namespace,
          suggestKey(namespace, fileBase, null, ++idx), merged, mapped)
      }
    })
  }
}

rows.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line)

// header + TSV
console.log(['file', 'line', 'classification', 'namespace', 'suggestedKey', 'original', 'note'].join('\t'))
for (const r of rows) {
  console.log([r.file, r.line, r.classification, r.namespace, r.key, r.original, r.note].join('\t'))
}

// 汇总打到 stderr，不污染 TSV
const byClass = {}
const byNs = {}
for (const r of rows) {
  byClass[r.classification] = (byClass[r.classification] || 0) + 1
  byNs[r.namespace] = (byNs[r.namespace] || 0) + 1
}
console.error(`# files scanned, candidates: ${rows.length}`)
console.error(`# by classification: ${JSON.stringify(byClass)}`)
console.error(`# by namespace: ${JSON.stringify(byNs)}`)
