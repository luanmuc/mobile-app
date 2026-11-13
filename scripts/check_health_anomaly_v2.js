#!/use/bin/env node
/**
 * F54 异常检测 v2 契约：probe/chain 分块、cache 不算异常、播放单列。
 *
 * 用法：node scripts/check_health_anomaly_v2.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const src = fs.readFileSync(file, 'utf-8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText
  const Module = require('module')
  const mod = new Module(file)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(js, file)
  return mod.exports
}
const diag = loadTs('src/core/healthDiagnostics.ts')
let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) } catch (e) { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const NOW = Date.UTC(2026, 10, 13, 4, 0, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ev = (over = {}) => ({ traceId: 't', event: 'source_result', sourceId: 'suyinKuwo', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_TIMEOUT', latencyMs: 500, ts: NOW - HOUR, ...over })
const ids = fs => fs.map(f => f.id)

check('A1 只有 cache_hit：零异常，缓存不算异常', () => {
  const events = Array.from({ length: 10 }, (_, i) => ev({ event: 'cache_hit', ok: undefined, code: undefined, traceId: `c${i}` }))
  assert(diag.detectHealthAnomalies({ events, now: NOW }).length === 0, '缓存命中被当成异常')
})

check('A2 取链失败聚合成 recent_failure，不生成 play/probe', () => {
  const events = [0, 1, 2].map(i => ev({ traceId: `f${i}` }))
  const findings = diag.detectHealthAnomalies({ events, now: NOW })
  assert(ids(findings).includes('recent_failure'), '取链失败未入 recent_failure')
  assert(!ids(findings).includes('play_failure') && !ids(findings).includes('probe_failure'), '取链失败串到播放/探测')
})

check('A3 播放失败只生成 play_failure，不污染取链', () => {
  const events = [0, 1, 2].map(i => ev({ event: 'play_result', traceId: `p${i}`, code: 'PLAYER_ERROR' }))
  const findings = diag.detectHealthAnomalies({ events, now: NOW })
  assert(ids(findings).includes('play_failure'), '播放失败未单列')
  assert(!ids(findings).includes('recent_failure'), '播放失败混进取链 recent_failure')
})

check('A4 探测非 UNKNOWN 失败生成 probe_failure', () => {
  const events = [0, 1, 2].map(i => ev({ event: 'probe_result', traceId: `q${i}`, code: 'HTTP_500' }))
  const findings = diag.detectHealthAnomalies({ events, now: NOW })
  const f = findings.find(x => x.id === 'probe_failure')
  assert(f && f.title.includes('探测') && f.detail.includes('缓存命中不计异常'), JSON.stringify(f))
})

check('A5 探测 UNKNOWN（本地断网）不算异常', () => {
  const events = [0, 1, 2].map(i => ev({ event: 'probe_result', traceId: `u${i}`, code: 'UNKNOWN' }))
  assert(!ids(diag.detectHealthAnomalies({ events, now: NOW })).includes('probe_failure'), 'UNKNOWN 被当成探测失败')
})

check('A6 三块混合：标题各带 播放/探测，取链窗口只算 1 次', () => {
  const events = [
    ev({ traceId: 'c1' }),
    ev({ event: 'play_result', traceId: 'p1', code: 'PLAYER_ERROR' }),
    ev({ event: 'probe_result', traceId: 'q1', code: 'HTTP_500' }),
  ]
  const findings = diag.detectHealthAnomalies({ events, now: NOW })
  assert(ids(findings).includes('recent_failure'), '取链块缺 recent_failure')
  const play = findings.find(x => x.id === 'play_failure')
  const probe = findings.find(x => x.id === 'probe_failure')
  assert(play && play.title.includes('播放'), '播放块标题不对')
  assert(probe && probe.title.includes('探测'), '探测块标题不对')
  const agg = diag.aggregateHealthEvents(events, NOW)
  assert(agg.windows.h24.total === 1 && agg.windows.h24.failed === 1, `取链窗口被污染：${JSON.stringify(agg.windows.h24)}`)
})

check('A7 缓存命中不改变取链窗口/成功率', () => {
  const chain = [ev({ traceId: 'ok1', ok: true, latencyMs: 200 }), ev({ traceId: 'f1' })]
  const withCache = chain.concat(Array.from({ length: 5 }, (_, i) => ev({ event: 'cache_hit', traceId: `c${i}`, ok: undefined, code: undefined })))
  const a = diag.aggregateHealthEvents(chain, NOW).windows.h1
  const b = diag.aggregateHealthEvents(withCache, NOW).windows.h1
  assert(JSON.stringify(a) === JSON.stringify(b), `缓存命中改变了取链窗口：${JSON.stringify({ a, b })}`)
})

check('A8 覆盖不足不宣称 7 天结论', () => {
  const report = diag.buildHealthReport({ events: [ev()], now: NOW })
  assert(report.coverage.coveredMs < DAY, `coverage 计算异常 ${report.coverage.coveredMs}`)
  assert(/仅覆盖|覆盖不足|不可用/.test(report.summary), `摘要未提示覆盖不足：${report.summary}`)
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
process.exit(0)
