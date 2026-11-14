#!/usr/bin/env node
/**
 * 方案 6.3 UI 映射契约（U1~U10）
 *
 * 覆盖：4 主状态文案/颜色、reason 可见、4 主状态摘要、质量矩阵七项、
 * API 绑定、全局探测确认、三语键齐备且无硬编码中文单位。
 *
 * 用法：node scripts/check_health_ui_mapping.js
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
const ui = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Setting/settings/Health.tsx'), 'utf8')
const langs = {}
for (const l of ['zh-cn', 'zh-tw', 'en-us']) langs[l] = JSON.parse(fs.readFileSync(path.join(ROOT, `src/lang/${l}.json`), 'utf8'))
const assert = (c, m) => { if (!c) throw new Error(m) }
let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) } catch (e) { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) }
}
const base = { enabled: true, sleeping: false, state: 'closed', successRate: 0.9, healthScore: 5, reqCount: 10, probeCount: 2 }

check('U1 4 主状态都有三语文案', () => {
  for (const k of ['health_main_available', 'health_main_degraded', 'health_main_paused', 'health_main_off']) {
    for (const l of ['zh-cn', 'zh-tw', 'en-us']) assert(langs[l][k], `${l} 缺 ${k}`)
  }
})

check('U2 每个主状态都有 tone，页面四色分支完整', () => {
  const tones = new Set(st.HEALTH_MAIN_STATES.map(s => st.classifyHealthMainState({
    ...base,
    state: s === 'degraded' ? 'open' : 'closed',
    playDead: s === 'paused',
    userEnabled: s !== 'off',
    offReason: s === 'off' ? 'USER_OFF' : null,
  }, true).tone))
  assert(tones.size >= 2, 'tone 未覆盖不同主状态')
  for (const c of ["status.tone === 'ok'", "status.tone === 'warn'", "status.tone === 'bad'"]) assert(ui.includes(c), `缺颜色分支 ${c}`)
})

check('U3 表格胶囊显示主状态 + 本地化 reason 两行', () => {
  assert(ui.includes('classifyHealthMainState(item, sampled)'), '行内未用主状态分类')
  assert(ui.includes('const reasonText = tt(`health_reason_${status.reason}`)'), 'reason 未走 i18n')
  assert(ui.includes('{reasonText}'), '未显示本地化 reason')
  assert(ui.includes('accessibilityLabel={`${reasonText} (${status.reason})`}'), 'raw reason 未保留在无障碍标签')
  assert(ui.includes('const stateText = tt(status.key)'), '主状态文案未走 i18n')
})

check('U4 摘要只显示 4 主状态，不再有旧 9 桶入口', () => {
  assert(ui.includes('summary.available'), '摘要缺可用计数')
  assert(ui.includes('summary.degraded'), '摘要缺降级计数')
  assert(ui.includes('summary.paused'), '摘要缺暂停计数')
  assert(ui.includes('summary.off'), '摘要缺已关闭计数')
  assert(!ui.includes('summary.buckets'), '仍残留旧桶明细')
  assert(!ui.includes('summaryDetailOpen'), '仍残留旧桶展开状态')
  assert(!ui.includes('health_main_detail'), '仍残留旧状态明细入口')
})

check('U5 质量矩阵七项字段齐全', () => {
  for (const k of ['q.req', 'q.success', 'q.fail', 'q.businessFail', 'q.avgTime', 'q.state', 'q.rateLimited']) assert(ui.includes(k), `矩阵缺 ${k}`)
  assert(st.HEALTH_QUALITIES.length === 4, '音质档数量应为 4')
})

check('U6 质量矩阵不硬编码中文单位', () => {
  for (const bad of ['$' + '{q.req}次', '成$' + '{q.success}', '败$' + '{q.fail}', '业务$' + '{q.businessFail}']) assert(!ui.includes(bad), `硬编码中文单位：${bad}`)
})

check('U7 多源绑定与质量提示可见', () => {
  assert(ui.includes("t('health_quality_matrix_tip')"), '缺质量矩阵说明')
  assert(ui.includes("t('health_source_binding'"), '缺绑定 API 显示')
  assert(ui.includes('boundSourceId(item)'), '绑定 API 未取当前源')
})

check('U8 全局探测明确提示“会实际应用结果”', () => {
  assert(ui.includes("t('health_probe_all_apply_tip')"), '缺全局探测应用确认')
  assert(ui.includes("t('health_probe_apply_tip')"), '缺单源探测应用确认')
})

check('U9 主状态与 reason 一一映射，无未知 reason', () => {
  const known = new Set(['ELIGIBLE', 'PENDING_SAMPLE', 'DEGRADED', 'PLAYBACK_FAILED', 'RESOLVE_FAILED', 'RATE_LIMITED', 'QUALITY_OPEN', 'QUALITY_HALF_OPEN', 'SOURCE_SLEEPING', 'AUTO_OFF_PROBE', 'USER_OFF', 'DEFAULT_OFF'])
  const cases = [{}, { reqCount: 0, probeCount: 0 }, { state: 'open' }, { state: 'half-open' }, { rateLimitActive: true }, { successRate: 0, healthScore: -9 }, { playDead: true }, { resolveDead: true }, { enabled: false, sleeping: true }, { autoOff: true, offReason: 'AUTO_OFF_PROBE' }, { userEnabled: false, offReason: 'USER_OFF' }, { enabled: false, userEnabled: false, offReason: 'DEFAULT_OFF' }]
  for (const c of cases) {
    const r = st.classifyHealthMainState({ ...base, ...c }, !(c.reqCount === 0 && c.probeCount === 0))
    assert(known.has(r.reason), `未知 reason ${r.reason}`)
    assert(st.HEALTH_MAIN_STATES.includes(r.state), `未知主状态 ${r.state}`)
  }
  for (const reason of known) {
    for (const l of ['zh-cn', 'zh-tw', 'en-us']) {
      assert(typeof langs[l][`health_reason_${reason}`] === 'string' && langs[l][`health_reason_${reason}`], `${l} 缺 health_reason_${reason}`)
    }
  }
})

check('U10 三语键数一致且旧状态/旧桶键已删除', () => {
  const counts = Object.values(langs).map(x => Object.keys(x).length)
  assert(new Set(counts).size === 1, `三语键数不一致：${counts.join('/')}`)
  for (const k of ['health_sum_ok', 'health_sum_bad', 'health_sum_removed', 'health_sum_rate', 'health_sum_open', 'health_sum_half', 'health_sum_idle', 'health_sum_sleep', 'health_sum_off', 'health_state_removed', 'health_state_open']) {
    for (const l of ['zh-cn', 'zh-tw', 'en-us']) assert(!langs[l][k], `${l} 仍残留旧键 ${k}`)
  }
  for (const l of ['zh-cn', 'zh-tw', 'en-us']) {
    const joined = `${langs[l].health_desc}\n${langs[l].health_footnote}`
    for (const term of ['11 态', '9 桶', '11-state', '9-bucket', '11 態', '9 桶']) {
      assert(!joined.includes(term), `${l} 用户文案仍保留旧模型：${term}`)
    }
  }
})

check('U11 诊断取链/播放/探测三块独立可见', () => {
  assert(ui.includes('diagView.blocks.play') && ui.includes('diagView.blocks.probe'), '诊断 UI 未消费播放/探测块')
  for (const k of ['health_diag_chain', 'health_diag_play', 'health_diag_probe', 'health_diag_block']) {
    for (const l of ['zh-cn', 'zh-tw', 'en-us']) assert(langs[l][k], `${l} 缺 ${k}`)
  }
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
process.exit(0)
