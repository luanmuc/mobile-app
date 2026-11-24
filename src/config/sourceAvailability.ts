/**
 * 音源可用性开关（R89）
 *
 * Audius（`au`）上游对 UA / 请求形态 / 节点分层：固定探针曲 + Range 1KB 能过，
 * 真实整段播放却会撞 502。2026-11-24 决定默认把 au 从用户可见的搜索与播放链路下线，
 * 不做“其他源失败后再试 au”的兜底；适配器代码与开关保留，等上游稳定后按受控方式接回。
 *
 * 注意：不要把 AUDIUS_SEARCH_ENABLED 单独打开。搜索会返回 au 曲目，但播放关闭时
 * 用户点进去只会得到“该音源已暂时下线”；若要做“只搜不播”，必须同时补不可播标识/
 * 非默认分组/点击换源，否则等于制造死链。
 */
export const AUDIUS_SEARCH_ENABLED: boolean = false
export const AUDIUS_PLAYBACK_ENABLED: boolean = false

export type SourceCapability = 'search' | 'playback'

export const isSourceEnabled = (source: string, capability: SourceCapability): boolean => {
  if (source !== 'au') return true
  return capability === 'search' ? AUDIUS_SEARCH_ENABLED : AUDIUS_PLAYBACK_ENABLED
}

export const isSearchSourceEnabled = (source: string): boolean => isSourceEnabled(source, 'search')

export const isPlaybackSourceEnabled = (source: string): boolean => isSourceEnabled(source, 'playback')
