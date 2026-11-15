#!/usr/bin/env node
/**
 * 双仓联动静态守门：配置键数、预算错误码、归因字段、诊断版本、单次桥调用。
 * 这不是替代行为测试；行为测试见 check_source_config_contract / check_playback_budget /
 * 源仓 test/audit/budget-admission.js。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

check('配置 30 数字 / 9 布尔 / 39 总键', (() => {
  const s = read('src/core/sourceConfig.ts')
  return /NUMERIC_CONFIG_KEYS = \[(?:[\s\S]*?)\] as const/.test(s) &&
    (s.match(/healthCheckJitterRatio/g) || []).length >= 2 &&
    (s.match(/healthCheckPauseRetryMs/g) || []).length >= 2
})(), 'sourceConfig.ts')

check('诊断包优先读 active_source_version', (() => {
  const h = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  const i = h.indexOf('active_source_version')
  const j = h.indexOf('imported_builtin_source_version')
  return i >= 0 && j >= 0 && i < j
})(), 'Health.tsx')

check('失败事件按 trace 顺序命中即停，不再 Promise.all 全打', (() => {
  const h = read('src/core/healthLog.ts')
  const fn = h.slice(h.indexOf('const fetchSourceEvents'), h.indexOf('// F56'))
  return fn.includes('for (const id of sourceIds)') && fn.includes('if (events.length) return events') && !fn.includes('Promise.all(sourceIds')
})(), 'healthLog.ts')

check('健康恢复每个脚本只调用一次并共享 promise', (() => {
  const u = read('src/core/init/userApi/index.ts')
  return u.includes('restoreSourceHealth(apis as Record<string, SourceHealthApi>, restoreIds[0]') &&
    u.includes('for (const sourceId of restoreIds) healthRestoreMap.set(sourceId, restore')
})(), 'userApi/index.ts')

check('attempt 带平台归因，成功源写实际子源', (() => {
  const u = read('src/core/music/utils.ts')
  return u.includes('source: subSource || musicInfo.source, platform: musicInfo.source') &&
    u.includes('source: cachedSource?.id ?? candidate.source, platform: cachedSource?.platform ?? candidate.source')
})(), 'utils.ts')

const sourceRoot = path.join(ROOT, '..', 'lx-music-source')
if (fs.existsSync(path.join(sourceRoot, 'src', 'legacy.js'))) {
  const s = fs.readFileSync(path.join(sourceRoot, 'src', 'legacy.js'), 'utf8')
  check('源仓预算耗尽独立错误码且不再冒充 NETWORK_TIMEOUT', s.includes('BUDGET_EXHAUSTED') && !/ERROR_CODES\.NETWORK_TIMEOUT[^\n]*预算耗尽/.test(s), 'legacy.js')
  check('源仓预算不 bump resolveDead', /BUDGET:\s*\{[^}]*resolveDead:\s*false/.test(s), 'legacy.js')
  check('源仓跨平台最坏 22s 在 App 桥 23s 内', s.includes('BUDGET_TOTAL_HARD_LIMIT_MS = 16000') && s.includes('resolveColdStartTimeout') && read('src/core/init/userApi/index.ts').includes('}, 23_000),'), 'legacy.js + userApi/index.ts')
} else {
  console.log('  - 跳过源仓联动检查（未检出兄弟仓）')
}
console.log(`\n双仓联动静态检查：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
