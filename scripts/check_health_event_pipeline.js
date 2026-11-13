#!/usr/bin/env node
/**
 * 方案 6.3 事件流水线契约（E1~E10）
 *
 * 覆盖：源事件拉取、白名单落盘、eventId 去重、失败抓 source_events 脱敏、
 * play/probe/chain 三块隔离、cache_hit 不计入成功率。
 *
 * 用法：node scripts/check_health_event_pipeline.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ROOT = path.resolve(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

const fakeFiles = new Map()
const logsDir = '/tmp/health-pipeline'
const fakeFs = {
  exists: async() => true,
  mkdir: async() => {},
  readDir: async() => [],
  unlink: async() => {},
  stat: async p => ({ size: (fakeFiles.get(p) || '').length }),
  readFile: async p => fakeFiles.get(p) || '',
  writeFile: async(p, c) => { fakeFiles.set(p, c) },
  appendFile: async(p, c) => { fakeFiles.set(p, (fakeFiles.get(p) || '') + c) },
}
const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const base = Module.createRequire(file)
  const req = name => {
    if (name === 'react-native-fs') return { default: fakeFs }
    if (name === '../utils/log') return { getActiveLogsDir: () => logsDir, ensureAllLogFiles: async() => {} }
    if (name === 'react-native') return { Platform: { OS: 'android' }, Share: { share: async() => {} } }
    return base(name)
  }
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, req, mod, file, path.dirname(file))
  return mod.exports
}
const hlog = loadTs('src/core/healthLog.ts')
const diag = loadTs('src/core/healthDiagnostics.ts')

const assert = (c, m) => { if (!c) throw new Error(m) }
let passed = 0
const failures = []
const tests = []
const check = (name, fn) => { tests.push({ name, fn }) }
const reset = () => { fakeFiles.clear() }
const allEntries = () => Array.from(fakeFiles.entries())
  .filter(([p]) => p.endsWith('.jsonl'))
  .flatMap(([, text]) => text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)))
const probe = (over = {}) => Object.assign({ ts: Date.now(), traceId: 't1', event: 'probe_result', sourceId: 'suyinKuwo', quality: '128k', ok: true, code: '', latencyMs: 12 }, over)

check('E1 probe_result / health_transition 入库，未知事件忽略', async() => {
  reset()
  const n = await hlog.recordProbeEvents([
    probe(),
    probe({ event: 'health_transition', ok: undefined, code: undefined, reason: 'probe_unknown' }),
    probe({ event: 'source_result' }),
    null,
  ])
  assert(n === 2, `应写 2 条，实际 ${n}`)
  const ev = allEntries().map(e => e.event)
  assert(ev.includes('probe_result') && ev.includes('health_transition') && !ev.includes('source_result'), '事件过滤错误')
})

check('E2 同 ts/trace/source/quality/event/code 去重', async() => {
  reset()
  const e = probe({ ts: 1000 })
  assert(await hlog.recordProbeEvents([e]) === 1, '首次应写')
  assert(await hlog.recordProbeEvents([e]) === 0, '重复应被去重')
  assert(await hlog.recordProbeEvents([{ ...e, quality: 'flac' }]) === 1, '不同档位不应去重')
})

check('E3 落盘字段白名单：URL / 歌名 / 账号不落盘', async() => {
  reset()
  await hlog.recordProbeEvents([probe({
    url: 'https://cdn.test/a.flac?sig=1',
    songName: '晴天',
    singer: '周杰伦',
    account: 'u1',
  })])
  const entry = allEntries()[0]
  const text = JSON.stringify(entry)
  for (const bad of ['cdn.test', '晴天', '周杰伦', 'u1', 'url', 'songName', 'account']) {
    assert(!text.includes(bad), `落盘含敏感字段 ${bad}`)
  }
})

check('E4 失败播放拉同 trace 源事件，且 sourceEvents 先脱敏', async() => {
  reset()
  global.lx = {
    apis: {
      kw: {
        healthEvents: () => ({
          promise: Promise.resolve({
            events: [
              { event: 'source_result', sourceId: 'suyinKuwo', ok: false, code: 'NOT_FOUND', url: 'https://cdn.test/x.mp3', songName: '夜曲' },
            ],
          }),
        }),
      },
    },
  }
  const realDateNow = Date.now
  const fixed = 1700000000000
  Date.now = () => fixed
  try {
    await hlog.recordPlayResult({ traceId: 'trace-e4', ok: false, code: 'NOT_FOUND' })
  } finally { Date.now = realDateNow }
  const src = allEntries().find(e => e.event === 'source_events')
  assert(src && Array.isArray(src.sourceEvents) && src.sourceEvents.length === 1, '缺少 source_events')
  const text = JSON.stringify(src)
  assert(!text.includes('cdn.test') && !text.includes('夜曲'), 'source_events 落盘前未脱敏')
  assert(text.includes('NOT_FOUND') && text.includes('suyinKuwo'), '白名单字段丢失')
})

check('E5 成功播放按 1/5 采样并带权重 5', async() => {
  reset()
  const oldRandom = Math.random
  let seq = [0.05, 0.5]
  Math.random = () => seq.shift() ?? 0.5
  try {
    await hlog.recordPlayResult({ traceId: 't-ok1', ok: true, latencyMs: 50 })
    await hlog.recordPlayResult({ traceId: 't-ok2', ok: true, latencyMs: 60 })
  } finally { Math.random = oldRandom }
  const entries = allEntries().filter(e => e.event === 'play_result')
  assert(entries.length === 1 && entries[0].sampleWeight === 5, `采样/权重错误：${JSON.stringify(entries)}`)
})

check('E6 三块隔离：play 失败不污染 chain，probe 失败不污染 play', async() => {
  const now = Date.now()
  const agg = diag.aggregateHealthEvents([
    { ts: now - 1000, event: 'source_result', ok: true, sourceId: 'kw', latencyMs: 10 },
    { ts: now - 900, event: 'source_result', ok: true, sourceId: 'kw', latencyMs: 12 },
    { ts: now - 800, event: 'play_result', ok: false, code: 'PLAY_FAIL', sourceId: 'kw' },
    { ts: now - 700, event: 'play_result', ok: true, sourceId: 'kw' },
    { ts: now - 600, event: 'probe_result', ok: false, code: 'NETWORK_TIMEOUT', sourceId: 'kw' },
  ], now)
  assert(agg.kinds.chain.windows.h1.total === 2 && agg.kinds.chain.windows.h1.successRate === 1, 'chain 块被污染')
  assert(agg.kinds.play.windows.h1.total === 2 && agg.kinds.play.windows.h1.ok === 1, 'play 块错误')
  assert(agg.kinds.probe.windows.h1.total === 1 && agg.kinds.probe.windows.h1.ok === 0, 'probe 块错误')
})

check('E7 cache_hit 单列，不进入 chain 成功率与 Top 错误码', async() => {
  const now = Date.now()
  const agg = diag.aggregateHealthEvents([
    { ts: now - 500, event: 'source_result', ok: true, sourceId: 'kw' },
    { ts: now - 400, event: 'cache_hit', ok: true, sourceId: 'kw' },
    { ts: now - 300, event: 'cache_hit', ok: false, code: 'CACHE_MISS', sourceId: 'kw' },
  ], now)
  assert(agg.windows.h1.total === 1, 'cache_hit 不应进入取链统计')
  assert(!agg.topCodes.some(c => c.code === 'CACHE_MISS'), 'cache_hit 不应产生 Top 错误码')
})

check('E8 报告摘要分别给出播放/探测计数', async() => {
  const now = Date.now()
  const report = diag.buildHealthReport({
    events: [
      { ts: now - 1000, event: 'source_result', ok: true },
      { ts: now - 900, event: 'play_result', ok: false, code: 'PLAY_FAIL' },
      { ts: now - 800, event: 'probe_result', ok: true, latencyMs: 20 },
    ],
    now,
  })
  assert(report.playWindows.h24.total === 1, '报告缺播放块')
  assert(report.probeWindows.h24.total === 1, '报告缺探测块')
  assert(report.summary.includes('播放近 24 小时 1 次'), '摘要缺播放说明')
  assert(report.summary.includes('探测近 24 小时 1 次'), '摘要缺探测说明')
})

check('E9 source_events 不当作成功率样本', async() => {
  const now = Date.now()
  const agg = diag.aggregateHealthEvents([
    { ts: now - 100, event: 'source_events', sourceEvents: [{ event: 'source_result', ok: false }] },
  ], now)
  assert(agg.windows.h1.total === 0 && agg.kinds.play.windows.h1.total === 0 && agg.kinds.probe.windows.h1.total === 0, 'source_events 不应计入任何成功率')
})

check('E10 事件流水线只写本机：无上传调用口', async() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/healthLog.ts'), 'utf8')
  assert(!/fetch\s*\(/.test(src) && !/XMLHttpRequest/.test(src), 'healthLog 不应有上传实现')
  assert(src.includes('只落本地，不上传'), '缺少本地-only 注释契约')
})

;(async() => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`✓ ${t.name}`) } catch (e) { failures.push(`${t.name} — ${e.message}`); console.log(`✗ ${t.name} — ${e.message}`) }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  process.exit(0)
})()
