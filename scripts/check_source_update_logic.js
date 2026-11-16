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
  // 判据要写行为方向，不能写源码字面量：`!includes(旧写法)` 这种断言改文案/换变量名就假绿，
  // 真正的回归（改回按名字删除）反而抓不到。
  assert.ok(/filter\(api => api\.id === storedBuiltinId\)/.test(source), 'Source.tsx 未按 id 精确清理旧内置源（storedBuiltinId）')
  assert.ok(!/\.filter\(api => api\.name/.test(source), 'Source.tsx 仍按 name 字段筛选/删除内置源')
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

run('U25 多份同名时，覆盖目标必须是「正在启用的那份」', () => {
  const { resolveBuiltinTarget } = LOGIC()
  const t = resolveBuiltinTarget({
    storedId: '',
    activeId: 'user_api_b',
    list: [
      { id: 'user_api_a', name: '豆包定制[聚合音源]' },
      { id: 'user_api_b', name: '豆包定制[聚合音源]' },
    ],
    builtinName: '豆包定制[聚合音源]',
  })
  assert.strictEqual(t.targetId, 'user_api_b', '多份同名时未把启用中的那份作为覆盖目标')
  assert.strictEqual(t.canManage, true)
  assert.strictEqual(t.reason, 'active-named')
})

run('U26 多份同名但启用的不是同名源时不冒险，且不覆盖用户源', () => {
  const { resolveBuiltinTarget } = LOGIC()
  const t = resolveBuiltinTarget({
    storedId: '',
    activeId: 'kw',
    list: [
      { id: 'user_api_a', name: '豆包定制[聚合音源]' },
      { id: 'user_api_b', name: '豆包定制[聚合音源]' },
    ],
    builtinName: '豆包定制[聚合音源]',
  })
  assert.strictEqual(t.targetId, '', '启用的不是聚合音源时不应指定覆盖目标')
  assert.strictEqual(t.canManage, false)
  assert.strictEqual(t.reason, 'ambiguous')
})

run('U27 无 id 标记但同名唯一时，目标就是那一份（兼容旧数据迁移）', () => {
  const { resolveBuiltinTarget } = LOGIC()
  const t = resolveBuiltinTarget({
    storedId: '',
    activeId: 'kw',
    list: [{ id: 'user_api_only', name: '豆包定制[聚合音源]' }],
    builtinName: '豆包定制[聚合音源]',
  })
  assert.strictEqual(t.targetId, 'user_api_only')
  assert.strictEqual(t.canManage, true)
  assert.strictEqual(t.reason, 'named-unique')
})

run('U28 有 id 标记时优先按 id，名字不同也认（用户可改名）', () => {
  const { resolveBuiltinTarget } = LOGIC()
  const t = resolveBuiltinTarget({
    storedId: 'user_api_x',
    activeId: 'kw',
    list: [{ id: 'user_api_x', name: '我自己改的名字' }],
    builtinName: '豆包定制[聚合音源]',
  })
  assert.strictEqual(t.targetId, 'user_api_x')
  assert.strictEqual(t.reason, 'stored-id')
})

run('U29 就地覆盖保留 id 与更新提醒开关，只换版本/名称/说明', () => {
  const { buildOverwrittenApiInfo } = LOGIC()
  const prev = { id: 'user_api_old', name: '豆包定制[聚合音源]', version: '8.15.1', description: '旧说明', allowShowUpdateAlert: false, author: 'x' }
  const next = buildOverwrittenApiInfo(prev, { name: '豆包定制[聚合音源]', version: '8.16.0', description: '新说明' })
  assert.strictEqual(next.id, 'user_api_old', '覆盖后 id 变了（会多出一份新源）')
  assert.strictEqual(next.allowShowUpdateAlert, false, '覆盖后丢了更新提醒开关')
  assert.strictEqual(next.author, 'x', '覆盖后丢了原有 author')
  assert.strictEqual(next.version, '8.16.0')
  assert.strictEqual(next.description, '新说明')
})

console.log('\n[接线静态锁 · 就地覆盖]')

run('U30 在线更新走就地覆盖，目标取自当前启用源，不再无条件新增', () => {
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  assert.ok(source.includes('overwriteUserApi'), 'Source.tsx 未调用 overwriteUserApi（仍只会新增）')
  assert.ok(source.includes('resolveBuiltinTarget'), 'Source.tsx 未使用 resolveBuiltinTarget 定位覆盖目标')
  assert.ok(/resolveBuiltinTarget\([\s\S]{0,200}activeId:\s*apiSourceSetting/.test(source), 'Source.tsx 未把当前启用源作为覆盖目标')
})

run('U31 启动自动升级同样就地覆盖，不再 remove+add 造成 id 漂移', () => {
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(index.includes('overwriteUserApi'), 'index.ts 未就地覆盖内置源（仍 remove+add）')
  assert.ok(!/await removeUserApi\(\[builtinApi\.id\]\)[\s\S]{0,80}await addUserApi/.test(index), 'index.ts 仍是先删后建')
})

run('U32 用户手动启用了另一份同名源时，覆盖目标必须是启用那份（不能被 id 标记带偏）', () => {
  const { resolveBuiltinTarget } = LOGIC()
  const t = resolveBuiltinTarget({
    storedId: 'user_api_stored',
    activeId: 'user_api_active',
    list: [
      { id: 'user_api_stored', name: '豆包定制[聚合音源]' },
      { id: 'user_api_active', name: '豆包定制[聚合音源]' },
    ],
    builtinName: '豆包定制[聚合音源]',
  })
  assert.strictEqual(t.targetId, 'user_api_active', 'id 标记压过了启用份，会去覆盖没启用的那份')
  assert.strictEqual(t.reason, 'active-named')
})

run('U33 版本基线优先取「将被覆盖那份」的版本，避免拿另一份的版本误判远端更低', () => {
  const { resolveSourceUpdateBaseline } = LOGIC()
  const base = resolveSourceUpdateBaseline({
    builtinScript: '/*!\n * @name 豆包定制[聚合音源]\n * @version 8.16.0\n */',
    importedVersion: '8.16.0',
    targetScript: '/*!\n * @name 豆包定制[聚合音源]\n * @version 8.15.1\n */',
  })
  assert.strictEqual(base.version, '8.15.1', '基线仍取标记份（8.16.0），启用份就永远升不动')
  assert.strictEqual(base.source, 'target-script')
})

run('U34 只有“没有覆盖目标”时 pending 才阻断自动导入，避免老 pending 永久卡住升级', () => {
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(/pendingBlocked:\s*pendingBlocked\s*&&\s*!builtinApi/.test(index), 'index.ts 仍在有目标时被 pending 阻断')
})

run('U35 删除内置源必须清掉悬空 id 标记，避免将来把用户自建同名源当内置源覆盖', () => {
  const core = read('src/core/userApi.ts')
  assert.ok(core.includes('BUILTIN_SOURCE_STORAGE_KEYS.sourceId'), 'core/userApi.ts 删除时未清 builtin_source_id')
  assert.ok(/removeData\(BUILTIN_SOURCE_STORAGE_KEYS\.pendingSourceId\)/.test(core), 'core/userApi.ts 删除时未清 pending 标记')
})

run('U36 覆盖成功后不再谎报“重启 App 生效”（同 id 已经热重载）', () => {
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const text = JSON.parse(read(`src/lang/${lang}.json`)).source_update_ok
    assert.ok(!/重启|重新啟動|Restart/i.test(text), `${lang} 的 source_update_ok 仍写“重启生效”`)
  }
})

run('U37 覆盖目标不存在时给用户可读文案，不抛英文内部错误', () => {
  const data = read('src/utils/data.ts')
  assert.ok(!data.includes("throw new Error('user api not found')"), 'data.ts 仍抛英文内部错误')
  assert.ok(/global\.i18n\.t\('source_update_target_missing'\)/.test(data), 'data.ts 未用可读文案')
})

run('U38 换包（含降级）：包内版本更低也必须覆盖，音源跟包走', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({
    canManage: true,
    hasImported: true,
    hasBuiltinSource: true,
    builtinVersion: '8.16.0',
    importedVersion: '8.18.0',
    appVersion: '1.9.2-b134',
    importedAppVersion: '1.9.2-b138',
  })
  assert.strictEqual(d.shouldImport, true, '换包后内置版本更低仍拒绝覆盖，降级包音源不生效')
  assert.strictEqual(d.reason, 'app-version-sync')
})

run('U39 同一个包内重启：内置更低仍不覆盖，保住在线更新结果', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({
    canManage: true,
    hasImported: true,
    hasBuiltinSource: true,
    builtinVersion: '8.16.0',
    importedVersion: '8.18.0',
    appVersion: '1.9.2-b138',
    importedAppVersion: '1.9.2-b138',
  })
  assert.strictEqual(d.shouldImport, false)
  assert.strictEqual(d.reason, 'builtin-older')
})

run('U40 老数据没有 App 版本标记：强制同步一次，顺带修好卡在旧版的设备', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({
    canManage: true,
    hasImported: true,
    hasBuiltinSource: true,
    builtinVersion: '8.16.0',
    importedVersion: '8.15.1',
    appVersion: '1.9.2-b138',
    importedAppVersion: '',
  })
  assert.strictEqual(d.shouldImport, true)
  assert.strictEqual(d.reason, 'app-version-sync')
})

run('U41 覆盖后必须记录当前 App 版本，否则下次启动又会当成换包', () => {
  const index = read('src/core/init/userApi/index.ts')
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  assert.ok(index.includes('BUILTIN_SOURCE_STORAGE_KEYS.appVersion'), 'index.ts 未记录 app 版本标记')
  assert.ok(source.includes('BUILTIN_SOURCE_STORAGE_KEYS.appVersion'), 'Source.tsx 未记录 app 版本标记')
})

run('U42 用户改过的同名源：不静默覆盖，判 target-modified', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({
    canManage: true,
    hasImported: true,
    hasBuiltinSource: true,
    builtinVersion: '8.16.0',
    importedVersion: '8.15.1',
    appVersion: '1.9.2-b139',
    importedAppVersion: '1.9.2-b138',
    targetModified: true,
  })
  assert.strictEqual(d.shouldImport, false, '改过的源被静默覆盖了')
  assert.strictEqual(d.reason, 'target-modified')
})

run('U43 老数据没有 checksum 基线：不阻断，否则设备永远卡在旧版', () => {
  const { decideBuiltinSourceImport } = LOGIC()
  const d = decideBuiltinSourceImport({
    canManage: true,
    hasImported: true,
    hasBuiltinSource: true,
    builtinVersion: '8.16.0',
    importedVersion: '8.15.1',
    appVersion: '1.9.2-b139',
    importedAppVersion: '',
    targetModified: false,
  })
  assert.strictEqual(d.shouldImport, true)
  assert.strictEqual(d.reason, 'app-version-sync')
})

run('U44 脚本指纹：同内容稳定、任意位置改一个字符就变、空基线不算改动', () => {
  const { hashScript, isScriptModified } = LOGIC()
  const a = '/*! @version 8.16.0 */' + 'x'.repeat(2000)
  const b = '/*! @version 8.16.0 */' + 'x'.repeat(1999) + 'y'
  assert.strictEqual(hashScript(a), hashScript(a))
  assert.notStrictEqual(hashScript(a), hashScript(b))
  assert.strictEqual(isScriptModified('', hashScript(a)), false, '空基线应视为可覆盖')
  assert.strictEqual(isScriptModified(hashScript(a), hashScript(a)), false)
  assert.strictEqual(isScriptModified(hashScript(a), hashScript(b)), true)
})

run('U45 启动侧：读 checksum 基线、算指纹、覆盖成功后回写 checksum', () => {
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(index.includes('BUILTIN_SOURCE_STORAGE_KEYS.checksum'), 'index.ts 未读/写 checksum')
  assert.ok(index.includes('isScriptModified'), 'index.ts 未做改动判定')
  assert.ok(index.includes('targetModified'), 'index.ts 未把判定结果传给决策函数')
  assert.ok(index.includes('hashScript'), 'index.ts 未计算脚本指纹')
})

run('U46 在线更新侧：同样回写 checksum，被改过时弹窗要提示会覆盖改动', () => {
  const source = read('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  assert.ok(source.includes('BUILTIN_SOURCE_STORAGE_KEYS.checksum'), 'Source.tsx 未回写 checksum')
  assert.ok(source.includes('hashScript'), 'Source.tsx 未计算指纹')
  assert.ok(source.includes('source_update_modified_warn'), 'Source.tsx 缺少“将覆盖改动”提示')
})

console.log(`\n${checks} 项通过，${failures} 项失败`)
if (failures) process.exitCode = 1
