#!/usr/bin/env node
/**
 * docs-audit.js — 文档一致性巡检（L4 定时兜底，mobile-app 定制版）
 *
 * 目的：Hook 管"当下提交"，本脚本管"历史欠账"——每日检查文档中
 * 与真实状态漂移的「确定性低风险项」（数字/版本串/commit 引用），自动对齐；
 * 语义类项（章节内容）只报告不修改。
 *
 * 用法：
 *   node scripts/docs-audit.js            # 自动修复低风险项
 *   node scripts/docs-audit.js --dry-run  # 只报告，不修改
 *
 * 修复前打印 before → after，全部为从真实文件提取的值（可复核）。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const DRY = process.argv.includes('--dry-run')
const report = []
let fixed = 0

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8') }
function write(p, s) { fs.writeFileSync(path.join(ROOT, p), s) }

function fixAll(p, re, replacer, note) {
  const s = read(p)
  const m = s.match(re)
  if (!m) { report.push(`⚠️ [${p}] 模式 ${re} 未命中，跳过`); return }
  const before = m[0]
  const after = replacer(m)
  if (before === after) { report.push(`🟢 [${p}] 一致：${before.length > 60 ? before.slice(0, 60) + '…' : before}`); return }
  const noteStr = typeof note === 'function' ? note(before, after) : note
  if (DRY) {
    report.push(`🟡 [${p}] ${noteStr}\n    ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
  } else {
    write(p, s.replace(re, after))
    fixed++
    report.push(`✅ [${p}] ${noteStr}\n    ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
  }
}

// ── 规则 1：TS/TSX 文件数 ↔ 文档（RELEASE_SOP / DEV_SETUP）──────────────
function ruleTsCount() {
  const n = execSync('find src -name \'*.ts\' -o -name \'*.tsx\' | wc -l', { encoding: 'utf8', cwd: ROOT }).trim()
  for (const p of ['docs/RELEASE_SOP.md', 'docs/DEV_SETUP.md']) {
    if (!fs.existsSync(path.join(ROOT, p))) continue
    if (p === 'docs/RELEASE_SOP.md') {
      fixAll(p, /(\d+) 个 TS\/TSX/, () => `${n} 个 TS/TSX`, (b) => `TS 文件数 ${b}→${n}`)
    } else if (p === 'docs/DEV_SETUP.md') {
      fixAll(p, /全量 TS\/TSX 语法检查（(\d+) 个文件）/, () => `全量 TS/TSX 语法检查（${n} 个文件）`, (b) => `TS 文件数 ${b}→${n}`)
    }
  }
}

// ── 规则 2：三语言键数一致（报告项，无法自动补词条）────────────────────
function ruleLangKeys() {
  try {
    const counts = {}
    for (const l of ['zh-cn', 'zh-tw', 'en-us']) {
      counts[l] = Object.keys(JSON.parse(read(`src/lang/${l}.json`))).length
    }
    const uniq = new Set(Object.values(counts))
    if (uniq.size === 1) {
      report.push(`🟢 三语言键数一致：${counts['zh-cn']} 键`)
    } else {
      report.push(`🔴 三语言键数不一致：${JSON.stringify(counts)}（需补词条，不能自动修复）`)
    }
  } catch (e) {
    report.push(`⚠️ 三语言键数读取失败：${e.message}`)
  }
}

// ── 规则 3：底座版本 bN ↔ README「当前底座 vX.Y 至 bN」────────────────
function ruleBuildNumber() {
  try {
    const b = JSON.parse(read('publish/build-state.json'))
    const readme = read('README.md')
    const m = readme.match(/当前底座 v([\d.]+) 至 b(\d+)/)
    if (m) {
      if (m[1] !== b.baseVersion || Number(m[2]) !== b.build) {
        fixAll('README.md', /当前底座 v[\d.]+ 至 b\d+/, () => `当前底座 v${b.baseVersion} 至 b${b.build}`, (bb) => `README 底座版本 ${bb}→v${b.baseVersion}-b${b.build}`)
      } else {
        report.push(`🟢 README 底座版本一致：v${b.baseVersion} 至 b${b.build}`)
      }
    }
  } catch (e) {
    report.push(`⚠️ build-state 读取失败：${e.message}`)
  }
}

// ── 规则 4：track-player 锁定 commit ↔ UPSTREAM_LIFECYCLE ──────────────
function ruleTrackPlayer() {
  try {
    const pkg = JSON.parse(read('package.json'))
    const m = (pkg.dependencies['react-native-track-player'] || '').match(/#([0-9a-f]{7,40})/)
    if (!m) { report.push('⚠️ package.json 未找到 track-player 锁定 commit'); return }
    const sha7 = m[1].slice(0, 7)
    const doc = 'docs/UPSTREAM_LIFECYCLE.md'
    const d = read(doc)
    const m2 = d.match(/commit `([0-9a-f]{7})`/)
    if (m2 && m2[1] !== sha7) {
      fixAll(doc, /commit `[0-9a-f]{7}`/, () => `commit \`${sha7}\``, (bb) => `track-player commit ${bb}→${sha7}`)
    } else {
      report.push(`🟢 track-player 锁定 commit 一致：${sha7}`)
    }
  } catch (e) {
    report.push(`⚠️ track-player 规则异常：${e.message}`)
  }
}

// ── 通用：从构建脚本里取 SDK 级别 ───────────────────────────────────────
function sdkLevel(src, key) {
  const m = src.match(new RegExp(key + '\\s*(?:=)?\\s*(\\d+)'))
  return m ? m[1] : null
}

// ── 规则 5：downloadManager 行数 ↔ DOWNLOAD_DESIGN ───────────────────────
function ruleDownloadManagerLines() {
  try {
    const p = 'docs/DOWNLOAD_DESIGN.md'
    if (!fs.existsSync(path.join(ROOT, p))) return
    const n = execSync('wc -l < src/core/downloadManager.ts', { encoding: 'utf8', cwd: ROOT }).trim()
    fixAll(p, /`src\/core\/downloadManager\.ts`（(\d+) 行）/, () => `\`src/core/downloadManager.ts\`（${n} 行）`,
      b => `downloadManager 行数 ${b}→${n}`)
  } catch (e) { report.push(`⚠️ 规则5 异常：${e.message}`) }
}

// ── 规则 6：构建 ABI 清单 ↔ README（真值 = release.yml 注释）─────────────
function ruleAbiList() {
  try {
    const m = read('.github/workflows/release.yml').match(/mobile-app-vX\.Y\.Z-\{([^}]+)\}\.apk/)
    if (!m) { report.push('⚠️ 规则6：release.yml 未找到 ABI 清单注释'); return }
    const abis = m[1].split(',').map(x => x.trim()).filter(Boolean)
    const line = read('README.md').match(/按 ABI 选择：(.+)/)
    if (!line) { report.push('⚠️ 规则6：README 未找到「按 ABI 选择」行'); return }
    const missing = abis.filter(a => !line[1].includes('`' + a + '`'))
    if (missing.length) report.push(`🔴 [README.md] ABI 缺 ${missing.join('、')}（真值 ${abis.length} 个：${abis.join('/')}）——需人工补进「按 ABI 选择」行`)
    else report.push(`🟢 ABI 清单一致：${abis.length} 个（${abis.join('/')}）`)
  } catch (e) { report.push(`⚠️ 规则6 异常：${e.message}`) }
}

// ── 规则 7：compileSdk / targetSdk / minSdk ↔ DEV_SETUP ──────────────────
function ruleSdkLevels() {
  try {
    const g = read('android/build.gradle')
    const c = sdkLevel(g, 'compileSdkVersion'); const t = sdkLevel(g, 'targetSdkVersion'); const m = sdkLevel(g, 'minSdkVersion')
    if (!c || !t || !m) { report.push('⚠️ 规则7：build.gradle SDK 级别解析失败'); return }
    const p = 'docs/DEV_SETUP.md'
    fixAll(p, /定制版 compileSdk (\d+) \/ targetSdk (\d+) \/ minSdk (\d+)/g,
      () => `定制版 compileSdk ${c} / targetSdk ${t} / minSdk ${m}`, b => `SDK 级别 ${b}→${c}/${t}/${m}`)
    fixAll(p, /平台 (\d+)（compileSdk (\d+)）/g, () => `平台 ${c}（compileSdk ${c}）`, b => `SDK 平台 ${b}→${c}`)
  } catch (e) { report.push(`⚠️ 规则7 异常：${e.message}`) }
}

// ── 规则 8：音频卸载默认值 ↔ README 默认差异表 ──────────────────────────
function ruleAudioOffload() {
  try {
    const m = read('src/config/defaultSetting.ts').match(/isEnableAudioOffload['"]?\s*:\s*(true|false)/)
    if (!m) { report.push('⚠️ 规则8：defaultSetting 未找到 isEnableAudioOffload'); return }
    const want = m[1] === 'true' ? '开启' : '关闭'
    const line = read('README.md').match(/^\| 音频卸载 \| (.+) \|/m)
    if (!line) { report.push('⚠️ 规则8：README 未找到音频卸载行'); return }
    if (line[1].trim().startsWith(want)) { report.push(`🟢 音频卸载默认值一致：${want}`); return }
    const p = 'README.md'; const before = line[1]
    if (DRY) report.push(`🟡 [${p}] 音频卸载 ${before}→${want}`)
    else {
      write(p, read(p).replace(/^\| 音频卸载 \| (.+) \|/m,
        `| 音频卸载 | ${want}（同步上游 v1.9.2，设置迁移 2.3） |`))
      fixed++; report.push(`✅ [${p}] 音频卸载 ${before}→${want}`)
    }
  } catch (e) { report.push(`⚠️ 规则8 异常：${e.message}`) }
}

// ── 规则 9：跨仓 · 内置音源版本 ↔ 音源仓 lx-source.js @version ───────────
function ruleBuiltinSourceVersion() {
  try {
    const sib = path.resolve(ROOT, '..', 'lx-music-source', 'lx-source.js')
    if (!fs.existsSync(sib)) { report.push('⚪ 规则9 跳过：本地无 ../lx-music-source（CI 请先 clone 兄弟仓）'); return }
    const m = fs.readFileSync(sib, 'utf8').match(/@version[: \t]+([\d.]+)/)
    if (!m) { report.push('⚠️ 规则9：兄弟仓 lx-source.js 未找到 @version'); return }
    const v = m[1]; const p = 'docs/MUSIC_SOURCE_GUIDE.md'
    fixAll(p, /豆包定制 v\d+(?:\.\d+)*/g, () => `豆包定制 v${v}`, b => `音源版本(标题) ${b}→v${v}`)
    fixAll(p, /以下为当前（v\d+(?:\.\d+)*）/g, () => `以下为当前（v${v}）`, b => `音源版本(正文) ${b}→v${v}`)
    // v8.11.5：原先只修「§四标题」与「以下为当前（vX）」两种写法，而指南的正文摘要是
    // 「> **注**：`vX.Y.Z` 为音源本体当前版本（…）」——这种反引号写法不在覆盖范围，
    // 于是音源仓升版后指南的注会静默停在旧值（本轮实测漂到 v8.10.12 才被发现）。
    fixAll(p, /`v\d+(?:\.\d+)*` 为音源本体当前版本/g, () => `\`v${v}\` 为音源本体当前版本`, b => `音源版本(注) ${b}→v${v}`)
  } catch (e) { report.push(`⚠️ 规则9 异常：${e.message}`) }
}

// ── 规则 10：TS/TSX 计数扩到全部含该断言的文档 ──────────────────────────
function ruleTsCountWide() {
  try {
    const n = execSync('find src -name \'*.ts\' -o -name \'*.tsx\' | wc -l', { encoding: 'utf8', cwd: ROOT }).trim()
    for (const p of ['docs/MERGE_GUIDE.md', 'docs/AGENTS.md']) {
      if (!fs.existsSync(path.join(ROOT, p))) continue
      fixAll(p, /(\d+) 个 TS\/TSX/g, () => `${n} 个 TS/TSX`, b => `TS 计数 ${b}→${n}`)
      if (p.endsWith('AGENTS.md')) fixAll(p, /（(\d+) 文件 0 错误）/g, () => `（${n} 文件 0 错误）`, b => `TS 计数 ${b}→${n}`)
    }
  } catch (e) { report.push(`⚠️ 规则10 异常：${e.message}`) }
}

// ── 规则 11：定制提交数（只报告，不自动改日期）──────────────────────────
function ruleCustomCommits() {
  try {
    const n = execSync('git rev-list --count fb848072..HEAD', { encoding: 'utf8', cwd: ROOT }).trim()
    const m = read('docs/MERGE_GUIDE.md').match(/截至 (\d{4}-\d{2}-\d{2}) 为 \*\*(\d+)\*\*/)
    if (m) report.push(`🟡 [docs/MERGE_GUIDE.md] 写死了提交数 ${m[2]}（${m[1]}），当前已是 ${n}——持续增长量不应写死，改为命令引用（git rev-list --count fb848072..HEAD）`)
    else report.push(`🟢 无写死提交数（当前 ${n}，文档以命令引用）`)
  } catch (e) { report.push(`⚠️ 规则11 异常：${e.message}`) }
}

// ── 规则 12：i18n 总键数 / dl_ 键数 ↔ DOWNLOAD_DESIGN ────────────────────
function ruleI18nKeys() {
  try {
    const zh = JSON.parse(read('src/lang/zh-cn.json'))
    const total = Object.keys(zh).length
    const dl = Object.keys(zh).filter(k => k.startsWith('dl_')).length
    const p = 'docs/DOWNLOAD_DESIGN.md'
    fixAll(p, /三语对齐到 (\d+) 键/g, () => `三语对齐到 ${total} 键`, b => `i18n 总键 ${b}→${total}`)
    fixAll(p, /`dl_\*` 共 (\d+) 键/g, () => `\`dl_*\` 共 ${dl} 键`, b => `dl_ 键 ${b}→${dl}`)
  } catch (e) { report.push(`⚠️ 规则12 异常：${e.message}`) }
}

// ── 规则 13：SYNC_POINTS「音源 action（N 个）」↔ 音源 actions 并集（跨仓）──
function ruleSyncPointsActions() {
  const sib = path.resolve(ROOT, '..', 'lx-music-source', 'lx-source.js')
  if (!fs.existsSync(sib)) { report.push('⚪ 规则13 跳过：本地无 ../lx-music-source'); return }
  const src = fs.readFileSync(sib, 'utf8')
  const init = (src.match(/const actions = \[([^\]]*)\]/) || [])[1] || ''
  const pushed = (src.match(/actions\.push\([^)]*\)/g) || []).join(';')
  const names = ((init + ';' + pushed).match(/"[a-zA-Z]+"/g) || []).map(x => x.replace(/"/g, ''))
  const uniq = Array.from(new Set(names))
  const n = uniq.length
  const m = read('docs/SYNC_POINTS.md').match(/音源 action（(\d+) 个）/)
  if (!m) { report.push('⚠️ 规则13：SYNC_POINTS 未找到「音源 action（N 个）」'); return }
  const dn = Number(m[1])
  if (dn === n) report.push(`🟢 [docs/SYNC_POINTS.md] 音源 action（${n} 个）一致：${uniq.join('/')}`)
  else report.push(`🟡 [docs/SYNC_POINTS.md] 音源 action 文档 ${dn} 个 ≠ 实际 ${n} 个（${uniq.join('/')}）——请同步`)
}

// ── 执行 ────────────────────────────────────────────────────────────────
ruleTsCount()
ruleLangKeys()
ruleBuildNumber()
ruleTrackPlayer()
ruleDownloadManagerLines()
ruleAbiList()
ruleSdkLevels()
ruleAudioOffload()
ruleBuiltinSourceVersion()
ruleTsCountWide()
ruleCustomCommits()
ruleI18nKeys()
ruleSyncPointsActions()

console.log(`\n[L4 文档巡检·mobile] ${DRY ? 'DRY-RUN（不修改）' : '自动修复'} — ${new Date().toISOString().slice(0, 10)}\n`)
for (const r of report) console.log(r)
console.log(`\n汇总：${DRY ? '待处理' : '已修复'} ${fixed} 项 · 报告 ${report.length - fixed} 项\n`)
process.exit(0) // 恒成功：修复/报告已落盘，workflow 以 git diff 判断是否有提交
