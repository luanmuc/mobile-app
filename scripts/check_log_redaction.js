#!/usr/bin/env node
/**
 * 门禁：禁止把错误对象裸打日志（v9.1 / 交接任务 3）
 *
 * 背景（实测）：`src/core/music/utils.ts` 里 5 处 `console.log(err)`（509/595/623/686/719），
 * 源仓返回体常把带签名的整条 URL 塞进 error message，整条打印等于把签名写进日志。
 *
 * 规则：`console.log/log/warn/error(...)` 的参数里，错误标识符必须经 `sanitizeError(...)`
 * 包裹才允许出现。保留 `code` 的责任在 sanitizeError 里（见 src/core/music/playbackGuard.ts）。
 *
 * 同样要求负向自检：喂一段裸打的文本，检测器必须报红。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SCAN_DIRS = ['src']
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx'])

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }

// 错误对象常见标识符
const ERR_IDS = ['err', 'e', 'error', 'toggleErr', 'candErr', 'guardErr', 'catchErr']
const LOG_RE = new RegExp(`console\\.(?:log|warn|error|info|debug)\\s*\\(\\s*(?:[^,()]*,\\s*)?(${ERR_IDS.join('|')})\\s*\\)`, 'g')

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXT.has(path.extname(name))) out.push(full)
  }
  return out
}

const scanText = (text) => {
  const hits = []
  const lines = text.split('\n')
  lines.forEach((line, idx) => {
    // 只看真实代码行，跳过注释行（注释里讨论"旧实现 console.log(err)"是合法的）
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    LOG_RE.lastIndex = 0
    if (LOG_RE.test(line)) hits.push(idx + 1)
  })
  return hits
}

console.log('===== 日志脱敏门禁（v9.1）=====')

// G1：sanitizeError 存在且保留 code
{
  const t = fs.readFileSync(path.join(ROOT, 'src/core/music/playbackGuard.ts'), 'utf8')
  if (!/export const sanitizeError/.test(t)) bad('G1 playbackGuard.ts 未导出 sanitizeError')
  else if (!/code/.test(t)) bad('G1 sanitizeError 未保留 code 字段')
  else ok('G1 sanitizeError 存在且保留 code')
}

// G2：全仓扫描裸打。历史位置冻结在 scripts/log_redaction_baseline.json（按「文件 + 该行原文」精确匹配，
// 行号漂移不影响；但该行内容一旦变化就必须重新合规）——新增/改动位置的裸打一律判红，防止历史债继续扩散。
{
  const baselinePath = path.join(ROOT, 'scripts/log_redaction_baseline.json')
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {}
  let newHits = 0
  let frozen = 0
  for (const dir of SCAN_DIRS) {
    const base = path.join(ROOT, dir)
    if (!fs.existsSync(base)) continue
    for (const file of walk(base)) {
      const rel = path.relative(path.join(ROOT, dir), file)
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      const allowed = new Set(baseline[rel] || [])
      lines.forEach((line, idx) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        LOG_RE.lastIndex = 0
        if (!LOG_RE.test(line)) return
        if (allowed.has(trimmed)) { frozen++; return }
        newHits++
        bad(`${path.relative(ROOT, file)}:${idx + 1} 新增裸打错误对象（基线未收录）`)
      })
    }
  }
  if (!newHits) ok(`G2 src/ 无新增裸打错误对象（历史冻结 ${frozen} 处，已收录于 baseline）`)
}

// G3：utils.ts 已知的 5 处必须已改成 sanitizeError
// R74：裸 console 全仓迁到 logger 后，形态从 `console.log(sanitizeError(err))` 变为
// `logger.warn('PlaySource', ... + toLogText(sanitizeError(err)))`。判据跟随形态更新，
// 但仍要求错误对象**先脱敏再交给日志**——漏掉 sanitizeError 就无法匹配。
{
  const t = fs.readFileSync(path.join(ROOT, 'src/core/music/utils.ts'), 'utf8')
  const count = (t.match(/toLogText\(sanitizeError\(/g) || []).length
  if (count < 5) bad(`G3 utils.ts 只有 ${count} 处错误打印已脱敏（应 ≥5）`)
  else ok(`G3 utils.ts ${count} 处错误打印已走 sanitizeError`)
}

// G4：负向自检（检测器本身有效）
{
  const badSample = ['console.log(err)', 'console.log("x failed:", e)'].join('\n')
  const goodSample = ['console.log(sanitizeError(err))', 'console.log(err.code, sanitizeError(err))'].join('\n')
  const badHits = scanText(badSample)
  const goodHits = scanText(goodSample)
  if (badHits.length !== 2) bad(`G4 负向自检失败：裸打样本应抓 2 处，实际 ${badHits.length}`)
  else if (goodHits.length) bad(`G4 正向自检失败：脱敏样本被误报 ${goodHits.length} 处（行 ${goodHits.join('、')}）`)
  else ok('G4 负向/正向自检均符合预期（检测器本身有效）')
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail) process.exitCode = 1
