/**
 * 均衡器档位的纯计算层（零依赖，可被门禁单独编译断言）。
 *
 * 存储格式：一串逗号分隔的毫贝值，如 `"-300,0,0,200,500"`。
 * 为什么用字符串而不是数组：
 * - App 的设置项是扁平 key-value（`player.equalizer.bands`），数组会被序列化成对象；
 * - 字符串在迁移、备份、日志里都是自解释的，也不会因为「少一项」导致结构漂移。
 */

/** 面板固定 5 段（低/中低/中/中高/高）。真机的 band 数与中心频率由系统决定，可能多于 5。 */
export const EQ_BAND_COUNT = 5

/** 毫贝（millibel）。系统 Equalizer 的 getBandLevelRange() 通常是 [-1500, 1500]。 */
export const EQ_LEVEL_MIN = -1500
export const EQ_LEVEL_MAX = 1500

export const EQ_BANDS_DEFAULT = '0,0,0,0,0'

const clampLevel = (value: unknown): number => {
  const num = typeof value == 'number'
    ? value
    : typeof value == 'string'
      ? parseFloat(value)
      : NaN
  if (!Number.isFinite(num)) return 0
  if (num < EQ_LEVEL_MIN) return EQ_LEVEL_MIN
  if (num > EQ_LEVEL_MAX) return EQ_LEVEL_MAX
  return Math.round(num)
}

/** 解析成至少 EQ_BAND_COUNT 项（不足补 0，超出截断，非法项归 0） */
export const parseBands = (csv: unknown): number[] => {
  const raw = typeof csv == 'string' ? csv.split(',') : []
  const res: number[] = []
  for (let i = 0; i < EQ_BAND_COUNT; i++) res.push(clampLevel(raw[i]))
  return res
}

/** 归一化成可直接写进原生的 CSV（恒为 EQ_BAND_COUNT 项、恒在合法区间） */
export const normalizeBandsCsv = (csv: unknown): string => parseBands(csv).join(',')

/** 由电平数组生成 CSV（UI 保存时用） */
export const serializeBands = (levels: unknown[]): string => {
  const res: number[] = []
  for (let i = 0; i < EQ_BAND_COUNT; i++) res.push(clampLevel(levels[i]))
  return res.join(',')
}

/** 是否全部归零（UI 用来判断「重置」是否可用） */
export const isFlatBands = (csv: unknown): boolean => parseBands(csv).every(v => v == 0)
