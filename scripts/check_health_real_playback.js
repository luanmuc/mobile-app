#!/usr/bin/env node
/**
 * 真实播放链路健康事件回归（2026-11-15）
 *
 * 与 check_health_event_pipeline.js 的合成事件不同：这里直接调用生产
 * `recordPlayResult`，验证它写出的日志能被 `buildHealthReport` 计入取链/播放窗口。
 *
 * 用法：node scripts/check_health_real_playback.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ROOT = path.resolve(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

const fakeFiles = new Map()
const logsDir = '/tmp/health-real-playback'
const fakeFs = {
  exists: async() => true,
  mkdir: async() => {},
  readDir: async() => Array.from(fakeFiles.keys()).map(p => ({ name: path.basename(p) })),
  unlink: async p => { fakeFiles.delete(p) },
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
const reset = () => {
  fakeFiles.clear()
  delete global.lx
}
const allEntries = () => Array.from(fakeFiles.entries())
  .filter(([p]) => p.endsWith('.jsonl'))
  .flatMap(([, text]) => text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)))
const report = events => diag.buildHealthReport({ events, now: Date.now() })

check('R1 成功在线播放：play_result + chain_result 都进入窗口', async() => {
  reset()
  await hlog.recordPlayResult({
    traceId: 'ok-play',
    ok: true,
    sourceId: 'kw',
    quality: '128k',
    latencyMs: 80,
    attempts: [{ source: 'kw', owner: 'source', ok: true, code: 'OK', latencyMs: 20 }],
  })
  const events = allEntries()
  const result = report(events)
  assert(events.some(e => e.event === 'play_result'), '缺 play_result')
  assert(events.some(e => e.event === 'chain_result'), '缺顶层 chain_result')
  assert(result.playWindows.h24.total >= 1, `播放窗口未计数：${JSON.stringify(result.playWindows.h24)}`)
  assert(result.windows.h24.total >= 1, `取链窗口未计数：${JSON.stringify(result.windows.h24)}`)
})

check('R2 失败播放：chain_result 进入窗口，source_events 仍保留', async() => {
  reset()
  global.lx = {
    apis: {
      kw: {
        healthEvents: () => ({
          promise: Promise.resolve({
            events: [
              {
                event: 'source_result',
                traceId: 'fail-play',
                sourceId: 'kw',
                ok: false,
                code: 'NETWORK_TIMEOUT',
                latencyMs: 30,
              },
            ],
          }),
        }),
      },
    },
  }
  await hlog.recordPlayResult({
    traceId: 'fail-play',
    ok: false,
    sourceId: 'kw',
    code: 'PLAY_FAIL',
    latencyMs: 90,
    attempts: [{ source: 'kw', owner: 'source', ok: false, code: 'NETWORK_TIMEOUT', latencyMs: 30 }],
  })
  const events = allEntries()
  const result = report(events)
  assert(events.some(e => e.event === 'play_result' && e.ok === false), '缺失败 play_result')
  assert(events.some(e => e.event === 'chain_result' && e.ok === false), '缺失败 chain_result')
  assert(events.some(e => e.event === 'source_events' && Array.isArray(e.sourceEvents)), '缺 source_events')
  assert(result.playWindows.h24.total >= 1, '失败播放未计数')
  assert(result.windows.h24.total >= 1, '失败取链未计数')
})

check('R3 预加载：只记 chain，不伪造 play', async() => {
  reset()
  await hlog.recordPlayResult({
    traceId: 'preload',
    ok: true,
    sourceId: 'kw',
    latencyMs: 40,
    recordPlay: false,
    attempts: [{ source: 'kw', owner: 'source', ok: true, latencyMs: 15 }],
  })
  const events = allEntries()
  assert(!events.some(e => e.event === 'play_result'), '预加载不应写 play_result')
  assert(events.some(e => e.event === 'chain_result' && e.traceId === 'preload'), '预加载应写 chain_result')
  assert(report(events).playWindows.h24.total === 0, '预加载污染播放窗口')
  assert(report(events).windows.h24.total >= 1, '预加载取链未计数')
})

check('R4 缓存命中：cache_hit 单列，不进取链', async() => {
  reset()
  await hlog.recordCacheHit({ platform: 'kw', quality: '128k', sourceId: 'kw' })
  const events = allEntries()
  const result = report(events)
  assert(events.some(e => e.event === 'cache_hit'), '缺 cache_hit')
  assert(result.cacheHits.h24 >= 1, '缓存命中未计数')
  assert(result.windows.h24.total === 0, '缓存命中污染取链窗口')
  assert(result.playWindows.h24.total === 0, '缓存命中污染播放窗口')
})

;(async() => {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`✓ ${t.name}`)
    } catch (e) {
      failures.push({ name: t.name, error: e.message })
      console.log(`✗ ${t.name} — ${e.message}`)
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})()
