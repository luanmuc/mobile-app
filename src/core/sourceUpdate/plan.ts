/**
 * 在线更新判定（v9.3-c）
 *
 * 纯函数，不碰网络/存储：给定「内置版本 / 远端版本 / 各区间配置」，算出一个明确的动作。
 * 这样版本区间语义可以被单测穷举，不需要把手机连到服务器上试。
 *
 * 区间口径（与源仓 18-health-persist 的区间判定同义）：只允许「不低于内置基线」的更新，
 * 允许小幅回退到同一兼容区间（用于修坏包），禁止跨大版本降级。
 */
/**
 * 最多允许前跳几个 minor。注意这里**不设绝对 minor 下限**：
 * 早先写过 `remote.minor < 8 拒绝`，那是 8.x 时代的口径——源仓升到 9.0.0 后
 * minor 归零，这条会把合法的新主版本直接判死。区间只按「同主版本 + 前跳幅度 + 回退范围」判。
 */
export const MAX_FORWARD_MINOR = 2

export type UpdateDecision =
  | { action: 'use-remote', reason: 'NEWER' | 'SAME_FIX' }
  | { action: 'keep-builtin', reason: 'SAME' | 'REMOTE_OLDER' | 'TOO_NEW' | 'INCOMPATIBLE' | 'NO_REMOTE' }

export interface UpdatePlanInput {
  builtinVersion: string
  remoteVersion: string | null
  /** 远端是否通过了签名验证；false 时一律不采用 */
  remoteVerified: boolean
  /** 用户开关，默认关 */
  enabled: boolean
}

const parse = (v: string): number[] | null => {
  const m = (v || '').match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const cmp = (a: number[], b: number[]): number => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

/**
 * 判定逻辑顺序很重要：先看开关、再看有无远端、再看验签，最后才比版本。
 * 验签放在版本比较之前，是因为「版本号更大的坏包」正是攻击面——版本号是签名覆盖的一部分，
 * 但不能先信版本号再决定要不要验签。
 */
export const planSourceUpdate = (input: UpdatePlanInput): UpdateDecision => {
  if (!input.enabled) return { action: 'keep-builtin', reason: 'SAME' }
  if (!input.remoteVersion) return { action: 'keep-builtin', reason: 'NO_REMOTE' }
  if (!input.remoteVerified) return { action: 'keep-builtin', reason: 'INCOMPATIBLE' }

  const builtin = parse(input.builtinVersion)
  const remote = parse(input.remoteVersion)
  if (!builtin || !remote) return { action: 'keep-builtin', reason: 'INCOMPATIBLE' }

  if (remote[0] !== builtin[0]) return { action: 'keep-builtin', reason: 'INCOMPATIBLE' }
  if (remote[1] - builtin[1] > MAX_FORWARD_MINOR) return { action: 'keep-builtin', reason: 'TOO_NEW' }

  const c = cmp(remote, builtin)
  if (c > 0) return { action: 'use-remote', reason: 'NEWER' }
  if (c === 0) return { action: 'keep-builtin', reason: 'SAME' }
  // 远端更旧：只允许同 minor 的补丁回退（修坏包场景），跨 minor 一律拒绝
  if (remote[1] === builtin[1]) return { action: 'use-remote', reason: 'SAME_FIX' }
  return { action: 'keep-builtin', reason: 'REMOTE_OLDER' }
}
