/**
 * 音源契约 v2（App 侧唯一 action / envelope 权威表）。
 *
 * 约束：
 * - 这里只做纯数据与纯函数，不依赖 React Native / 原生桥；
 * - 源脚本仍可返回旧 raw 值；unwrapSourceResult 同时兼容旧 raw 与 v2 envelope；
 * - action 列表是 App 侧唯一权威来源，preload 不再按 source 维护白名单。
 */

export const SOURCE_ACTIONS = [
  'musicUrl',
  'lyric',
  'pic',
  'health',
  'toggle',
  'probe',
  'config',
  'trend',
  'healthEvents',
  'exportHealthState',
  'restoreHealthState',
] as const

export type SourceAction = typeof SOURCE_ACTIONS[number]

export type FallbackOwner = 'host' | 'source'

export const SOURCE_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const

export const SOURCE_ERROR_CODES = [
  'NO_MATCH',
  'NOT_AUDIO',
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'UNSUPPORTED_ACTION',
  'INTERNAL',
] as const

export type SourceErrorCode = typeof SOURCE_ERROR_CODES[number]

const RETRYABLE_ERROR_CODES = new Set<SourceErrorCode>(['NETWORK', 'TIMEOUT', 'RATE_LIMITED'])

export const isSourceAction = (value: unknown): value is SourceAction =>
  typeof value === 'string' && (SOURCE_ACTIONS as readonly string[]).includes(value)

export const isSourceQuality = (value: unknown): value is LX.Quality =>
  typeof value === 'string' && (SOURCE_QUALITIES as readonly string[]).includes(value)

export const getErrorRetryable = (code: SourceErrorCode | string): boolean =>
  RETRYABLE_ERROR_CODES.has(code as SourceErrorCode)

export const normalizeFallbackOwner = (value: unknown): FallbackOwner =>
  value === 'source' ? 'source' : 'host'

/** 只有显式声明 source 所有权的源，App 才不启动自己的换源。 */
export const shouldHostFallback = (owner: FallbackOwner | string | undefined): boolean =>
  owner !== 'source'

export interface SourceError {
  code: SourceErrorCode
  message: string
  retryable?: boolean
  stage?: 'request' | 'verify' | 'deliver'
  source?: string
  detail?: unknown
}

export type SourceEnvelope<T> =
  | { ok: true, data: T, meta?: Record<string, unknown> }
  | { ok: false, error: SourceError }

const isSourceEnvelope = (value: unknown): value is SourceEnvelope<unknown> => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') return false
  return record.ok ? 'data' in record : 'error' in record
}

/**
 * 旧音源：原样返回。
 * v2 成功：返回 data。
 * v2 失败：抛 Error，message 固定为 `CODE: message`，并带 code/retryable/stage 供上层归因。
 */
export const unwrapSourceResult = <T = any>(value: unknown): T => {
  if (!isSourceEnvelope(value)) return value as T
  if (value.ok) return value.data as T

  const error = value.error
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL'
  const message = typeof error?.message === 'string' && error.message ? error.message : 'unknown source error'
  const err = new Error(`${code}: ${message}`) as Error & {
    code?: string
    retryable?: boolean
    stage?: SourceError['stage']
    source?: string
    detail?: unknown
  }
  err.code = code
  err.retryable = error?.retryable ?? getErrorRetryable(code)
  err.stage = error?.stage
  err.source = error?.source
  err.detail = error?.detail
  throw err
}

/**
 * 只保留 music 源，过滤未知 action / 非法音质，并去重。
 * 返回值仍保持 LX.UserApi.UserApiSourceInfo 形状，消费方可无感替换。
 */
export const normalizeSourceInfo = (raw: unknown): Partial<Record<LX.Source, LX.UserApi.UserApiSourceInfo>> => {
  if (!raw || typeof raw !== 'object') return {}
  const output: Partial<Record<LX.Source, LX.UserApi.UserApiSourceInfo>> = {}

  for (const [source, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (item.type !== 'music') continue

    const actions = Array.isArray(item.actions)
      ? [...new Set(item.actions.filter(isSourceAction))]
      : []
    const qualitys = Array.isArray(item.qualitys)
      ? [...new Set(item.qualitys.filter(isSourceQuality))]
      : []

    output[source as LX.Source] = {
      name: typeof item.name === 'string' ? item.name : '',
      type: 'music',
      actions,
      qualitys,
      fallbackOwner: normalizeFallbackOwner(item.fallbackOwner),
    }
  }

  return output
}
