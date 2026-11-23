/**
 * 播放页/通知栏音源标签拼装。
 *
 * v8.12.0 起音源返回 sourcePlatform（实际交付平台），标签优先显示实际平台；
 * 旧音源没有该字段时，回退到歌曲主平台，保持旧行为。
 */
export type PlatformNameKey =
  | 'source_real_all'
  | 'source_real_au'
  | 'source_real_bd'
  | 'source_real_kg'
  | 'source_real_kw'
  | 'source_real_mg'
  | 'source_real_tx'
  | 'source_real_wy'

const PLATFORM_NAME_KEYS: Record<string, PlatformNameKey> = {
  all: 'source_real_all',
  au: 'source_real_au',
  bd: 'source_real_bd',
  kg: 'source_real_kg',
  kw: 'source_real_kw',
  mg: 'source_real_mg',
  tx: 'source_real_tx',
  wy: 'source_real_wy',
}

/** 已知平台 → i18n key；未知平台返回空串，由调用方回退平台 id */
export const getPlatformNameKey = (platform: string | null | undefined): PlatformNameKey | '' => {
  const value = String(platform ?? '').trim()
  if (!value || value === 'local') return ''
  return PLATFORM_NAME_KEYS[value] ?? ''
}

export const resolvePlayPlatform = (
  playSource: { platform?: string } | null | undefined,
  fallbackPlatform: string | null | undefined,
) => {
  const platform = playSource?.platform
  if (platform) return platform
  return fallbackPlatform ?? ''
}

export const resolvePlatformName = (
  platform: string | null | undefined,
  translatedName?: string,
) => {
  const value = String(platform ?? '').trim()
  if (!value || value === 'local') return ''
  return translatedName !== undefined && translatedName !== '' ? translatedName : value
}

export const buildSourceLabel = (platformName?: string, sourceName?: string, fragment?: boolean) => {
  const platform = String(platformName ?? '').trim()
  const source = String(sourceName ?? '').trim()
  const base = (source && platform && source !== platform) ? `${platform} · ${source}` : (source !== '' ? source : platform)
  if (fragment && base && !base.includes('试听')) return `${base} · 试听`
  return base
}
