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
  const attempts = [{ source: 'kw', stage: 'primary', ok: false, code: 'TIMEOUT', latencyMs: 12000 }]
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
