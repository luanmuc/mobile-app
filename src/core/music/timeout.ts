/**
 * raceWithTimeout：给不响应 abort 的 Promise 加一个「一定会被清理」的超时兜底。
 *
 * 为什么需要它（2026-11-16 实测校正）：`Promise.race([task, 超时])` 里 task 先胜出时，
 * race 内部已对两个入参挂了 then，超时那一路到点的 reject 会被**静默吞掉**，实测
 * 不产生 unhandledRejection（交接单原写的「未处理拒绝/崩溃」是夸大）。真实代价是：
 *   1. 定时器继续空转，占住句柄——Node 下实测进程被拖到定时器到点才退出（3s 档：3002ms vs 24ms）；
 *   2. 超时回调里的副作用会在任务完成后**再执行一次**（如 downloadManager 会再调一次
 *      stopDownload，对已完成任务发无意义调用）。
 * 所以这里在 finally 里 clearTimeout，并允许调用方在超时瞬间做副作用（如停掉底层下载）。
 *
 * 约束：延时必须由调用方以具名常量传入（门禁 G27），不要在调用点写裸数字。
 */
export interface RaceTimeoutOptions {
  message: string
  /** 超时判定瞬间、reject 之前执行的副作用（例如 stopDownload(jobId)） */
  onTimeout?: () => void
}

export const raceWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, options: RaceTimeoutOptions): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          try { options.onTimeout?.() } catch (e) {}
          reject(new Error(options.message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}
