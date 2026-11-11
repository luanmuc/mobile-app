#!/usr/bin/env node
/**
 * 本地诊断窗口视图模型审计（折叠态 / 四层分组 / 空态 / 百分比 / 压力）
 *
 * 运行：node scripts/check_health_diagnostics_view.js
 * 说明：直接转译生产 TS 模块，不复制实现；任一条失败退出码 1。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let ts
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch { ts = require('typescript') }

const cache = new Map()
const loadTs = (rel) => {
  if (cache.has(rel)) return cache.get(rel).exports
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  // 仅加载本仓转译模块，不执行外部输入；相对引用继续走同一转译链
  const localRequire = (spec) => {
    if (!spec.startsWith('.')) return require(spec)
    const target = path.resolve(path.dirname(file), spec)
    const targetRel = path.relative(ROOT, target).replace(/\\/g, '/')
    return loadTs(targetRel.endsWith('.ts') ? targetRel : `${targetRel}.ts`)
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`✓ ${name}`)
  } catch (e) {
    failures.push(`${name} — ${e && e.message}`)
    console.log(`✗ ${name} — ${e && e.message}`)
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

const NOW = new Date('2026-11-11T12:00:00+08:00').getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const win = (over = {}) => ({
  total: 0, ok: 0, failed: 0, successRate: null, p95: null, covered: false, ...over,
})
const finding = (id, over = {}) => ({
  id,
  level: 'warn',
  title: id,
  detail: '',
  evidence: '',
  suggestion: '',
  traceIds: [],
  ...over,
})
const report = (over = {}) => ({
  schema: 1,
  generatedAt: NOW,
  summary: '',
  windows: { h1: win(), h24: win(), d7: win() },
  coverage: {
    eventCount: 0,
    oldestTs: null,
    newestTs: null,
    coveredMs: 0,
    truncated: false,
    unweightedSuccesses: 0,
  },
  breakdown: [],
  findings: [],
  recommendations: [],
  traceIds: [],
  ...over,
})

const view = loadTs('src/core/healthDiagnosticsView.ts')

check('V1 百分比：null/0/22%/100%', () => {
  assert(view.percentText(null) === '-', `null => ${view.percentText(null)}`)
  assert(view.percentText(undefined) === '-', `undefined => ${view.percentText(undefined)}`)
  assert(view.percentText(0) === '0%', `0 => ${view.percentText(0)}`)
  assert(view.percentText(0.221) === '22%', `0.221 => ${view.percentText(0.221)}`)
  assert(view.percentText(1) === '100%', `1 => ${view.percentText(1)}`)
})

check('V2 空报告：空态、无错误码/其他线索、成功率 -', () => {
  const v = view.buildHealthDiagnosticsView(report())
  assert(v.empty === true, `empty=${v.empty}`)
  assert(v.codes.length === 0 && v.others.length === 0, `${v.codes.length}/${v.others.length}`)
  assert(v.stats.rateText === '-', v.stats.rateText)
  assert(v.coverage.span === '0 小时', v.coverage.span)
})

check('V3 24h 统计与低成功率告警阈值', () => {
  const low = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win({ total: 9, ok: 2, failed: 7, successRate: 0.22 }), d7: win() },
  }))
  assert(low.stats.total === 9 && low.stats.ok === 2 && low.stats.failed === 7, JSON.stringify(low.stats))
  assert(low.stats.rateText === '22%' && low.stats.rateWarn === true, JSON.stringify(low.stats))
  const edge = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win({ total: 10, ok: 6, failed: 4, successRate: 0.6 }), d7: win() },
  }))
  assert(edge.stats.rateWarn === false, `60% 被误判为低：${edge.stats.rateWarn}`)
})

check('V4 覆盖 7 天：full=true，不显示截断', () => {
  const v = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win(), d7: win({ covered: true }) },
    coverage: { eventCount: 2, oldestTs: NOW - 7 * DAY, newestTs: NOW, coveredMs: 7 * DAY, truncated: false, unweightedSuccesses: 0 },
  }))
  assert(v.coverage.full === true && v.coverage.truncated === false, JSON.stringify(v.coverage))
  assert(v.coverage.span === '7 天', v.coverage.span)
})

check('V5 覆盖 8 小时 + 截断：full=false，保留实际跨度', () => {
  const v = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win(), d7: win({ covered: false }) },
    coverage: { eventCount: 100, oldestTs: NOW - 8 * HOUR, newestTs: NOW, coveredMs: 8 * HOUR, truncated: true, unweightedSuccesses: 0 },
  }))
  assert(v.coverage.full === false && v.coverage.truncated === true, JSON.stringify(v.coverage))
  assert(v.coverage.span === '8 小时', v.coverage.span)
})

check('V6 1 小时：0 条为空态，非 0 保留次数/成功数', () => {
  const none = view.buildHealthDiagnosticsView(report())
  assert(none.h1.empty === true, JSON.stringify(none.h1))
  const some = view.buildHealthDiagnosticsView(report({
    windows: { h1: win({ total: 4, ok: 3, failed: 1, successRate: 0.75 }), h24: win(), d7: win() },
  }))
  assert(some.h1.empty === false && some.h1.total === 4 && some.h1.ok === 3, JSON.stringify(some.h1))
})

check('V7 错误码只收 new_code/recent_failure，其他线索不混入', () => {
  const v = view.buildHealthDiagnosticsView(report({
    findings: [
      finding('rate_drop'),
      finding('new_code'),
      finding('p95_spike'),
      finding('recent_failure'),
    ],
  }))
  assert(v.codes.map(f => f.id).join(',') === 'new_code,recent_failure', v.codes.map(f => f.id).join(','))
  assert(v.others.map(f => f.id).join(',') === 'rate_drop,p95_spike', v.others.map(f => f.id).join(','))
})

check('V8 分组保持原顺序，且不修改原 findings 数组', () => {
  const findings = [finding('recent_failure'), finding('new_code'), finding('rate_drop')]
  const before = findings.map(f => f.id).join(',')
  const v = view.buildHealthDiagnosticsView(report({ findings }))
  assert(v.codes.map(f => f.id).join(',') === 'recent_failure,new_code', v.codes.map(f => f.id).join(','))
  assert(findings.map(f => f.id).join(',') === before, `原数组被改写：${findings.map(f => f.id).join(',')}`)
})

check('V9 findingCount 包含全部线索，空态仅由 findings 决定', () => {
  const v = view.buildHealthDiagnosticsView(report({ findings: [finding('new_code'), finding('rate_drop'), finding('trend_decline')] }))
  assert(v.findingCount === 3 && v.empty === false, `${v.findingCount}/${v.empty}`)
})

check('V10 未加权样本：2 条时 hasUnweighted=true', () => {
  const v = view.buildHealthDiagnosticsView(report({
    coverage: { eventCount: 2, oldestTs: NOW - HOUR, newestTs: NOW, coveredMs: HOUR, truncated: false, unweightedSuccesses: 2 },
  }))
  assert(v.weighting.unweightedSuccesses === 2 && v.weighting.hasUnweighted === true, JSON.stringify(v.weighting))
})

check('V11 无未加权样本：hasUnweighted=false，仍可显示加权说明', () => {
  const v = view.buildHealthDiagnosticsView(report())
  assert(v.weighting.hasUnweighted === false, JSON.stringify(v.weighting))
})

check('V12 折叠态摘要字段：ok/total/rate/findingCount 一致', () => {
  const v = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win({ total: 9, ok: 2, failed: 7, successRate: 0.22 }), d7: win() },
    findings: [finding('new_code'), finding('rate_drop')],
  }))
  assert(v.collapsed.ok === 2 && v.collapsed.total === 9, JSON.stringify(v.collapsed))
  assert(v.collapsed.rateText === '22%' && v.collapsed.findingCount === 2, JSON.stringify(v.collapsed))
})

check('V13 12 条 finding 全量保留，不截断', () => {
  const findings = Array.from({ length: 12 }, (_, i) => finding(i === 0 ? 'new_code' : `x${i}`))
  const v = view.buildHealthDiagnosticsView(report({ findings }))
  assert(v.findingCount === 12, `${v.findingCount}`)
  assert(v.codes.length === 1 && v.others.length === 11, `${v.codes.length}/${v.others.length}`)
})

check('V14 覆盖跨度 0 不产生负值/NaN', () => {
  const v = view.buildHealthDiagnosticsView(report({
    coverage: { eventCount: 1, oldestTs: NOW, newestTs: NOW, coveredMs: 0, truncated: false, unweightedSuccesses: 0 },
  }))
  assert(v.coverage.span === '0 小时', v.coverage.span)
})

check('V15 成功率 0% 仍可展示且判低', () => {
  const v = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win({ total: 5, ok: 0, failed: 5, successRate: 0 }), d7: win() },
  }))
  assert(v.stats.rateText === '0%' && v.stats.rateWarn === true, JSON.stringify(v.stats))
})

check('V16 d7 未覆盖但 h24 有数据：full=false 且统计不丢', () => {
  const v = view.buildHealthDiagnosticsView(report({
    windows: { h1: win(), h24: win({ total: 3, ok: 1, failed: 2, successRate: 0.333 }), d7: win({ total: 3, ok: 1, failed: 2, successRate: 0.333 }) },
  }))
  assert(v.coverage.full === false && v.stats.total === 3 && v.stats.rateText === '33%', `${v.coverage.full}/${v.stats.total}/${v.stats.rateText}`)
})

check('V17 视图模型不修改原报告引用', () => {
  const r = report({ findings: [finding('new_code')] })
  const v = view.buildHealthDiagnosticsView(r)
  assert(v.codes[0] === r.findings[0], '分组应保留原 finding 引用')
  assert(r.findings.length === 1, `原报告 findings 被改写：${r.findings.length}`)
})

check('V18 10000 次视图构建 ≤300ms', () => {
  const r = report({
    windows: { h1: win({ total: 2, ok: 1 }), h24: win({ total: 9, ok: 2, failed: 7, successRate: 0.22 }), d7: win() },
    findings: Array.from({ length: 12 }, (_, i) => finding(i === 0 ? 'new_code' : `x${i}`)),
    coverage: { eventCount: 100, oldestTs: NOW - 8 * HOUR, newestTs: NOW, coveredMs: 8 * HOUR, truncated: true, unweightedSuccesses: 2 },
  })
  const start = Date.now()
  for (let i = 0; i < 10000; i++) view.buildHealthDiagnosticsView(r)
  const cost = Date.now() - start
  assert(cost <= 300, `10000 次耗时 ${cost}ms`)
  console.log(`  耗时 ${cost}ms`)
})

check('V19 100000 次百分比格式化 ≤200ms', () => {
  const start = Date.now()
  for (let i = 0; i < 100000; i++) view.percentText((i % 101) / 100)
  const cost = Date.now() - start
  assert(cost <= 200, `100000 次耗时 ${cost}ms`)
  console.log(`  耗时 ${cost}ms`)
})

check('V20 视图构建无副作用：连续两次结果一致', () => {
  const r = report({ findings: [finding('new_code'), finding('rate_drop')] })
  const a = view.buildHealthDiagnosticsView(r)
  const b = view.buildHealthDiagnosticsView(r)
  assert(JSON.stringify(a) === JSON.stringify(b), '两次结果不一致')
})

console.log(`\n===== 本地诊断视图模型审计：${passed} 通过 / ${failures.length} 失败 =====`)
if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach(f => console.log(` - ${f}`))
  process.exit(1)
}
