/**
 * 音高（pitch）取值域与夹取。
 *
 * 为什么单独抽一个零依赖模块：
 * - 渐变/音高这类"数值边界"逻辑最容易在改动时被悄悄放宽（比如把 2.0 写成 20），
 *   抽出来后门禁可以单独编译它跑数值断言，不依赖 RN 运行时。
 * - ExoPlayer 的 PlaybackParameters.pitch 要求 > 0；这里是产品口径，不是内核口径。
 *
 * 口径（与播放速率滑块一致，便于用户理解）：
 * - 50% ~ 200%（0.5 ~ 2.0），1.0 为原速原调。
 * - 非法值（NaN / 负数 / 字符串脏值）一律回落到 1.0，绝不把 NaN 写进原生。
 */
export const PITCH_MIN = 0.5
export const PITCH_MAX = 2
export const PITCH_DEFAULT = 1

export const normalizePitch = (pitch: unknown): number => {
  const num = typeof pitch == 'number'
    ? pitch
    : typeof pitch == 'string'
      ? parseFloat(pitch)
      : NaN
  if (!Number.isFinite(num)) return PITCH_DEFAULT
  if (num < PITCH_MIN) return PITCH_MIN
  if (num > PITCH_MAX) return PITCH_MAX
  return num
}

/** 是否为默认音高（面板上用来判断要不要显示「重置」的高亮态） */
export const isDefaultPitch = (pitch: unknown): boolean => normalizePitch(pitch) == PITCH_DEFAULT
