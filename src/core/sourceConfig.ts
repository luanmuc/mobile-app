/**
 * 音源配置契约（与 lx-source.js v8.12.1 config 写模式对齐）。
 *
 * 这里是 App 侧唯一的一份配置键表 / 默认值 / 上下限 / 预设 / 注入过滤 / 保存校验。
 * 新增音源配置键时只改本文件，Health 面板与启动注入都从这里读，避免再次出现
 * “面板能改、重启就回落”的两套白名单漂移。
 */

export type SourceConfigValue = number | boolean
export type NumericConfigValue = number

export type ConfigErrorCode =
  | 'not-in-source'
  | 'empty'
  | 'not-number'
  | 'negative'
  | 'zero-not-allowed'
  | 'below-min'
  | 'above-max'
  | 'not-boolean'
  | 'missing'

export interface NumericConfigSpec {
  /** i18n key，不再直接写中文单位 */
  unit: string
  /** 1 单位等于多少 ms；纯数字键不填 */
  msPerUnit?: number
  presets: number[]
  default: number
}

/** 音源 v8.11.7 ALLOWED_KEYS：28 个数字键 */
export const NUMERIC_CONFIG_KEYS = [
  'cacheTtlMs',
  'cacheTtlHighQualityMs',
  'failCacheNotFoundMs',
  'failCacheExpiredMs',
  'breakerThreshold',
  'breakerCooldownMs',
  'rateLimitBackoffMs',
  'maxConcurrency',
  'rateWindowMs',
  'rateWindowMax',
  'healthCheckIntervalMs',
  'raceBudgetMs',
  'raceBudgetFloorMs',
  'raceBatchSize',
  'raceBatchStaggerMs',
  'raceMatchWaitMs',
  'coldStartTimeoutMs',
  'coldStartProbeTimeoutMs',
  'coldStartWarmTtlMs',
  'qualityShortCircuitSamples',
  'qualityShortCircuitProbeMs',
  'verifyTimeoutMs',
  'verifyMinOriginalSec',
  'verifyDurRatio',
  'verifyDurGapSec',
  'allFailShortTtlMs',
  'playDeadReviveMs',
  'memoryMapMax',
] as const

/** 音源 v8.12.1 ALLOWED_BOOL_KEYS：9 个布尔键 */
export const BOOL_CONFIG_KEYS = [
  'verifyDelivery',
  'truthfulQuality',
  'qualityFloor',
  'verifyOnCacheHit',
  'previewUrlPreFilter',
  'fragmentFallback',
  'qualityShortCircuit',
  'coldStartWarmEnabled',
  'crossPlatformEnabled',
] as const

export const SOURCE_CONFIG_KEYS = [...NUMERIC_CONFIG_KEYS, ...BOOL_CONFIG_KEYS] as const

/** 音源 ZERO_ALLOWED_KEYS：只有这两个键允许 0 值 */
export const ZERO_ALLOWED_KEYS = ['verifyDurRatio', 'verifyDurGapSec'] as const

const NUMERIC_KEY_SET: ReadonlySet<string> = new Set(NUMERIC_CONFIG_KEYS)
const BOOL_KEY_SET: ReadonlySet<string> = new Set(BOOL_CONFIG_KEYS)
const SOURCE_KEY_SET: ReadonlySet<string> = new Set(SOURCE_CONFIG_KEYS)
const ZERO_ALLOWED_SET: ReadonlySet<string> = new Set(ZERO_ALLOWED_KEYS)

export const CONFIG_LABEL_PREFIX = 'health_cfg_label_'
export const CONFIG_DESC_PREFIX = 'health_cfg_desc_'

export const configLabelKey = (key: string) => `${CONFIG_LABEL_PREFIX}${key}`
export const configDescKey = (key: string) => `${CONFIG_DESC_PREFIX}${key}`

/**
 * 数字参数单位 / 预设 / 默认值。
 * 默认值以音源 USER_CONFIG 为准：playDeadReviveMs=300000ms(5min)、
 * allFailShortTtlMs=30000ms(30s)。预设必须全部可保存（0 仅两个验真键合法）。
 */
export const CONFIG_UNIT_CONFIG: Record<string, NumericConfigSpec> = {
  cacheTtlMs: { unit: 'health_unit_hours', msPerUnit: 3600000, presets: [1, 6, 12, 24, 168], default: 6 },
  cacheTtlHighQualityMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [10, 30, 60, 120], default: 30 },
  failCacheNotFoundMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [1, 5, 60, 360], default: 60 },
  failCacheExpiredMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [30, 60, 300], default: 60 },
  breakerThreshold: { unit: 'health_unit_times', presets: [2, 3, 5, 10], default: 3 },
  breakerCooldownMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [0.5, 1, 3, 10], default: 3 },
  rateLimitBackoffMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [5, 10, 30, 60], default: 30 },
  maxConcurrency: { unit: 'health_unit_items', presets: [1, 2, 3, 5], default: 2 },
  rateWindowMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [1, 3, 5], default: 3 },
  rateWindowMax: { unit: 'health_unit_times', presets: [3, 5, 10, 20], default: 5 },
  healthCheckIntervalMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [1, 5, 10, 30], default: 10 },
  healthCheckJitterRatio: { unit: 'health_unit_ratio', presets: [0.05, 0.1, 0.2, 0.3], default: 0.1 },
  healthCheckPauseRetryMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [30, 60, 120, 300], default: 60 },
  raceBudgetMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [5, 8, 12, 15], default: 12 },
  raceBudgetFloorMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [1, 2, 3, 5], default: 3 },
  raceBatchSize: { unit: 'health_unit_items', presets: [1, 2, 3, 5], default: 3 },
  raceBatchStaggerMs: { unit: 'health_unit_ms', presets: [100, 300, 500], default: 300 },
  raceMatchWaitMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [0.3, 0.6, 1, 2], default: 0.6 },
  coldStartTimeoutMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [5, 8, 15, 30], default: 8 },
  coldStartProbeTimeoutMs: { unit: 'health_unit_seconds', msPerUnit: 1000, presets: [10, 20, 30, 60], default: 30 },
  coldStartWarmTtlMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [1, 5, 10, 30], default: 5 },
  qualityShortCircuitSamples: { unit: 'health_unit_times', presets: [2, 3, 5, 10], default: 3 },
  qualityShortCircuitProbeMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [30, 60, 180, 360], default: 60 },
  verifyTimeoutMs: { unit: 'health_unit_ms', presets: [1000, 2000, 3000, 5000], default: 3000 },
  verifyMinOriginalSec: { unit: 'health_unit_seconds', presets: [30, 60, 90, 120], default: 90 },
  verifyDurRatio: { unit: 'health_unit_ratio', presets: [0.4, 0.5, 0.6, 0.8], default: 0.6 },
  verifyDurGapSec: { unit: 'health_unit_seconds', presets: [5, 10, 15, 30], default: 15 },
  allFailShortTtlMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [0.5, 1, 5], default: 0.5 },
  playDeadReviveMs: { unit: 'health_unit_minutes', msPerUnit: 60000, presets: [5, 10, 30, 60], default: 5 },
  memoryMapMax: { unit: 'health_unit_rows', presets: [500, 1000, 2000, 5000], default: 2000 },
}

/** 与音源 v8.11.7 PARAM_LIMITS 一致 */
export const PARAM_LIMITS: Record<string, { min?: number, max?: number }> = {
  cacheTtlMs: { max: 7 * 24 * 3600 * 1000 },
  cacheTtlHighQualityMs: { max: 7 * 24 * 3600 * 1000 },
  failCacheNotFoundMs: { max: 24 * 3600 * 1000 },
  failCacheExpiredMs: { max: 3600 * 1000 },
  breakerThreshold: { max: 20 },
  breakerCooldownMs: { max: 30 * 60 * 1000 },
  rateLimitBackoffMs: { max: 5 * 60 * 1000 },
  maxConcurrency: { max: 5 },
  rateWindowMs: { max: 10 * 1000 },
  rateWindowMax: { max: 20 },
  healthCheckIntervalMs: { min: 60 * 1000 },
  healthCheckJitterRatio: { min: 0, max: 0.5 },
  healthCheckPauseRetryMs: { min: 1000, max: 5 * 60 * 1000 },
  raceBudgetMs: { max: 15 * 1000 },
  raceBudgetFloorMs: { max: 15 * 1000 },
  raceBatchSize: { max: 10 },
  raceBatchStaggerMs: { max: 2000 },
  raceMatchWaitMs: { max: 5 * 1000 },
  coldStartTimeoutMs: { max: 30 * 1000 },
  coldStartProbeTimeoutMs: { max: 60 * 1000 },
  coldStartWarmTtlMs: { max: 60 * 60 * 1000 },
  qualityShortCircuitSamples: { max: 20 },
  qualityShortCircuitProbeMs: { max: 24 * 3600 * 1000 },
  verifyTimeoutMs: { min: 500, max: 10 * 1000 },
  verifyMinOriginalSec: { max: 3600 },
  verifyDurRatio: { max: 1 },
  verifyDurGapSec: { max: 300 },
  allFailShortTtlMs: { max: 10 * 60 * 1000 },
  playDeadReviveMs: { max: 2 * 3600 * 1000 },
  memoryMapMax: { min: 1, max: 20000 },
}

export const BOOL_CONFIG_DEFAULT: Record<string, boolean> = {
  verifyDelivery: true,
  truthfulQuality: true,
  qualityFloor: true,
  verifyOnCacheHit: true,
  previewUrlPreFilter: false,
  fragmentFallback: true,
  qualityShortCircuit: true,
  coldStartWarmEnabled: true,
  crossPlatformEnabled: true,
}

const withinLimits = (key: string, value: number) => {
  const limits = PARAM_LIMITS[key]
  if (!limits) return true
  if (limits.min !== undefined && value < limits.min) return false
  if (limits.max !== undefined && value > limits.max) return false
  return true
}

const isAllowedNumber = (key: string, value: number) => {
  if (!Number.isFinite(value)) return false
  if (value < 0) return false
  if (value === 0 && !ZERO_ALLOWED_SET.has(key)) return false
  return withinLimits(key, value)
}

/**
 * 启动注入：只把音源契约内的合法键写进 __lxSourceConfig。
 * 数字支持 28 键（含两个允许 0 的验真键），布尔支持 8 键；
 * 旧死键、错误类型、负数、超限值一律丢弃。
 */
export const filterConfigForInjection = (
  saved: unknown,
): Record<string, SourceConfigValue> => {
  const out: Record<string, SourceConfigValue> = {}
  if (!saved || typeof saved !== 'object') return out
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    if (!SOURCE_KEY_SET.has(key)) continue
    if (BOOL_KEY_SET.has(key)) {
      if (typeof value === 'boolean') out[key] = value
      continue
    }
    if (!NUMERIC_KEY_SET.has(key)) continue
    if (typeof value !== 'number') continue
    if (!isAllowedNumber(key, value)) continue
    out[key] = value
  }
  return out
}

export const msToDisplay = (key: string, msValue: number): number => {
  const cfg = CONFIG_UNIT_CONFIG[key]
  if (!cfg?.msPerUnit) return msValue
  return Math.round(msValue / cfg.msPerUnit * 100) / 100
}

export const displayToMs = (key: string, displayValue: number): number => {
  const cfg = CONFIG_UNIT_CONFIG[key]
  if (!cfg?.msPerUnit) return displayValue
  return Math.round(displayValue * cfg.msPerUnit)
}

export interface ConfigUpdateResult {
  updates: Record<string, SourceConfigValue>
  errors: Record<string, ConfigErrorCode>
}

/**
 * 保存校验：所有输入先全量校验，存在任一错误就整次不提交，
 * 由 UI 逐项提示，避免“填错了但提示已保存”的静默失败。
 */
export const buildConfigUpdates = (
  configData: Record<string, unknown> | null | undefined,
  inputs: Record<string, string>,
  bools: Record<string, boolean>,
): ConfigUpdateResult => {
  const updates: Record<string, SourceConfigValue> = {}
  const errors: Record<string, ConfigErrorCode> = {}
  if (!configData) return { updates, errors: { ...errors, __form: 'not-in-source' } }

  for (const [key, raw] of Object.entries(inputs)) {
    if (!NUMERIC_KEY_SET.has(key)) {
      errors[key] = 'not-in-source'
      continue
    }
    if (!(key in configData)) {
      errors[key] = 'not-in-source'
      continue
    }
    const text = String(raw ?? '').trim()
    if (!text) {
      errors[key] = 'empty'
      continue
    }
    const num = Number(text)
    if (!Number.isFinite(num)) {
      errors[key] = 'not-number'
      continue
    }
    if (num < 0) {
      errors[key] = 'negative'
      continue
    }
    const value = displayToMs(key, num)
    if (value === 0 && !ZERO_ALLOWED_SET.has(key)) {
      errors[key] = 'zero-not-allowed'
      continue
    }
    const limits = PARAM_LIMITS[key]
    if (limits?.min !== undefined && value < limits.min) {
      errors[key] = 'below-min'
      continue
    }
    if (limits?.max !== undefined && value > limits.max) {
      errors[key] = 'above-max'
      continue
    }
    updates[key] = value
  }

  for (const key of BOOL_CONFIG_KEYS) {
    if (!(key in bools)) {
      errors[key] = 'missing'
      continue
    }
    if (!(key in configData)) {
      errors[key] = 'not-in-source'
      continue
    }
    const value = (bools as Record<string, unknown>)[key]
    if (typeof value !== 'boolean') {
      errors[key] = 'not-boolean'
      continue
    }
    updates[key] = value
  }

  if (Object.keys(errors).length) return { updates: {}, errors }
  return { updates, errors }
}
