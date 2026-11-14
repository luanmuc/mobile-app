// 下载文件名模板：结构化占位符 + 旧中文模板迁移。
// 旧版本把「歌名」「歌手」当占位符，切语言后无法本地化；这里统一转成
// {title}/{artist}，显示层按当前语言渲染，存储与构建逻辑只认 token。
export const DEFAULT_FILE_NAME_TEMPLATE = '{title} - {artist}'

const LEGACY_TITLE = /歌名/g
const LEGACY_ARTIST = /歌手/g
const HAS_TOKEN_RXP = /\{(title|artist)\}/

export const normalizeFileNameTemplate = (template?: string | null): string => {
  const raw = String(template ?? '').trim()
  if (!raw) return DEFAULT_FILE_NAME_TEMPLATE
  const converted = raw.replace(LEGACY_TITLE, '{title}').replace(LEGACY_ARTIST, '{artist}')
  return HAS_TOKEN_RXP.test(converted) ? converted : DEFAULT_FILE_NAME_TEMPLATE
}

export const hasFileNameToken = (template?: string | null): boolean => {
  const raw = String(template ?? '').trim()
  return HAS_TOKEN_RXP.test(raw.replace(LEGACY_TITLE, '{title}').replace(LEGACY_ARTIST, '{artist}'))
}

export const formatFileNameTemplate = (
  template: string | null | undefined,
  musicInfo: { name?: string | null, singer?: string | null },
): string => {
  return normalizeFileNameTemplate(template)
    .replace(/\{title\}/g, musicInfo.name ?? '')
    .replace(/\{artist\}/g, musicInfo.singer ?? '')
}
