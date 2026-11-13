#!/usr/bin/env node
/**
 * 音源健康本地诊断闭环（2.4 方案）契约检查。
 *
 * 用法：
 *   node scripts/check_health_diagnostics.js
 *
 * 说明：
 *   - 直接转译生产 TS 模块执行纯函数，不复制实现、不 mock；
 *   - 覆盖 H4~H9：traceId 透传、本地事件落盘、聚合/异常/报告/证据包、隐私边界；
 *   - 任一条失败退出码 1。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch (e) {
  ts = require('typescript')
}

const loadTs = (rel, stubs = {}) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // 仅在仓库自检脚本里加载转译后的本仓 TS 模块，不执行外部输入
  const localRequire = (id) => id in stubs ? stubs[id] : require(id)
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

const read = rel => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少文件：${rel}`)
  return fs.readFileSync(file, 'utf-8')
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
const MIN = 60 * 1000
const HOUR = 60 * MIN

const result = (traceId, sourceId, ok, code, latencyMs, ts) => ({
  traceId, event: 'source_result', sourceId, platform: 'kw', quality: '128k', ok, code, latencyMs, ts,
})

const events = [
  { traceId: 't-ok', event: 'play_start', platform: 'kw', quality: '128k', ts: NOW - 10 * MIN },
  { traceId: 't-ok', event: 'source_attempt', sourceId: 'suyinKuwo', platform: 'kw', quality: '128k', ts: NOW - 9 * MIN },
  result('t-ok', 'suyinKuwo', true, '', 300, NOW - 8 * MIN),
  result('t-fail', 'suyinKuwo', false, 'SERVER_ERROR', 900, NOW - 20 * MIN),
  result('t-new', 'suyinKuwo', false, 'NEW_CODE', 2000, NOW - 30 * MIN),
  // 本地 0% 但快照健康
  result('t-dead1', 'deadLocal', false, 'NETWORK_ERROR', 100, NOW - 2 * HOUR),
  result('t-dead2', 'deadLocal', false, 'NETWORK_ERROR', 120, NOW - 3 * HOUR),
  result('t-dead3', 'deadLocal', false, 'NETWORK_ERROR', 140, NOW - 4 * HOUR),
  // 成功率跌 20pp：前 24h 全成，近 24h 全败
  result('t-drop-old1', 'dropSrc', true, '', 100, NOW - 30 * HOUR),
  result('t-drop-old2', 'dropSrc', true, '', 100, NOW - 31 * HOUR),
  result('t-drop-old3', 'dropSrc', true, '', 100, NOW - 32 * HOUR),
  result('t-drop-old4', 'dropSrc', true, '', 100, NOW - 33 * HOUR),
  result('t-drop-old5', 'dropSrc', true, '', 100, NOW - 34 * HOUR),
  result('t-drop-new1', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 2 * HOUR),
  result('t-drop-new2', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 3 * HOUR),
  result('t-drop-new3', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 4 * HOUR),
  result('t-drop-new4', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 5 * HOUR),
  result('t-drop-new5', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 6 * HOUR),
  // P95 翻倍：旧 100ms，新 2000ms
  result('t-spike-old1', 'spikeSrc', true, '', 100, NOW - 30 * HOUR),
  result('t-spike-old2', 'spikeSrc', true, '', 100, NOW - 31 * HOUR),
  result('t-spike-old3', 'spikeSrc', true, '', 100, NOW - 32 * HOUR),
  result('t-spike-old4', 'spikeSrc', true, '', 100, NOW - 33 * HOUR),
  result('t-spike-old5', 'spikeSrc', true, '', 100, NOW - 34 * HOUR),
  result('t-spike-new1', 'spikeSrc', true, '', 2000, NOW - 2 * HOUR),
  result('t-spike-new2', 'spikeSrc', true, '', 2000, NOW - 3 * HOUR),
  result('t-spike-new3', 'spikeSrc', true, '', 2000, NOW - 4 * HOUR),
  result('t-spike-new4', 'spikeSrc', true, '', 2000, NOW - 5 * HOUR),
  result('t-spike-new5', 'spikeSrc', true, '', 2000, NOW - 6 * HOUR),
]
const snapshot = {
  suyinKuwo: { name: '溯音酷我', successRate: 0.8, healthScore: 5.0 },
  deadLocal: { name: '本地零成功源', successRate: 0.8, healthScore: 4.0 },
  dropSrc: { name: '跌 20pp 源', successRate: 0.4, healthScore: 1.0 },
  spikeSrc: { name: 'P95 翻倍源', successRate: 0.8, healthScore: 4.0 },
}

let diag = null
let healthLog = null
try { diag = loadTs('src/core/healthDiagnostics.ts') } catch (e) { console.log(`✗ 加载 healthDiagnostics.ts — ${e.message}`) }
try { healthLog = loadTs('src/core/healthLog.ts') } catch (e) { console.log(`✗ 加载 healthLog.ts — ${e.message}`) }
if (diag) passed++
else failures.push('加载 healthDiagnostics.ts')
if (healthLog) passed++
else failures.push('加载 healthLog.ts')

if (diag) {
  check('H7 聚合 1h/24h/7d 成功率与 P95', () => {
    const agg = diag.aggregateHealthEvents(events, NOW)
    assert(agg && agg.windows, '缺少 windows')
    assert(agg.windows.h1.total === 3, `1h total 应为 3，实际 ${agg.windows.h1 && agg.windows.h1.total}`)
    assert(Math.abs(agg.windows.h1.successRate - 1 / 3) < 0.02, `1h 成功率应约 33%，实际 ${agg.windows.h1.successRate}`)
    assert(agg.windows.h1.p95 === 2000, `1h P95 应为 2000，实际 ${agg.windows.h1.p95}`)
    assert(agg.windows.d7.total === events.filter(e => e.event === 'source_result' || e.event === 'play_result').length, '7d 样本数不符')
  })

  check('H7b 取链/播放/探测三块分开，不混成功率（F53/F10）', () => {
    const mixed = [
      { traceId: 'c1', event: 'source_result', sourceId: 's', ok: true, latencyMs: 100, ts: NOW - MIN },
      { traceId: 'c2', event: 'source_result', sourceId: 's', ok: false, code: 'CHAIN_FAIL', latencyMs: 200, ts: NOW - 2 * MIN },
      { traceId: 'p1', event: 'play_result', sourceId: 's', ok: true, latencyMs: 300, ts: NOW - 3 * MIN },
      { traceId: 'p2', event: 'play_result', sourceId: 's', ok: true, latencyMs: 400, ts: NOW - 4 * MIN },
      { traceId: 'p3', event: 'play_result', sourceId: 's', ok: true, latencyMs: 500, ts: NOW - 5 * MIN },
      { traceId: 'r1', event: 'probe_result', sourceId: 's', ok: false, code: 'PROBE_FAIL', latencyMs: 600, ts: NOW - 6 * MIN },
      { traceId: 'r2', event: 'probe_result', sourceId: 's', ok: false, code: 'PROBE_FAIL', latencyMs: 700, ts: NOW - 7 * MIN },
    ]
    const agg = diag.aggregateHealthEvents(mixed, NOW)
    assert(agg.windows.h24.total === 2 && agg.windows.h24.ok === 1, `取链块被播放/探测污染：${JSON.stringify(agg.windows.h24)}`)
    assert(agg.kinds.play.windows.h24.total === 3 && agg.kinds.play.windows.h24.successRate === 1, '播放块混入其他结果')
    assert(agg.kinds.probe.windows.h24.total === 2 && agg.kinds.probe.windows.h24.successRate === 0, '探测块混入其他结果')
    const rep = diag.buildHealthReport({ events: mixed, now: NOW })
    assert(rep.windows.h24.total === 2 && rep.playWindows.h24.total === 3 && rep.probeWindows.h24.total === 2, '报告三块窗口未分开')
  })

  check('H7 Top 错误码', () => {
    const agg = diag.aggregateHealthEvents(events, NOW)
    assert(Array.isArray(agg.topCodes) && agg.topCodes.length >= 2, '缺少 topCodes')
    const codes = agg.topCodes.map(x => x.code)
    assert(codes.includes('SERVER_ERROR'), 'Top 码缺 SERVER_ERROR')
    assert(codes.includes('NEW_CODE'), 'Top 码缺 NEW_CODE')
  })

  check('H7 异常规则：本地 0% 快照健康', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW })
    assert(findings.some(f => f.id === 'local_zero_snapshot_healthy'), '未识别本地 0% 但快照健康')
    assert(findings.some(f => (f.traceIds || []).includes('t-dead1')), '本地 0% 异常缺 traceId 证据')
  })

  check('H7 异常规则：成功率跌 20pp', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW })
    assert(findings.some(f => f.id === 'rate_drop'), '未识别成功率跌 20pp')
  })

  check('H7 异常规则：P95 翻倍', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW })
    assert(findings.some(f => f.id === 'p95_spike'), '未识别 P95 翻倍')
  })

  check('H7 异常规则：新错误码', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW })
    assert(findings.some(f => f.id === 'new_code' && f.evidence.includes('NEW_CODE')), '未识别新错误码')
  })

  check('H8 报告含结论/证据/建议/traceId', () => {
    const report = diag.buildHealthReport({ events, snapshot, now: NOW })
    assert(typeof report.summary === 'string' && report.summary.length > 0, '报告缺 summary')
    assert(Array.isArray(report.findings) && report.findings.length >= 4, '报告 findings 不足')
    const f = report.findings.find(x => x.id === 'rate_drop')
    assert(f && f.evidence && f.suggestion, '异常缺 evidence/suggestion')
    assert(Array.isArray(report.traceIds) && report.traceIds.length > 0, '报告缺 traceIds')
    assert(report.traceIds.includes('t-drop-new1'), '报告 traceIds 未包含失败链')
  })

  check('H8 证据包 v2 载荷键 + manifest', () => {
    const report = diag.buildHealthReport({ events, snapshot, now: NOW })
    const pkg = diag.buildEvidencePackage({ report, events, snapshot, trend: [], logTail: 'tail' })
    assert(pkg.schema === 2, `schema 应为 2，实际 ${pkg.schema}`)
    for (const k of ['report', 'events', 'snapshot', 'trend', 'logTail', 'manifest']) assert(k in pkg, `证据包缺 ${k}`)
    assert(pkg.manifest.format === 'lx-health-evidence' && pkg.manifest.version === 2, 'manifest 格式/版本不符')
    assert(pkg.manifest.redacted === true && pkg.manifest.localOnly === true, 'manifest 缺脱敏/本地标记')
    assert(pkg.events.length === events.length, '证据包事件数不符')
    assert(pkg.manifest.counts.events === events.length, 'manifest 事件数不符')
  })

  check('H8b 证据包事件/日志/趋势/总量上限（F08/F58）', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ ts: NOW - i, traceId: `t-${i}`, event: 'source_result', sourceId: 's', ok: false, code: 'X' }))
    const report = diag.buildHealthReport({ events: many, snapshot, now: NOW })
    const pkg = diag.buildEvidencePackage({
      report,
      events: many,
      snapshot: { s: { reason: 'u=https://secret.test/a?b=1 歌=SECRET' } },
      trend: Array.from({ length: 300 }, (_, i) => ({ ts: i })),
      logTail: ('u=https://secret.test/x 歌=SECRET ' + 'x'.repeat(200)).repeat(1000),
    })
    assert(pkg.events.length === 1000, `事件未截断：${pkg.events.length}`)
    assert(pkg.manifest.truncated.events === true, '未标记事件截断')
    assert(pkg.trend.length <= 200, `趋势未截断：${pkg.trend.length}`)
    assert(pkg.manifest.truncated.trend === true, '未标记趋势截断')
    assert(Buffer.byteLength(pkg.logTail, 'utf8') <= 64 * 1024, '日志尾部未截断')
    assert(pkg.manifest.truncated.logTail === true, '未标记日志截断')
    assert(pkg.manifest.estimatedBytes <= 2 * 1024 * 1024, `证据包超 2MB：${pkg.manifest.estimatedBytes}`)
    assert(!JSON.stringify(pkg.snapshot).includes('secret.test'), '快照 URL 未脱敏')
    assert(!JSON.stringify(pkg.snapshot).includes('SECRET'), '快照歌名未脱敏')
  })

  check('H3 脱敏：URL 与歌名不落证据', () => {
    const out = diag.redactDiagnosticText('u=https://secret.test/a?b=1 歌=SECRET_SONG 源=kw')
    assert(!out.includes('secret.test'), `URL 未脱敏：${out}`)
    assert(!out.includes('SECRET_SONG'), `歌名未脱敏：${out}`)
    assert(out.includes('源=kw'), '非敏感字段被误删')
  })
}

if (healthLog) {
  check('H6 按天文件名', () => {
    const d = new Date(2026, 10, 11, 12, 0, 0)
    assert(healthLog.healthFileName(d) === 'source_health_20261111.jsonl', `实际 ${healthLog.healthFileName(d)}`)
  })

  check('H5 成功 1/5 采样', () => {
    assert(healthLog.shouldSampleSuccess(() => 0.01) === true, '0.01 应采样')
    assert(healthLog.shouldSampleSuccess(() => 0.19) === true, '0.19 应采样')
    assert(healthLog.shouldSampleSuccess(() => 0.2) === false, '0.2 不应采样')
    assert(healthLog.shouldSampleSuccess(() => 0.999) === false, '0.999 不应采样')
  })

  check('H6 2MB 封顶保留尾部并落在行边界', () => {
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(20) }))
    const text = lines.join('\n') + '\n'
    const out = healthLog.trimJsonlTail(text, 100)
    assert(out.length <= 100, `超长：${out.length}`)
    const first = out.split('\n')[0]
    assert(first.startsWith('{') && first.endsWith('}'), '输出未从完整 JSON 行开始')
    assert(out.trim().split('\n').every(l => { try { JSON.parse(l); return true } catch { return false } }), '输出含残行')
  })

  check('H6 按 UTF-8 字节保留尾部且不切断多字节字符', () => {
    assert(healthLog.trimTailByBytes('ab音乐', 4) === '乐', `实际 ${JSON.stringify(healthLog.trimTailByBytes('ab音乐', 4))}`)
    assert(healthLog.trimTailByBytes('x😀', 4) === '😀', '4 字节应完整保留代理对')
    assert(healthLog.trimTailByBytes('x😀', 3) === '', '剩余字节不足时不得切半个 emoji')
    assert(healthLog.trimTailByBytes('abc', 0) === '', 'maxBytes<=0 返回空串')
  })

  check('H5 缓存命中单独成事件且不含成功率字段', () => {
    const entry = healthLog.buildCacheHitEntry({ platform: 'kw', quality: '128k', sourceId: '溯音酷我' })
    assert(entry.event === 'cache_hit', 'event 应为 cache_hit')
    assert(entry.platform === 'kw' && entry.quality === '128k' && entry.sourceId === '溯音酷我', '字段未保留')
    assert(!('ok' in entry) && !('sampleWeight' in entry), 'cache_hit 不得混入成功率字段')
  })

  check('H6 JSONL 坏行跳过且不丢整份日志', () => {
    const good = JSON.stringify({ ts: 1, event: 'play_result', ok: true })
    const out = healthLog.parseHealthLines(`${good}\n{bad json}\n\n${JSON.stringify({ ts: 2 })}\n${JSON.stringify({ ts: 3, event: 'cache_hit' })}`)
    assert(out.length === 2, `实际 ${out.length}`)
    assert(out[0].event === 'play_result', '首条 event 不符')
    assert(out[1].event === 'cache_hit', '次条 event 不符')
  })

  check('H4 traceId 只含时间与随机、可直接串联', () => {
    const a = healthLog.createHealthTraceId()
    const b = healthLog.createHealthTraceId()
    assert(/^app_[0-9a-z]+_[0-9a-z]{1,6}$/.test(a), `格式不符：${a}`)
    assert(a !== b, '两次 traceId 不应相同')
    assert(!a.includes('@') && !a.includes(':'), 'traceId 不得含账号/设备标识')
  })

  check('H6 7 天清理判定', () => {
    assert(healthLog.isExpiredHealthFileName('source_health_20261101.jsonl', '20261111', 7) === true, '10 天前应清理')
    assert(healthLog.isExpiredHealthFileName('source_health_20261105.jsonl', '20261111', 7) === false, '6 天前不应清理')
  })

  check('H5 播放结果条目无歌名/URL', () => {
    const entry = healthLog.buildPlayResultEntry({
      traceId: 't-x', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 12,
    })
    assert(entry.event === 'play_result', 'event 应为 play_result')
    assert(entry.traceId === 't-x' && entry.ok === false && entry.code === 'SERVER_ERROR', '字段不符')
    assert(!('name' in entry) && !('url' in entry), '条目不得含歌名/URL')
  })

  check('H8 诊断包文件名', () => {
    const d = new Date(2026, 10, 11, 12, 0, 0)
    assert(/^source_health_diag_20261111_120000\.json$/.test(healthLog.buildExportFileName(d)), `实际 ${healthLog.buildExportFileName(d)}`)
  })
}

check('H4 traceId 透传：online → utils → userApi → 5 平台', () => {
  const files = [
    'src/core/music/online.ts',
    'src/core/music/utils.ts',
    'src/core/init/userApi/index.ts',
    'src/utils/musicSdk/kw/index.js',
    'src/utils/musicSdk/kg/index.js',
    'src/utils/musicSdk/tx/index.js',
    'src/utils/musicSdk/wy/index.js',
    'src/utils/musicSdk/mg/index.js',
  ]
  for (const f of files) assert(read(f).includes('traceId'), `${f} 未透传 traceId`)
})

check('H4/H8 user_api action 联合类型含 healthEvents', () => {
  assert(read('src/types/user_api.d.ts').includes('healthEvents'), 'user_api.d.ts 未声明 healthEvents')
})

check('H9 新模块无任何上传通道', () => {
  for (const f of ['src/core/healthDiagnostics.ts', 'src/core/healthLog.ts']) {
    const src = read(f)
    for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'axios', 'http://', 'https://']) {
      assert(!src.includes(bad), `${f} 含上传通道 ${bad}`)
    }
  }
})

check('H8 健康页接入最近异常 + 导出诊断包', () => {
  const src = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  assert(src.includes('health_recent_anomaly'), '健康页缺最近异常文案键')
  assert(src.includes('health_export_diag') || src.includes('exportDiagnostics'), '健康页缺导出诊断包入口')
})

check('H10 App 预加载脚本放行并透传 healthEvents', () => {
  const preload = read('android/app/src/main/assets/script/user-api-preload.js')
  // P0：preload 不再维护按 source 的白名单，actions 直接来自源脚本声明
  assert(!preload.includes('const supportActions'), 'preload 仍存在 supportActions 白名单')
  assert(preload.includes('actions: userSource.actions'), 'preload 未直接透传 userSource.actions')
  assert(preload.includes("case 'healthEvents':"), '分发 switch 缺少 healthEvents case')
  assert(preload.includes('response.events'), 'healthEvents 未校验 events 数组')
  assert(read('src/core/init/userApi/sourceContract.ts').includes("'healthEvents'"), 'sourceContract 缺少 healthEvents')
  assert(read('src/core/init/userApi/index.ts').includes("case 'healthEvents'"), 'userApi 缺少 healthEvents case')
})

check('H11 成功采样加权：真实 95% 不得报成 79%', () => {
  const weighted = []
  for (let i = 0; i < 95; i++) {
    weighted.push({ traceId: `w-ok-${i}`, event: 'source_result', sourceId: 'wSrc', platform: 'kw', quality: '128k', ok: true, latencyMs: 300, ts: NOW - 5 * MIN, sampleWeight: 5 })
  }
  for (let i = 0; i < 25; i++) {
    weighted.push({ traceId: `w-fail-${i}`, event: 'source_result', sourceId: 'wSrc', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 300, ts: NOW - 5 * MIN })
  }
  const agg = diag.aggregateHealthEvents(weighted, NOW)
  assert(agg.windows.h1.total === 500, `加权 total 应为 500，实际 ${agg.windows.h1.total}`)
  assert(Math.abs(agg.windows.h1.successRate - 0.95) < 0.01, `加权成功率应约 95%，实际 ${agg.windows.h1.successRate}`)
})

check('H12 失败归因 sourceId：同源 3 败 + 快照 90% 必报 local_zero', () => {
  const attrEvents = [
    { traceId: 'a1', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 1 * HOUR },
    { traceId: 'a2', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 2 * HOUR },
    { traceId: 'a3', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 3 * HOUR },
  ]
  const findings = diag.detectHealthAnomalies({ events: attrEvents, snapshot: { kuwoOfficial: { successRate: 0.9, healthScore: 4 } }, now: NOW })
  assert(findings.some(f => f.id === 'local_zero_snapshot_healthy'), '带 sourceId 的同源 3 败未触发 local_zero')
})

check('H13 归因不足不误判：无 sourceId 的旧事件不得冒充快照源', () => {
  const oldEvents = [
    { traceId: 'o1', event: 'play_result', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 1 * HOUR },
    { traceId: 'o2', event: 'play_result', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 2 * HOUR },
    { traceId: 'o3', event: 'play_result', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 100, ts: NOW - 3 * HOUR },
  ]
  const findings = diag.detectHealthAnomalies({ events: oldEvents, snapshot: { kuwoOfficial: { successRate: 0.9, healthScore: 4 } }, now: NOW })
  assert(!findings.some(f => f.id === 'local_zero_snapshot_healthy'), '无 sourceId 的旧事件被误判成 kuwoOfficial 0%')
})

check('H14 窗口覆盖：只覆盖 2h 时 d7.covered 必须为 false', () => {
  const shortEvents = [
    { traceId: 'c1', event: 'source_result', sourceId: 'cSrc', platform: 'kw', quality: '128k', ok: true, latencyMs: 100, ts: NOW - 1 * HOUR },
    { traceId: 'c2', event: 'source_result', sourceId: 'cSrc', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 100, ts: NOW - 2 * HOUR },
  ]
  const report = diag.buildHealthReport({ events: shortEvents, now: NOW })
  assert(report.coverage && report.coverage.eventCount === 2, `报告缺 coverage/事件数，实际 ${JSON.stringify(report.coverage)}`)
  assert(report.windows.h1.covered === true, 'h1 应标记 covered=true')
  assert(report.windows.d7.covered === false, 'd7 仅覆盖 2h 却标记 covered=true')
})

check('H15 失败落盘必须带 sourceId 提取', () => {
  const src = read('src/core/music/online.ts')
  const catchBlock = src.slice(src.indexOf('const codeMatch'), src.indexOf('log.diagnose(`[播放诊断] 链接获取失败'))
  assert(/sourceId\s*:/.test(catchBlock), '失败 recordPlayResult 未写入 sourceId，归因只能退回 platform')
})

check('H16 按源拆分 + 证据包 attempts 展开', () => {
  const srcEvents = [
    { traceId: 'b1', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: true, latencyMs: 100, ts: NOW - 10 * MIN, sampleWeight: 20 },
    { traceId: 'b2', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: true, latencyMs: 100, ts: NOW - 10 * MIN, sampleWeight: 20 },
    { traceId: 'b3', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 100, ts: NOW - 10 * MIN },
    { traceId: 'b3', event: 'source_events', sourceEvents: [{ source: 'kuwoOfficial', ok: false, code: 'SERVER_ERROR', latencyMs: 100 }], ts: NOW - 10 * MIN },
  ]
  const report = diag.buildHealthReport({ events: srcEvents, now: NOW })
  const row = report.breakdown.find(r => r.sourceKey === 'kuwoOfficial')
  assert(row && row.total === 41 && row.failed === 1, `按源拆分错误：${JSON.stringify(row)}`)
  const pkg = diag.buildEvidencePackage({ report, events: srcEvents, snapshot: {}, logTail: '', appVersion: '1.9.2-b100' })
  assert(pkg.attempts.length === 1 && pkg.attempts[0].sourceId === 'kuwoOfficial' && pkg.attempts[0].code === 'SERVER_ERROR', '证据包 attempts 未展开 source_events')
  assert(pkg.appVersion === '1.9.2-b100', '证据包缺 appVersion')
})


check('H17 趋势判断同样加权：真实 100%→95% 不得因采样比例误报下跌', () => {
  const trendEvents = []
  for (let i = 0; i < 100; i++) {
    trendEvents.push({ traceId: `p-ok-${i}`, event: 'source_result', sourceId: 'sSrc', platform: 'kw', quality: '128k', ok: true, latencyMs: 200, ts: NOW - 30 * HOUR })
  }
  for (let i = 0; i < 95; i++) {
    trendEvents.push({ traceId: `r-ok-${i}`, event: 'source_result', sourceId: 'sSrc', platform: 'kw', quality: '128k', ok: true, latencyMs: 200, ts: NOW - 2 * HOUR, sampleWeight: 5 })
  }
  for (let i = 0; i < 25; i++) {
    trendEvents.push({ traceId: `r-fail-${i}`, event: 'source_result', sourceId: 'sSrc', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 200, ts: NOW - 2 * HOUR })
  }
  const findings = diag.detectHealthAnomalies({ events: trendEvents, now: NOW })
  assert(!findings.some(f => f.id === 'rate_drop' && f.title.includes('sSrc')), '加权后同为约 95%，却按原始条数误报成功率下跌')
})


check('H18 证据包带内置音源版本，便于复现“哪个源版本出的问题”', () => {
  const report = diag.buildHealthReport({ events: [], now: NOW })
  const pkg = diag.buildEvidencePackage({ report, events: [], snapshot: {}, logTail: '', appVersion: '1.9.2-b100', sourceVersion: '8.12.1' })
  assert(pkg.sourceVersion === '8.12.1', `证据包缺 sourceVersion，实际 ${JSON.stringify(pkg.sourceVersion)}`)
})


check('H19 异常条目带可展开样本（时间/源/错误码/耗时/traceId）', () => {
  const samples = [
    { traceId: 'x1', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 880, ts: NOW - 1 * HOUR },
    { traceId: 'x2', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 900, ts: NOW - 2 * HOUR },
    { traceId: 'x3', event: 'source_result', sourceId: 'kuwoOfficial', platform: 'kw', quality: '128k', ok: false, code: 'NETWORK_ERROR', latencyMs: 910, ts: NOW - 3 * HOUR },
  ]
  const findings = diag.detectHealthAnomalies({ events: samples, snapshot: { kuwoOfficial: { successRate: 0.9 } }, now: NOW })
  const f = findings.find(x => x.id === 'local_zero_snapshot_healthy')
  assert(f && Array.isArray(f.samples) && f.samples.length === 3, '异常条目缺少可展开样本')
  const s0 = f.samples[0]
  assert(s0.traceId === 'x1' && s0.source === 'kuwoOfficial' && s0.code === 'NETWORK_ERROR' && s0.latencyMs === 880 && s0.ts === NOW - 1 * HOUR, `样本字段不全：${JSON.stringify(s0)}`)
})


check('H20 快照趋势连续下降生成独立 finding', () => {
  const trend = [0, 1, 2, 3].map(i => ({
    timestamp: NOW - (3 - i) * HOUR,
    sources: { kuwoOfficial: { score: 8 - i, successRate: [0.9, 0.8, 0.65, 0.45][i] } },
  }))
  const findings = diag.detectHealthAnomalies({ events: [], trend, now: NOW })
  const f = findings.find(x => x.id === 'trend_decline')
  assert(f, '趋势连续下降未生成 finding')
  assert(f.title.includes('45pp'), `下降幅度文案不对：${f.title}`)
  assert(f.evidence.includes('90%') && f.evidence.includes('45%'), `趋势证据不全：${f.evidence}`)
})

check('H21 快照趋势上升/抖动不得误报下降', () => {
  const up = [0, 1, 2, 3].map(i => ({
    timestamp: NOW - (3 - i) * HOUR,
    sources: { kuwoOfficial: { score: 5 + i, successRate: [0.45, 0.6, 0.8, 0.9][i] } },
  }))
  const bounce = [0, 1, 2, 3].map(i => ({
    timestamp: NOW - (3 - i) * HOUR,
    sources: { kuwoOfficial: { score: 8, successRate: [0.9, 0.75, 0.8, 0.4][i] } },
  }))
  assert(!diag.detectHealthAnomalies({ events: [], trend: up, now: NOW }).some(x => x.id === 'trend_decline'), '上升趋势被误报为下降')
  assert(!diag.detectHealthAnomalies({ events: [], trend: bounce, now: NOW }).some(x => x.id === 'trend_decline'), '非连续下降被误报')
})

check('H24 无前 24h 基线不得误报新错误码', () => {
  const ev = []
  for (let i = 0; i < 7; i++) {
    ev.push(result(`n${i}`, undefined, false, 'NETWORK_TIMEOUT', 1200, NOW - (2 * 60 + i) * MIN))
  }
  for (let i = 0; i < 2; i++) {
    ev.push(result(`ok${i}`, undefined, true, '', 300, NOW - (3 * 60 + i) * MIN))
  }
  const findings = diag.detectHealthAnomalies({ events: ev, snapshot: {}, now: NOW })
  assert(!findings.some(f => f.id === 'new_code'), `覆盖仅 8 小时仍报新错误码：${findings.map(f => f.title).join(' / ')}`)
  const recent = findings.filter(f => f.id === 'recent_failure')
  assert(recent.length === 1 && recent[0].title.includes('NETWORK_TIMEOUT'), `近期失败聚合条目缺失或重复：${recent.map(f => f.title).join(' / ')}`)
})

check('H25 有基线时同码只出一条，且证据写实际基线跨度', () => {
  const ev = []
  for (let i = 0; i < 3; i++) {
    ev.push(result(`old${i}`, undefined, false, 'OLD_CODE', 900, NOW - 2 * 24 * HOUR - i * MIN))
  }
  for (let i = 0; i < 7; i++) {
    ev.push(result(`new${i}`, undefined, false, 'NETWORK_TIMEOUT', 1200, NOW - (2 * 60 + i) * MIN))
  }
  const findings = diag.detectHealthAnomalies({ events: ev, snapshot: {}, now: NOW })
  const newCode = findings.find(f => f.id === 'new_code' && f.title.includes('NETWORK_TIMEOUT'))
  assert(newCode, '有基线的新错误码未生成 finding')
  assert(newCode.evidence.includes('此前 1 天未见'), `基线跨度文案不对：${newCode.evidence}`)
  const dup = findings.filter(f => f.id === 'recent_failure' && f.title.includes('NETWORK_TIMEOUT'))
  assert(dup.length === 0, `同一个码又用 recent_failure 重复出现：${dup.map(f => f.title).join(' / ')}`)
})

check('H26 汇总必须标明未加权历史成功样本', () => {
  const ev = []
  for (let i = 0; i < 7; i++) {
    ev.push(result(`f${i}`, undefined, false, 'NETWORK_TIMEOUT', 1200, NOW - (2 * 60 + i) * MIN))
  }
  for (let i = 0; i < 2; i++) {
    ev.push(result(`s${i}`, undefined, true, '', 300, NOW - (3 * 60 + i) * MIN))
  }
  const report = diag.buildHealthReport({ events: ev, now: NOW })
  assert(report.summary.includes('2 条成功为升级前未加权样本'), `汇总未标明未加权历史样本：${report.summary}`)
  assert(report.coverage.unweightedSuccesses === 2, `coverage 未记录未加权成功数：${report.coverage.unweightedSuccesses}`)
})

check('H27 本地诊断窗口按可信度/总体/错误码/其他线索分层', () => {
  const src = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  const view = read('src/core/healthDiagnosticsView.ts')
  for (const key of ['health_diag_coverage_short', 'health_diag_h24', 'health_diag_codes', 'health_diag_other', 'diagnosticsExpanded', 'buildHealthDiagnosticsView']) {
    assert(src.includes(key), `窗口缺少分层元素：${key}`)
  }
  for (const key of ['coverage.unweightedSuccesses', 'spanText(']) {
    assert(view.includes(key), `视图模型缺少口径字段：${key}`)
  }
})

check('H22 趋势预警单一来源：页面不得维护第二套阈值', () => {
  const src = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  assert(!src.includes('decliningSources'), '健康页仍在维护 decliningSources 独立判定')
  assert(src.includes("f.id === 'trend_decline'"), '健康页未复用报告 trend_decline finding')
  assert(src.includes('trendDeclineFindings.map(f => f.title)'), '多源趋势下降未聚合展示')
})

check('H23 日志死 API 清零且运行日志页仍可读 debug', () => {
  const logger = read('src/utils/logger.ts')
  assert(!/^\s{2}(getLog|clearLog|getLogPath):/m.test(logger), 'logger 仍暴露零调用 API')
  const page = read('src/screens/Home/Views/Setting/settings/Log.tsx')
  assert(page.includes('getLogs') && page.includes('LOG_CATEGORY_LABELS'), '运行日志页读取链路被误删')
})

check('H28 日志公共优先、私有回迁、目录逐级重建且四类日志文件自动补齐', () => {
  const log = read('src/utils/log.ts')
  const health = read('src/core/healthLog.ts')
  const page = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  assert(log.includes('migratePrivateLogsToPublic'), '日志模块缺少私有日志回迁函数')
  assert(log.includes('await migratePrivateLogsToPublic()'), '权限恢复分支未调用私有日志回迁')
  assert(log.includes('PRIVATE_LOGS_DIR') && log.includes('LOGS_DIR'), '日志模块未同时维护公共/私有目录')
  assert(log.includes('appendFile'), '同文件迁移未做追加合并')
  assert(log.includes('export const ensureAllLogFiles'), '日志模块缺少四类日志文件补齐入口')
  assert(log.includes('await ensureAllLogFiles(dir)'), '写任一分类日志时未补齐其余日志文件')
  assert(log.includes('Object.values(LOG_FILES)'), '补齐逻辑未覆盖全部固定日志文件')
  assert(health.includes('ensureAllLogFiles(dir)'), '健康事件写入时未补齐四类日志文件')
  assert(health.includes('export const ensureHealthLogsDir'), '健康日志缺少目录确保入口')
  assert(health.includes('const parent'), '健康日志未逐级创建父目录')
  assert(page.includes('ensureHealthLogsDir()'), '诊断页打开时未确保日志目录')
})

check('H29 缓存命中单独计数，不进入取链成功率', () => {
  const events = [
    { event: 'cache_hit', sourceId: 'kw', platform: 'kw', quality: '128k', ts: NOW - 2 * HOUR },
    { event: 'cache_hit', sourceId: 'kw', platform: 'kw', quality: '128k', ts: NOW - 1 * HOUR },
    { traceId: 'p1', event: 'play_result', sourceId: 'kw', platform: 'kw', quality: '128k', ok: true, latencyMs: 100, ts: NOW - 30 * MIN, sampleWeight: 5 },
  ]
  const report = diag.buildHealthReport({ events, now: NOW })
  assert(report.cacheHits.h24 === 2, `24h 缓存命中应为 2，实际 ${report.cacheHits.h24}`)
  assert(report.windows.h24.total === 0, `缓存/播放污染取链窗口：${JSON.stringify(report.windows.h24)}`)
  assert(report.playWindows.h24.total === 5 && report.playWindows.h24.ok === 5, `播放窗口被缓存污染：${JSON.stringify(report.playWindows.h24)}`)
  assert(report.playWindows.h24.successRate === 1, `播放成功率被缓存污染：${report.playWindows.h24.successRate}`)
  assert(read('src/core/healthLog.ts').includes('recordCacheHit'), 'healthLog 缺少缓存命中写入入口')
  assert(read('src/core/healthLog.ts').includes("event: 'cache_hit'"), '缓存命中事件名不是 cache_hit')
  assert(read('src/core/music/online.ts').includes('recordCacheHit({'), '缓存命中分支未接线')
})

const checkAsync = async(name, fn) => {
  try {
    await fn()
    passed++
    console.log(`✓ ${name}`)
  } catch (e) {
    failures.push(`${name} — ${e && e.message}`)
    console.log(`✗ ${name} — ${e && e.message}`)
  }
}

const memoryFs = () => {
  const files = new Map()
  return {
    files,
    exists: async(p) => files.has(p) || Array.from(files.keys()).some(k => k.startsWith(p + '/')),
    mkdir: async() => {},
    readDir: async(dir) => Array.from(files.keys())
      .filter(k => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map(k => ({ name: k.slice(dir.length + 1) })),
    unlink: async(p) => { files.delete(p) },
    stat: async(p) => ({ size: (files.get(p) || '').length }),
    readFile: async(p) => files.get(p) || '',
    writeFile: async(p, content) => { files.set(p, content) },
    appendFile: async(p, content) => { files.set(p, (files.get(p) || '') + content) },
  }
}

;(async() => {
  const mem = memoryFs()
  const shared = []
  const now = new Date(2026, 10, 11, 12, 0, 0)
  const todayFile = '/logs/source_health_20261111.jsonl'
  mem.files.set(todayFile, [
    JSON.stringify({ ts: now.getTime() - 3 * HOUR, event: 'play_result', ok: false, code: 'OLD' }),
    JSON.stringify({ ts: now.getTime() - 2 * HOUR, event: 'play_result', ok: true }),
    JSON.stringify({ ts: now.getTime() - 1 * HOUR, event: 'cache_hit' }),
  ].join('\n') + '\n')
  mem.files.set('/logs/source_health_20261001.jsonl', JSON.stringify({ ts: 1, event: 'play_result' }) + '\n')
  mem.files.set('/logs/diagnose.log', 'old-line\nnew-tail')

  const runtime = loadTs('src/core/healthLog.ts', {
    'react-native-fs': mem,
    '../utils/log': { getActiveLogsDir: () => '/logs', ensureAllLogFiles: async() => {} },
    'react-native': { Platform: { OS: 'android' }, Share: { share: async() => {} } },
    '../utils/nativeModules/utils': { shareFile: async(p) => { shared.push(p) } },
  })

  await checkAsync('H6 读取最近事件只保留未过期文件并截取尾部', async() => {
    const out = await runtime.readRecentHealthEvents(2, now)
    assert(out.length === 2, `应只剩当天最后 2 条，实际 ${out.length}`)
    assert(out[0].event === 'play_result' && out[1].event === 'cache_hit', '尾部顺序不符')
  })

  await checkAsync('H6 diagnose.log 按字节取尾部', async() => {
    const out = await runtime.readDiagnoseLogTail(8)
    assert(out === 'new-tail', `实际 ${JSON.stringify(out)}`)
  })

  await checkAsync('H5 recordCacheHit 真实追加 cache_hit 事件', async() => {
    await runtime.recordCacheHit({ platform: 'kw', quality: '128k', sourceId: 'kw' })
    const text = Array.from(mem.files.keys()).filter(k => k.startsWith('/logs/source_health_')).sort().map(k => mem.files.get(k)).join('')
    const last = text.trim().split('\n').pop()
    const entry = JSON.parse(last)
    assert(entry.event === 'cache_hit' && entry.platform === 'kw', `实际 ${last}`)
  })

  await checkAsync('H5 recordPlayResult 失败落盘 play_result + source_events', async() => {
    const prevLx = global.lx
    global.lx = { ...(prevLx || {}), apis: { kw: { healthEvents: () => ({ promise: Promise.resolve({ events: [{ event: 'source_result', ok: false }] }) }) } } }
    mem.files.clear()
    await runtime.recordPlayResult({ traceId: 't-rt', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 12 })
    const text = Array.from(mem.files.keys()).filter(k => k.startsWith('/logs/source_health_')).sort().map(k => mem.files.get(k)).join('')
    const lines = text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    assert(lines.some(l => l.event === 'play_result' && l.traceId === 't-rt' && l.sampleWeight === 1), '缺少 play_result 或权重不是 1')
    assert(lines.some(l => l.event === 'source_events' && Array.isArray(l.sourceEvents)), '缺少同 trace 音源事件')
    global.lx = prevLx
  })

  await checkAsync('H10 recordProbeEvents 只落探测/迁移事件且跨批去重', async() => {
    mem.files.clear()
    const events = [
      { ts: Date.now(), traceId: 'p1', event: 'probe_result', sourceId: 'suyinKuwo', quality: 'flac', ok: false, code: 'PROBE_FAIL', latencyMs: 3, name: '不落歌名' },
      { ts: Date.now(), traceId: 'p1', event: 'health_transition', sourceId: 'suyinKuwo', from: 'ELIGIBLE', to: 'AUTO_OFF' },
      { ts: Date.now(), traceId: 'p1', event: 'play_result', sourceId: 'suyinKuwo' },
    ]
    const first = await runtime.recordProbeEvents(events)
    const again = await runtime.recordProbeEvents(events)
    assert(first === 2, `首轮应写 2 条，实际 ${first}`)
    assert(again === 0, `重复批次应 0 条，实际 ${again}`)
    const text = Array.from(mem.files.keys()).filter(k => k.startsWith('/logs/source_health_')).sort().map(k => mem.files.get(k)).join('')
    const lines = text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    assert(lines.length === 2 && lines[0].event === 'probe_result' && lines[1].event === 'health_transition', `实际 ${text}`)
    assert(!('name' in lines[0]), '不得落歌名/非白名单字段')
  })

  await checkAsync('H8 exportDiagnostics 写诊断包并返回路径', async() => {
    const p = await runtime.exportDiagnostics({ ok: true }, new Date(2026, 10, 11, 12, 0, 0))
    assert(p === '/logs/source_health_diag_20261111_120000.json', `实际 ${p}`)
    assert(mem.files.get(p).includes('"ok": true'), '诊断包内容不符')
  })

  await checkAsync('H8 exportAndShareDiagnostics 导出后调用系统分享', async() => {
    shared.length = 0
    const p = await runtime.exportAndShareDiagnostics({ ok: false }, new Date(2026, 10, 11, 13, 0, 0))
    assert(p === '/logs/source_health_diag_20261111_130000.json', `实际 ${p}`)
    assert(shared[0] === p, `分享路径不符：${shared[0]}`)
  })

  console.log(`\n===== 健康诊断契约汇总：${passed} 通过 / ${failures.length} 失败 =====`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log(' - ' + f)
    process.exit(1)
  }
})()
