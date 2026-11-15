export const BUILTIN_SOURCE_NAME = '豆包定制[聚合音源]'

export const BUILTIN_SOURCE_STORAGE_KEYS = {
  hasImported: 'has_imported_builtin_source',
  importedVersion: 'imported_builtin_source_version',
  sourceId: 'builtin_source_id',
  pendingSourceId: 'pending_builtin_source_id',
} as const

const HEADER_BLOCK_REGEX = /\/\*[!*][\s\S]*?\*\//
const HEADER_VERSION_LINE_REGEX = /(?:^|\n)\s*(?:\/\*[!*]?\s*)?\*?\s*@version\s+(\S+)/m
const BARE_VERSION_LINE_REGEX = /(?:^|\n)\s*(?:\/\/\s*)?@version\s+(\S+)/m
const NUMERIC_VERSION_REGEX = /^\d+(?:\.\d+)*$/

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
  | 'builtin-script'
  | 'imported-version'
  | 'active-builtin'
  | 'none'

export interface SourceUpdateBaselineInput {
  builtinScript: string
  importedVersion: string
  activeSourceName?: string
  activeScript?: string
}

export interface SourceUpdateBaselineResult {
  version: string
  source: SourceUpdateBaselineSource
}

/**
 * 在线升级的版本基线必须锚定“内置源”，不能拿当前选中的任意音源当基线。
 * 优先级：内置源脚本 → 已导入内置版本 → 名称精确匹配的内置源（迁移兜底）。
 */
export const resolveSourceUpdateBaseline = ({
  builtinScript,
  importedVersion,
  activeSourceName = '',
  activeScript = '',
}: SourceUpdateBaselineInput): SourceUpdateBaselineResult => {
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
 * - 内置版本高于已导入版本：升级。
 * - 同版本 / 内置更低 / 版本不可解析：保持现状，禁止降级。
 */
export const decideBuiltinSourceImport = ({
  canManage,
  hasImported,
  hasBuiltinSource,
  builtinVersion,
  importedVersion,
  pendingBlocked = false,
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
