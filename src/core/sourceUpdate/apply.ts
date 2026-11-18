/**
 * 把在线更新结果落进 App 的音源库（v9.3-d）
 *
 * 这一层只做「验过的包怎么落地」，判定与下载都在 fetcher/plan 里。
 * 依赖全部注入（覆盖/新增/读内置版本），这样「未验签的包绝不落地」这条规则
 * 能被单测直接证明，而不需要连真机。
 *
 * 落地策略与既有导入管线一致：**就地覆盖同一 id**，不新增副本、不改 id——
 * 否则用户会看到音源列表里凭空多出一份，选中状态也会漂。
 */
import { fetchAndVerifySource, type HttpGet, type FetchSourceResult } from './fetcher'

export interface ApplySourceUpdateDeps {
  baseUrl: string
  get: HttpGet
  enabled: boolean
  /** 当前内置包版本（从 assets 里的 @version 解析） */
  builtinVersion: string
  /** 已定位到的内置源 id；无则说明库里还没有，需要新增 */
  builtinSourceId: string | null
  overwrite: (id: string, script: string) => Promise<unknown>
  add: (script: string) => Promise<{ id: string }>
}

export interface ApplySourceUpdateResult {
  action: 'overwritten' | 'added' | 'skipped'
  reason: string
  version?: string
  sourceId?: string
  fetch: FetchSourceResult | null
}

export const applySourceUpdate = async(deps: ApplySourceUpdateDeps): Promise<ApplySourceUpdateResult> => {
  const fetched = await fetchAndVerifySource({
    baseUrl: deps.baseUrl,
    get: deps.get,
    builtinVersion: deps.builtinVersion,
    enabled: deps.enabled,
  })

  if (!fetched || fetched.decision.action !== 'use-remote' || !fetched.script) {
    return {
      action: 'skipped',
      reason: fetched ? fetched.reason ?? fetched.decision.reason : 'NO_RESULT',
      fetch: fetched ?? null,
    }
  }

  const version = fetched.manifest ? fetched.manifest.version : undefined

  if (deps.builtinSourceId) {
    await deps.overwrite(deps.builtinSourceId, fetched.script)
    return {
      action: 'overwritten',
      reason: fetched.decision.reason,
      version,
      sourceId: deps.builtinSourceId,
      fetch: fetched,
    }
  }

  const created = await deps.add(fetched.script)
  return {
    action: 'added',
    reason: fetched.decision.reason,
    version,
    sourceId: created.id,
    fetch: fetched,
  }
}

export interface RestoreBuiltinDeps {
  /** 读 App assets 里的内置包（真机走 react-native-fs，测试可注入） */
  readBuiltinScript: () => Promise<string>
  /** 已定位到的内置源 id；为 null 说明库里还没有，不能"回滚出"一份新源 */
  builtinSourceId: string | null
  overwrite: (id: string, script: string) => Promise<unknown>
}

export interface RestoreBuiltinResult {
  ok: boolean
  reason: 'RESTORED' | 'NO_TARGET' | 'BUILTIN_UNREADABLE' | 'BUILTIN_TOO_SHORT'
}

/**
 * 回滚到内置版：在线包把播放搞坏时的安全阀。
 * 刻意要求「已有内置源 id」——没有目标时回滚等于凭空新增一份音源，
 * 那会把用户的列表搞乱，宁可失败并让用户手动处理。
 */
export const restoreBuiltinSource = async(deps: RestoreBuiltinDeps): Promise<RestoreBuiltinResult> => {
  if (!deps.builtinSourceId) return { ok: false, reason: 'NO_TARGET' }
  let script = ''
  try {
    script = await deps.readBuiltinScript()
  } catch {
    return { ok: false, reason: 'BUILTIN_UNREADABLE' }
  }
  if (!script || script.length < 1000) return { ok: false, reason: 'BUILTIN_TOO_SHORT' }
  await deps.overwrite(deps.builtinSourceId, script)
  return { ok: true, reason: 'RESTORED' }
}
