#!/usr/bin/env node
/* eslint-disable no-new-func */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
let ts
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch { ts = require('typescript') }
const file = path.join(ROOT, 'src/core/healthStatus.ts')
const out = ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: file,
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', out)(mod.exports, mod, require)
const { classifyHealthState, summarizeHealthItems } = mod.exports
let pass = 0
let fail = 0
const check = (id, name, fn) => {
  try {
    fn()
    pass++
    console.log(`✓ ${id} ${name}`)
  } catch (e) {
    fail++
    console.log(`✗ ${id} ${name} — ${e.message}`)
  }
}
const base = { name: 'x', maxQuality: 'flac', enabled: true, successRate: 0, avgTime: 0, state: 'closed', reqCount: 1, probeCount: 0, sleeping: false, healthScore: 0 }
check('HS1', '手动关闭优先于自动关闭/摘除', () => {
  const r = classifyHealthState({ ...base, offReason: 'USER_OFF', playDead: true, autoOff: true }, true)
  if (r.key !== 'health_state_user_off') throw new Error(r.key)
})
check('HS2', '探测自动关闭显示 auto_off，不显示异常', () => {
  const r = classifyHealthState({ ...base, enabled: false, offReason: 'AUTO_OFF_PROBE', sleeping: true, healthScore: -9 }, true)
  if (r.key !== 'health_state_auto_off') throw new Error(r.key)
})
check('HS3', '默认关闭显示 disabled，不冒充用户关闭', () => {
  const r = classifyHealthState({ ...base, enabled: false, offReason: 'DEFAULT_OFF', userEnabled: false }, true)
  if (r.key !== 'health_state_disabled') throw new Error(r.key)
})
check('HS4', '真实播放摘除优先于异常', () => {
  const r = classifyHealthState({ ...base, playDead: true, successRate: 0, healthScore: -9 }, true)
  if (r.key !== 'health_state_removed') throw new Error(r.key)
})
check('HS5', '自动关闭优先于播放摘除', () => {
  const r = classifyHealthState({ ...base, enabled: false, offReason: 'AUTO_OFF_PROBE', playDead: true }, true)
  if (r.key !== 'health_state_auto_off') throw new Error(r.key)
})
check('HS6', '旧快照无 offReason 回退 enabled/sleeping', () => {
  const r = classifyHealthState({ ...base, enabled: false, sleeping: true }, true)
  if (r.key !== 'health_state_sleeping') throw new Error(r.key)
})
check('HS7', '旧快照 userEnabled=false 但无 offReason 仍按用户关闭', () => {
  const r = classifyHealthState({ ...base, enabled: false, userEnabled: false }, true)
  if (r.key !== 'health_state_user_off') throw new Error(r.key)
})
check('HS8', '9 桶只落一桶且合计等于源数', () => {
  const r = summarizeHealthItems([
    { ...base, offReason: 'USER_OFF' },
    { ...base, offReason: 'AUTO_OFF_PROBE', enabled: false },
    { ...base, playDead: true },
    { ...base },
  ])
  const total = Object.values(r).reduce((a, b) => a + b, 0)
  if (total !== 4 || r.off !== 2 || r.removed !== 1 || r.ok !== 1) throw new Error(JSON.stringify(r))
})
console.log(`\nHealth status refactor: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
