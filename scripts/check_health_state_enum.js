#!/usr/bin/env node
/**
 * E14 / R75：状态分类全枚举。
 *
 * `check_health_status_refactor`（19 条）守的是「判定优先级与 288 结构」，
 * 本脚本换一个角度：**把 classifyHealthMainState 的 12 个 reason 逐个走一遍**，
 * 并钉住「谁压过谁」的优先级链，防止有人调换两行 if 的顺序而 19 条仍全绿
 * （那种改动不改变单点结果，只改变冲突组合的结果）。
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

const assert = require('assert')
const h = loadTs('src/core/healthStatus.ts')
const classify = h.classifyHealthMainState

let checks = 0
let failures = 0
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) { failures++; console.error(`  ✗ ${name}`); console.error(`    ${e && e.message ? e.message : e}`) }
}

// 基线：一个「健康、有样本、可用」的源
const base = (over = {}) => ({
  enabled: true,
  sleeping: false,
  state: 'closed',
  successRate: 1,
  healthScore: 100,
  reqCount: 5,
  probeCount: 0,
  playDead: false,
  resolveDead: false,
  rateLimited: false,
  rateLimitActive: false,
  userEnabled: true,
  autoOff: false,
  offReason: null,
  ...over,
})

console.log('\n[E14 state enum]')

run('E14-01 USER_OFF → off / muted', () => {
  const r = classify(base({ offReason: 'USER_OFF' }), true)
  assert.deepStrictEqual([r.state, r.reason, r.tone, r.key], ['off', 'USER_OFF', 'muted', 'health_main_off'])
})

run('E14-02 DEFAULT_OFF → off / muted', () => {
  const r = classify(base({ offReason: 'DEFAULT_OFF' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['off', 'DEFAULT_OFF'])
})

run('E14-03 offReason=AUTO_OFF_PROBE → paused', () => {
  const r = classify(base({ offReason: 'AUTO_OFF_PROBE' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'AUTO_OFF_PROBE'])
})

run('E14-04 autoOff=true 无 offReason 等价 → paused', () => {
  const r = classify(base({ autoOff: true }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'AUTO_OFF_PROBE'])
})

run('E14-05 SLEEPING → paused / SOURCE_SLEEPING', () => {
  const r = classify(base({ offReason: 'SLEEPING' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'SOURCE_SLEEPING'])
})

run('E14-06 PLAY_DEAD → paused / PLAYBACK_FAILED', () => {
  const r = classify(base({ offReason: 'PLAY_DEAD' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'PLAYBACK_FAILED'])
})

run('E14-07 playDead=true 无 offReason 等价 → paused', () => {
  const r = classify(base({ playDead: true }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'PLAYBACK_FAILED'])
})

run('E14-08 resolveDead → paused / RESOLVE_FAILED', () => {
  const r = classify(base({ resolveDead: true }), true)
  assert.deepStrictEqual([r.state, r.reason], ['paused', 'RESOLVE_FAILED'])
})

run('E14-09 无样本 → available / PENDING_SAMPLE（即便 state=open）', () => {
  const r = classify(base({ state: 'open', reqCount: 0, probeCount: 0, successRate: 0 }), false)
  assert.deepStrictEqual([r.state, r.reason], ['available', 'PENDING_SAMPLE'])
})

run('E14-10 rateLimitActive → degraded / RATE_LIMITED', () => {
  const r = classify(base({ rateLimitActive: true, successRate: 0 }), true)
  assert.deepStrictEqual([r.state, r.reason, r.tone], ['degraded', 'RATE_LIMITED', 'warn'])
})

run('E14-11 rateLimited → degraded（与 rateLimitActive 等价）', () => {
  const r = classify(base({ rateLimited: true }), true)
  assert.deepStrictEqual([r.state, r.reason], ['degraded', 'RATE_LIMITED'])
})

run('E14-12 breaker open → degraded / QUALITY_OPEN', () => {
  const r = classify(base({ state: 'open' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['degraded', 'QUALITY_OPEN'])
})

run('E14-13 breaker half-open → degraded / QUALITY_HALF_OPEN', () => {
  const r = classify(base({ state: 'half-open' }), true)
  assert.deepStrictEqual([r.state, r.reason], ['degraded', 'QUALITY_HALF_OPEN'])
})

run('E14-14 successRate=0 且 healthScore<0 → degraded / DEGRADED', () => {
  const r = classify(base({ successRate: 0, healthScore: -1 }), true)
  assert.deepStrictEqual([r.state, r.reason], ['degraded', 'DEGRADED'])
})

run('E14-15 其余 → available / ELIGIBLE', () => {
  const r = classify(base(), true)
  assert.deepStrictEqual([r.state, r.reason, r.tone], ['available', 'ELIGIBLE', 'ok'])
})

run('E14-16 优先级：USER_OFF 压过 PLAY_DEAD + open + rateLimit', () => {
  const r = classify(base({ offReason: 'USER_OFF', playDead: true, state: 'open', rateLimitActive: true }), true)
  assert.strictEqual(r.reason, 'USER_OFF')
})

run('E14-17 优先级：PLAY_DEAD 压过 open + rateLimit', () => {
  const r = classify(base({ playDead: true, state: 'open', rateLimitActive: true }), true)
  assert.strictEqual(r.reason, 'PLAYBACK_FAILED')
})

run('E14-18 优先级：无样本压过 open / half-open（不因 open 报 degraded）', () => {
  for (const st of ['open', 'half-open']) {
    const r = classify(base({ state: st, reqCount: 0, probeCount: 0 }), false)
    assert.strictEqual(r.reason, 'PENDING_SAMPLE', `state=${st} 时 reason=${r.reason}`)
  }
})

run('E14-19 优先级：rateLimit 压过 open', () => {
  const r = classify(base({ state: 'open', rateLimitActive: true }), true)
  assert.strictEqual(r.reason, 'RATE_LIMITED')
})

run('E14-20 4 主状态的 tone 映射固定', () => {
  const cases = [
    [base({ offReason: 'USER_OFF' }), true, 'off', 'muted'],
    [base({ playDead: true }), true, 'paused', 'muted'],
    [base({ state: 'open' }), true, 'degraded', 'warn'],
    [base(), true, 'available', 'ok'],
  ]
  for (const [item, sampled, state, tone] of cases) {
    const r = classify(item, sampled)
    assert.strictEqual(r.state, state)
    assert.strictEqual(r.tone, tone, `${state} 的 tone=${r.tone}`)
  }
})

run('E14-21 4 主状态的 key 映射固定', () => {
  const cases = [
    [base({ offReason: 'USER_OFF' }), 'off', 'health_main_off'],
    [base({ playDead: true }), 'paused', 'health_main_paused'],
    [base({ state: 'open' }), 'degraded', 'health_main_degraded'],
    [base(), 'available', 'health_main_available'],
  ]
  for (const [item, state, key] of cases) {
    const r = classify(item, true)
    assert.strictEqual(r.state, state)
    assert.strictEqual(r.key, key, `${state} 的 key=${r.key}`)
  }
})

run('E14-22 288 组合全枚举：输出恒为合法四元组', () => {
  const offReasons = [null, 'USER_OFF', 'DEFAULT_OFF', 'AUTO_OFF_PROBE', 'SLEEPING', 'PLAY_DEAD']
  const states = ['closed', 'open', 'half-open']
  const flags = [{}, { playDead: true }, { resolveDead: true }, { rateLimitActive: true }]
  const sampleFlags = [true, false]
  const legalStates = new Set(['available', 'degraded', 'paused', 'off'])
  const legalTones = new Set(['ok', 'warn', 'bad', 'muted'])
  let n = 0
  const seenReasons = new Set()
  for (const offReason of offReasons) {
    for (const st of states) {
      for (const f of flags) {
        for (const sampled of sampleFlags) {
          for (const successRate of [1, 0]) {
            for (const healthScore of [100, -1]) {
              const r = classify(base({ offReason, state: st, successRate, healthScore, ...f }), sampled)
              n++
              assert(legalStates.has(r.state), `非法 state=${r.state}`)
              assert(legalTones.has(r.tone), `非法 tone=${r.tone}`)
              assert(typeof r.key === 'string' && r.key.startsWith('health_main_'), `非法 key=${r.key}`)
              assert(typeof r.reason === 'string' && r.reason.length > 0, 'reason 为空')
              seenReasons.add(r.reason)
            }
          }
        }
      }
    }
  }
  assert(n >= 288, `只枚举了 ${n} 组合`)
  // 12 个 reason 必须全部可达，否则说明某条分支已成死代码
  const expected = ['ELIGIBLE', 'PENDING_SAMPLE', 'DEGRADED', 'PLAYBACK_FAILED', 'RESOLVE_FAILED',
    'RATE_LIMITED', 'QUALITY_OPEN', 'QUALITY_HALF_OPEN', 'SOURCE_SLEEPING', 'AUTO_OFF_PROBE', 'USER_OFF', 'DEFAULT_OFF']
  const missing = expected.filter(x => !seenReasons.has(x))
  assert.strictEqual(missing.length, 0, `不可达 reason：${missing.join(',')}`)
})

console.log(`\n===== E14 状态全枚举：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
