/**
 * 音源健康状态分类与摘要（纯逻辑，不依赖 React / 主题）。
 *
 * 表格胶囊与底部摘要必须共用同一个分类函数，避免出现
 * “表格显示已摘除/限流，摘要却把它算进正常”的两套口径。
 */

export type HealthStateKey =
  | 'health_state_sleeping'
  | 'health_state_disabled'
  | 'health_state_user_off'
  | 'health_state_auto_off'
  | 'health_state_idle'
  | 'health_state_abnormal'
  | 'health_state_removed'
  | 'health_state_rate_limiting'
  | 'health_state_rate_limited'
  | 'health_state_open'
  | 'health_state_half-open'
  | 'health_state_closed'

export type HealthTone = 'ok' | 'warn' | 'bad' | 'muted'
export type HealthBucket = 'ok' | 'bad' | 'open' | 'half' | 'idle' | 'sleep' | 'off' | 'removed' | 'rate'

export interface HealthStatusItem {
  enabled: boolean
  sleeping: boolean
  state: 'closed' | 'open' | 'half-open'
  successRate: number | null
  healthScore: number
  reqCount?: number
  probeCount?: number
  playDead?: boolean
  rateLimited?: boolean
  rateLimitActive?: boolean
  // v8.14：开关权威拆分（源快照提供）。旧快照没有这些字段时回退到 enabled/sleeping。
  userEnabled?: boolean
  autoOff?: boolean
  offReason?: 'USER_OFF' | 'AUTO_OFF_PROBE' | 'SLEEPING' | 'PLAY_DEAD' | 'DEFAULT_OFF' | null
}

export interface HealthStateResult {
  key: HealthStateKey
  bucket: HealthBucket
  tone: HealthTone
}

export const hasHealthSample = (item: Pick<HealthStatusItem, 'reqCount' | 'probeCount'>) =>
  (item.reqCount ?? 0) > 0 || (item.probeCount ?? 0) > 0

/**
 * 单源状态判定。优先级：
 * 已关/休眠 → 待采样 → 异常 → 已摘除 → 限流 → 熔断/半开/正常。
 * 已关闭永远优先于播放摘除/限流，因为该源已经不参与任何请求。
 */
export const classifyHealthState = (
  item: HealthStatusItem,
  sampled: boolean,
): HealthStateResult => {
  // v8.14：用户关闭/系统自动关闭必须优先于休眠与播放摘除；
  // 旧快照没有 offReason 时回退到 enabled/sleeping，不改变旧行为。
  if (item.offReason === 'USER_OFF' || (item.userEnabled === false && item.offReason == null)) {
    return { key: 'health_state_user_off', bucket: 'off', tone: 'muted' }
  }
  if (item.offReason === 'AUTO_OFF_PROBE' || item.autoOff === true) {
    return { key: 'health_state_auto_off', bucket: 'off', tone: 'warn' }
  }
  if (!item.enabled) {
    return item.sleeping
      ? { key: 'health_state_sleeping', bucket: 'sleep', tone: 'muted' }
      : { key: 'health_state_disabled', bucket: 'off', tone: 'muted' }
  }
  if (!sampled) return { key: 'health_state_idle', bucket: 'idle', tone: 'muted' }
  // v8.14：真实播放摘除优先于“异常”，否则成功率 0/负健康分会把“已摘除”盖成“异常”。
  if (item.playDead === true || item.offReason === 'PLAY_DEAD') {
    return { key: 'health_state_removed', bucket: 'removed', tone: 'bad' }
  }
  if (item.state === 'closed' && item.successRate === 0 && item.healthScore < 0) {
    return { key: 'health_state_abnormal', bucket: 'bad', tone: 'bad' }
  }
  // 熔断 open 优先于限流标签：熔断更严重，不能被“限流中”降级显示
  if (item.state !== 'open' && (item.rateLimitActive === true || item.rateLimited === true)) {
    return {
      key: item.rateLimitActive ? 'health_state_rate_limiting' : 'health_state_rate_limited',
      bucket: 'rate',
      tone: 'warn',
    }
  }
  if (item.state === 'open') return { key: 'health_state_open', bucket: 'open', tone: 'bad' }
  if (item.state === 'half-open') return { key: 'health_state_half-open', bucket: 'half', tone: 'warn' }
  return { key: 'health_state_closed', bucket: 'ok', tone: 'ok' }
}

export type HealthSummary = Record<HealthBucket, number>

export const emptyHealthSummary = (): HealthSummary => ({
  ok: 0,
  bad: 0,
  open: 0,
  half: 0,
  idle: 0,
  sleep: 0,
  off: 0,
  removed: 0,
  rate: 0,
})

/** 摘要按 9 个桶统计；每个源只会落入一个桶，合计等于源数。 */
export const summarizeHealthItems = (items: HealthStatusItem[]): HealthSummary => {
  const summary = emptyHealthSummary()
  for (const item of items) {
    const result = classifyHealthState(item, hasHealthSample(item))
    summary[result.bucket]++
  }
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
