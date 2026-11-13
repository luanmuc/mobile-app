/**
 * P3：源健康元数据宿主侧持久化。
 *
 * 官方移动版自定义源没有 storage API，源脚本不能落盘；本模块只通过 AsyncStorage
 * 保存健康统计/熔断/档位短路/播放摘除元数据，绝不保存 success URL、歌名、歌手、账号。
 * P3-R：快照是全局元数据，统一写 canonical key，不再按平台复制全量副本。
 */
export const HEALTH_STATE_VERSION = 1
export const HEALTH_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const HEALTH_STATE_FUTURE_TOLERANCE_MS = 60 * 60 * 1000
export const HEALTH_STATE_MAX_BYTES = 256 * 1024
export const HEALTH_STATE_KEY_PREFIX = '@___SOURCE_HEALTH___'
// P3-R：健康快照是全局元数据，不再按平台复制 5 份；旧平台键只用于一次性迁移。
export const HEALTH_STATE_CANONICAL_KEY = `${HEALTH_STATE_KEY_PREFIX}global`
export const HEALTH_STATE_LEGACY_SOURCE_IDS = ['kw', 'wy', 'tx', 'mg', 'kg']

const QUALITIES = ['128k', '320k', 'flac', 'flac24bit']
// G5：不再维护 provider 固定名单。源脚本升级/增源后，快照键由源自身导出；
// 宿主只校验键名形态，调用方需要更强边界时可显式传 knownSourceIds。
const SOURCE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const FORBIDDEN_KEY = /^(url|successurl|failcache|successcache|cache|songinfo|musicinfo|name|singer|account|cookie|token|headers|body)$/i

export interface HealthStorage {
  getData: <T = unknown>(key: string) => Promise<T | null>
  saveData: (key: string, value: any) => Promise<void>
  removeData: (key: string) => Promise<void>
}

export interface HealthStateSource {
  breaker: Record<string, unknown>
  byQuality: Record<string, Record<string, number>>
  playDead: { streak: number, deadline: number }
}
export interface HealthState {
  v: number
  sourceVersion: string
  savedAt: number
  sources: Record<string, HealthStateSource>
  qualityShortCircuit: Record<string, number>
}
export interface SanitizeResult {
  ok: boolean
  state?: HealthState
  reason?: string
}
export interface SourceHealthApi {
  restoreHealth?: (state: HealthState) => { promise: Promise<{ ok?: boolean, restored?: number, reason?: string }> }
  exportHealth?: () => { promise: Promise<HealthState> }
}
export interface RestoreResult {
  restored: number
  reason?: string
}

const isPlainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const findForbiddenKey = (value: unknown, path: string): string | null => {
  if (!isPlainObject(value)) return null
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY.test(key)) return `${path}.${key}`
    const nested = findForbiddenKey(value[key], `${path}.${key}`)
    if (nested) return nested
  }
  return null
}

/** 白名单校验；合法时返回原对象（不增删字段），非法时返回 reason。 */
export const sanitizeSourceHealthState = (input: unknown, opts: {
  sourceId?: string
  sourceVersion?: string
  knownSourceIds?: string[]
  now?: number
  maxBytes?: number
} = {}): SanitizeResult => {
  const now = opts.now ?? Date.now()
  if (!isPlainObject(input)) return { ok: false, reason: 'state 必须是对象' }
  if (input.v !== HEALTH_STATE_VERSION) return { ok: false, reason: 'schema version 不符' }
  const expectedVersion = opts.sourceVersion
  if (typeof input.sourceVersion !== 'string' || !input.sourceVersion) return { ok: false, reason: 'sourceVersion 非法' }
  if (expectedVersion !== undefined && input.sourceVersion !== expectedVersion) return { ok: false, reason: 'sourceVersion 不符' }
  if (!isFiniteNumber(input.savedAt)) return { ok: false, reason: 'savedAt 非法' }
  const age = now - input.savedAt
  if (age < -HEALTH_STATE_FUTURE_TOLERANCE_MS || age > HEALTH_STATE_TTL_MS) return { ok: false, reason: 'savedAt 超出 TTL' }
  const maxBytes = opts.maxBytes ?? HEALTH_STATE_MAX_BYTES
  if (JSON.stringify(input).length > maxBytes) return { ok: false, reason: 'state 超过容量上限' }
  const forbidden = findForbiddenKey(input, 'state')
  if (forbidden) return { ok: false, reason: `禁止字段 ${forbidden}` }
  if (!isPlainObject(input.sources) || !Object.keys(input.sources).length) return { ok: false, reason: 'sources 为空或非法' }
  // 注意：state.sources 的键是源脚本内部 provider id（suyinKuwo 等），
  // 而 App 侧保存槽位用的是平台 id（kw/wy/tx/mg/kg）。两者不是同一命名空间，
  // 不能要求 state.sources[opts.sourceId] 存在，否则真实 App 的 kw/wy 槽位永远存不进去。
  const allowed = opts.knownSourceIds ? new Set(opts.knownSourceIds) : null
  const qualityShortCircuit = input.qualityShortCircuit === undefined ? {} : input.qualityShortCircuit
  if (!isPlainObject(qualityShortCircuit)) return { ok: false, reason: 'qualityShortCircuit 非法' }
  for (const [key, at] of Object.entries(qualityShortCircuit)) {
    const [id, quality] = String(key).split(':')
    if (!SOURCE_ID_PATTERN.test(id)) return { ok: false, reason: `qualityShortCircuit.${key} 非法` }
    if (allowed && !allowed.has(id)) return { ok: false, reason: `qualityShortCircuit.${key} 非法` }
    if (!QUALITIES.includes(quality)) return { ok: false, reason: `qualityShortCircuit.${key} 非法` }
    if (!isFiniteNumber(at) || at <= 0) return { ok: false, reason: `qualityShortCircuit.${key} 非法` }
  }
  for (const [id, item] of Object.entries(input.sources)) {
    if (!SOURCE_ID_PATTERN.test(id)) return { ok: false, reason: `源 ID 非法 ${id}` }
    if (allowed && !allowed.has(id)) return { ok: false, reason: `未知源 ${id}` }
    if (!isPlainObject(item) || !isPlainObject(item.breaker)) return { ok: false, reason: `${id}.breaker 非法` }
    if (!isPlainObject(item.byQuality)) return { ok: false, reason: `${id}.byQuality 非法` }
    if (!isPlainObject(item.playDead)) return { ok: false, reason: `${id}.playDead 非法` }
    for (const [quality, q] of Object.entries(item.byQuality)) {
      if (!QUALITIES.includes(quality) || !isPlainObject(q)) return { ok: false, reason: `${id}.byQuality.${quality} 非法` }
    }
  }
  return { ok: true, state: input as HealthState }
}

export const sourceHealthStateKey = (sourceId: string) => `${HEALTH_STATE_KEY_PREFIX}${sourceId}`

const stateFingerprint = (state: HealthState): string => {
  const copy: any = { ...state }
  delete copy.savedAt
  return JSON.stringify(copy)
}
const canonicalWriteCache = new WeakMap<object, { fingerprint: string, savedAt: number }>()
const CANONICAL_REFRESH_MS = 60 * 60 * 1000

const removeLegacyKeys = async(storage: HealthStorage): Promise<void> => {
  for (const id of HEALTH_STATE_LEGACY_SOURCE_IDS) {
    try { await storage.removeData(sourceHealthStateKey(id)) } catch (e) { /* 迁移清理失败不阻断 */ }
  }
}

const readCanonical = async(storage: HealthStorage, sourceVersion: string, now: number): Promise<HealthState | null> => {
  let raw: unknown = null
  try { raw = await storage.getData<HealthState>(HEALTH_STATE_CANONICAL_KEY) } catch (e) { return null }
  const result = sanitizeSourceHealthState(raw, { sourceVersion, now })
  if (result.ok) return result.state!
  if (raw !== null && raw !== undefined) {
    try { await storage.removeData(HEALTH_STATE_CANONICAL_KEY) } catch (e) { /* 忽略清理失败 */ }
  }
  return null
}

export const readSourceHealthState = async(storage: HealthStorage, sourceId: string, sourceVersion: string, now = Date.now()): Promise<HealthState | null> => {
  const canonical = await readCanonical(storage, sourceVersion, now)
  if (canonical) return canonical
  const key = sourceHealthStateKey(sourceId)
  let raw: unknown = null
  try {
    raw = await storage.getData<HealthState>(key)
  } catch (e) {
    return null
  }
  const result = sanitizeSourceHealthState(raw, { sourceVersion, now })
  if (result.ok) {
    // 旧平台键一次性提升为 canonical；只有写成功后才删除旧键，失败则保留可重试。
    try {
      await storage.saveData(HEALTH_STATE_CANONICAL_KEY, result.state!)
      canonicalWriteCache.set(storage, { fingerprint: stateFingerprint(result.state!), savedAt: now })
      await removeLegacyKeys(storage)
    } catch (e) { /* 迁移失败：本次仍返回内存态，下次再试 */ }
    return result.state!
  }
  if (raw !== null && raw !== undefined) {
    try { await storage.removeData(key) } catch (e) { /* 忽略删除失败，下一次读仍会拒绝 */ }
  }
  return null
}

export const writeSourceHealthState = async(storage: HealthStorage, sourceId: string, state: HealthState, now = Date.now()): Promise<boolean> => {
  const result = sanitizeSourceHealthState(state, { now })
  if (!result.ok) return false
  const fingerprint = stateFingerprint(state)
  const cached = canonicalWriteCache.get(storage)
  if (cached && fingerprint === cached.fingerprint && now - cached.savedAt < CANONICAL_REFRESH_MS) return true
  try {
    await storage.saveData(HEALTH_STATE_CANONICAL_KEY, state)
    canonicalWriteCache.set(storage, { fingerprint, savedAt: now })
    await removeLegacyKeys(storage)
    return true
  } catch (e) {
    return false
  }
}

export const restoreSourceHealth = async(
  apis: Record<string, SourceHealthApi>,
  sourceId: string,
  sourceVersion: string,
  storage: HealthStorage,
  now = Date.now(),
): Promise<RestoreResult> => {
  const state = await readSourceHealthState(storage, sourceId, sourceVersion, now)
  if (!state) return { restored: 0, reason: 'no-state' }
  const api = apis[sourceId]?.restoreHealth
  if (typeof api !== 'function') return { restored: 0, reason: 'no-action' }
  try {
    const res = await api(state).promise
    if (res && res.ok) return { restored: res.restored ?? 1 }
    return { restored: 0, reason: res?.reason ?? 'restore-rejected' }
  } catch (e: any) {
    return { restored: 0, reason: String(e?.message || e) }
  }
}

export const saveSourceHealth = async(
  apis: Record<string, SourceHealthApi>,
  sourceId: string,
  storage: HealthStorage,
  now = Date.now(),
): Promise<boolean> => {
  const api = apis[sourceId]?.exportHealth
  if (typeof api !== 'function') return false
  try {
    const state = await api().promise
    return await writeSourceHealthState(storage, sourceId, state, now)
  } catch (e) {
    return false
  }
}

// G5：生产路径不再导出固定 provider 名单/版本；源快照自带 sourceVersion，
// 源 ID 由源自身导出的 sources 键决定，宿主只做键名形态校验。
