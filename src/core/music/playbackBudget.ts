/**
 * 播放取链预算与 attempts 账本
 *
 * 外层 `online.ts` 仍有 25s 兜底；这里用 24s 预算抢在它之前给出可归因错误，
 * 避免 15s 初始化 + 12s 源内预算 = 27s 被外层改写成无源信息的 `URL获取超时(25s)`。
 */

export const PLAYBACK_BUDGET_MS = 24_000

export type PlaybackStage = 'primary' | 'fallback'
export type PlaybackOwner = 'host' | 'source'

export interface PlaybackAttempt {
  source: string
  owner: PlaybackOwner
  stage: PlaybackStage
  ok: boolean
  code: string
  latencyMs: number
}

/** 主源归谁：源声明 source 即源内换源；其余（缺省/host）由宿主兜底。 */
export const resolvePlaybackOwner = (fallbackOwner?: string): PlaybackOwner =>
  fallbackOwner === 'source' ? 'source' : 'host'

export interface PlaybackBudget {
  startedAt: number
  deadline: number
  totalMs: number
}

export const createPlaybackBudget = (now: number = Date.now(), totalMs: number = PLAYBACK_BUDGET_MS): PlaybackBudget => ({
  startedAt: now,
  deadline: now + totalMs,
  totalMs,
})

export const remainingBudgetMs = (budget: PlaybackBudget, now: number = Date.now()): number =>
  Math.max(0, budget.deadline - now)

export const isBudgetExhausted = (budget: PlaybackBudget, now: number = Date.now()): boolean =>
  remainingBudgetMs(budget, now) <= 0

export const classifyPlaybackErrorCode = (err: any): string => {
  if (err && typeof err.code === 'string' && err.code) return err.code
  const match = String(err?.message ?? '').match(/^([A-Z_]+):/)
  return match ? match[1] : 'PLAY_FAIL'
}

export const createBudgetExhaustedError = (attempts: PlaybackAttempt[]): Error => {
  const error = new Error(`BUDGET_EXHAUSTED: 取链预算耗尽(${PLAYBACK_BUDGET_MS / 1000}s)`) as Error & {
    code: string
    retryable: boolean
    attempts: PlaybackAttempt[]
  }
  error.code = 'BUDGET_EXHAUSTED'
  error.retryable = true
  error.attempts = attempts
  return error
}

/**
 * 让单个请求也受预算约束。外层 25s 是最后兜底，预算计时器必须先于它触发。
 */
export const raceWithBudget = async <T>(promise: Promise<T>, budget: PlaybackBudget, attempts: PlaybackAttempt[]): Promise<T> => {
  const remaining = remainingBudgetMs(budget)
  if (remaining <= 0) return Promise.reject(createBudgetExhaustedError(attempts))
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => { reject(createBudgetExhaustedError(attempts)) }, remaining)
      if (typeof (timer as any).unref === 'function') (timer as any).unref()
    }),
  ])
}

/**
 * 候选取链竞速：首个成功立即胜出，并逻辑取消其余候选。
 *
 * 源 SDK 的 getMusicUrl 只返回 promise，没有 abort 契约；这里的 cancel 是逻辑取消，
 * 调用方必须在每个候选的 run 内检查 isCancelled，避免晚到结果写 attempts/缓存。
 */
export interface PlaybackCandidateTask<T> {
  key: string
  run: (isCancelled: () => boolean) => Promise<T>
  cancel?: () => void
}

export interface PlaybackCandidateWinner<T> {
  key: string
  value: T
}

export const racePlaybackCandidates = async <T>(tasks: Array<PlaybackCandidateTask<T>>): Promise<PlaybackCandidateWinner<T>> => {
  if (!tasks.length) throw new Error('NO_CANDIDATE')
  return await new Promise<PlaybackCandidateWinner<T>>((resolve, reject) => {
    let settled = false
    let failed = 0
    const errors: unknown[] = []
    const states = tasks.map(() => ({ cancelled: false }))
    const finishWin = (index: number, value: T) => {
      if (settled) return
      settled = true
      states.forEach((state, i) => {
        if (i === index) return
        state.cancelled = true
        try { tasks[i].cancel?.() } catch {}
      })
      resolve({ key: tasks[index].key, value })
    }
    const finishFail = (error: unknown) => {
      if (settled) return
      errors.push(error)
      failed++
      if (failed === tasks.length) {
        settled = true
        reject(errors[errors.length - 1])
      }
    }
    tasks.forEach((task, index) => {
      Promise.resolve()
        .then(async() => await task.run(() => states[index].cancelled))
        .then(value => { finishWin(index, value) }, error => { finishFail(error) })
    })
  })
}
