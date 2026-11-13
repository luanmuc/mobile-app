/**
 * 音源健康状态分类与摘要（纯逻辑，不依赖 React / 主题）。
 *
 * 单一状态模型：4 主状态 + reason。旧 11 态 / 9 桶已移除，表格与摘要共用
 * `classifyHealthMainState`，不再保留第二套口径。
 */

export type HealthStateKey =
  | 'health_main_available'
  | 'health_main_degraded'
  | 'health_main_paused'
  | 'health_main_off'

export type HealthTone = 'ok' | 'warn' | 'bad' | 'muted'
export type HealthMainState = 'available' | 'degraded' | 'paused' | 'off'
export const HEALTH_MAIN_STATES: HealthMainState[] = ['available', 'degraded', 'paused', 'off']
export type HealthMainReason =
  | 'ELIGIBLE'
  | 'PENDING_SAMPLE'
  | 'DEGRADED'
  | 'PLAYBACK_FAILED'
  | 'RESOLVE_FAILED'
  | 'RATE_LIMITED'
  | 'QUALITY_OPEN'
  | 'QUALITY_HALF_OPEN'
  | 'SOURCE_SLEEPING'
  | 'AUTO_OFF_PROBE'
  | 'USER_OFF'
  | 'DEFAULT_OFF'

export interface HealthStatusItem {
  enabled: boolean
  sleeping: boolean
  state: 'closed' | 'open' | 'half-open'
  successRate: number | null
  healthScore: number
  reqCount?: number
  probeCount?: number
  playDead?: boolean
  resolveDead?: boolean
  rateLimited?: boolean
  rateLimitActive?: boolean
  userEnabled?: boolean
  autoOff?: boolean
  offReason?: 'USER_OFF' | 'AUTO_OFF_PROBE' | 'SLEEPING' | 'PLAY_DEAD' | 'DEFAULT_OFF' | null
  offAt?: number
}

export interface HealthMainResult {
  state: HealthMainState
  reason: HealthMainReason
  tone: HealthTone
  key: HealthStateKey
}

export const hasHealthSample = (item: Pick<HealthStatusItem, 'reqCount' | 'probeCount'>) =>
  (item.reqCount ?? 0) > 0 || (item.probeCount ?? 0) > 0

/**
 * 单一裁决：关闭/暂停优先，其次待采样、降级、可用。
 * offReason 是开关权威；不再从旧 enabled/sleeping 字段推断第二套状态。
 */
export const classifyHealthMainState = (
  item: HealthStatusItem,
  sampled: boolean,
): HealthMainResult => {
  const of = (state: HealthMainState, reason: HealthMainReason, key: HealthStateKey, tone: HealthTone): HealthMainResult => ({ state, reason, key, tone })
  const offReason = item.offReason
  if (offReason === 'USER_OFF') return of('off', 'USER_OFF', 'health_main_off', 'muted')
  if (offReason === 'DEFAULT_OFF') return of('off', 'DEFAULT_OFF', 'health_main_off', 'muted')
  if (offReason === 'AUTO_OFF_PROBE' || item.autoOff === true) return of('paused', 'AUTO_OFF_PROBE', 'health_main_paused', 'muted')
  if (offReason === 'SLEEPING') return of('paused', 'SOURCE_SLEEPING', 'health_main_paused', 'muted')
  if (offReason === 'PLAY_DEAD' || item.playDead === true) return of('paused', 'PLAYBACK_FAILED', 'health_main_paused', 'muted')
  if (item.resolveDead === true) return of('paused', 'RESOLVE_FAILED', 'health_main_paused', 'muted')
  if (!sampled) return of('available', 'PENDING_SAMPLE', 'health_main_available', 'ok')
  if (item.rateLimitActive === true || item.rateLimited === true) return of('degraded', 'RATE_LIMITED', 'health_main_degraded', 'warn')
  if (item.state === 'open') return of('degraded', 'QUALITY_OPEN', 'health_main_degraded', 'warn')
  if (item.state === 'half-open') return of('degraded', 'QUALITY_HALF_OPEN', 'health_main_degraded', 'warn')
  if (item.successRate === 0 && item.healthScore < 0) return of('degraded', 'DEGRADED', 'health_main_degraded', 'warn')
  return of('available', 'ELIGIBLE', 'health_main_available', 'ok')
}

export type HealthSummary = Record<HealthMainState, number>

export const emptyHealthSummary = (): HealthSummary => ({ available: 0, degraded: 0, paused: 0, off: 0 })

/** 摘要按 4 主状态统计；每个源只落一个状态，合计等于源数。 */
export const buildHealthSummary = (items: HealthStatusItem[]): HealthSummary => {
  const summary = emptyHealthSummary()
  for (const item of items) summary[classifyHealthMainState(item, hasHealthSample(item)).state]++
  return summary
}

// F16：质量档矩阵。旧表格只有源级成功率，flac 坏了但 128k 好会被平均掉。
// 这里固定四档顺序，逐档展示请求/成功/失败/耗时/熔断/限流，页面只负责排版。
export const HEALTH_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const
export type HealthQuality = typeof HEALTH_QUALITIES[number]

export interface HealthQualityCell {
  quality: HealthQuality
  req: number
  success: number
  fail: number
  businessFail: number
  rate: number | null
  avgTime: number | null
  state: 'closed' | 'open' | 'half-open'
  rateLimited: boolean
  hasSample: boolean
}

export const buildQualityMatrixRows = (item: { byQuality?: Partial<Record<string, unknown>> }): HealthQualityCell[] =>
  HEALTH_QUALITIES.map(quality => {
    const raw = item.byQuality?.[quality]
    const q = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const req = Number(q.req) || 0
    const success = Number(q.success) || 0
    const fail = Number(q.fail) || 0
    const businessFail = Number(q.businessFail) || 0
    const rate = q.rate == null ? null : Number(q.rate)
    const avgTime = q.avgTime == null ? null : Number(q.avgTime)
    const state = q.state === 'open' || q.state === 'half-open' ? q.state : 'closed'
    return {
      quality,
      req,
      success,
      fail,
      businessFail,
      rate: Number.isFinite(rate) ? rate : null,
      avgTime: Number.isFinite(avgTime) ? avgTime : null,
      state,
      rateLimited: q.rateLimited === true,
      hasSample: req > 0 || success > 0 || fail > 0,
    }
  })
