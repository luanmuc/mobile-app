#!/usr/bin/env node
/** P3：源健康元数据宿主持久化契约自检（A7/A8/A9）。 */
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
let passed = 0
const failures = []
const check = (name, fn) => {
  Promise.resolve().then(fn).then(() => { passed++; console.log(`✓ ${name}`) }).catch(e => { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) })
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const mod = loadTs('src/core/sourceHealthPersistence.ts')
const NOW = Date.now()
const mkState = () => ({
  v: 1,
  sourceVersion: '8.13.0',
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
check('A7 合法状态 round-trip', async() => {
  const r = mod.sanitizeSourceHealthState(mkState(), { sourceId: 'suyinKuwo', now: NOW })
  assert(r.ok, r.reason)
  assert(r.state.sources.suyinKuwo.breaker.totalRequests === 2, '字段丢失')
})
check('A7b App 平台键可接受完整源快照', async() => {
  const r = mod.sanitizeSourceHealthState(mkState(), { sourceId: 'kw', now: NOW })
  assert(r.ok, r.reason)
})
check('A7 拒绝 URL/未知源/未知音质/超限', async() => {
  const s = mkState(); s.sources.suyinKuwo.successUrl = 'https://x/y.mp3'
  assert(!mod.sanitizeSourceHealthState(s, { now: NOW }).ok, 'URL 应拒绝')
  const u = mkState(); u.sources.notASource = { breaker: {}, byQuality: {}, playDead: {} }
  assert(!mod.sanitizeSourceHealthState(u, { now: NOW, knownSourceIds: ['suyinKuwo'] }).ok, '显式白名单外源应拒绝')
  const badId = mkState(); badId.sources['bad id'] = { breaker: {}, byQuality: {}, playDead: {} }
  assert(!mod.sanitizeSourceHealthState(badId, { now: NOW }).ok, '非法源 ID 应拒绝')
  const q = mkState(); q.sources.suyinKuwo.byQuality.hires = { req: 1 }
  assert(!mod.sanitizeSourceHealthState(q, { now: NOW }).ok, '未知音质应拒绝')
  const big = mkState(); big.sources.suyinKuwo.breaker.note = 'x'.repeat(300000)
  assert(!mod.sanitizeSourceHealthState(big, { now: NOW }).ok, '超限应拒绝')
})
check('A8 TTL/版本不匹配拒绝并删除', async() => {
  const st = fakeStorage()
  const old = mkState(); old.savedAt = NOW - 8 * 24 * 3600 * 1000
  await st.saveData(mod.sourceHealthStateKey('suyinKuwo'), old)
  assert(await mod.readSourceHealthState(st, 'suyinKuwo', '8.13.0', NOW) === null, '过期应拒绝')
  assert(!st.map.has(mod.sourceHealthStateKey('suyinKuwo')), '过期键应删除')
  const bad = mkState(); bad.sourceVersion = '8.12.0'
  await st.saveData(mod.sourceHealthStateKey('suyinKuwo'), bad)
  assert(await mod.readSourceHealthState(st, 'suyinKuwo', '8.13.0', NOW) === null, '版本不符应拒绝')
})
check('A9 restore 先于读取完成，失败不阻断', async() => {
  const st = fakeStorage(); await st.saveData(mod.sourceHealthStateKey('suyinKuwo'), mkState())
  let called = null
  const apis = { suyinKuwo: { restoreHealth: state => ({ promise: Promise.resolve().then(() => { called = state; return { ok: true, restored: 1 } }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'suyinKuwo', '8.13.0', st, NOW)
  assert(r.restored === 1 && called, '恢复应调用')
  const bad = { suyinKuwo: { restoreHealth: () => ({ promise: Promise.reject(new Error('boom')) }) } }
  const r2 = await mod.restoreSourceHealth(bad, 'suyinKuwo', '8.13.0', st, NOW)
  assert(r2.restored === 0, '失败应返回 0 而不抛出')
})
check('A9b App 平台键 save/restore 全链路', async() => {
  const st = fakeStorage()
  const apis = {
    kw: {
      exportHealth: () => ({ promise: Promise.resolve(mkState()) }),
      restoreHealth: state => ({ promise: Promise.resolve({ ok: true, restored: 1, state }) }),
    },
  }
  assert(await mod.saveSourceHealth(apis, 'kw', st, NOW) === true, '平台键 save 应成功')
  assert(st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), 'canonical 键应写入')
  assert((await mod.restoreSourceHealth(apis, 'kw', '8.13.0', st, NOW)).restored === 1, '平台键 restore 应成功')
})
check('A9 userApi 首请求前等待 restore、health 后 save', async() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/init/userApi/index.ts'), 'utf8')
  assert(src.includes('restoreSourceHealth(') && src.includes('healthRestoreMap.set'), '注册后未调用 restore')
  assert(src.includes('healthRestoreMap.get(source)') && src.includes("action: 'musicUrl'"), 'getMusicUrl 未接 restore gate')
  assert(src.includes("action: 'health'") && src.includes('saveSourceHealth('), 'getHealth 后未保存')
})
check('A10 存储读写异常降级不阻断', async() => {
  const bad = {
    getData: async() => { throw new Error('io-read') },
    saveData: async() => { throw new Error('io-write') },
    removeData: async() => { throw new Error('io-remove') },
  }
  assert(await mod.readSourceHealthState(bad, 'kw', '8.13.0', NOW) === null, '读异常应返回 null')
  const apis = { kw: { exportHealth: () => ({ promise: Promise.resolve(mkState()) }) } }
  assert(await mod.saveSourceHealth(apis, 'kw', bad, NOW) === false, '写异常应返回 false')
})
check('A11 五平台并发 restore 全链路不抛错', async() => {
  const st = fakeStorage()
  const platforms = ['kw', 'wy', 'tx', 'mg', 'kg']
  const calls = []
  const apis = {}
  for (const p of platforms) {
    apis[p] = {
      exportHealth: () => ({ promise: Promise.resolve(mkState()) }),
      restoreHealth: state => ({ promise: Promise.resolve().then(() => { calls.push(p); return { ok: true, restored: 1, state } }) }),
    }
    assert(await mod.saveSourceHealth(apis, p, st, NOW) === true, `${p} save 应成功`)
    assert(st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), `${p} save 后应写入 canonical`)
  }
  const results = await Promise.all(platforms.map(p => mod.restoreSourceHealth(apis, p, '8.13.0', st, NOW)))
  assert(results.every(r => r.restored === 1), '五平台 restore 应全成功')
  assert(calls.length === 5, '五平台 restore 应各调用一次')
})
check('A9 save 调用 export 后写盘', async() => {
  const st = fakeStorage()
  const apis = { suyinKuwo: { exportHealth: () => ({ promise: Promise.resolve(mkState()) }) } }
  assert(await mod.saveSourceHealth(apis, 'suyinKuwo', st, NOW) === true, 'save 应成功')
  assert(st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), '应写入 canonical')
})
check('A12 五平台 save 收敛为单一 canonical key', async() => {
  const st = fakeStorage()
  const platforms = ['kw', 'wy', 'tx', 'mg', 'kg']
  const apis = {}
  for (const p of platforms) apis[p] = { exportHealth: () => ({ promise: Promise.resolve(mkState()) }) }
  for (const p of platforms) assert(await mod.saveSourceHealth(apis, p, st, NOW) === true, `${p} save 应成功`)
  assert(st.map.size === 1, `应只保留 1 个 key，实际 ${st.map.size}`)
  assert(st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), '应写入 canonical key')
  for (const p of platforms) assert(!st.map.has(mod.sourceHealthStateKey(p)), `${p} 旧平台键应清理`)
})
check('A13 旧平台键迁移到 canonical 后可跨平台恢复', async() => {
  const st = fakeStorage()
  await st.saveData(mod.sourceHealthStateKey('kw'), mkState())
  const apis = { kw: { restoreHealth: state => ({ promise: Promise.resolve({ ok: true, restored: 1, state }) }) } }
  const r1 = await mod.restoreSourceHealth(apis, 'kw', '8.13.0', st, NOW)
  assert(r1.restored === 1, '旧键应可恢复')
  assert(st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), '应提升为 canonical')
  assert(!st.map.has(mod.sourceHealthStateKey('kw')), '旧键应清理')
  const wyApi = { wy: { restoreHealth: state => ({ promise: Promise.resolve({ ok: true, restored: 1, state }) }) } }
  const r2 = await mod.restoreSourceHealth(wyApi, 'wy', '8.13.0', st, NOW)
  assert(r2.restored === 1, '其他平台应从 canonical 恢复')
})
check('G5-A1 新源/新版本无需改持久化白名单', async() => {
  const st = fakeStorage()
  const state = mkState()
  state.sourceVersion = '9.1.0'
  state.sources.newProvider = {
    breaker: { state: 'closed', totalRequests: 1 },
    byQuality: { '128k': { req: 1, success: 1 } },
    playDead: { streak: 0, deadline: 0 },
  }
  const apis = { newProvider: { exportHealth: () => ({ promise: Promise.resolve(state) }) } }
  assert(await mod.saveSourceHealth(apis, 'newProvider', st, NOW) === true, '新源应写入成功')
  const back = await mod.readSourceHealthState(st, 'newProvider', '9.1.0', NOW)
  assert(back && back.sources.newProvider, '新源应可往返')
  assert(await mod.readSourceHealthState(st, 'newProvider', '8.13.0', NOW) === null, '旧版本仍应拒绝')
})
check('B1 v2 save 拆出独立 control key，健康态不带 controls', async() => {
  const st = fakeStorage()
  const state = mkState()
  state.controls = { suyinQQ: { enabled: false, manualOff: true } }
  const apis = { kw: { exportHealth: () => ({ promise: Promise.resolve(state) }) } }
  assert(await mod.saveSourceHealth(apis, 'kw', st, NOW) === true, 'save 应成功')
  const health = JSON.parse(st.map.get(mod.HEALTH_STATE_CANONICAL_KEY))
  assert(!('controls' in health), '健康 key 不应再带 controls')
  const control = JSON.parse(st.map.get(mod.HEALTH_CONTROL_KEY))
  assert(control.v === 2 && control.controls.suyinQQ.manualOff === true, '控制 key 内容不符')
})

check('B2 control 独立恢复：健康版本不符仍保留用户意图', async() => {
  const st = fakeStorage()
  const health = mkState(); health.sourceVersion = '8.12.0'
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, health)
  await st.saveData(mod.HEALTH_CONTROL_KEY, { v: 2, savedAt: NOW, controls: { suyinQQ: { enabled: false, manualOff: true }, suyinKuwo: { enabled: true } } })
  const calls = []
  const apis = { kw: { restoreHealth: state => ({ promise: Promise.resolve().then(() => { calls.push(state); return state.sources && Object.keys(state.sources).length ? { ok: true, restored: 1 } : { ok: true, restored: 0, controlsRestored: 2 } }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'kw', '8.13.0', st, NOW)
  assert(r.controlsRestored === 2, `控制恢复数不符：${JSON.stringify(r)}`)
  assert(r.restored === 0 && r.reason === undefined, '健康元数据应按版本丢弃，但不能报失败')
  assert(calls.length === 1 && calls[0].sources && Object.keys(calls[0].sources).length === 0, '只应发控制态')
})

check('B3 control 态不绑定 sourceVersion，TTL 与容量仍校验', async() => {
  const ok = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW, controls: { suyinKuwo: { enabled: true } } }, { now: NOW })
  assert(ok.ok, ok.reason)
  const old = mod.sanitizeSourceHealthControls({ v: 2, savedAt: NOW - 8 * 24 * 3600 * 1000, controls: { suyinKuwo: { enabled: true } } }, { now: NOW })
  assert(!old.ok, '过期 control 应拒绝')
})

check('B4 v1 旧合并态仍兼容：controls 随健康态恢复', async() => {
  const st = fakeStorage()
  const state = mkState()
  state.controls = { suyinQQ: { enabled: false, manualOff: true } }
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, state)
  let called = null
  const apis = { kw: { restoreHealth: s => ({ promise: Promise.resolve().then(() => { called = s; return { ok: true, restored: 1 } }) }) } }
  const r = await mod.restoreSourceHealth(apis, 'kw', '8.13.0', st, NOW)
  assert(r.restored === 1 && called && called.controls && called.controls.suyinQQ, 'v1 合并态应原样恢复')
})

setTimeout(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  process.exit(0)
}, 100)
