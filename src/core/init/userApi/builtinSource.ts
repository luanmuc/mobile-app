export const BUILTIN_SOURCE_NAME = '豆包定制[聚合音源]'

export const BUILTIN_SOURCE_STORAGE_KEYS = {
  hasImported: 'has_imported_builtin_source',
  importedVersion: 'imported_builtin_source_version',
  sourceId: 'builtin_source_id',
  pendingSourceId: 'pending_builtin_source_id',
  // 上次同步时所在的 App 版本（1.9.2-b138）：换了包（升级/降级）就以内置音源为准
  appVersion: 'builtin_source_app_version',
  // 上次我们写进去那份脚本的指纹：对不上说明用户手动改过，不静默覆盖
  checksum: 'builtin_source_checksum',
} as const

const HEADER_BLOCK_REGEX = /\/\*[!*][\s\S]*?\*\//
const HEADER_VERSION_LINE_REGEX = /(?:^|\n)\s*(?:\/\*[!*]?\s*)?\*?\s*@version\s+(\S+)/m
const BARE_VERSION_LINE_REGEX = /(?:^|\n)\s*(?:\/\/\s*)?@version\s+(\S+)/m
const NUMERIC_VERSION_REGEX = /^\d+(?:\.\d+)*$/

export interface BuiltinTargetSource {
  id: string
  name: string
}

export type BuiltinTargetReason = 'stored-id' | 'active-named' | 'named-unique' | 'none' | 'ambiguous'

export interface BuiltinTargetResult {
  targetId: string
  canManage: boolean
  reason: BuiltinTargetReason
}

/**
 * 定位“要覆盖/升级的那一份内置源”。
 *
 * 更新必须是**就地覆盖**，所以目标必须是唯一的：
 * - 有 id 标记：认 id（用户改名也不影响）；
 * - 无标记且同名唯一：认为那一份（兼容旧数据迁移）；
 * - 无标记且存在多份同名：只在其中一份**正在启用**时才认它（音源同时只能启用一个，
 *   未启用的同名旧版属于用户手动导入，不动）；启用的是别的源就放弃，绝不猜。
 */
export const resolveBuiltinTarget = ({
  storedId,
  activeId,
  list,
  builtinName,
}: {
  storedId: string
  activeId: string
  list: BuiltinTargetSource[]
  builtinName: string
}): BuiltinTargetResult => {
  const named = list.filter(api => api.name === builtinName)

  // 1) 启用份优先：用户手动启用了另一份同名源时，要覆盖的是他正在用的那份，
  //    不能被 builtin_source_id 标记带到“没启用的那份”上去（否则他永远停在旧版）。
  const activeNamed = named.find(api => api.id === activeId)
  if (activeNamed) {
    return { targetId: activeNamed.id, canManage: true, reason: named.length > 1 ? 'active-named' : 'named-unique' }
  }

  // 2) 没有启用同名源时，才按 id 标记认内置源（用户改名也能认）
  if (storedId && list.some(api => api.id === storedId)) {
    return { targetId: storedId, canManage: true, reason: 'stored-id' }
  }

  if (named.length === 0) return { targetId: '', canManage: !storedId, reason: 'none' }
  if (named.length === 1) return { targetId: named[0].id, canManage: true, reason: 'named-unique' }

  // 3) 多份同名且启用的不是它们：不猜、不冒险
  return { targetId: '', canManage: false, reason: 'ambiguous' }
}

export type OverwritableInfoKey = 'name' | 'version' | 'description' | 'author' | 'homepage'

/**
 * 就地覆盖时的元信息合并：id 与“是否弹更新提醒”必须沿用原值，
 * 否则覆盖等于新建一份（用户会看到两份同名源），或把用户关掉的提醒又打开。
 */
export const buildOverwrittenApiInfo = <T extends { id: string, allowShowUpdateAlert?: boolean }>(
  prev: T,
  parsed: Partial<Record<OverwritableInfoKey, string>>,
): T => {
  const next: Record<string, unknown> = { ...prev }
  for (const key of ['name', 'version', 'description', 'author', 'homepage'] as const) {
    const value = parsed[key]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value != null && value !== '') next[key] = value
  }
  next.id = prev.id
  next.allowShowUpdateAlert = prev.allowShowUpdateAlert
  return next as unknown as T
}

export const normalizeSourceVersion = (version: string): string => {
  return version.trim().replace(/^v/i, '')
}

/**
 * 音源版本只认文件头注释块里的 `@version` 第一个 token。
 * 没有文件头时才回退到行首 `@version` / `// @version`；
 * `@description`、普通注释、日志里的假版本都不能抢先。
 */
export const parseSourceVersion = (script: string): string => {
  const header = script.match(HEADER_BLOCK_REGEX)?.[0]
  if (header) {
    const headerMatch = header.match(HEADER_VERSION_LINE_REGEX)
    return headerMatch ? normalizeSourceVersion(headerMatch[1]) : ''
  }

  const bareMatch = script.match(BARE_VERSION_LINE_REGEX)
  return bareMatch ? normalizeSourceVersion(bareMatch[1]) : ''
}

/**
 * 返回 left 相对 right 的比较结果；版本不合法时返回 null。
 * 8.15.0 > 8.14.1，8.15 == 8.15.0。
 */
export const compareSourceVersions = (left: string, right: string): number | null => {
  const a = normalizeSourceVersion(left)
  const b = normalizeSourceVersion(right)
  if (!NUMERIC_VERSION_REGEX.test(a) || !NUMERIC_VERSION_REGEX.test(b)) return null

  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const ai = aParts[i] ?? 0
    const bi = bParts[i] ?? 0
    if (ai !== bi) return ai > bi ? 1 : -1
  }
  return 0
}

export type SourceUpdateBaselineSource =
  | 'target-script'
  | 'builtin-script'
  | 'imported-version'
  | 'active-builtin'
  | 'none'

export interface SourceUpdateBaselineInput {
  builtinScript: string
  importedVersion: string
  activeSourceName?: string
  activeScript?: string
  /** 真正会被就地覆盖的那份脚本（优先级最高） */
  targetScript?: string
}

export interface SourceUpdateBaselineResult {
  version: string
  source: SourceUpdateBaselineSource
}

/**
 * 在线升级的版本基线必须锚定“内置源”，不能拿当前选中的任意音源当基线。
 * 优先级：将被覆盖那份的脚本 → 内置源脚本 → 已导入内置版本 → 名称精确匹配的内置源（迁移兜底）。
 */
export const resolveSourceUpdateBaseline = ({
  builtinScript,
  importedVersion,
  activeSourceName = '',
  activeScript = '',
  targetScript = '',
}: SourceUpdateBaselineInput): SourceUpdateBaselineResult => {
  // 覆盖前的“本地版本”必须是**将被覆盖那份**的版本：拿另一份同名源的版本比较，
  // 会出现“标记份 8.16 挡住启用份 8.15.1 的升级”，或把 8.15.1 → 8.15.5 误判成降级。
  const targetVersion = parseSourceVersion(targetScript)
  if (NUMERIC_VERSION_REGEX.test(targetVersion)) {
    return { version: targetVersion, source: 'target-script' }
  }

  const builtinVersion = parseSourceVersion(builtinScript)
  if (NUMERIC_VERSION_REGEX.test(builtinVersion)) {
    return { version: builtinVersion, source: 'builtin-script' }
  }

  const imported = normalizeSourceVersion(importedVersion)
  if (NUMERIC_VERSION_REGEX.test(imported)) {
    return { version: imported, source: 'imported-version' }
  }

  if (activeSourceName === BUILTIN_SOURCE_NAME) {
    const activeVersion = parseSourceVersion(activeScript)
    if (NUMERIC_VERSION_REGEX.test(activeVersion)) {
      return { version: activeVersion, source: 'active-builtin' }
    }
  }

  return { version: '', source: 'none' }
}

export type PendingBuiltinSwitchAction =
  | 'none'
  | 'promote-active'
  | 'block-import'
  | 'clear-stale'

export interface PendingBuiltinSwitchInput {
  pendingSourceId: string
  sourceIds: string[]
  activeSourceId: string
  pendingVersion: string
}

export interface PendingBuiltinSwitchDecision {
  action: PendingBuiltinSwitchAction
  promoteVersion: string
}

/**
 * 在线升级“导入成功但切源结果不确定”的启动对账：
 * - 待切换源已是当前选中源：视为迟到成功，提升为内置源；
 * - 待切换源还在但未选中：保留孤儿源，阻止启动再次导入；
 * - 待切换源已被用户删除：清掉 pending，恢复正常升级流程。
 */
export const decidePendingBuiltinSwitch = ({
  pendingSourceId,
  sourceIds,
  activeSourceId,
  pendingVersion,
}: PendingBuiltinSwitchInput): PendingBuiltinSwitchDecision => {
  const id = pendingSourceId.trim()
  if (!id) return { action: 'none', promoteVersion: '' }
  if (!sourceIds.includes(id)) return { action: 'clear-stale', promoteVersion: '' }

  const version = normalizeSourceVersion(pendingVersion)
  if (activeSourceId === id && NUMERIC_VERSION_REGEX.test(version)) {
    return { action: 'promote-active', promoteVersion: version }
  }

  return { action: 'block-import', promoteVersion: '' }
}

export type BuiltinSourceImportReason =
  | 'first-install'
  | 'app-version-sync'
  | 'target-modified'
  | 'version-upgrade'
  | 'current'
  | 'builtin-older'
  | 'unknown-version'
  | 'pending-switch'
  | 'unmanaged'

export interface BuiltinSourceImportInput {
  canManage: boolean
  hasImported: boolean
  hasBuiltinSource: boolean
  builtinVersion: string
  importedVersion: string
  pendingBlocked?: boolean
  /** 当前运行 App 的版本（1.9.2-b138） */
  appVersion?: string
  /** 上次同步时记录的 App 版本；为空表示老数据 */
  importedAppVersion?: string
  /** 目标脚本与上次写入的指纹不一致（用户改过）；无基线时为 false */
  targetModified?: boolean
}

export interface BuiltinSourceImportDecision {
  shouldImport: boolean
  reason: BuiltinSourceImportReason
  builtinVersion: string
  importedVersion: string
}

/**
 * 内置源导入决策：
 * - 首次安装：导入。
 * - 换了 App 版本（升/降）、或没有 App 版本标记：以内置源为准（app-version-sync）。
 * - 同一个包内：内置版本高于已导入版本才升级，内置更低/同版本保持现状（保住在线更新结果）。
 * - 版本不可解析：不动。
 */
export const decideBuiltinSourceImport = ({
  canManage,
  hasImported,
  hasBuiltinSource,
  builtinVersion,
  importedVersion,
  pendingBlocked = false,
  appVersion = '',
  importedAppVersion = '',
  targetModified = false,
}: BuiltinSourceImportInput): BuiltinSourceImportDecision => {
  const currentBuiltinVersion = normalizeSourceVersion(builtinVersion)
  const currentImportedVersion = normalizeSourceVersion(importedVersion)

  if (pendingBlocked) {
    return { shouldImport: false, reason: 'pending-switch', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  if (!canManage) {
    return { shouldImport: false, reason: 'unmanaged', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  if (!hasImported && !hasBuiltinSource) {
    return { shouldImport: true, reason: 'first-install', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  if (!currentBuiltinVersion) {
    return { shouldImport: false, reason: 'unknown-version', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  // 用户手动改过的同名源不静默覆盖（否则改动直接丢失）：留给他自己决定
  if (targetModified) {
    return { shouldImport: false, reason: 'target-modified', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  // 音源跟着包走：换了 App 版本（升级或降级都算），或老数据没有版本标记时，
  // 一律以内置音源为准——这是“降级 App 后音源也得覆盖”的唯一入口。
  if (appVersion && appVersion !== importedAppVersion) {
    return { shouldImport: true, reason: 'app-version-sync', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  if (!currentImportedVersion) {
    return { shouldImport: true, reason: 'version-upgrade', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  const comparison = compareSourceVersions(currentBuiltinVersion, currentImportedVersion)
  if (comparison == null) {
    return { shouldImport: false, reason: 'unknown-version', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  if (comparison > 0) {
    return { shouldImport: true, reason: 'version-upgrade', builtinVersion: currentBuiltinVersion, importedVersion: currentImportedVersion }
  }

  return {
    shouldImport: false,
    reason: comparison < 0 ? 'builtin-older' : 'current',
    builtinVersion: currentBuiltinVersion,
    importedVersion: currentImportedVersion,
  }
}

/**
 * 脚本指纹：长度 + FNV-1a 32 位散列。
 * 不依赖任何库（纯函数，可被 TS 门禁加载），用来判断“这份脚本还是不是我们上次写进去的那份”。
 */
export const hashScript = (script: string): string => {
  if (!script) return ''
  let h = 0x811c9dc5
  for (let i = 0; i < script.length; i++) {
    h ^= script.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return `${script.length.toString(16)}-${(h >>> 0).toString(16)}`
}

/**
 * 目标脚本是否被用户改过。
 * 没有基线（老数据）时一律视为未改过——否则老设备会被永久挡住，永远停在旧版。
 */
export const isScriptModified = (storedChecksum: string, currentChecksum: string): boolean => {
  if (!storedChecksum || !currentChecksum) return false
  return storedChecksum !== currentChecksum
}
