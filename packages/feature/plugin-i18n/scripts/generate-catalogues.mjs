#!/usr/bin/env node
/**
 * generate-catalogues.mjs — Group 2 catalogue 生成脚本。
 *
 * 输入：inventory-ui-strings.mjs 产出的 TSV（--tsv <path>）。
 * 输出：往 packages/feature/plugin-i18n/src/locales/ 合并新 key：
 *   - app namespace → en.json / zh.json（flat 格式，挂到 common.* 下的新分组）
 *   - 其他 namespace → <ns>.json（{en:{…}, zh:{…}} 并列格式）
 * 已有 key 原样保留；新 key 的 zh 初值填 en 文案（随后人工翻译，见下）。
 *
 * 去重：同一 namespace 内 normalized 原文相同 → 同一个 key。
 *   动态文案按模板形状去重（${…} → {}）。
 * 占位符：${expr} → {param}，param 取表达式首段的末段标识符
 *   （platformInfo.userAgent → userAgent；entry.requestBody.length → length）。
 * 冲突：新 key 路径与已有/本次冲突时追加数字后缀（title2…），并打到 stderr。
 *
 * 排除清单（有明确理由，不猜）：
 *   - 纯 URL（^https?://\S+$）：示例地址，无需翻译
 *     （https://ghproxy.example.com/、https://music.example.org）
 *   - 'Radiohead'：CinematicLayout.tsx 里的占位艺人名，数据内容非 UI 文案
 *
 * zh 翻译在本脚本之后人工完成（rules/i18n.md §4 术语表约束）；
 * 完成后跑 pnpm check:locales 验证 en/zh 双向零缺失。
 *
 * 用法：node packages/feature/plugin-i18n/scripts/generate-catalogues.mjs \
 *         --tsv /tmp/i18n-inventory.tsv [--root <repo根>] [--write]
 * 不带 --write 只打印将要写入的摘要（dry-run）。
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import console from 'node:console'

const args = process.argv.slice(2)
const tsvIdx = args.indexOf('--tsv')
const rootIdx = args.indexOf('--root')
const WRITE = args.includes('--write')
if (tsvIdx < 0) { console.error('usage: --tsv <inventory.tsv> [--root .] [--write]'); process.exit(2) }
const TSV = args[tsvIdx + 1]
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd()
const LOCALES = join(ROOT, 'packages/feature/plugin-i18n/src/locales')

/** 已部分迁移文件的 segment 覆盖（与现有 catalogue 的 segment 对齐）。 */
const SEGMENT_OVERRIDE = {
  'packages/ui/plugin-settings-ui-desktop/src/components/GitHubAccelerationEditor.tsx': 'github',
  'packages/ui/plugin-registry-ui-desktop/src/components/RegistryFilterBar.tsx': 'filter',
}

const EXCLUDE_PURE_URL = /^https?:\/\/\S+$/
const EXCLUDE_LITERAL = new Set([
  'Radiohead', // CinematicLayout.tsx 占位艺人名：数据内容非 UI 文案
  '♪ May the music heal every wound ♪', // CinematicLyricsTemplate.tsx 示例歌词：内容样本
  'No Surprises', // 同上，示例歌曲名
])

// 生成 key 后丢弃：手工分解/删除过的坏 key，防止 inventory 重跑时回加。
// 格式 `namespace:leaf`（leaf 为最后一段；segment 可能随规则迭代变化，故只比 leaf）。
const DROP_KEYS = new Set([
  'library:savedMusic', // 复数三元坏键，由 savedMusicOne/Other 替代
  'settings:nApiKeyYourKeyHere', // 与 configJsonExample 重复
  'settings:text', // 输入框默认值 127.0.0.1，非 UI 文案（network.text）
  'settings:bBeBee', // User-Agent 取值，非 UI 文案（network.bBeBee）
  'settings:switchToSchemePreview', // 三元压坏，由 switchToLight/DarkPreview 替代
  'nowPlaying:by', // 复合模板，手工分解
  'nowPlaying:widthDeviceWidthInitialScale', // viewport meta，非 UI 文案
  'library:songsAlbum', // 复合模板，手工分解
  'sources:sourceInThisString', // 复数三元坏键，手工分解
  'registry:ing', // 动词形态坏键，手工分解
  'registry:install', // 独立动词，由 confirmInstall/installTitle 替代
])

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const getPath = (obj, path) => {
  const parts = path.split('.')
  let o = obj
  for (const p of parts) { if (o == null || typeof o !== 'object' || !(p in o)) return undefined; o = o[p] }
  return o
}
const hasPath = (obj, path) => getPath(obj, path) !== undefined
/** 文案 → 语义化 leaf key（Previous track → previousTrack）。 */
function leafFromText(text) {
  const bare = text.replace(/\$\{[^}]*\}/g, ' ').replace(/[✓•…]/g, ' ')
  const words = bare.split(/[^A-Za-z0-9]+/).filter((w) => /[A-Za-z]/.test(w)).slice(0, 5)
  if (!words.length) return 'text'
  const camel = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('')
  const s = camel.replace(/[^A-Za-z0-9]/g, '')
  if (!s) return 'text'
  const fixed = /^[0-9]/.test(s) ? 'n' + s : s
  return fixed.charAt(0).toLowerCase() + fixed.slice(1)
}
const setPath = (obj, path, value) => {
  const parts = path.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {})
  o[parts[parts.length - 1]] = value
}
const sortDeep = (o) => {
  if (Array.isArray(o)) return o.map(sortDeep)
  if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])]))
  return o
}

/** ${expr} → {param}；返回 { text, params }。 */
function toTemplate(original) {
  const params = []
  const text = original.replace(/\$\{([^}]*)\}/g, (_, expr) => {
    const first = expr.split(/(\|\||\?\?|\?|:)/)[0].trim()
    const segs = first.split('.').map((s) => s.trim()).filter(Boolean)
    let name = (segs[segs.length - 1] || 'value').replace(/[^A-Za-z0-9_]/g, '') || 'value'
    if (!/^[A-Za-z_]/.test(name)) name = 'v_' + name
    if (!params.includes(name)) params.push(name)
    return `{${name}}`
  })
  return { text, params }
}

const normalize = (classification, original) =>
  classification === '动态文案' ? original.replace(/\$\{[^}]*\}/g, '{}') : original

// ---- 读已有 catalogue ----
const appEn = readJson(join(LOCALES, 'en.json'))
const appZh = readJson(join(LOCALES, 'zh.json'))
const nsFiles = {} // ns -> { en, zh }（不含 app）
for (const f of readdirSync(LOCALES).sort()) {
  if (!f.endsWith('.json') || f === 'en.json' || f === 'zh.json') continue
  const ns = f.replace(/\.json$/, '')
  const d = readJson(join(LOCALES, f))
  nsFiles[ns] = { en: d.en ?? {}, zh: d.zh ?? {}, file: f }
}

// ---- 读 TSV ----
const lines = readFileSync(TSV, 'utf8').split('\n').slice(1).filter((l) => l.trim())
const seen = new Map() // `${ns}\n${normalized}` -> { keyPath, params, files }
const excluded = []
const collisions = []

for (const line of lines) {
  const [file, lineNo, classification, namespace, suggested, original] = line.split('\t')
  if (!file || !original) continue
  if (EXCLUDE_PURE_URL.test(original.trim()) || EXCLUDE_LITERAL.has(original.trim())) {
    excluded.push(`${file}:${lineNo} ${original.trim()}`)
    continue
  }
  const norm = normalize(classification, original.trim())
  const dedupKey = `${namespace}\n${norm}`
  if (seen.has(dedupKey)) { seen.get(dedupKey).files.push(`${file}:${lineNo}`); continue }

  const { text, params } = toTemplate(original.trim())
  // suggested 形如 `ns:segment.hint` —— segment 复用，leaf 改从文案生成
  const sugPath = (suggested.split(':')[1] || 'misc.text')
  let seg = sugPath.split('.')[0]
  if (SEGMENT_OVERRIDE[file]) seg = SEGMENT_OVERRIDE[file]
  const hint = leafFromText(original.trim())

  const isApp = namespace === 'app'
  const basePath = isApp ? `common.${seg}.${hint}` : `${seg}.${hint}`
  const existing = isApp ? appEn : nsFiles[namespace]?.en
  let keyPath = basePath
  let n = 2
  const taken = (p) => (existing && hasPath(existing, p)) || [...seen.values()].some((v) => v.ns === namespace && v.keyPath === p)
  // 幂等：已存在相同文案 → 直接复用，不改名
  if (existing && getPath(existing, basePath) === text) {
    keyPath = basePath
  } else {
    while (taken(keyPath)) { keyPath = `${basePath}${n}`; n++ }
    if (keyPath !== basePath) collisions.push(`${namespace}:${basePath} → ${keyPath} (${original.trim().slice(0, 40)})`)
  }
  const leaf = keyPath.split('.').pop()
  if ([...DROP_KEYS].some((d) => d === `${namespace}:${leaf}`)) {
    excluded.push(`${file}:${lineNo} ${namespace}:${keyPath} (drop list)`)
    continue
  }
  seen.set(dedupKey, { ns: namespace, keyPath, params, files: [`${file}:${lineNo}`], text })
}

// ---- 合并写入 ----
const addedByNs = {}
for (const { ns, keyPath, text } of seen.values()) {
  addedByNs[ns] = (addedByNs[ns] || 0) + 1
  if (ns === 'app') {
    setPath(appEn, keyPath, text)
    if (!hasPath(appZh, keyPath)) setPath(appZh, keyPath, text) // 仅新 key 用 en 占位，已有翻译保留
  } else {
    if (!nsFiles[ns]) nsFiles[ns] = { en: {}, zh: {}, file: `${ns}.json` }
    setPath(nsFiles[ns].en, keyPath, text)
    if (!hasPath(nsFiles[ns].zh, keyPath)) setPath(nsFiles[ns].zh, keyPath, text)
  }
}

const fmt = (o) => JSON.stringify(sortDeep(o), null, 2) + '\n'
if (WRITE) {
  writeFileSync(join(LOCALES, 'en.json'), fmt(appEn))
  writeFileSync(join(LOCALES, 'zh.json'), fmt(appZh))
  for (const { en, zh, file } of Object.values(nsFiles)) {
    writeFileSync(join(LOCALES, file), fmt({ en, zh }))
  }
}

console.error(`# unique keys: ${seen.size}; added by namespace: ${JSON.stringify(addedByNs)}`)
console.error(`# excluded (${excluded.length}):`)
for (const e of excluded) console.error(`#   - ${e}`)
if (collisions.length) { console.error(`# collisions resolved (${collisions.length}):`); for (const c of collisions) console.error(`#   ! ${c}`) }
const withParams = [...seen.values()].filter((v) => v.params.length)
console.error(`# keys with params (${withParams.length}), call-site adaptation needed in Group 3:`)
for (const v of withParams.slice(0, 40)) console.error(`#   ${v.ns}:${v.keyPath} params=[${v.params.join(', ')}]`)
if (withParams.length > 40) console.error(`#   … +${withParams.length - 40} more`)
console.error(WRITE ? '# WROTE catalogue files' : '# dry-run (no --write), nothing written')
