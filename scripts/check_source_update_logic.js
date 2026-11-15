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

console.log(`\n${checks} 项通过，${failures} 项失败`)
if (failures) process.exitCode = 1
