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
const { buildQualityMatrixRows, classifyHealthState, summarizeHealthItems } = mod.exports
const bindFile = path.join(ROOT, 'src/core/healthSourceBinding.ts')
const bindOut = ts.transpileModule(fs.readFileSync(bindFile, 'utf-8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: bindFile,
}).outputText
const bindMod = { exports: {} }
new Function('exports', 'module', 'require', bindOut)(bindMod.exports, bindMod, require)
const { bindHealthSource } = bindMod.exports
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
check('HS9', '质量矩阵固定四档，逐档展示 success/fail/state（F16）', () => {
  const rows = buildQualityMatrixRows({
    byQuality: {
      flac: { req: 10, success: 3, fail: 7, rate: 0.3, avgTime: 1200, state: 'open' },
      '128k': { req: 5, success: 5, fail: 0, rate: 1, avgTime: 400, state: 'closed' },
    },
  })
  if (rows.length !== 4) throw new Error(`rows=${rows.length}`)
  const flac = rows.find(r => r.quality === 'flac')
  if (!flac || flac.success !== 3 || flac.fail !== 7 || flac.state !== 'open') throw new Error(JSON.stringify(flac))
  const low = rows.find(r => r.quality === '128k')
  if (!low || low.success !== 5 || low.fail !== 0 || low.hasSample !== true) throw new Error(JSON.stringify(low))
  const empty = rows.find(r => r.quality === '320k')
  if (!empty || empty.req !== 0 || empty.hasSample !== false) throw new Error(JSON.stringify(empty))
})
check('HS10', '健康 API 按 provider platforms 绑定，多源时不取第一个（F19/F60）', () => {
  const apis = { kw: { toggle() {} }, suyin: { toggle() {} }, wy: { toggle() {} }, noAction: {} }
  const platform = bindHealthSource(apis, 'toggle', 'suyinKuwo', ['wy', 'kw'])
  if (!platform || platform.sourceId !== 'wy' || platform.matched !== 'platform') throw new Error(JSON.stringify(platform))
  const explicit = bindHealthSource(apis, 'toggle', 'suyin', ['kw'])
  if (!explicit || explicit.sourceId !== 'suyin' || explicit.matched !== 'explicit') throw new Error(JSON.stringify(explicit))
  const fallback = bindHealthSource(apis, 'toggle', 'missing', ['zz'])
  if (!fallback || fallback.sourceId !== 'kw' || fallback.matched !== 'fallback') throw new Error(JSON.stringify(fallback))
  if (bindHealthSource(apis, 'probeSource', undefined, ['kw']) !== null) throw new Error('不应绑定缺 action 的 API')
})
console.log(`\nHealth status refactor: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
