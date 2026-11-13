/**
 * F19/F60：健康页 API 绑定。
 *
 * 旧实现用 `Object.keys(apis).find(...)` 取第一个声明 action 的音源，
 * 多源同时声明时，toggle/probeSource 可能打到不相干的 API。
 * 这里按 provider 的 platforms 顺序优先绑定；没有匹配才回退第一个声明者。
 * 纯函数，不依赖 React / RN。
 */

export type HealthSourceAction = 'getHealth' | 'toggle' | 'probe' | 'probeSource' | 'config' | 'trend' | 'healthEvents'

export interface HealthSourceBinding {
  sourceId: string
  action: HealthSourceAction
  matched: 'platform' | 'explicit' | 'fallback'
}

type ApiMap = Record<string, Record<string, unknown> | undefined>

export const bindHealthSource = (
  apis: ApiMap | null | undefined,
  action: HealthSourceAction,
  sourceId?: string,
  platforms?: string[],
): HealthSourceBinding | null => {
  if (!apis) return null
  const has = (id: string) => typeof apis[id]?.[action] === 'function'
  if (sourceId && has(sourceId)) return { sourceId, action, matched: 'explicit' }
  for (const platform of platforms ?? []) {
    if (platform && has(platform)) return { sourceId: platform, action, matched: 'platform' }
  }
  const fallback = Object.keys(apis).find(id => has(id))
  return fallback ? { sourceId: fallback, action, matched: 'fallback' } : null
}
