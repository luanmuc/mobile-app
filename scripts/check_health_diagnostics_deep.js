#!/usr/bin/env node
/**
 * 音源健康本地诊断 · 深度审计压力脚本（独立于 check_health_diagnostics_stress.js）
 *
 * 目标：不是只跑“大数据不崩”，而是逐条覆盖 healthDiagnostics / healthLog 的
 * 分支、边界、隐私、性能与证据包不变量。每个 group 对应审计计划里的 D 组条目。
 *
 * 运行：node scripts/check_health_diagnostics_deep.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let ts
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch { ts = require('typescript') }

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // 仅加载本仓转译模块，不执行外部输入
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

const diag = loadTs('src/core/healthDiagnostics.ts')
const log = loadTs('src/core/healthLog.ts')

const res = []
const rec = (id, name, ok, detail) => {
  res.push({ id, ok: !!ok, name, detail: String(detail || '') })
  console.log(`${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`)
}
const near = (a, b, eps = 0.005) => typeof a === 'number' && Math.abs(a - b) <= eps
const event = (o = {}) => ({
  traceId: 't',
  event: 'source_result',
  sourceId: 's',
  platform: 'kw',
  quality: '128k',
  ok: true,
  latencyMs: 100,
  ts: NOW - 5 * 60 * 1000,
  ...o,
})

const NOW = new Date('2026-11-11T12:00:00+08:00').getTime()
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// ---------- A. 加权数学与窗口 ----------
{
  const weighted = []
  for (let i = 0; i < 950; i++) weighted.push(event({ traceId: `ok-${i}`, ok: true, sampleWeight: 20 }))
  for (let i = 0; i < 1000; i++) weighted.push(event({ traceId: `bad-${i}`, ok: false, code: 'E' }))
  const agg = diag.aggregateHealthEvents(weighted, NOW)
  rec('D1', '950*20 成功 + 1000 失败 = total 20000 / rate 95%', agg.windows.h1.total === 20000 && agg.windows.h1.ok === 19000 && agg.windows.h1.failed === 1000 && near(agg.windows.h1.successRate, 0.95), `${agg.windows.h1.total}/${agg.windows.h1.ok}/${agg.windows.h1.successRate}`)
  rec('D1', '三窗口 total 单调且同值', agg.windows.h1.total === agg.windows.h24.total && agg.windows.h24.total === agg.windows.d7.total, `${agg.windows.h1.total}/${agg.windows.h24.total}/${agg.windows.d7.total}`)

  const invalid = [
    event({ traceId: 'z1', sampleWeight: 0 }),
    event({ traceId: 'z2', sampleWeight: -3 }),
    event({ traceId: 'z3', sampleWeight: NaN }),
    event({ traceId: 'z4', sampleWeight: Infinity }),
    event({ traceId: 'z5', sampleWeight: 'x' }),
  ]
  const invalidAgg = diag.aggregateHealthEvents(invalid, NOW)
  rec('D2', '非法 sampleWeight 全部按 1，不得放大/抹掉样本', invalidAgg.windows.h1.total === 5 && invalidAgg.windows.h1.ok === 5, `${invalidAgg.windows.h1.total}/${invalidAgg.windows.h1.ok}`)

  const p95Events = [event({ latencyMs: 1000, ok: false })]
  for (let i = 0; i < 100; i++) p95Events.push(event({ traceId: `p${i}`, sampleWeight: 20, latencyMs: 100 }))
  const p95Agg = diag.aggregateHealthEvents(p95Events, NOW)
  rec('D3', 'P95 用原始延迟样本，不受权重影响', p95Agg.windows.h1.p95 === 100, String(p95Agg.windows.h1.p95))

  const emptyAgg = diag.aggregateHealthEvents([], NOW)
  rec('D4', '空事件三窗口 null 且 covered=false', emptyAgg.windows.h1.total === 0 && emptyAgg.windows.h1.successRate === null && emptyAgg.windows.h1.p95 === null && emptyAgg.windows.h1.covered === false, JSON.stringify(emptyAgg.windows.h1))

  const legacy = [event({ traceId: 'l1' }), event({ traceId: 'l2', ok: false })]
  const legacyAgg = diag.aggregateHealthEvents(legacy, NOW)
  rec('D5', '历史无权重事件按 1，total=长度', legacyAgg.windows.h1.total === 2 && legacyAgg.windows.h1.ok === 1, `${legacyAgg.windows.h1.total}/${legacyAgg.windows.h1.ok}`)

  const boundary = [
    event({ traceId: 'b0', ts: NOW - 2 * HOUR }),
    event({ traceId: 'b1', ts: NOW - HOUR + 1 }),
    event({ traceId: 'b2', ts: NOW - 30 * MIN }),
  ]
  const boundaryAgg = diag.aggregateHealthEvents(boundary, NOW)
  rec('D6', '1h 窗口内 2 条 + 2h 前基准：total=2 且 covered=true', boundaryAgg.windows.h1.total === 2 && boundaryAgg.windows.h1.covered === true, `${boundaryAgg.windows.h1.total}/${boundaryAgg.windows.h1.covered}`)

  const older = [event({ traceId: 'o1', ts: NOW - 2 * HOUR }), event({ traceId: 'o2', ts: NOW - 3 * HOUR })]
  const olderAgg = diag.aggregateHealthEvents(older, NOW)
  const recentOnly = diag.aggregateHealthEvents([event({ traceId: 'r1', ts: NOW - 30 * MIN })], NOW)
  rec('D7', 'covered 由全量最早事件判定：3h 数据覆盖 1h 但不覆盖 24h，30min 数据不覆盖 1h', olderAgg.windows.h1.total === 0 && olderAgg.windows.h1.covered === true && olderAgg.windows.h24.covered === false && recentOnly.windows.h1.covered === false, `${olderAgg.windows.h1.covered}/${recentOnly.windows.h1.covered}`)
}

// ---------- B. 报告覆盖与文案 ----------
{
  const emptyReport = diag.buildHealthReport({ events: [], now: NOW })
  rec('D8', '空报告：coverage 空、summary 引导、findings=0', emptyReport.coverage.eventCount === 0 && emptyReport.coverage.oldestTs === null && emptyReport.coverage.coveredMs === 0 && emptyReport.findings.length === 0 && emptyReport.summary.includes('先播放几首歌'), emptyReport.summary)

  const short = diag.buildHealthReport({
    events: [event({ traceId: 's1', ts: NOW - 30 * MIN, ok: false, code: 'E' })],
    now: NOW,
    truncated: true,
  })
  rec('D9', '只有 30min 数据 + truncated：d7=false 且 summary 说明覆盖时长', short.windows.d7.covered === false && short.coverage.truncated === true && short.summary.includes('仅覆盖最近') && short.summary.includes('1/20'), short.summary)

  const long = diag.buildHealthReport({
    events: [
      event({ traceId: 'd0', ts: NOW - 7 * DAY, sampleWeight: 20 }),
      event({ traceId: 'd2', ts: NOW - 1 * HOUR, sampleWeight: 20 }),
    ],
    now: NOW,
  })
  rec('D10', '恰好 7 天前的基准事件让 d7.covered=true', long.windows.d7.covered === true && long.windows.d7.total === 20 && long.coverage.oldestTs === NOW - 7 * DAY, `${long.windows.d7.covered}/${long.windows.d7.total}/${long.coverage.oldestTs}`)

  const onlyFailures = diag.buildHealthReport({ events: [event({ traceId: 'f1', ok: false, code: 'E' })], now: NOW })
  rec('D11', '全失败报告 rate=0 且仍给建议/异常', onlyFailures.windows.h1.successRate === 0 && onlyFailures.findings.length > 0 && onlyFailures.recommendations.length > 0, `${onlyFailures.windows.h1.successRate}/${onlyFailures.findings.length}`)

  const invalid = [null, {}, { ts: 'x' }, { ts: NaN }, { ts: NOW, event: 'source_events' }, event({ traceId: 'v1' })]
  let noThrow = true
  let report
  try { report = diag.buildHealthReport({ events: invalid, now: NOW }) } catch { noThrow = false }
  rec('D12', '非法事件不抛且只保留合法 ts', noThrow && report && report.coverage.eventCount === 2, noThrow ? `eventCount=${report.coverage.eventCount}` : 'threw')

  const recs = diag.buildHealthReport({
    events: [event({ traceId: 'r1', ok: false, code: 'NEW_CODE' })],
    now: NOW,
  })
  rec('D13', 'recommendations 去重且 ≤6，traceIds 去重且 ≤6', recs.recommendations.length <= 6 && new Set(recs.recommendations).size === recs.recommendations.length && recs.traceIds.length <= 6 && new Set(recs.traceIds).size === recs.traceIds.length, `${recs.recommendations.length}/${recs.traceIds.length}`)

  const future = diag.buildHealthReport({ events: [event({ traceId: 'x1', ts: NOW + HOUR })], now: NOW })
  rec('D14', '未来时间戳不计入窗口但 coverage 可见', future.windows.h1.total === 0 && future.coverage.newestTs === NOW + HOUR, `${future.windows.h1.total}/${future.coverage.newestTs}`)
}

// ---------- C. breakdown 分组 ----------
{
  const events = [
    event({ traceId: 'g1', sourceId: 'a', platform: 'kw', quality: '128k', ok: true, sampleWeight: 20 }),
    event({ traceId: 'g2', sourceId: 'a', platform: 'kw', quality: '128k', ok: false }),
    event({ traceId: 'g3', sourceId: 'a', platform: 'wy', quality: '320k', ok: false }),
    event({ traceId: 'g4', sourceId: 'b', platform: 'kw', quality: '', ok: true }),
  ]
  const agg = diag.aggregateHealthEvents(events, NOW)
  const rows = Object.fromEntries(agg.breakdown.map(r => [r.sourceKey + '|' + r.platform + '|' + r.quality, r]))
  rec('D15', '按 source|platform|quality 分组且权重正确', agg.breakdown.length === 3 && rows['a|kw|128k'].total === 21 && rows['a|kw|128k'].failed === 1 && rows['a|wy|320k'].total === 1 && rows['b|kw|'].total === 1, JSON.stringify(agg.breakdown))

  const many = []
  for (let i = 0; i < 15; i++) many.push(event({ traceId: `m${i}`, sourceId: `s${i}`, ok: false }))
  const manyAgg = diag.aggregateHealthEvents(many, NOW)
  rec('D16', 'breakdown 最多 10 行，按 total 降序', manyAgg.breakdown.length === 10 && manyAgg.breakdown.every((r, i, a) => i === 0 || a[i - 1].total >= r.total), `${manyAgg.breakdown.length}/${manyAgg.breakdown[0]?.sourceKey}`)

  const tie = [event({ traceId: 't1', sourceId: 'z' }), event({ traceId: 't2', sourceId: 'a' })]
  const tieAgg = diag.aggregateHealthEvents(tie, NOW)
  rec('D17', 'total 相同按 sourceKey 字典序，结果稳定', tieAgg.breakdown[0].sourceKey === 'a', JSON.stringify(tieAgg.breakdown.map(r => r.sourceKey)))
}

// ---------- D. 异常规则正反例 ----------
{
  const threeFails = [
    event({ traceId: 'lz1', sourceId: 'kuwoOfficial', platform: 'kw', ok: false, code: 'NETWORK_ERROR', ts: NOW - HOUR }),
    event({ traceId: 'lz2', sourceId: 'kuwoOfficial', platform: 'kw', ok: false, code: 'NETWORK_ERROR', ts: NOW - 2 * HOUR }),
    event({ traceId: 'lz3', sourceId: 'kuwoOfficial', platform: 'kw', ok: false, code: 'NETWORK_ERROR', ts: NOW - 3 * HOUR }),
  ]
  const localZero = diag.detectHealthAnomalies({ events: threeFails, snapshot: { kuwoOfficial: { successRate: 0.9 } }, now: NOW })
  rec('D18', 'local_zero 正例：3 败 + 快照 90% 必报且 samples≤5', localZero.some(f => f.id === 'local_zero_snapshot_healthy') && localZero.find(f => f.id === 'local_zero_snapshot_healthy').samples.length <= 5, `findings=${localZero.length}`)

  const noSource = threeFails.map(e => ({ ...e, sourceId: undefined }))
  const noSourceFindings = diag.detectHealthAnomalies({ events: noSource, snapshot: { kuwoOfficial: { successRate: 0.9 } }, now: NOW })
  rec('D19', 'local_zero 反例：只有 platform 不得冒充 kuwoOfficial', !noSourceFindings.some(f => f.id === 'local_zero_snapshot_healthy'), `findings=${noSourceFindings.length}`)

  // 前 24h 真实 99.5%，近 24h 真实 66.7%，原始条数口径会给出不同结论
  const rateEvents = []
  for (let i = 0; i < 200; i++) rateEvents.push(event({ traceId: `po-${i}`, ok: true, sampleWeight: 20, ts: NOW - 30 * HOUR }))
  for (let i = 0; i < 20; i++) rateEvents.push(event({ traceId: `pf-${i}`, ok: false, code: 'E', ts: NOW - 30 * HOUR }))
  for (let i = 0; i < 10; i++) rateEvents.push(event({ traceId: `ro-${i}`, ok: true, sampleWeight: 20, ts: NOW - 2 * HOUR }))
  for (let i = 0; i < 100; i++) rateEvents.push(event({ traceId: `rf-${i}`, ok: false, code: 'E', ts: NOW - 2 * HOUR }))
  const rateFindings = diag.detectHealthAnomalies({ events: rateEvents, now: NOW })
  const rateDrop = rateFindings.find(f => f.id === 'rate_drop')
  rec('D20', 'rate_drop 按加权口径：99.5%→66.7% 必报且带“约”', !!rateDrop && rateDrop.title.includes('33pp') && rateDrop.evidence.includes('约'), rateDrop ? rateDrop.title : 'not found')

  const p95Events = []
  for (let i = 0; i < 5; i++) p95Events.push(event({ traceId: `p9o-${i}`, latencyMs: 100, ts: NOW - 30 * HOUR }))
  for (let i = 0; i < 5; i++) p95Events.push(event({ traceId: `p9r-${i}`, latencyMs: 1000, ts: NOW - 2 * HOUR }))
  const p95Finding = diag.detectHealthAnomalies({ events: p95Events, now: NOW }).find(f => f.id === 'p95_spike')
  rec('D21', 'p95_spike 正例：100ms→1000ms 必报', !!p95Finding && p95Finding.title.includes('P95'), p95Finding ? p95Finding.title : 'not found')

  const newCodeEvents = [
    event({ traceId: 'nc0', ok: false, code: 'OLD_CODE', ts: NOW - 3 * DAY }),
    event({ traceId: 'nc1', ok: false, code: 'NEW_CODE', ts: NOW - HOUR }),
  ]
  const newCode = diag.detectHealthAnomalies({ events: newCodeEvents, now: NOW })
  rec('D22', 'new_code 正例：前 7d 未见的新码必报', newCode.some(f => f.id === 'new_code' && f.title.includes('NEW_CODE')), `findings=${newCode.length}`)

  const oldCodeAgain = [
    event({ traceId: 'oc0', ok: false, code: 'OLD_CODE', ts: NOW - 3 * DAY }),
    event({ traceId: 'oc1', ok: false, code: 'OLD_CODE', ts: NOW - HOUR }),
  ]
  rec('D23', 'new_code 反例：旧码再次出现不得报新码', !diag.detectHealthAnomalies({ events: oldCodeAgain, now: NOW }).some(f => f.id === 'new_code'), 'OLD_CODE only')

  const trendDown = [0, 1, 2, 3].map(i => ({ timestamp: NOW - (3 - i) * HOUR, sources: { trendSrc: { successRate: [0.9, 0.8, 0.65, 0.45][i] } } }))
  const trendDownFinding = diag.detectHealthAnomalies({ events: [], trend: trendDown, now: NOW }).find(f => f.id === 'trend_decline')
  const trendBounce = [0, 1, 2, 3].map(i => ({ timestamp: NOW - (3 - i) * HOUR, sources: { trendSrc: { successRate: [0.9, 0.7, 0.8, 0.4][i] } } }))
  rec('D24', 'trend_decline 正例/反例：连续降必报、抖降不报', !!trendDownFinding && !diag.detectHealthAnomalies({ events: [], trend: trendBounce, now: NOW }).some(f => f.id === 'trend_decline'), trendDownFinding?.title || 'not found')

  const manyFindings = []
  for (let i = 0; i < 30; i++) {
    manyFindings.push(event({ traceId: `cap-${i}`, sourceId: `src-${i}`, ok: false, code: `C${i}`, ts: NOW - (i % 20) * HOUR }))
  }
  const capped = diag.detectHealthAnomalies({ events: manyFindings, now: NOW })
  const samplesOk = capped.every(f => (f.samples || []).length <= 5)
  rec('D25', '异常条目上限 12 且每条 samples≤5', capped.length <= 12 && samplesOk, `findings=${capped.length}`)

  const onlyStructured = diag.detectHealthAnomalies({ events: [event({ event: 'source_events', sourceEvents: [{ source: 's', ok: false }] })], now: NOW })
  rec('D26', 'source_events 不得被当成 outcome 参与异常规则', onlyStructured.length === 0, `findings=${onlyStructured.length}`)

  const codes = []
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i <= c; i++) codes.push(event({ traceId: `tc-${c}-${i}`, ok: false, code: `CODE_${c}` }))
  }
  const codeAgg = diag.aggregateHealthEvents(codes, NOW)
  rec('D27', 'topCodes 只统计失败 outcome、按次数降序且上限 8', codeAgg.topCodes.length === 8 && codeAgg.topCodes[0].code === 'CODE_9' && codeAgg.topCodes[0].count === 10 && codeAgg.topCodes.every((x, i, a) => i === 0 || a[i - 1].count >= x.count), JSON.stringify(codeAgg.topCodes))
}

// ---------- E. 证据包与隐私 ----------
{
  const report = diag.buildHealthReport({ events: [event({ traceId: 'pkg1', ok: false, code: 'E' })], now: NOW })
  const sourceEvents = []
  for (let i = 0; i < 60; i++) sourceEvents.push({ source: `sub-${i}`, ok: i % 2 === 0, code: `C${i}`, latencyMs: 100 + i })
  sourceEvents.push(null, 'bad', { source: 'fallback', ok: false, code: 'X' })
  const pkg = diag.buildEvidencePackage({
    report,
    events: [event({ traceId: 'evt1', event: 'source_events', sourceEvents })],
    snapshot: {},
    trend: [],
    logTail: 'HTTPS://secret.example/a.mp3 歌=秘密 singer=张三 搜索词=秘密',
    appVersion: '1.9.2-b100',
    sourceVersion: '8.12.1',
  })
  rec('E1', 'attempts 展开 source_events 且上限 50', pkg.attempts.length === 50 && pkg.attempts[0].sourceId === 'sub-0', `attempts=${pkg.attempts.length}`)
  rec('E2', 'attempts sourceId 支持 source 回退、坏行跳过', pkg.attempts.every(a => a.sourceId != null), `last=${pkg.attempts[pkg.attempts.length - 1]?.sourceId}`)
  rec('E3', '版本字段有值时写入，空值不写', pkg.appVersion === '1.9.2-b100' && pkg.sourceVersion === '8.12.1', `${pkg.appVersion}/${pkg.sourceVersion}`)

  const noVer = diag.buildEvidencePackage({ report, events: [], snapshot: {}, trend: [], logTail: '' })
  rec('E4', '版本字段空值不得写出 undefined 键', !('appVersion' in noVer) && !('sourceVersion' in noVer), Object.keys(noVer).join(','))

  const text = 'HTTPS://secret.example/a.mp3 FTP://x/y file://tmp/a 歌=秘密歌曲 singer=张三 搜索词=秘密'
  const redacted = diag.redactDiagnosticText(text)
  rec('E5', '脱敏覆盖大小写协议与 ftp/file、歌名/歌手/搜索词', !/https?|ftp|file/i.test(redacted) && !redacted.includes('秘密歌曲') && !redacted.includes('张三') && !redacted.includes('秘密'), redacted)
  rec('E6', '脱敏幂等，二次处理后不再变化', diag.redactDiagnosticText(redacted) === redacted, diag.redactDiagnosticText(redacted))

  const leakyEvent = event({
    traceId: 'leak1',
    event: 'source_events',
    sourceEvents: [
      { source: 'kw', ok: false, reason: 'HTTPS://secret.example/a.mp3 歌=秘密歌曲' },
      { source: 'wy', ok: false, reason: 'file:///tmp/a.mp3 搜索词=秘密' },
    ],
    reason: 'https://secret.example/b.mp3 歌=秘密歌曲',
  })
  const leakyPkg = diag.buildEvidencePackage({ report, events: [leakyEvent], snapshot: {}, trend: [], logTail: '' })
  const json = JSON.stringify(leakyPkg.events)
  rec('E7', '证据包 events/sourceEvents 内的 URL/歌名也必须脱敏', !/https?|ftp|file/i.test(json) && !json.includes('秘密歌曲') && !json.includes('秘密'), json.slice(0, 200))
  rec('E8', '脱敏不得修改调用方原始事件对象', leakyEvent.reason.includes('https://'), leakyEvent.reason)

  const original = event({ traceId: 'clone1' })
  const clonePkg = diag.buildEvidencePackage({ report, events: [original], snapshot: {}, trend: [], logTail: '' })
  clonePkg.events[0].ok = false
  rec('E9', '证据包 events 为浅拷贝，改包不回写原事件', original.ok === true, String(original.ok))
}

// ---------- F. healthLog 纯函数 ----------
{
  const multibyte = Array.from({ length: 4000 }, (_, i) => JSON.stringify({ i, pad: '中文'.repeat(20) })).join('\n')
  const trimmed = log.trimJsonlTail(multibyte, 2000)
  rec('F1', '多字节日志截尾按 UTF-8 字节，不超上限且首尾完整', Buffer.byteLength(trimmed, 'utf8') <= 2000 && trimmed.startsWith('{') && trimmed.endsWith('}'), `bytes=${Buffer.byteLength(trimmed, 'utf8')}`)

  const crlf = '{"a":1}\r\n{"b":2}\r\n'
  rec('F2', 'CRLF 归一为 LF 且行完整', log.trimJsonlTail(crlf, 100) === '{"a":1}\n{"b":2}', JSON.stringify(log.trimJsonlTail(crlf, 100)))

  const entry = log.buildPlayResultEntry({ traceId: '', platform: '', quality: '', sourceId: '', code: '', latencyMs: NaN, sampleWeight: -1, ok: true })
  rec('F3', '空串/NaN/负权重字段全部省略', !('traceId' in entry) && !('platform' in entry) && !('quality' in entry) && !('sourceId' in entry) && !('code' in entry) && !('latencyMs' in entry) && !('sampleWeight' in entry), JSON.stringify(entry))

  const rounded = log.buildPlayResultEntry({ traceId: 't', platform: 'kw', ok: false, latencyMs: 123.6, sampleWeight: 1 })
  rec('F4', '延迟四舍五入且失败权重 1 保留', rounded.latencyMs === 124 && rounded.sampleWeight === 1, JSON.stringify(rounded))

  const dirty = '{"event":"play_result","ts":1}\n[]\nnull\n{"event":1}\n{"event":"x","ts":2}\r\n'
  rec('F5', '坏行/数组/无 event 跳过，合法行保留', log.parseHealthLines(dirty).length === 2, String(log.parseHealthLines(dirty).length))

  rec('F6', '非法文件名不判过期，7 天边界正确', log.isExpiredHealthFileName('foo.jsonl', '20261111') === false && log.isExpiredHealthFileName('source_health_20261103.jsonl', '20261111') === true && log.isExpiredHealthFileName('source_health_20261104.jsonl', '20261111') === false, 'foo/20261103/20261104')

  rec('F7', '成功采样边界 0→采、0.049→采、0.05→不采、0.999→不采', log.shouldSampleSuccess(() => 0) && log.shouldSampleSuccess(() => 0.049) && !log.shouldSampleSuccess(() => 0.05) && !log.shouldSampleSuccess(() => 0.999), 'floor(r*20)===0')

  const traceIds = new Set(Array.from({ length: 2000 }, () => log.createHealthTraceId()))
  rec('F8', '2000 个 traceId 唯一且格式稳定', traceIds.size === 2000 && Array.from(traceIds).every(id => /^app_[a-z0-9]+_[a-z0-9]{1,6}$/.test(id)), `unique=${traceIds.size}`)

  const exact = JSON.stringify({ a: 'x'.repeat(10) })
  rec('F9', '恰好等于上限的完整行不被丢弃', log.trimJsonlTail(exact, Buffer.byteLength(exact)) === exact, `len=${Buffer.byteLength(exact)}`)

  const day = new Date('2026-11-11T12:00:00+08:00')
  const exportName = log.buildExportFileName(day)
  rec('F10', '健康文件名/导出文件名带日期、时间且不含账号设备', /^source_health_2026111[01].jsonl$/.test(log.healthFileName(day)) && /^source_health_diag_20261111_[0-9]{6}.json$/.test(exportName), `${log.healthFileName(day)}/${exportName}`)
}

// ---------- G. 性能与规模 ----------
{
  const big = []
  for (let i = 0; i < 100000; i++) {
    big.push(event({
      traceId: `big-${i % 5000}`,
      sourceId: `s-${i % 20}`,
      platform: ['kw', 'wy', 'tx'][i % 3],
      quality: ['128k', '320k', 'flac'][i % 3],
      ok: i % 5 !== 0,
      code: i % 5 === 0 ? `E${i % 100}` : '',
      latencyMs: 50 + (i % 2000),
      ts: NOW - (i % (7 * DAY)),
    }))
  }
  const t0 = Date.now()
  const agg = diag.aggregateHealthEvents(big, NOW)
  const ms = Date.now() - t0
  rec('G1', '100000 条聚合 ≤2000ms 且结果有限', ms <= 2000 && agg.windows.d7.total > 0 && agg.breakdown.length <= 10, `${ms}ms total=${agg.windows.d7.total}`)

  const t1 = Date.now()
  const report = diag.buildHealthReport({ events: big, now: NOW })
  const reportMs = Date.now() - t1
  rec('G2', '100000 条报告生成 ≤3000ms，findings≤12', reportMs <= 3000 && report.findings.length <= 12, `${reportMs}ms findings=${report.findings.length}`)

  const t2 = Date.now()
  const pkg = diag.buildEvidencePackage({ report, events: big.slice(0, 20000), snapshot: {}, trend: [], logTail: 'x'.repeat(64 * 1024) })
  const pkgMs = Date.now() - t2
  let size = 0
  try { size = Buffer.byteLength(JSON.stringify(pkg), 'utf8') } catch { size = -1 }
  rec('G3', '20000 事件证据包 ≤4000ms 且可 JSON 序列化', pkgMs <= 4000 && size > 0, `${pkgMs}ms size=${size}`)
}

const failed = res.filter(x => !x.ok)
console.log(`\n===== 深度审计压力汇总：${res.length - failed.length} 通过 / ${failed.length} 失败 =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - [${f.id}] ${f.name} — ${f.detail}`)
  process.exit(1)
}
process.exit(0)
