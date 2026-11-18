// 纯计算层：不 import React Native / TrackPlayer，也不碰任何 store。
// 这样 scripts/check_volume_fade.js 可以用 tsc 单独编译本文件后在 Node 里跑断言。
// 控制器（定时器、取消、generation）在 volumeFade.ts，本文件只回答"第几帧该是多少音量"。

/** 每帧间隔。JS→原生每次 setVolume 都是一次异步跨 bridge 调用，做不到 60fps；
 *  60ms 是实测听感与调用次数之间的折中（300ms → 5 帧）。 */
export const FADE_STEP_MS = 60

/** 默认时长（设置项非法/缺失时的回落值） */
export const FADE_DEFAULT_MS = 300

/** 允许的时长档位；设置里只能选这些值，避免出现 37ms 这种既听不出又难复现的配置 */
export const FADE_CHOICES_MS = [150, 300, 500]

export interface FadeStep {
  /** 距渐变开始的毫秒数 */
  at: number
  /** 该帧应写入的音量（0–1） */
  volume: number
}

/** 把设置项里的值收敛到合法档位；数字字符串也接受（AsyncStorage 回读可能是 string） */
export const normalizeFadeMs = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return FADE_CHOICES_MS.includes(n) ? n : FADE_DEFAULT_MS
}

/** 线性插值；progress 夹在 [0,1]，越界不抛错（定时器抖动导致的 >1 直接当终点） */
export const computeFadeVolume = (from: number, to: number, progress: number): number => {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress
  return from + (to - from) * p
}

/**
 * 生成渐变帧序列。
 * 关键不变量（由 check_volume_fade.js 断言）：
 * - 末帧 volume 精确等于 to（用 i/steps 而不是 at/total，避免最后一次落在 0.998）
 * - 从 from 到 to 单调（同向）
 * - ms = 0 时只有 1 帧且立刻到 to
 * - 帧数 = ceil(ms / FADE_STEP_MS)，至少 1
 */
export const buildFadeSteps = (from: number, to: number, ms: number): FadeStep[] => {
  const total = ms > 0 ? ms : 0
  const steps = Math.max(1, Math.ceil(total / FADE_STEP_MS))
  const out: FadeStep[] = []
  for (let i = 1; i <= steps; i++) {
    out.push({
      at: Math.min(total, i * FADE_STEP_MS),
      volume: computeFadeVolume(from, to, i / steps),
    })
  }
  return out
}
