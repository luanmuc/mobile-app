/**
 * 音源健康本地诊断（2.4 方案）。
 *
 * 纯函数，零网络、零文件、零 RN 依赖：
 * - 事件聚合：1h / 24h / 7d 成功率、P95、Top 错误码
 * - 异常规则：本地 0% 但快照健康、成功率跌 20pp、P95 翻倍、新错误码、近期失败码
 * - 人话报告 + 证据包（报告 / 事件 / 快照 / 趋势 / 日志尾部）
 *
 * 事件字段白名单与音源侧 healthEvents 保持一致，不处理歌名、URL、账号、设备信息。
 */

export interface HealthEventLike {
  ts: number
  traceId?: string
  event: string
  sourceId?: string
  platform?: string
  quality?: string
  ok?: boolean
  code?: string
  latencyMs?: number
  reason?: string
  sampleWeight?: number
  sourceEvents?: unknown[]
}

export interface HealthWindowStats {
  total: number
  ok: number
  failed: number
  successRate: number | null
  p95: number | null
  covered: boolean
}

export interface HealthWindows {
  h1: HealthWindowStats
  h24: HealthWindowStats
  d7: HealthWindowStats
}

export interface HealthAggregate {
  windows: HealthWindows
  topCodes: Array<{ code: string, count: number }>
  breakdown: HealthBreakdownRow[]
}

export interface HealthBreakdownRow {
  sourceKey: string
  platform: string
  quality: string
  total: number
  failed: number
  successRate: number | null
}

export interface HealthCoverage {
  eventCount: number
  oldestTs: number | null
  newestTs: number | null
  coveredMs: number
  truncated: boolean
  unweightedSuccesses: number
}

export interface HealthFindingSample {
  traceId?: string
  ts: number
  source: string
  code?: string
  latencyMs?: number
}

export interface HealthFinding {
  id: string
  level: 'warn' | 'info'
  title: string
  detail: string
  evidence: string
  suggestion: string
  traceIds: string[]
  samples?: HealthFindingSample[]
}

export interface HealthTrendPoint {
  timestamp: number
  sources: Record<string, { score?: number | null, successRate?: number | null }>
}

export type HealthSnapshotLike = Record<string, {
  name?: string
  successRate?: number | null
  healthScore?: number
  [key: string]: unknown
}>

export interface HealthReport {
  schema: 1
  generatedAt: number
  summary: string
  windows: HealthWindows
  coverage: HealthCoverage
  breakdown: HealthBreakdownRow[]
  findings: HealthFinding[]
  recommendations: string[]
  traceIds: string[]
}

export interface HealthEvidencePackage {
  schema: 1
  generatedAt: number
  report: HealthReport
  events: HealthEventLike[]
  attempts: Array<{ traceId?: string, sourceId?: string, ok?: boolean, code?: string, latencyMs?: number }>
  appVersion?: string
  sourceVersion?: string
  snapshot: HealthSnapshotLike
  trend: unknown[]
  logTail: string
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const isOutcome = (e: HealthEventLike) => (e.event === 'source_result' || e.event === 'play_result') && typeof e.ok === 'boolean'

const inWindow = (e: HealthEventLike, now: number, ms: number) => e.ts <= now && e.ts > now - ms

const p95 = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = Math.max(Math.ceil(sorted.length * 0.95) - 1, 0)
  return Math.round(sorted[idx])
}

// 成功按 1/20 采样落盘，落盘时带 sampleWeight=20；历史事件没有权重，按 1 处理。
const weightOf = (e: HealthEventLike): number => {
  const w = Number(e.sampleWeight)
  return Number.isFinite(w) && w > 0 ? w : 1
}

const statsOf = (list: HealthEventLike[], covered: boolean): HealthWindowStats => {
  const total = Math.round(list.reduce((sum, e) => sum + weightOf(e), 0))
  const ok = Math.round(list.filter(e => e.ok === true).reduce((sum, e) => sum + weightOf(e), 0))
  const failed = total - ok
  const latencies = list.map(e => Number(e.latencyMs)).filter(n => Number.isFinite(n) && n >= 0)
  return {
    total,
    ok,
    failed,
    successRate: total ? ok / total : null,
    p95: p95(latencies),
    covered,
  }
}

const coversWindow = (list: HealthEventLike[], now: number, ms: number): boolean => {
  if (!list.length) return false
  const oldest = Math.min(...list.map(e => e.ts))
  return oldest <= now - ms
}

export const aggregateHealthEvents = (events: HealthEventLike[], now: number = Date.now()): HealthAggregate => {
  const safe = (Array.isArray(events) ? events : []).filter(e => e && typeof e.ts === 'number' && !Number.isNaN(e.ts))
  const outcomes = safe.filter(isOutcome)
  const windowOf = (ms: number) => {
    const list = outcomes.filter(e => inWindow(e, now, ms))
    return statsOf(list, coversWindow(outcomes, now, ms))
  }
  const windows: HealthWindows = {
    h1: windowOf(HOUR),
    h24: windowOf(DAY),
    d7: windowOf(7 * DAY),
  }
  const counts = new Map<string, number>()
  for (const e of outcomes) {
    if (e.ok === false && e.code) counts.set(e.code, (counts.get(e.code) ?? 0) + 1)
  }
  const topCodes = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }))
  const groups = new Map<string, { sourceKey: string, platform: string, quality: string, total: number, ok: number }>()
  for (const e of outcomes) {
    const sourceKey = sourceOf(e)
    const platform = e.platform ? String(e.platform) : ''
    const quality = e.quality ? String(e.quality) : ''
    const key = `${sourceKey}|${platform}|${quality}`
    const row = groups.get(key) ?? { sourceKey, platform, quality, total: 0, ok: 0 }
    row.total += weightOf(e)
    if (e.ok === true) row.ok += weightOf(e)
    groups.set(key, row)
  }
  const breakdown: HealthBreakdownRow[] = Array.from(groups.values())
    .map(row => {
      const total = Math.round(row.total)
      const ok = Math.round(row.ok)
      return { sourceKey: row.sourceKey, platform: row.platform, quality: row.quality, total, failed: total - ok, successRate: total ? ok / total : null }
    })
    .sort((a, b) => b.total - a.total || a.sourceKey.localeCompare(b.sourceKey))
    .slice(0, 10)
  return { windows, topCodes, breakdown }
}

const sourceOf = (e: HealthEventLike) => {
  if (e.sourceId != null && e.sourceId !== '') return String(e.sourceId)
  if (e.platform != null && e.platform !== '') return String(e.platform)
  return 'unknown'
}
const pct = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(n * 100)}%`)
const trimTrace = (ids: string[]) => Array.from(new Set(ids.filter(Boolean))).slice(0, 6)
const samplesOf = (list: HealthEventLike[], limit = 5): HealthFindingSample[] => list.slice(0, limit).map(e => ({
  traceId: e.traceId != null ? String(e.traceId) : undefined,
  ts: e.ts,
  source: sourceOf(e),
  code: e.code != null ? String(e.code) : undefined,
  latencyMs: Number.isFinite(Number(e.latencyMs)) ? Math.round(Number(e.latencyMs)) : undefined,
}))

export const detectHealthAnomalies = (input: {
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  trend?: HealthTrendPoint[]
  now?: number
}): HealthFinding[] => {
  const now = input.now ?? Date.now()
  const events = (Array.isArray(input.events) ? input.events : []).filter(e => e && typeof e.ts === 'number')
  const outcomes = events.filter(isOutcome)
  const snapshot = input.snapshot ?? {}
  const findings: HealthFinding[] = []

  // 1) 本地 0% 但音源快照健康：本地证据与源自评冲突，优先怀疑端内取链/缓存/时间窗
  for (const sourceId of Object.keys(snapshot)) {
    const recent = outcomes.filter(e => sourceOf(e) === sourceId && inWindow(e, now, DAY))
    const snapRate = snapshot[sourceId]?.successRate
    if (recent.length >= 3 && recent.every(e => e.ok === false) && snapRate != null && snapRate >= 0.6) {
      findings.push({
        id: 'local_zero_snapshot_healthy',
        level: 'warn',
        title: `${sourceId} 本地 0% 但音源快照 ${pct(snapRate)}`,
        detail: '本地记录与音源自评冲突，可能是端内取链失败、缓存命中失败或音源上报时间窗不同。',
        evidence: `近 24h 本地 0/${recent.length}，音源快照成功率 ${pct(snapRate)}`,
        suggestion: '先看同 traceId 的 source_attempt/source_skip，确认是取链失败还是被熔断/限速跳过；不要直接关闭音源。',
        traceIds: trimTrace(recent.map(e => String(e.traceId ?? ''))),
        samples: samplesOf(recent.filter(e => e.ok === false)),
      })
    }
  }

  const sourceIds = Array.from(new Set(outcomes.map(sourceOf)))

  // 2) 近 24h 成功率比前 24h 跌 ≥20pp
  for (const sourceId of sourceIds) {
    const recent = outcomes.filter(e => sourceOf(e) === sourceId && inWindow(e, now, DAY))
    const prev = outcomes.filter(e => sourceOf(e) === sourceId && e.ts <= now - DAY && e.ts > now - 2 * DAY)
    if (recent.length >= 5 && prev.length >= 5) {
      // 与窗口统计同一口径：成功样本按 1/20 采样，必须用 sampleWeight 还原，
      // 否则采样比例变化会被误读成成功率变化。
      const recentStats = statsOf(recent, true)
      const prevStats = statsOf(prev, true)
      const recentRate = recentStats.successRate ?? 0
      const prevRate = prevStats.successRate ?? 0
      if (prevRate - recentRate >= 0.2) {
        findings.push({
          id: 'rate_drop',
          level: 'warn',
          title: `${sourceId} 成功率下跌 ${Math.round((prevRate - recentRate) * 100)}pp`,
          detail: '近 24h 与前 24h 对比出现明显下滑。',
          evidence: `前 24h ${pct(prevRate)}（约 ${prevStats.total} 次）→ 近 24h ${pct(recentRate)}（约 ${recentStats.total} 次）`,
          suggestion: '看近期失败码是否集中在同一类；若伴随 P95 翻倍，优先怀疑上游变慢或风控。',
          traceIds: trimTrace(recent.filter(e => e.ok === false).map(e => String(e.traceId ?? ''))),
          samples: samplesOf(recent.filter(e => e.ok === false)),
        })
      }
    }
  }

  // 3) P95 翻倍（且近 24h 至少 500ms）
  for (const sourceId of sourceIds) {
    const recent = outcomes.filter(e => sourceOf(e) === sourceId && inWindow(e, now, DAY))
    const prev = outcomes.filter(e => sourceOf(e) === sourceId && e.ts <= now - DAY && e.ts > now - 2 * DAY)
    if (recent.length >= 5 && prev.length >= 5) {
      const recentP95 = p95(recent.map(e => Number(e.latencyMs)).filter(Number.isFinite))
      const prevP95 = p95(prev.map(e => Number(e.latencyMs)).filter(Number.isFinite))
      if (recentP95 != null && prevP95 != null && recentP95 >= 500 && recentP95 >= prevP95 * 2) {
        findings.push({
          id: 'p95_spike',
          level: 'warn',
          title: `${sourceId} P95 翻倍`,
          detail: '近 24h 取链尾延迟明显高于前 24h。',
          evidence: `P95 ${prevP95}ms → ${recentP95}ms（${Math.round(recentP95 / prevP95)} 倍）`,
          suggestion: '结合 source_result 的 latencyMs 分布看是否某一子源拖尾；必要时在音源配置里降低该源并发或缩短预算。',
          traceIds: trimTrace(recent.map(e => String(e.traceId ?? ''))),
          samples: samplesOf(recent),
        })
      }
    }
  }

  // 4) 近 24h 出现前 7d 没见过的错误码
  const recentCodes = new Set(outcomes.filter(e => inWindow(e, now, DAY) && e.ok === false && e.code).map(e => String(e.code)))
  // “新错误码”必须建立在已有基线之上：本地日志只覆盖几小时时，1~7 天前是空窗，
  // 不能把空窗当成“前 7 天没出现”，否则每个错误码都会被误判成新码。
  const baseline = outcomes.filter(e => e.ts <= now - DAY && e.ts > now - 7 * DAY)
  const baselineOldest = baseline.length ? Math.min(...baseline.map(e => e.ts)) : null
  const baselineSpan = baselineOldest == null ? 0 : Math.max(0, now - DAY - baselineOldest)
  const baselineText = baselineSpan >= DAY
    ? `${Math.max(1, Math.round(baselineSpan / DAY))} 天`
    : `${Math.max(1, Math.round(baselineSpan / HOUR))} 小时`
  const priorCodes = new Set(baseline.filter(e => e.ok === false && e.code).map(e => String(e.code)))
  const newCodes = baseline.length ? Array.from(recentCodes).filter(c => !priorCodes.has(c)) : []
  const emittedNewCodes = new Set<string>()
  for (const code of newCodes.sort((a, b) => {
    const ca = outcomes.filter(e => e.code === a).length
    const cb = outcomes.filter(e => e.code === b).length
    return cb - ca
  }).slice(0, 3)) {
    const hit = outcomes.filter(e => inWindow(e, now, DAY) && e.code === code)
    findings.push({
      id: 'new_code',
      level: 'info',
      title: `出现新错误码 ${code}`,
      detail: '该错误码在前 7 天未出现过，可能是上游策略变化或新链路问题。',
      evidence: `近 24h ${hit.length} 次 ${code}，此前 ${baselineText}未见`,
      suggestion: '把该错误码与同 traceId 的事件一起看；若是持续出现，再考虑临时降权该源。',
      traceIds: trimTrace(hit.map(e => String(e.traceId ?? ''))),
      samples: samplesOf(hit),
    })
    emittedNewCodes.add(code)
  }

  // 5) 近期失败按错误码聚合，保证“最近异常”里有可直接看的证据
  const recentFails = outcomes.filter(e => inWindow(e, now, DAY) && e.ok === false)
  const byCode = new Map<string, HealthEventLike[]>()
  for (const e of recentFails) {
    const code = e.code != null && e.code !== '' ? String(e.code) : 'UNKNOWN'
    const list = byCode.get(code) ?? []
    list.push(e)
    byCode.set(code, list)
  }
  for (const [code, list] of Array.from(byCode.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
    // 已经以“新错误码”露出过的码不再重复一条，避免同一批失败出现两个标题。
    if (emittedNewCodes.has(code)) continue
    findings.push({
      id: 'recent_failure',
      level: 'info',
      title: `近 24h ${list.length} 次 ${code}`,
      detail: '近期失败样本，按错误码聚合。',
      evidence: `涉及 ${Array.from(new Set(list.map(sourceOf))).join('、')}`,
      suggestion: '点开对应 traceId 看第几次尝试、哪一步失败；若集中在同一源再考虑换源。',
      traceIds: trimTrace(list.map(e => String(e.traceId ?? ''))),
      samples: samplesOf(list),
    })
  }

  // 6) 快照趋势连续下降：本地事件可能还不够多，先用音源自带趋势兜住
  if (Array.isArray(input.trend) && input.trend.length >= 4) {
    const points = input.trend
      .filter(p => p && typeof p.timestamp === 'number' && p.sources)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-4)
    const ids = Array.from(new Set(points.flatMap(p => Object.keys(p.sources ?? {}))))
    for (const sourceId of ids) {
      const series = points.map(p => p.sources?.[sourceId]?.successRate)
      if (series.some(v => typeof v !== 'number' || !Number.isFinite(v))) continue
      const nums = series as number[]
      const declining = nums.every((v, i) => i === 0 || v < nums[i - 1])
      const drop = nums[0] - nums[nums.length - 1]
      if (!declining || drop < 0.15) continue
      const local = outcomes.filter(e => sourceOf(e) === sourceId && inWindow(e, now, DAY))
      findings.push({
        id: 'trend_decline',
        level: drop >= 0.2 ? 'warn' : 'info',
        title: `${sourceId} 成功率连续下降 ${Math.round(drop * 100)}pp`,
        detail: '最近 4 次音源快照的成功率逐次下降，可能是上游变慢/风控或本地网络变化。',
        evidence: `最近 4 次探测：${nums.map(v => pct(v)).join(' → ')}`,
        suggestion: '结合近 24h 本地日志与失败码确认；单看一次探测不下结论，也不要直接关闭音源。',
        traceIds: trimTrace(local.map(e => String(e.traceId ?? ''))),
        samples: samplesOf(local.filter(e => e.ok === false)),
      })
    }
  }

  return findings.slice(0, 12)
}

export const spanText = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '0 小时'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} 分钟`
  if (ms < DAY) return `${Math.round(ms / HOUR)} 小时`
  return `${Math.round(ms / DAY)} 天`
}

export const buildHealthReport = (input: {
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  trend?: HealthTrendPoint[]
  now?: number
  truncated?: boolean
}): HealthReport => {
  const now = input.now ?? Date.now()
  const safe = (Array.isArray(input.events) ? input.events : []).filter(e => e && typeof e.ts === 'number' && !Number.isNaN(e.ts))
  const agg = aggregateHealthEvents(safe, now)
  const findings = detectHealthAnomalies({ events: safe, snapshot: input.snapshot, trend: input.trend, now })
  const timestamps = safe.map(e => e.ts)
  const oldestTs = timestamps.length ? Math.min(...timestamps) : null
  const newestTs = timestamps.length ? Math.max(...timestamps) : null
  // 升级前的成功事件没有 sampleWeight，按 1 计；它们会把加权成功率拉低，
  // 报告必须显式说明，避免用户把混合口径当成当前真实成功率。
  const unweightedSuccesses = safe.filter(e => isOutcome(e) && e.ok === true && weightOf(e) === 1).length
  const coverage: HealthCoverage = {
    eventCount: safe.length,
    oldestTs,
    newestTs,
    coveredMs: oldestTs != null && newestTs != null ? Math.max(0, newestTs - oldestTs) : 0,
    truncated: Boolean(input.truncated),
    unweightedSuccesses,
  }
  const h1 = agg.windows.h1
  const h24 = agg.windows.h24
  const weightingNote = coverage.unweightedSuccesses
    ? `成功按 1/20 采样加权；其中 ${coverage.unweightedSuccesses} 条成功为升级前未加权样本，成功率仅供参考。`
    : '成功按 1/20 采样加权，数值为估算。'
  const coverageNote = agg.windows.d7.covered
    ? ''
    : ` 本地日志仅覆盖最近 ${spanText(coverage.coveredMs)}，7 天结论仅供参考。`
  const summary = h24.total
    ? `近 1 小时约 ${h1.total} 次、成功 ${h1.ok} 次（${pct(h1.successRate)}）；近 24 小时约 ${h24.total} 次、成功 ${h24.ok} 次（${pct(h24.successRate)}）；${weightingNote}发现 ${findings.length} 项异常/线索。${coverageNote}`
    : `近 24 小时还没有本地取链记录。先播放几首歌，或到音源健康页点一次探测，再回来导出。${coverageNote}`
  const traceIds = trimTrace(findings.flatMap(f => f.traceIds))
  const recommendations = Array.from(new Set(findings.map(f => f.suggestion).filter(Boolean))).slice(0, 6)
  return {
    schema: 1,
    generatedAt: now,
    summary,
    windows: agg.windows,
    coverage,
    breakdown: agg.breakdown,
    findings,
    recommendations,
    traceIds,
  }
}

export const redactDiagnosticText = (text: string): string => {
  if (!text) return ''
  // 大小写与 ftp/file 也要覆盖：日志里的链接不一定是小写 http(s)。
  const URL_RE = new RegExp('(?:https?|ftp|file)' + '://[^\\s\'"]+', 'gi')
  return String(text)
    .replace(URL_RE, '[url]')
    .replace(/歌=[^\s]+/g, '歌=[已脱敏]')
    .replace(/singer=[^\s]+/g, 'singer=[已脱敏]')
    .replace(/搜索词=[^\s]+/g, '搜索词=[已脱敏]')
}

// 证据包会把源脚本返回的 sourceEvents 原样带出，里面的 reason 可能含 URL/歌名。
// 只对字符串做递归脱敏，保留结构；深度/数组长度设上限，防止异常大对象拖垮导出。
const redactValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (Array.isArray(value)) {
    if (depth >= 4) return []
    return value.slice(0, 200).map(v => redactValue(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth >= 4) return '[truncated]'
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[k] = redactValue(v, depth + 1)
    return out
  }
  return value
}

export const buildEvidencePackage = (input: {
  report: HealthReport
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  trend?: unknown[]
  logTail?: string
  appVersion?: string
  sourceVersion?: string
}): HealthEvidencePackage => {
  const report = input.report
  const events = (Array.isArray(input.events) ? input.events : []).map(e => redactValue({ ...e }) as HealthEventLike)
  const attempts: HealthEvidencePackage['attempts'] = []
  for (const e of events) {
    if (attempts.length >= 50) break
    if (e.event !== 'source_events' || !Array.isArray(e.sourceEvents)) continue
    for (const raw of e.sourceEvents) {
      if (attempts.length >= 50) break
      if (!raw || typeof raw !== 'object') continue
      const row = raw as { source?: unknown, sourceId?: unknown, ok?: unknown, code?: unknown, latencyMs?: unknown }
      attempts.push({
        traceId: e.traceId,
        sourceId: row.sourceId != null ? String(row.sourceId) : row.source != null ? String(row.source) : undefined,
        ok: typeof row.ok === 'boolean' ? row.ok : undefined,
        code: row.code != null ? String(row.code) : undefined,
        latencyMs: Number.isFinite(Number(row.latencyMs)) ? Math.round(Number(row.latencyMs)) : undefined,
      })
    }
  }
  return {
    schema: 1,
    generatedAt: report?.generatedAt ?? Date.now(),
    report,
    events,
    attempts,
    ...(input.appVersion ? { appVersion: String(input.appVersion) } : {}),
    ...(input.sourceVersion ? { sourceVersion: String(input.sourceVersion) } : {}),
    snapshot: input.snapshot ?? {},
    trend: Array.isArray(input.trend) ? input.trend : [],
    logTail: redactDiagnosticText(input.logTail ?? ''),
  }
}
