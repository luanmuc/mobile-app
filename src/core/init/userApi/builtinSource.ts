export const BUILTIN_SOURCE_NAME = '豆包定制[聚合音源]'

export const BUILTIN_SOURCE_STORAGE_KEYS = {
  hasImported: 'has_imported_builtin_source',
  importedVersion: 'imported_builtin_source_version',
  sourceId: 'builtin_source_id',
} as const

const VERSION_REGEX = /@version\s+(\S+)/
const NUMERIC_VERSION_REGEX = /^\d+(?:\.\d+)*$/

export const normalizeSourceVersion = (version: string): string => {
  return version.trim().replace(/^v/i, '')
}

/**
 * 音源版本只认文件头 `@version` 的第一个 token。
 * `@description` / `logInfo` 可以带说明，不能作为版本真相来源。
 */
export const parseSourceVersion = (script: string): string => {
  const match = script.match(VERSION_REGEX)
  return match ? normalizeSourceVersion(match[1]) : ''
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

export type BuiltinSourceImportReason =
  | 'first-install'
  | 'version-upgrade'
  | 'current'
  | 'builtin-older'
  | 'unknown-version'
  | 'unmanaged'

export interface BuiltinSourceImportInput {
  canManage: boolean
  hasImported: boolean
  hasBuiltinSource: boolean
  builtinVersion: string
  importedVersion: string
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
}: BuiltinSourceImportInput): BuiltinSourceImportDecision => {
  const currentBuiltinVersion = normalizeSourceVersion(builtinVersion)
  const currentImportedVersion = normalizeSourceVersion(importedVersion)

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
