/**
 * 音源健康状态分类与摘要（纯逻辑，不依赖 React / 主题）。
 *
 * 表格胶囊与底部摘要必须共用同一个分类函数，避免出现
 * “表格显示已摘除/限流，摘要却把它算进正常”的两套口径。
 */

export type HealthStateKey =
  | 'health_state_sleeping'
  | 'health_state_disabled'
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
  if (!item.enabled) {
    return item.sleeping
      ? { key: 'health_state_sleeping', bucket: 'sleep', tone: 'muted' }
      : { key: 'health_state_disabled', bucket: 'off', tone: 'muted' }
  }
  if (!sampled) return { key: 'health_state_idle', bucket: 'idle', tone: 'muted' }
  if (item.state === 'closed' && item.successRate === 0 && item.healthScore < 0) {
    return { key: 'health_state_abnormal', bucket: 'bad', tone: 'bad' }
  }
  if (item.playDead) {
    return { key: 'health_state_removed', bucket: 'removed', tone: 'bad' }
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
