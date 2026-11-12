#!/usr/bin/env node
/**
 * P1 第二刀：播放取链预算与 attempts 账本
 *
 * 目标：
 *   P1B-A1 24s 预算从播放取链开始计时，deadline 归 0
 *   P1B-A2 超时错误带 BUDGET_EXHAUSTED / retryable / attempts
 *   P1B-A3 主源失败写 primary attempt
 *   P1B-A4 候选失败写 fallback attempt 且预算耗尽即停
 *   P1B-A5 主源与候选请求都受预算 race 约束
 *   P1B-A6 外层失败日志带 attempts
 *
 * 用法：node20 scripts/check_playback_budget.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch (e) {
  ts = require('typescript')
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

let failures = 0
let checks = 0
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}

const SECTION = (name) => console.log(`\n[${name}]`)
const BUDGET = () => loadTs('src/core/music/playbackBudget.ts')

SECTION('budget')
run('P1B-A1 24s 预算起点与 deadline 归一', () => {
  const { PLAYBACK_BUDGET_MS, createPlaybackBudget, remainingBudgetMs } = BUDGET()
  assert.strictEqual(PLAYBACK_BUDGET_MS, 24_000, '预算必须是 24s，早于外层 25s')
  const budget = createPlaybackBudget(1000)
  assert.strictEqual(budget.deadline, 25_000)
  assert.strictEqual(remainingBudgetMs(budget, 1000), 24_000)
  assert.strictEqual(remainingBudgetMs(budget, 24_999), 1)
  assert.strictEqual(remainingBudgetMs(budget, 25_000), 0)
  assert.strictEqual(remainingBudgetMs(budget, 30_000), 0)
})

run('P1B-A2 预算耗尽错误带 code/retryable/attempts', () => {
  const { createBudgetExhaustedError } = BUDGET()
  const attempts = [{ source: 'kw', owner: 'source', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 12000 }]
  const error = createBudgetExhaustedError(attempts)
  assert.ok(error instanceof Error)
  assert.ok(error.message.startsWith('BUDGET_EXHAUSTED:'), error.message)
  assert.strictEqual(error.code, 'BUDGET_EXHAUSTED')
  assert.strictEqual(error.retryable, true)
  assert.strictEqual(error.attempts, attempts)
  assert.strictEqual(error.attempts.length, 1)
})

run('P1B-A2 错误码提取兼容 code 与 CODE: message', () => {
  const { classifyPlaybackErrorCode } = BUDGET()
  assert.strictEqual(classifyPlaybackErrorCode({ code: 'NOT_AUDIO' }), 'NOT_AUDIO')
  assert.strictEqual(classifyPlaybackErrorCode({ message: 'TIMEOUT: 请求超时' }), 'TIMEOUT')
  assert.strictEqual(classifyPlaybackErrorCode({ message: '普通错误' }), 'PLAY_FAIL')
})

SECTION('wiring')
run('P1B-A3 主源失败写 primary attempt', () => {
  const source = read('src/core/music/utils.ts')
  assert.ok(source.includes("stage: 'primary'"), '主源 catch 未写 primary attempt')
  assert.ok(source.includes('playbackAttempts.push'), '主源 catch 未 push attempts')
})

run('P1B-A4 候选接受 budget/attempts 且耗尽即停', () => {
  const source = read('src/core/music/utils.ts')
  assert.ok(source.includes('budget?: PlaybackBudget'), '候选函数未接受 budget')
  assert.ok(source.includes('attempts?: PlaybackAttempt[]'), '候选函数未接受 attempts')
  assert.ok(source.includes('isBudgetExhausted(playbackBudget)'), '候选循环未检查预算')
  assert.ok(source.includes("stage: 'fallback'"), '候选失败未写 fallback attempt')
})

run('P1B-A5 请求受 raceWithBudget 约束且 24s < 25s', () => {
  const utils = read('src/core/music/utils.ts')
  const online = read('src/core/music/online.ts')
  const budget = BUDGET()
  assert.ok(typeof budget.raceWithBudget === 'function', 'playbackBudget 缺少 raceWithBudget')
  assert.ok(/raceWithBudget[<(]/.test(utils), 'utils 未使用 raceWithBudget')
  assert.ok(budget.PLAYBACK_BUDGET_MS < 25_000, '24s 预算必须早于外层 25s')
  assert.ok(online.includes('25_000'), '外层 25s 兜底不应被移除')
})

run('P1B-A6 外层失败日志带 attempts', () => {
  const online = read('src/core/music/online.ts')
  assert.ok(online.includes('attempts'), 'online.ts 失败日志未带 attempts')
})

SECTION('other source cache')
const OTHER_CACHE = () => loadTs('src/core/music/otherSourceCache.ts')

run('P1D-A1 正向缓存 5min 到点失效', () => {
  const { createOtherSourceCache, readOtherSourceCache, writeOtherSourceCache, OTHER_SOURCE_CACHE_TTL_MS } = OTHER_CACHE()
  assert.strictEqual(OTHER_SOURCE_CACHE_TTL_MS, 300_000, '正向 TTL 必须是 5min')
  const cache = createOtherSourceCache()
  writeOtherSourceCache(cache, 'kw_1', [{ id: 'x' }], 1000, OTHER_SOURCE_CACHE_TTL_MS)
  assert.deepStrictEqual(readOtherSourceCache(cache, 'kw_1', 300_999), [{ id: 'x' }], '未到点应命中')
  assert.strictEqual(readOtherSourceCache(cache, 'kw_1', 301_000), undefined, '到点必须失效')
  assert.strictEqual(cache.has('kw_1'), false, '过期条目应删除')
})

run('P1D-A2 负缓存 60s 且不重搜', () => {
  const { createOtherSourceCache, readOtherSourceCache, writeOtherSourceCache, OTHER_SOURCE_NEGATIVE_TTL_MS } = OTHER_CACHE()
  assert.strictEqual(OTHER_SOURCE_NEGATIVE_TTL_MS, 60_000, '负缓存 TTL 必须是 60s')
  const cache = createOtherSourceCache()
  writeOtherSourceCache(cache, 'kw_miss', [], 1000, OTHER_SOURCE_NEGATIVE_TTL_MS)
  assert.deepStrictEqual(readOtherSourceCache(cache, 'kw_miss', 60_999), [], '负缓存期内应返回空数组')
  assert.strictEqual(readOtherSourceCache(cache, 'kw_miss', 61_000), undefined, '负缓存到点必须失效')
})

run('P1D-A3 容量 50 且 LRU 只淘汰最旧', () => {
  const { createOtherSourceCache, readOtherSourceCache, writeOtherSourceCache, OTHER_SOURCE_CACHE_CAPACITY } = OTHER_CACHE()
  assert.strictEqual(OTHER_SOURCE_CACHE_CAPACITY, 50, '容量必须是 50')
  const cache = createOtherSourceCache()
  for (let i = 0; i < 51; i++) writeOtherSourceCache(cache, `k${i}`, [i], 1000, 300_000)
  assert.strictEqual(cache.size, 50, '超限必须淘汰而不是清空')
  assert.strictEqual(readOtherSourceCache(cache, 'k0', 1000), undefined, '最旧条目应被淘汰')
  assert.deepStrictEqual(readOtherSourceCache(cache, 'k1', 1000), [1], '第二条应保留')
  assert.deepStrictEqual(readOtherSourceCache(cache, 'k50', 1000), [50], '最新条目应保留')
})

run('P1D-A4 utils 使用稳定 key 缓存并保留 refresh 语义', () => {
  const utils = read('src/core/music/utils.ts')
  assert.ok(utils.includes('readOtherSourceCache('), '未读 otherSourceCache')
  assert.ok(utils.includes('writeOtherSourceCache('), '未写 otherSourceCache')
  assert.ok(utils.includes('const cacheKey ='), '未使用稳定 key')
  assert.ok(utils.includes('if (!isRefresh)'), '未保留 refresh 跳过缓存')
  assert.ok(utils.includes('source.length ? OTHER_SOURCE_CACHE_TTL_MS : OTHER_SOURCE_NEGATIVE_TTL_MS'), '空结果未使用负缓存 TTL')
})

SECTION('play_result attempts')
const HEALTH_LOG = () => loadTs('src/core/healthLog.ts')

run('P1C-A1 play_result 持久化 attempts', () => {
  const { buildPlayResultEntry } = HEALTH_LOG()
  const entry = buildPlayResultEntry({
    traceId: 't-p1c',
    platform: 'kw',
    quality: '128k',
    ok: false,
    code: 'BUDGET_EXHAUSTED',
    latencyMs: 24000,
    attempts: [
      { source: 'kw', owner: 'source', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 12000 },
      { source: 'wy', owner: 'host', stage: 'fallback', ok: false, code: 'NETWORK_ERROR', latencyMs: 8000 },
    ],
  })
  assert.ok(Array.isArray(entry.attempts), 'play_result 未保存 attempts')
  assert.strictEqual(entry.attempts.length, 2, 'attempts 数量不符')
  assert.deepStrictEqual(entry.attempts[0], {
    source: 'kw', owner: 'source', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 12000,
  }, 'attempt 字段被改写')
})

run('P1C-A2 attempts 白名单归一、限 20 条', () => {
  const { buildPlayResultEntry } = HEALTH_LOG()
  const raw = Array.from({ length: 25 }, (_, i) => ({
    source: `s${i}`,
    stage: i % 2 ? 'fallback' : 'primary',
    ok: false,
    code: 'TIMEOUT',
    latencyMs: 1.6,
    url: 'https://secret.example/a.mp3',
    name: '不能落盘的歌名',
  }))
  const entry = buildPlayResultEntry({ ok: false, attempts: raw })
  assert.strictEqual(entry.attempts.length, 20, 'attempts 未限制 20 条')
  assert.strictEqual(entry.attempts[0].latencyMs, 2, 'latency 未取整')
  assert.ok(!('url' in entry.attempts[0]), 'attempts 泄漏 url')
  assert.ok(!('name' in entry.attempts[0]), 'attempts 泄漏歌名')
})

run('P1C-A3 失败记录接线并保留结构化错误码', () => {
  const online = read('src/core/music/online.ts')
  assert.ok(/attempts:\s*normalizeAttempts|attempts:\s*errAttempts/.test(online), '失败 recordPlayResult 未传 attempts')
  assert.ok(online.includes('errAny?.code'), '失败码未优先读取 err.code')
})

SECTION('owner attribution')
run('P1E-A1 owner 解析：source 声明归源，其余归宿主', () => {
  const { resolvePlaybackOwner } = BUDGET()
  assert.strictEqual(resolvePlaybackOwner('source'), 'source')
  assert.strictEqual(resolvePlaybackOwner('host'), 'host')
  assert.strictEqual(resolvePlaybackOwner(undefined), 'host')
})

run('P1E-A2 play_result 保留合法 owner，丢弃非法值', () => {
  const { buildPlayResultEntry } = HEALTH_LOG()
  const entry = buildPlayResultEntry({
    ok: false,
    attempts: [
      { source: 'kw', owner: 'source', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 12000 },
      { source: 'wy', owner: 'host', stage: 'fallback', ok: false, code: 'NETWORK_ERROR', latencyMs: 8000 },
      { source: 'kg', owner: 'bogus', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 1 },
    ],
  })
  assert.strictEqual(entry.attempts[0].owner, 'source')
  assert.strictEqual(entry.attempts[1].owner, 'host')
  assert.ok(!('owner' in entry.attempts[2]), '非法 owner 不应落盘')
})

run('P1E-A3 主源按 fallbackOwner 解析，候选固定 host', () => {
  const utils = read('src/core/music/utils.ts')
  assert.ok(utils.includes('resolvePlaybackOwner(fallbackOwner)'), '主源未按 fallbackOwner 解析 owner')
  assert.ok(/stage: 'primary'.*owner: primaryOwner|owner: primaryOwner.*stage: 'primary'/.test(utils), 'primary attempt 未使用解析后的 owner')
  assert.ok(/stage: 'fallback'.*owner: 'host'|owner: 'host'.*stage: 'fallback'/.test(utils), 'fallback attempt 未标记 host')
})

run('P1E-A4 同 trace 同平台候选只尝试一次', () => {
  const utils = read('src/core/music/utils.ts')
  assert.ok(utils.includes('if (retryedSource.includes(musicInfo.source)) continue'), '候选循环未按平台去重')
  assert.ok(utils.includes('retryedSource.push(musicInfo.source)'), '候选平台未入已试集合')
  assert.ok(utils.includes('retryedSource: [musicInfo.source]'), '首轮候选未预置主平台')
})

const asyncRun = async(name, fn) => {
  try { await fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}

;(async() => {
  SECTION('budget behavior')
  await asyncRun('P1B-A5 已过期预算立刻拒绝且不等待请求', async() => {
    const { createPlaybackBudget, raceWithBudget } = BUDGET()
    const expired = createPlaybackBudget(0, 1)
    await assert.rejects(
      raceWithBudget(Promise.resolve('ok'), expired, []),
      (error) => error.code === 'BUDGET_EXHAUSTED' && error.retryable === true,
    )
  })

  await asyncRun('P1B-A5 未过期预算先返回真实结果', async() => {
    const { createPlaybackBudget, raceWithBudget } = BUDGET()
    const budget = createPlaybackBudget()
    assert.strictEqual(await raceWithBudget(Promise.resolve('ok'), budget, []), 'ok')
  })

  console.log(`\n===== 播放预算审计：${checks} 通过 / ${failures} 失败 =====`)
  process.exit(failures ? 1 : 0)
})()
