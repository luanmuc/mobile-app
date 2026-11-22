#!/usr/bin/env node
/**
 * E22 / R75：持久化往返压力。
 *
 * `check_source_health_persistence`（17 条）守的是**单次**导出/恢复的边界，
 * 本脚本守的是**反复**往返后的退化：
 *   · 多轮 save→restore 是否逐轮等价（字段漂移会让熔断/短路状态越存越错）
 *   · 指纹缓存是否真的挡住重复写（否则每轮都刷 256KB 到存储）
 *   · 控制态是否被误塞进健康 key（读健康快照的人会看到用户开关，两套语义串味）
 *   · 过期/未来版本/超容量是否仍被拒（放宽过一次就再也收不住）
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

const mod = loadTs('src/core/sourceHealthPersistence.ts')
const assert = require('assert')

let passed = 0
const failures = []
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  passed++
  console.log(`  ✓ ${name}`)
}).catch(e => {
  failures.push(`${name} — ${e.message}`)
  console.log(`  ✗ ${name} — ${e.message}`)
})

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

const mkState = (over = {}) => ({
  v: 2,
  sourceVersion: '9.1.6',
  savedAt: NOW,
  sources: {
    suyinKuwo: {
      breaker: { state: 'closed', totalRequests: 7, consecutiveFail: 0 },
      byQuality: { '128k': { req: 7, success: 5 }, flac: { req: 2, success: 0 } },
      playDead: { streak: 0, deadline: 0 },
    },
  },
  qualityShortCircuit: { 'suyinKuwo:flac': NOW + 10 * 60 * 1000 },
  ...over,
})

const fakeStorage = () => {
  const map = new Map()
  return {
    map,
    getData: async k => (map.has(k) ? JSON.parse(map.get(k)) : null),
    saveData: async(k, v) => { map.set(k, JSON.stringify(v)) },
    removeData: async k => { map.delete(k) },
  }
}

// 源侧桩：exportHealth 回固定快照，restoreHealth 记录最后一次入参
const fakeApis = (state, sink) => ({
  kw: {
    exportHealth: () => ({ promise: Promise.resolve(state) }),
    restoreHealth: s => ({ promise: Promise.resolve((sink.push(s), { ok: true, restored: Object.keys(s.sources || {}).length })) }),
  },
})

console.log('\n[E22 persistence roundtrip]')

check('E22-01 单轮 save→restore 字段等价', async() => {
  const storage = fakeStorage()
  const sink = []
  const apis = fakeApis(mkState(), sink)
  const saved = await mod.saveSourceHealth(apis, 'kw', storage, NOW)
  assert.strictEqual(saved, true, 'save 返回 false')
  const r = await mod.restoreSourceHealth(apis, 'kw', '9.1.6', storage, NOW)
  assert.strictEqual(r.restored, 1, `restored=${r.restored}`)
  const back = sink[sink.length - 1]
  assert.deepStrictEqual(back.sources, mkState().sources, 'sources 往返不等价')
  assert.deepStrictEqual(back.qualityShortCircuit, mkState().qualityShortCircuit, 'qualityShortCircuit 往返不等价')
})

check('E22-02 5 轮往返逐轮等价（无累积漂移）', async() => {
  const storage = fakeStorage()
  const sink = []
  const apis = fakeApis(mkState(), sink)
  for (let i = 0; i < 5; i++) {
    const ok = await mod.saveSourceHealth(apis, 'kw', storage, NOW + i * 1000)
    assert.strictEqual(ok, true, `第 ${i + 1} 轮 save 失败`)
    const r = await mod.restoreSourceHealth(apis, 'kw', '9.1.6', storage, NOW + i * 1000)
    assert.strictEqual(r.restored, 1, `第 ${i + 1} 轮 restore=${r.restored}`)
  }
  const first = JSON.stringify(sink[0])
  const last = JSON.stringify(sink[sink.length - 1])
  assert.strictEqual(first, last, '第 1 轮与第 5 轮恢复结果不一致')
})

check('E22-03 20 轮重复写不增长存储字节（指纹缓存生效）', async() => {
  const storage = fakeStorage()
  const apis = fakeApis(mkState(), [])
  await mod.saveSourceHealth(apis, 'kw', storage, NOW)
  const sizeAfterFirst = [...storage.map.values()].reduce((n, v) => n + v.length, 0)
  let writes = 0
  const origSave = storage.saveData
  storage.saveData = async(k, v) => { writes++; return origSave(k, v) }
  for (let i = 0; i < 20; i++) await mod.saveSourceHealth(apis, 'kw', storage, NOW + i * 1000)
  const sizeAfter = [...storage.map.values()].reduce((n, v) => n + v.length, 0)
  assert.strictEqual(sizeAfter, sizeAfterFirst, `字节从 ${sizeAfterFirst} 变到 ${sizeAfter}`)
  assert(writes <= 1, `20 轮内写盘 ${writes} 次，指纹缓存未生效（应 ≤1）`)
})

check('E22-04 v1 旧快照被拒（不做静默迁移）', async() => {
  const res = mod.sanitizeSourceHealthState(mkState({ v: 1 }), { now: NOW })
  assert.strictEqual(res.ok, false, 'v1 竟被接受')
  assert(/schema version/.test(res.reason || ''), `reason=${res.reason}`)
})

check('E22-05 未来版本（v3）被拒', async() => {
  const res = mod.sanitizeSourceHealthState(mkState({ v: 3 }), { now: NOW })
  assert.strictEqual(res.ok, false, 'v3 竟被接受')
})

check('E22-06 save 不把 controls 写进健康 key', async() => {
  const storage = fakeStorage()
  const state = mkState({ controls: { suyinKuwo: { enabled: true } } })
  const apis = fakeApis(state, [])
  const ok = await mod.saveSourceHealth(apis, 'kw', storage, NOW)
  assert.strictEqual(ok, true, 'save 失败')
  const healthRaw = storage.map.get(mod.HEALTH_STATE_CANONICAL_KEY)
  assert(healthRaw, '健康 key 未写入')
  assert(!healthRaw.includes('"controls"'), `健康 key 混入 controls：${healthRaw.slice(0, 80)}`)
  const controlRaw = storage.map.get(mod.HEALTH_CONTROL_KEY)
  assert(controlRaw && controlRaw.includes('suyinKuwo'), '控制态未单独落到 control key')
})

check('E22-07 TTL 边界：6 天可恢复 / 8 天被拒', async() => {
  const fresh = mod.sanitizeSourceHealthState(mkState({ savedAt: NOW - 6 * DAY }), { now: NOW })
  assert.strictEqual(fresh.ok, true, `6 天前竟被拒：${fresh.reason}`)
  const stale = mod.sanitizeSourceHealthState(mkState({ savedAt: NOW - 8 * DAY }), { now: NOW })
  assert.strictEqual(stale.ok, false, '8 天前竟被接受')
  assert(/TTL/.test(stale.reason || ''), `reason=${stale.reason}`)
})

check('E22-08 超容量（>256KB）被拒', async() => {
  const big = mkState()
  // 用大量合法源 ID 撑体积，避免触发别的校验分支
  for (let i = 0; i < 4000; i++) {
    big.sources[`p${i}`] = { breaker: { state: 'closed', totalRequests: 1 }, byQuality: { '128k': { req: 1, success: 1 } }, playDead: { streak: 0, deadline: 0 } }
  }
  const res = mod.sanitizeSourceHealthState(big, { now: NOW })
  assert.strictEqual(res.ok, false, '超大 payload 竟被接受')
  assert(/容量/.test(res.reason || ''), `reason=${res.reason}`)
})

setTimeout(() => {
  console.log(`\n===== E22 持久化往返：${passed} 通过 / ${failures.length} 失败 =====`)
  process.exit(failures.length ? 1 : 0)
}, 0)
