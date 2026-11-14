#!/usr/bin/env node
/**
 * F36/F57 App 持久化 v2 契约（Q1~Q9）
 *
 * 覆盖：v2 常量、control 独立 key、save 拆分、control 不受 sourceVersion 影响、
 * v1 合并态拒绝、TTL/64KB、单一路径口径。
 *
 * 用法：node scripts/check_health_persistence_v2.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}
const assert = (c, m) => { if (!c) throw new Error(m) }
let passed = 0
const failures = []
const check = (name, fn) => {
  Promise.resolve().then(fn).then(() => { passed++; console.log(`✓ ${name}`) }).catch(e => { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) })
}
const mod = loadTs('src/core/sourceHealthPersistence.ts')
const NOW = Date.now()
const mkState = () => ({
  v: 2,
  sourceVersion: '8.13.1',
  savedAt: NOW,
  sources: { suyinKuwo: { breaker: { state: 'closed', totalRequests: 2 }, byQuality: { '128k': { req: 2, success: 1 } }, playDead: { streak: 0, deadline: 0 } } },
  qualityShortCircuit: { 'suyinKuwo:flac': NOW + 1000 },
})
const fakeStorage = () => {
  const map = new Map()
  return {
    map,
    getData: async k => map.has(k) ? JSON.parse(map.get(k)) : null,
    saveData: async(k, v) => { map.set(k, JSON.stringify(v)) },
    removeData: async k => { map.delete(k) },
  }
}

check('Q1 v2 常量与独立 control key', async() => {
  assert(mod.HEALTH_STATE_VERSION === 2, 'HEALTH_STATE_VERSION 应为 2')
  assert(!mod.HEALTH_STATE_ACCEPTED_VERSIONS.includes(1), '不得再接受 v1')
  assert(mod.HEALTH_STATE_ACCEPTED_VERSIONS.length === 1, '版本表只应有 v2')
  assert(mod.HEALTH_CONTROL_VERSION === 2, 'control version 应为 2')
  assert(mod.HEALTH_CONTROL_KEY !== mod.HEALTH_STATE_CANONICAL_KEY, 'control key 必须独立')
  assert(mod.HEALTH_CONTROL_MAX_BYTES === 64 * 1024, 'control 上限应为 64KB')
})

check('Q2 save 拆分：健康 key 无 controls，control key 有 v2 控制态', async() => {
  const st = fakeStorage()
  const state = mkState()
  state.controls = { suyinQQ: { enabled: false, manualOff: true }, suyinKuwo: { enabled: true } }
  const apis = { kw: { exportHealth: () => ({ promise: Promise.resolve(state) }) } }
  assert(await mod.saveSourceHealth(apis, 'kw', st, NOW) === true, 'save 应成功')
  const health = JSON.parse(st.map.get(mod.HEALTH_STATE_CANONICAL_KEY))
  const control = JSON.parse(st.map.get(mod.HEALTH_CONTROL_KEY))
  assert(health.v === 2, '健康态应写 v2')
  assert(!('controls' in health), '健康态不应带 controls')
  assert(control.v === 2 && control.controls.suyinQQ.manualOff === true, 'control key 内容不符')
})

check('Q3 control 独立恢复：健康 sourceVersion 不符仍恢复用户意图', async() => {
  const st = fakeStorage()
  const health = mkState(); health.sourceVersion = '8.12.0'
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, health)
  await st.saveData(mod.HEALTH_CONTROL_KEY, { v: 2, savedAt: NOW, controls: { suyinQQ: { enabled: false, manualOff: true }, suyinKuwo: { enabled: true } } })
  const calls = []
  const apis = { kw: { restoreHealth: state => ({ promise: Promise.resolve().then(() => { calls.push(state); return state.sources && Object.keys(state.sources).length ? { ok: true, restored: 1 } : { ok: true, restored: 0, controlsRestored: 2 } }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'kw', '8.13.1', st, NOW)
  assert(r.controlsRestored === 2, `控制恢复数不符：${JSON.stringify(r)}`)
  assert(r.restored === 0 && r.reason === undefined, '健康版本不符应丢弃元数据但不报失败')
  assert(calls.length === 1 && calls[0].sources && Object.keys(calls[0].sources).length === 0, '应只发控制态')
})

check('Q4 v1 旧合并态拒绝读取', async() => {
  const st = fakeStorage()
  const state = mkState(); state.v = 1
  state.controls = { suyinQQ: { enabled: false, manualOff: true } }
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, state)
  let called = null
  const apis = { kw: { restoreHealth: s => ({ promise: Promise.resolve().then(() => { called = s; return { ok: true, restored: 1 } }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'kw', '8.13.1', st, NOW)
  assert(r.restored === 0 && called === null, 'v1 必须被拒绝，不能进入源恢复')
})

check('Q5 control TTL / 64KB / 禁止字段', async() => {
  const ok = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW, controls: { suyinKuwo: { enabled: true } } }, { now: NOW })
  assert(ok.ok, ok.reason)
  const old = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW - 8 * 24 * 3600 * 1000, controls: { suyinKuwo: { enabled: true } } }, { now: NOW })
  assert(!old.ok, '过期 control 应拒绝')
  const big = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW, controls: { suyinKuwo: { enabled: true, note: 'x'.repeat(70000) } } }, { now: NOW })
  assert(!big.ok, '超 64KB 应拒绝')
  const bad = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW, controls: { suyinKuwo: { enabled: true, token: 'x' } } }, { now: NOW })
  assert(!bad.ok, '禁止字段应拒绝')
})

check('Q6 v1 读出被拒绝，v2 save 仍可重建', async() => {
  const st = fakeStorage()
  const v1 = mkState(); v1.v = 1
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, v1)
  const read = await mod.readSourceHealthState(st, 'kw', '8.13.1', NOW)
  assert(read === null, 'v1 应被拒绝')
  const v2 = mkState(); v2.controls = { suyinQQ: { enabled: false, manualOff: true } }
  const apis = { kw: { exportHealth: () => ({ promise: Promise.resolve(v2) }) } }
  assert(await mod.saveSourceHealth(apis, 'kw', st, NOW) === true, 'v2 save 应成功')
  const after = JSON.parse(st.map.get(mod.HEALTH_STATE_CANONICAL_KEY))
  assert(after.v === 2 && !('controls' in after), '迁移后健康态应为 v2 且无 controls')
})

check('Q7 健康不存在时 controlsRestored 仍返回', async() => {
  const st = fakeStorage()
  await st.saveData(mod.HEALTH_CONTROL_KEY, { v: 2, savedAt: NOW, controls: { suyinKuwo: { enabled: false, manualOff: true } } })
  const apis = { kw: { restoreHealth: () => ({ promise: Promise.resolve({ ok: true, restored: 0, controlsRestored: 1 }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'kw', '8.13.1', st, NOW)
  assert(r.controlsRestored === 1, 'control 恢复数应保留')
})

check('Q8 control 校验不读取 sourceVersion', async() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/sourceHealthPersistence.ts'), 'utf8')
  const body = src.split('export const sanitizeSourceHealthControls')[1].split('export const sourceHealthStateKey')[0]
  assert(!body.includes('sourceVersion'), 'control sanitizer 不应依赖 sourceVersion')
  assert(src.includes("HEALTH_CONTROL_KEY = '@___SOURCE_CONTROL___global'"), 'control key 不是独立常量')
})

check('Q9 源仓已移除 v1 回滚开关', async() => {
  const legacy = path.join(ROOT, '..', 'lx-music-source', 'src/legacy.js')
  if (!fs.existsSync(legacy)) {
    console.log('  （跳过）源仓不在同一工作区')
    return
  }
  const src = fs.readFileSync(legacy, 'utf8')
  assert(!src.includes('healthV2Enabled'), '源仓仍保留 healthV2Enabled 回滚开关')
  assert(src.includes('HEALTH_STATE_ACCEPTED_VERSIONS'), '源仓缺少 v2 版本表')
})

setTimeout(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  process.exit(0)
}, 100)
