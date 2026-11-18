import TrackPlayer from 'react-native-track-player'
import { buildFadeSteps, FADE_STEP_MS } from './volumeFadeCurve'

// ─────────────────────────────────────────────────────────────────────────────
// 单例渐变控制器。全 App 只允许一条渐变链存在，任何新渐变都会先作废旧链。
//
// 为什么必须是单例（不是理论洁癖）：
// 上游 SimpMusic 在 SleepFadeAudioProcessor.kt 的类注释里写明了同一个坑——交叉淡化
// "自己拥有 player.volume，并在每次过渡中改写它五十次"，任何共用这条音量线的功能
// "要么被覆盖，要么必须折进每一次写入"。我们没有第二条音频管线，所以只能用
// "单一写入者 + 用户操作优先作废"来等效规避。
//
// 为什么渐变不调用 utils.setVolume：
// utils.setVolume 里会 cancelVolumeFade()（用户改音量优先），渐变若走它就会取消自己。
// 因此依赖方向固定为 utils.setVolume → volumeFade.cancel，本文件不再反向依赖 utils，
// 只自己判一次 isReady()（避免循环依赖，也避免初始化窗口内被误写）。
// ─────────────────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0
let fading = false
let pendingResolve: (() => void) | null = null

const isReady = () => global.lx.playerStatus.isInitialized

const stop = () => {
  generation++
  fading = false
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  // 必须把等待中的 Promise 放掉，否则 clearTimeout 之后它会永远悬挂
  if (pendingResolve != null) {
    const resolve = pendingResolve
    pendingResolve = null
    resolve()
  }
}

/** 是否有渐变正在进行（调试/断言用） */
export const isFadingVolume = () => fading

/** 取消进行中的渐变。用户手动改音量、切歌被中断、服务销毁时都要调。 */
export const cancelVolumeFade = () => {
  if (!fading && timer == null) return
  stop()
}

/**
 * 从 from 线性渐变到 to，总时长 ms。
 * ms = 0 时立刻写一帧（用于"先静音再起播"）。
 * 返回的 Promise 在链完成或被取消时都 resolve —— 调用方不必区分。
 */
export const fadeVolumeTo = async(from: number, to: number, ms: number): Promise<void> => {
  stop()
  if (!isReady()) return Promise.resolve()

  const gen = generation
  const steps = buildFadeSteps(from, to, ms)
  if (steps.length === 1) {
    void TrackPlayer.setVolume(steps[0].volume)
    return Promise.resolve()
  }

  fading = true
  return new Promise<void>((resolve) => {
    let i = 0
    const finish = () => {
      if (pendingResolve === finish) pendingResolve = null
      resolve()
    }
    pendingResolve = finish

    const tick = () => {
      if (gen !== generation) { finish(); return } // 被取消 / 被新链取代
      if (!isReady()) { stop(); finish(); return } // 服务没了，别往原生写
      const step = steps[i]
      void TrackPlayer.setVolume(step.volume)
      i++
      if (i >= steps.length) {
        timer = null
        fading = false
        if (pendingResolve === finish) pendingResolve = null
        resolve()
        return
      }
      timer = setTimeout(tick, FADE_STEP_MS)
    }
    tick()
  })
}

/**
 * 切歌：淡出 → 切换 → 淡入。
 * 切换抛错时也要把淡入跑完，否则音量会永久停在 0（这是最容易漏的一条）。
 */
export const withTrackChangeFade = async(
  fadeMs: number,
  targetVolume: number,
  switchTrack: () => Promise<void>,
): Promise<void> => {
  if (!fadeMs || !isReady()) return switchTrack()
  await fadeVolumeTo(targetVolume, 0, fadeMs)
  try {
    await switchTrack()
  } finally {
    await fadeVolumeTo(0, targetVolume, fadeMs)
  }
}

/** 恢复播放：先置 0（避免起播瞬间的爆音）→ 起播 → 淡入到设置音量 */
export const withResumeFade = async(
  fadeMs: number,
  targetVolume: number,
  resume: () => Promise<void> | void,
): Promise<void> => {
  if (!fadeMs || !isReady()) { await resume(); return }
  await fadeVolumeTo(targetVolume, 0, 0)
  try {
    await resume()
  } finally {
    await fadeVolumeTo(0, targetVolume, fadeMs)
  }
}

/**
 * 睡眠定时到点前的渐弱。
 * from 由调用方传入（读设置值），因为本文件不碰 store。
 */
export const fadeOutForSleep = (fadeMs: number, from: number): void => {
  if (!fadeMs || !isReady()) return
  void fadeVolumeTo(from, 0, fadeMs)
}
