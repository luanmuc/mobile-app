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
}

export interface HealthWindowStats {
  total: number
  ok: number
  failed: number
  successRate: number | null
  p95: number | null
}

export interface HealthWindows {
  h1: HealthWindowStats
  h24: HealthWindowStats
  d7: HealthWindowStats
}

export interface HealthAggregate {
  windows: HealthWindows
  topCodes: Array<{ code: string, count: number }>
}

export interface HealthFinding {
  id: string
  level: 'warn' | 'info'
  title: string
  detail: string
  evidence: string
  suggestion: string
  traceIds: string[]
}

export interface HealthSnapshotLike {
  [sourceId: string]: {
    name?: string
    successRate?: number | null
    healthScore?: number
    [key: string]: unknown
  }
}

export interface HealthReport {
  schema: 1
  generatedAt: number
  summary: string
  windows: HealthWindows
  findings: HealthFinding[]
  recommendations: string[]
  traceIds: string[]
}

export interface HealthEvidencePackage {
  schema: 1
  generatedAt: number
  report: HealthReport
  events: HealthEventLike[]
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

const statsOf = (list: HealthEventLike[]): HealthWindowStats => {
  const total = list.length
  const ok = list.filter(e => e.ok === true).length
  const failed = total - ok
  const latencies = list.map(e => Number(e.latencyMs)).filter(n => Number.isFinite(n) && n >= 0)
  return {
    total,
    ok,
    failed,
    successRate: total ? ok / total : null,
    p95: p95(latencies),
  }
}

export const aggregateHealthEvents = (events: HealthEventLike[], now: number = Date.now()): HealthAggregate => {
  const safe = (Array.isArray(events) ? events : []).filter(e => e && typeof e.ts === 'number' && !Number.isNaN(e.ts))
  const outcomes = safe.filter(isOutcome)
  const windows: HealthWindows = {
    h1: statsOf(outcomes.filter(e => inWindow(e, now, HOUR))),
    h24: statsOf(outcomes.filter(e => inWindow(e, now, DAY))),
    d7: statsOf(outcomes.filter(e => inWindow(e, now, 7 * DAY))),
  }
  const counts = new Map<string, number>()
  for (const e of outcomes) {
    if (e.ok === false && e.code) counts.set(e.code, (counts.get(e.code) || 0) + 1)
  }
  const topCodes = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }))
  return { windows, topCodes }
}

const sourceOf = (e: HealthEventLike) => String(e.sourceId || e.platform || 'unknown')
const pct = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(n * 100)}%`)
const trimTrace = (ids: string[]) => Array.from(new Set(ids.filter(Boolean))).slice(0, 6)

export const detectHealthAnomalies = (input: {
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  now?: number
}): HealthFinding[] => {
  const now = input.now ?? Date.now()
  const events = (Array.isArray(input.events) ? input.events : []).filter(e => e && typeof e.ts === 'number')
  const outcomes = events.filter(isOutcome)
  const snapshot = input.snapshot || {}
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
        traceIds: trimTrace(recent.map(e => String(e.traceId || ''))),
      })
    }
  }

  const sourceIds = Array.from(new Set(outcomes.map(sourceOf)))

  // 2) 近 24h 成功率比前 24h 跌 ≥20pp
  for (const sourceId of sourceIds) {
    const recent = outcomes.filter(e => sourceOf(e) === sourceId && inWindow(e, now, DAY))
    const prev = outcomes.filter(e => sourceOf(e) === sourceId && e.ts <= now - DAY && e.ts > now - 2 * DAY)
    if (recent.length >= 5 && prev.length >= 5) {
      const recentRate = recent.filter(e => e.ok === true).length / recent.length
      const prevRate = prev.filter(e => e.ok === true).length / prev.length
      if (prevRate - recentRate >= 0.2) {
        findings.push({
          id: 'rate_drop',
          level: 'warn',
          title: `${sourceId} 成功率下跌 ${Math.round((prevRate - recentRate) * 100)}pp`,
          detail: '近 24h 与前 24h 对比出现明显下滑。',
          evidence: `前 24h ${pct(prevRate)}（${prev.length} 次）→ 近 24h ${pct(recentRate)}（${recent.length} 次）`,
          suggestion: '看近期失败码是否集中在同一类；若伴随 P95 翻倍，优先怀疑上游变慢或风控。',
          traceIds: trimTrace(recent.filter(e => e.ok === false).map(e => String(e.traceId || ''))),
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
          traceIds: trimTrace(recent.map(e => String(e.traceId || ''))),
        })
      }
    }
  }

  // 4) 近 24h 出现前 7d 没见过的错误码
  const recentCodes = new Set(outcomes.filter(e => inWindow(e, now, DAY) && e.ok === false && e.code).map(e => String(e.code)))
  const priorCodes = new Set(outcomes.filter(e => e.ts <= now - DAY && e.ts > now - 7 * DAY && e.ok === false && e.code).map(e => String(e.code)))
  const newCodes = Array.from(recentCodes).filter(c => !priorCodes.has(c))
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
      evidence: `近 24h ${hit.length} 次 ${code}，前 7d 未见`,
      suggestion: '把该错误码与同 traceId 的事件一起看；若是持续出现，再考虑临时降权该源。',
      traceIds: trimTrace(hit.map(e => String(e.traceId || ''))),
    })
  }

  // 5) 近期失败按错误码聚合，保证“最近异常”里有可直接看的证据
  const recentFails = outcomes.filter(e => inWindow(e, now, DAY) && e.ok === false)
  const byCode = new Map<string, HealthEventLike[]>()
  for (const e of recentFails) {
    const code = String(e.code || 'UNKNOWN')
    const list = byCode.get(code) || []
    list.push(e)
    byCode.set(code, list)
  }
  for (const [code, list] of Array.from(byCode.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
    findings.push({
      id: `recent_failure`,
      level: 'info',
      title: `近 24h ${list.length} 次 ${code}`,
      detail: '近期失败样本，按错误码聚合。',
      evidence: `涉及 ${Array.from(new Set(list.map(sourceOf))).join('、')}`,
      suggestion: '点开对应 traceId 看第几次尝试、哪一步失败；若集中在同一源再考虑换源。',
      traceIds: trimTrace(list.map(e => String(e.traceId || ''))),
    })
  }

  return findings.slice(0, 12)
}

export const buildHealthReport = (input: {
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  now?: number
}): HealthReport => {
  const now = input.now ?? Date.now()
  const agg = aggregateHealthEvents(input.events || [], now)
  const findings = detectHealthAnomalies({ events: input.events || [], snapshot: input.snapshot, now })
  const h1 = agg.windows.h1
  const h24 = agg.windows.h24
  const summary = h24.total
    ? `近 1 小时取链 ${h1.total} 次、成功 ${h1.ok} 次（${pct(h1.successRate)}）；近 24 小时 ${h24.total} 次、成功 ${h24.ok} 次（${pct(h24.successRate)}）；发现 ${findings.length} 项异常/线索。`
    : '近 24 小时还没有本地取链记录。先播放几首歌，或到音源健康页点一次探测，再回来导出。'
  const traceIds = trimTrace(findings.flatMap(f => f.traceIds))
  const recommendations = Array.from(new Set(findings.map(f => f.suggestion).filter(Boolean))).slice(0, 6)
  return {
    schema: 1,
    generatedAt: now,
    summary,
    windows: agg.windows,
    findings,
    recommendations,
    traceIds,
  }
}

export const redactDiagnosticText = (text: string): string => {
  if (!text) return ''
  const URL_RE = new RegExp('https?' + '://[^\\s\'"]+', 'g')
  return String(text)
    .replace(URL_RE, '[url]')
    .replace(/歌=[^\s]+/g, '歌=[已脱敏]')
    .replace(/singer=[^\s]+/g, 'singer=[已脱敏]')
    .replace(/搜索词=[^\s]+/g, '搜索词=[已脱敏]')
}

export const buildEvidencePackage = (input: {
  report: HealthReport
  events: HealthEventLike[]
  snapshot?: HealthSnapshotLike
  trend?: unknown[]
  logTail?: string
}): HealthEvidencePackage => {
  const report = input.report
  return {
    schema: 1,
    generatedAt: report?.generatedAt ?? Date.now(),
    report,
    events: (Array.isArray(input.events) ? input.events : []).map(e => ({ ...e })),
    snapshot: input.snapshot || {},
    trend: Array.isArray(input.trend) ? input.trend : [],
    logTail: redactDiagnosticText(input.logTail || ''),
  }
}
