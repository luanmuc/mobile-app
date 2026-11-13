#!/usr/bin/env node
/**
 * 方案 6.3 状态 v2 契约（S1~S8）
 *
 * 覆盖：4 主状态 + reason、旧 11 态一一映射、主/旧桶双汇总、UI 消费、
 * 三语键齐备、reason 可显示。
 *
 * 用法：node scripts/check_health_state_v2.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const Module = require('module')
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
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, Module.createRequire(file), mod, file, path.dirname(file))
  return mod.exports
}
const st = loadTs('src/core/healthStatus.ts')
const assert = (c, m) => { if (!c) throw new Error(m) }
let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) } catch (e) { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) }
}
const base = {
  enabled: true,
  sleeping: false,
  state: 'closed',
  successRate: 0.9,
  healthScore: 5,
  reqCount: 10,
  probeCount: 2,
}
const call = over => st.classifyHealthMainState({ ...base, ...over }, over.sampled ?? true)
const oldCall = over => st.classifyHealthState({ ...base, ...over }, over.sampled ?? true)

check('S1 主状态固定 4 个', () => {
  assert(Array.isArray(st.HEALTH_MAIN_STATES) && st.HEALTH_MAIN_STATES.length === 4, 'HEALTH_MAIN_STATES 应为 4')
  assert(['available', 'degraded', 'paused', 'off'].every(s => st.HEALTH_MAIN_STATES.includes(s)), '主状态枚举不符')
})

check('S2 正常/待采样 = 可用', () => {
  const ok = call({})
  assert(ok.state === 'available' && ok.reason === 'ELIGIBLE', `正常映射错误：${JSON.stringify(ok)}`)
  const idle = call({ reqCount: 0, probeCount: 0, sampled: false })
  assert(idle.state === 'available' && idle.reason === 'PENDING_SAMPLE', `待采样映射错误：${JSON.stringify(idle)}`)
})

check('S3 熔断/半开/限流/异常 = 降级且 reason 不同', () => {
  assert(call({ state: 'open' }).reason === 'QUALITY_OPEN', 'open 应 QUALITY_OPEN')
  assert(call({ state: 'half-open' }).reason === 'QUALITY_HALF_OPEN', 'half-open 应 QUALITY_HALF_OPEN')
  assert(call({ rateLimitActive: true }).reason === 'RATE_LIMITED', '限流应 RATE_LIMITED')
  const bad = call({ successRate: 0, healthScore: -10 })
  assert(bad.state === 'degraded' && bad.reason === 'DEGRADED', '异常应 degraded/DEGRADED')
})

check('S4 摘除/休眠/自动关闭 = 暂停', () => {
  assert(call({ playDead: true }).state === 'paused' && call({ playDead: true }).reason === 'PLAYBACK_FAILED', 'playDead 映射错误')
  assert(call({ resolveDead: true }).reason === 'RESOLVE_FAILED', 'resolveDead 映射错误')
  assert(call({ enabled: false, sleeping: true, sampled: false }).reason === 'SOURCE_SLEEPING', '休眠映射错误')
  assert(call({ autoOff: true, offReason: 'AUTO_OFF_PROBE' }).reason === 'AUTO_OFF_PROBE', '自动关闭映射错误')
})

check('S5 用户关闭 / 默认关闭 = 手动关闭', () => {
  const u = call({ userEnabled: false, offReason: 'USER_OFF', sampled: false })
  assert(u.state === 'off' && u.reason === 'USER_OFF', `USER_OFF 映射错误：${JSON.stringify(u)}`)
  const d = call({ enabled: false, userEnabled: false, offReason: 'DEFAULT_OFF', sampled: false })
  assert(d.state === 'off' && d.reason === 'DEFAULT_OFF', `DEFAULT_OFF 映射错误：${JSON.stringify(d)}`)
})

check('S6 旧 11 态全部有主状态 + reason，不丢信息', () => {
  const cases = [
    {}, { reqCount: 0, probeCount: 0, sampled: false }, { successRate: 0, healthScore: -10 },
    { playDead: true }, { rateLimitActive: true }, { state: 'open' }, { state: 'half-open' },
    { enabled: false, sleeping: true, sampled: false }, { autoOff: true, offReason: 'AUTO_OFF_PROBE' },
    { userEnabled: false, offReason: 'USER_OFF', sampled: false }, { enabled: false, userEnabled: false, offReason: 'DEFAULT_OFF', sampled: false },
  ]
  for (const c of cases) {
    const main = call(c)
    const old = oldCall(c)
    assert(st.HEALTH_MAIN_STATES.includes(main.state), '主状态越界')
    assert(main.reason && typeof main.reason === 'string', '缺 reason')
    assert(old.key && old.bucket, '旧态未保留')
  }
})

check('S7 汇总同时给 4 主状态计数与 9 桶明细，合计都等于源数', () => {
  const items = [
    { ...base },
    { ...base, state: 'open' },
    { ...base, playDead: true },
    { ...base, userEnabled: false, offReason: 'USER_OFF', enabled: false, reqCount: 0, probeCount: 0 },
  ]
  const s = st.buildHealthSummaryV2(items)
  const mainTotal = Object.values(s.main).reduce((a, b) => a + b, 0)
  const bucketTotal = Object.values(s.buckets).reduce((a, b) => a + b, 0)
  assert(mainTotal === items.length, `主状态合计 ${mainTotal} != ${items.length}`)
  assert(bucketTotal === items.length, `旧桶合计 ${bucketTotal} != ${items.length}`)
  assert(s.main.available === 1 && s.main.degraded === 1 && s.main.paused === 1 && s.main.off === 1, `主状态计数错误：${JSON.stringify(s.main)}`)
})

check('S8 UI 消费主状态汇总且显示 reason；三语键齐备', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Setting/settings/Health.tsx'), 'utf8')
  assert(ui.includes('buildHealthSummaryV2'), 'Health.tsx 未消费主状态汇总')
  assert(ui.includes('classifyHealthMainState'), 'Health.tsx 未消费主状态分类')
  assert(ui.includes('status.reason'), 'Health.tsx 未显示 reason')
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, `src/lang/${lang}.json`), 'utf8'))
    for (const k of ['health_main_available', 'health_main_degraded', 'health_main_paused', 'health_main_off', 'health_main_detail']) {
      assert(typeof json[k] === 'string' && json[k], `${lang} 缺 ${k}`)
    }
  }
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
process.exit(0)
