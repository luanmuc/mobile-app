#!/usr/bin/env node
/**
 * 音源管理内置/在线升级逻辑回归。
 *
 * 锁住三件事：
 *   1. 内置源与在线升级都只从 `@version` 首 token 取版本；
 *   2. b131 的 imported=8.14.1 状态遇到 b132 内置 8.15.0 必须升级；
 *   3. 在线升到更高版本后，较旧 APK 内置源不得反向覆盖。
 *
 * 用法：node scripts/check_source_update_logic.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch {
  ts = require('typescript')
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // 仅加载本仓受控 TS 模块，不执行外部输入
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

let failures = 0
let checks = 0
const run = (name, fn) => {
  try {
    fn()
    checks++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}

const LOGIC = () => loadTs('src/core/init/userApi/builtinSource.ts')
const B132_SCRIPT = `/*!
 * @name 豆包定制[聚合音源]
 * @description v8.15.0 预算边界与归因版
 * @version 8.15.0
 * @author 豆包定制
 */`

console.log('\n[版本解析]')

run('U1 从 @version 读取版本，不依赖 @description 或 logInfo', () => {
  const { parseSourceVersion } = LOGIC()
  assert.strictEqual(parseSourceVersion(B132_SCRIPT), '8.15.0')
  assert.strictEqual(parseSourceVersion('/*! @version 8.14.1 */'), '8.14.1')
})

run('U2 去掉 v 前缀，兼容 v8.15.0 写法', () => {
  const { parseSourceVersion, normalizeSourceVersion } = LOGIC()
  assert.strictEqual(parseSourceVersion('@version v8.15.0'), '8.15.0')
  assert.strictEqual(normalizeSourceVersion(' v8.15.0 '), '8.15.0')
})

run('U3 缺少 @version 返回空串，不能把说明当版本', () => {
  const { parseSourceVersion } = LOGIC()
  assert.strictEqual(parseSourceVersion('@name 豆包定制[聚合音源]\n@description v8.15.0'), '')
})

console.log('\n[版本比较]')

run('U4 8.15.0 > 8.14.1；8.15 == 8.15.0', () => {
  const { compareSourceVersions } = LOGIC()
  assert.strictEqual(compareSourceVersions('8.15.0', '8.14.1'), 1)
  assert.strictEqual(compareSourceVersions('8.15', '8.15.0'), 0)
  assert.strictEqual(compareSourceVersions('8.14.1', '8.15.0'), -1)
})

run('U5 非法版本返回 null，不能误判为升级', () => {
  const { compareSourceVersions } = LOGIC()
  assert.strictEqual(compareSourceVersions('8.15.0', 'unknown'), null)
  assert.strictEqual(compareSourceVersions('8.15.0', ''), null)
})

console.log('\n[升级决策]')

run('U6 全新安装：无内置源导入', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: false, hasBuiltinSource: false, builtinVersion: '8.15.0', importedVersion: '' })
  assert.strictEqual(d.shouldImport, true)
  assert.strictEqual(d.reason, 'first-install')
})

run('U7 b131 状态 imported=8.14.1 + b132 内置 8.15.0 必须升级', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: true, hasBuiltinSource: true, builtinVersion: '8.15.0', importedVersion: '8.14.1' })
  assert.strictEqual(d.shouldImport, true)
  assert.strictEqual(d.reason, 'version-upgrade')
})

run('U8 同版本不重复导入', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: true, hasBuiltinSource: true, builtinVersion: '8.15.0', importedVersion: '8.15.0' })
  assert.strictEqual(d.shouldImport, false)
  assert.strictEqual(d.reason, 'current')
})

run('U9 在线升到 8.16.0 后，旧 APK 内置 8.15.0 不得降级', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: true, hasBuiltinSource: true, builtinVersion: '8.15.0', importedVersion: '8.16.0' })
  assert.strictEqual(d.shouldImport, false)
  assert.strictEqual(d.reason, 'builtin-older')
})

run('U10 内置版本不可解析时不自动覆盖现有源', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: true, hasBuiltinSource: true, builtinVersion: '', importedVersion: '8.15.0' })
  assert.strictEqual(d.shouldImport, false)
  assert.strictEqual(d.reason, 'unknown-version')
})

console.log('\n[接线静态锁]')

run('U11 启动导入使用共享解析，不再保留旧「聚合音源 v」正则', () => {
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(index.includes('parseSourceVersion'), 'index.ts 未使用 parseSourceVersion')
  assert.ok(index.includes('decideBuiltinSourceImport'), 'index.ts 未使用 decideBuiltinSourceImport')
  assert.ok(!index.includes('聚合音源\\s*v'), 'index.ts 仍残留旧版本正则')
})

run('U12 在线升级使用共享解析/比较，并记录 imported_builtin_source_version', () => {
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  assert.ok(source.includes('parseSourceVersion'), 'Source.tsx 未使用 parseSourceVersion')
  assert.ok(source.includes('compareSourceVersions'), 'Source.tsx 未使用 compareSourceVersions')
  assert.ok(source.includes('BUILTIN_SOURCE_STORAGE_KEYS.importedVersion'), 'Source.tsx 未记录内置源版本')
  assert.ok(!source.includes('api.name.includes(\'豆包定制\')'), 'Source.tsx 仍按名字批量删除内置源')
})

console.log('\n[版本锚定]')

run('U13 @version 只认文件头，说明/前置注释里的假版本不能当真相', () => {
  const { parseSourceVersion } = LOGIC()
  const script = `// @version 9.9.9
/*!
 * @name 豆包定制[聚合音源]
 * @description 说明里写 @version 7.7.7 也不算
 * @version 8.15.0
 */`
  assert.strictEqual(parseSourceVersion(script), '8.15.0')
})

run('U14 无文件头时，只接受行首 @version 兜底', () => {
  const { parseSourceVersion } = LOGIC()
  assert.strictEqual(parseSourceVersion('// @version v8.1.2\nfoo()'), '8.1.2')
})

console.log('\n[升级基线]')

run('U15 升级基线优先取内置源脚本，不被当前选中的其他源污染', () => {
  const { resolveSourceUpdateBaseline } = LOGIC()
  const r = resolveSourceUpdateBaseline({
    builtinScript: '/*! @version 8.15.0 */',
    importedVersion: '8.15.0',
    activeSourceName: '用户手动源',
    activeScript: '/*! @version 9.9.9 */',
  })
  assert.strictEqual(r.version, '8.15.0')
  assert.strictEqual(r.source, 'builtin-script')
})

run('U16 内置源脚本读不到时，回退 imported_builtin_source_version', () => {
  const { resolveSourceUpdateBaseline } = LOGIC()
  const r = resolveSourceUpdateBaseline({
    builtinScript: '',
    importedVersion: '8.16.0',
    activeSourceName: '用户手动源',
    activeScript: '/*! @version 9.9.9 */',
  })
  assert.strictEqual(r.version, '8.16.0')
  assert.strictEqual(r.source, 'imported-version')
})

run('U17 无 id / 无版本时，才按内置名回退当前选中源', () => {
  const { BUILTIN_SOURCE_NAME, resolveSourceUpdateBaseline } = LOGIC()
  const r = resolveSourceUpdateBaseline({
    builtinScript: '',
    importedVersion: '',
    activeSourceName: BUILTIN_SOURCE_NAME,
    activeScript: '/*! @version 8.17.0 */',
  })
  assert.strictEqual(r.version, '8.17.0')
  assert.strictEqual(r.source, 'active-builtin')
})

console.log('\n[待切换源对账]')

run('U18 待切换源已在当前选中位，按脚本版本提升为内置源', () => {
  const { decidePendingBuiltinSwitch } = LOGIC()
  const d = decidePendingBuiltinSwitch({
    pendingSourceId: 'user_api_1',
    sourceIds: ['user_api_1', 'kw'],
    activeSourceId: 'user_api_1',
    pendingVersion: 'v8.15.0',
  })
  assert.strictEqual(d.action, 'promote-active')
  assert.strictEqual(d.promoteVersion, '8.15.0')
})

run('U19 待切换源是孤儿时阻止启动自动导入，避免重复源', () => {
  const { decidePendingBuiltinSwitch } = LOGIC()
  const d = decidePendingBuiltinSwitch({
    pendingSourceId: 'user_api_1',
    sourceIds: ['user_api_1', 'kw'],
    activeSourceId: 'kw',
    pendingVersion: '',
  })
  assert.strictEqual(d.action, 'block-import')
})

run('U20 待切换源已被删除时清掉 pending 标记', () => {
  const { decidePendingBuiltinSwitch } = LOGIC()
  const d = decidePendingBuiltinSwitch({
    pendingSourceId: 'user_api_1',
    sourceIds: ['kw'],
    activeSourceId: 'kw',
    pendingVersion: '',
  })
  assert.strictEqual(d.action, 'clear-stale')
})

run('U21 有 pending 阻断时导入决策必须拒绝自动导入', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({ canManage: true, hasImported: true, hasBuiltinSource: true, builtinVersion: '8.15.0', importedVersion: '8.14.1', pendingBlocked: true })
  assert.strictEqual(d.shouldImport, false)
  assert.strictEqual(d.reason, 'pending-switch')
})

console.log('\n[接线静态锁 · 原子性]')

run('U22 在线升级先写 pending 再切源，成功后才清 pending', () => {
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  const pendingAt = source.indexOf('BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId')
  const switchAt = source.indexOf('setApiSource(newApiInfo.id)')
  const removeAt = source.lastIndexOf('removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)')
  assert.ok(pendingAt >= 0, 'Source.tsx 未写 pendingSourceId')
  assert.ok(switchAt > pendingAt, 'pendingSourceId 必须在切源前写入')
  assert.ok(removeAt > switchAt, 'pendingSourceId 必须在切源成功后清理')
})

run('U23 启动导入用第二次读到的脚本回填版本，避免首次读失败导致反复导入', () => {
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(index.includes('builtinVer || parseSourceVersion(script)'), 'index.ts 未用第二次读取的脚本回填版本')
})

run('U24 pending 提升为内置源后清理旧内置源，避免只换标记不换实体', () => {
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(source.includes('previousBuiltinId'), 'Source.tsx 未记录待清理的旧内置源 id')
  assert.ok(source.includes('removeUserApi([previousBuiltinId])'), 'Source.tsx 未清理旧内置源')
  assert.ok(index.includes('previousBuiltinId'), 'index.ts 未记录待清理的旧内置源 id')
  assert.ok(index.includes('removeUserApi([previousBuiltinId])'), 'index.ts 未清理旧内置源')
})

console.log(`\n${checks} 项通过，${failures} 项失败`)
if (failures) process.exitCode = 1
