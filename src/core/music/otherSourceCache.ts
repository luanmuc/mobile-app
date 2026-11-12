/**
 * 跨平台候选搜索缓存。
 *
 * 纯函数 + 显式 now，便于假时钟测试；`utils.getOtherSource` 只负责稳定 key 与
 * “正向 5min / 负向 60s” TTL 选择。
 */

export const OTHER_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000
export const OTHER_SOURCE_NEGATIVE_TTL_MS = 60 * 1000
export const OTHER_SOURCE_CACHE_CAPACITY = 50

export interface OtherSourceCacheEntry<T> {
  value: T
  expiresAt: number
}

export const createOtherSourceCache = <T>(): Map<string, OtherSourceCacheEntry<T>> => new Map()

export const readOtherSourceCache = <T>(
  cache: Map<string, OtherSourceCacheEntry<T>>,
  key: string,
  now: number,
): T | undefined => {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return undefined
  }
  // 命中即刷新 recency；Map 的插入顺序就是 LRU 顺序。
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

export const writeOtherSourceCache = <T>(
  cache: Map<string, OtherSourceCacheEntry<T>>,
  key: string,
  value: T,
  now: number,
  ttlMs: number,
): void => {
  if (!(ttlMs > 0)) {
    cache.delete(key)
    return
  }
  cache.delete(key)
  cache.set(key, { value, expiresAt: now + ttlMs })
  while (cache.size > OTHER_SOURCE_CACHE_CAPACITY) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}
