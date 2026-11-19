#!/usr/bin/env node
/**
 * 双仓联动静态守门：配置键数、预算错误码、归因字段、诊断版本、单次桥调用。
 * 这不是替代行为测试；行为测试见 check_source_config_contract / check_playback_budget /
 * 源仓 test/audit/budget-admission.js。
 */
'use strict'
const { hasCode, flexRe } = require('./lib/ast-match')
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let pass = 0
let fail = 0
let skipped = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

check('配置 30 数字 / 9 布尔 / 39 总键', (() => {
  // A12-006：原实现只做「数组形状正则 + 两个键名各出现 ≥2 次」——把数组删到只剩 2 个键仍然绿，
  // 标题里的 30/9/39 从来没被真正校验（名实不符的假绿）。这里改为按字面量真实计数再 strictEqual。
  const s = read('src/core/sourceConfig.ts')
  const countKeys = (name) => {
    const i = s.indexOf(`export const ${name} = [`)
    if (i < 0) return -1
    const j = s.indexOf('] as const', i)
    if (j < 0) return -1
    return [...s.slice(i, j).matchAll(/'([^']+)'/g)].length
  }
  const numeric = countKeys('NUMERIC_CONFIG_KEYS')
  const bool = countKeys('BOOL_CONFIG_KEYS')
  return numeric === 30 && bool === 9 && numeric + bool === 39
})(), 'sourceConfig.ts（NUMERIC 30 / BOOL 9 / 合计 39）')

check('诊断包优先读 active_source_version', (() => {
  const h = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  const i = h.indexOf('active_source_version')
  const j = h.indexOf('imported_builtin_source_version')
  return i >= 0 && j >= 0 && i < j
})(), 'Health.tsx')

check('失败事件按 trace 顺序命中即停，不再 Promise.all 全打', (() => {
  const h = read('src/core/healthLog.ts')
  const fn = h.slice(h.indexOf('const fetchSourceEvents'), h.indexOf('// F56'))
  return hasCode(fn, flexRe('for (const id of sourceIds)')) && hasCode(fn, flexRe('if (events.length) return events')) && !hasCode(fn, flexRe('Promise.all(sourceIds'))
})(), 'healthLog.ts')

check('健康恢复每个脚本只调用一次并共享 promise', (() => {
  const u = read('src/core/init/userApi/index.ts')
  return hasCode(u, flexRe('restoreSourceHealth(apis as Record<string, SourceHealthApi>, restoreIds[0]')) &&
    hasCode(u, flexRe('for (const sourceId of restoreIds) healthRestoreMap.set(sourceId, restore'))
})(), 'userApi/index.ts')

check('attempt 带平台归因，成功源写实际子源', (() => {
  const u = read('src/core/music/utils.ts')
  return hasCode(u, flexRe('source: subSource || musicInfo.source, platform: musicInfo.source')) &&
    hasCode(u, flexRe('source: cachedSource?.id ?? candidate.source, platform: cachedSource?.platform ?? candidate.source'))
})(), 'utils.ts')

// A13-P1-03 / A12-004：路径可覆盖，便于 CI 把源仓 clone 到任意位置（默认仍是 ../lx-music-source）。
const sourceRoot = process.env.LX_SOURCE_ROOT
  ? path.resolve(process.env.LX_SOURCE_ROOT)
  : path.join(ROOT, '..', 'lx-music-source')
// v9.3-b：源仓 v9.0 已把逻辑拆到 src/core/*.js，只扫 legacy.js 会把"已迁走"误判成"消失"。
// 口径改为拼接源：legacy.js + 全部 core 模块（与源仓门禁 STATIC_SRC 同一口径）。
const readSourceAll = () => {
  const parts = []
  const legacy = path.join(sourceRoot, 'src', 'legacy.js')
  if (fs.existsSync(legacy)) parts.push(fs.readFileSync(legacy, 'utf8'))
  const coreDir = path.join(sourceRoot, 'src', 'core')
  if (fs.existsSync(coreDir)) {
    for (const f of fs.readdirSync(coreDir).filter(x => x.endsWith('.js')).sort()) {
      parts.push(fs.readFileSync(path.join(coreDir, f), 'utf8'))
    }
  }
  return parts.join('\n')
}

if (fs.existsSync(path.join(sourceRoot, 'src', 'legacy.js'))) {
  const s = readSourceAll()
  check('源仓预算耗尽独立错误码且不再冒充 NETWORK_TIMEOUT', hasCode(s, flexRe('BUDGET_EXHAUSTED')) && !/ERROR_CODES\.NETWORK_TIMEOUT[^\n]*预算耗尽/.test(s), 'legacy.js')
  check('源仓预算不 bump resolveDead', /BUDGET:\s*\{[^}]*resolveDead:\s*false/.test(s), 'legacy.js')
  check('源仓跨平台最坏 22s 在 App 桥 23s 内', hasCode(s, flexRe('BUDGET_TOTAL_HARD_LIMIT_MS = 16000')) && hasCode(s, flexRe('resolveColdStartTimeout')) && hasCode(read('src/core/init/userApi/index.ts'), flexRe('}, 23_000),')), 'legacy.js + userApi/index.ts')
} else {
  // A12-004：原实现只打一行「跳过」，汇总仍写「N 通过 / 0 失败」——把「没测」记成「通过」，
  // 与 docs/AUDIT_PLAN.md 宣称的「回退任一仓即红」不符。现在：
  //   · LX_REQUIRE_SOURCE=1（CI，release.yml 已设）→ 直接把 3 条算失败
  //   · 本地未设 → 显式告警，并在汇总里单独列出「未执行」条数
  const msg = `源仓未检出（${sourceRoot}），3 条源侧断言未执行`
  if (process.env.LX_REQUIRE_SOURCE === '1') {
    fail += 3
    console.error(`  ✗ ${msg}（LX_REQUIRE_SOURCE=1 不允许跳过）`)
  } else {
    skipped += 3
    console.log(`  ⚠ ${msg}（设 LX_SOURCE_ROOT=<源仓路径> 或 LX_REQUIRE_SOURCE=1 可强制执行）`)
  }
}
console.log(`\n双仓联动静态检查：${pass} 通过 / ${fail} 失败${skipped ? ` / ${skipped} 未执行（跳过）` : ''}`)
process.exit(fail ? 1 : 0)
