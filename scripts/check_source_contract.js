#!/usr/bin/env node
/**
 * P0 音源契约统一检查（Source Contract v2）
 *
 * 目标：
 *   P0-A1 App 侧只有一个 action 权威列表
 *   P0-A2 preload 不再维护按 source 的 action 白名单
 *   P0-A3 源侧未知 action 不注册到 App
 *   P0-A4 结果兼容旧 raw 与 v2 envelope
 *   P0-A5 失败码 retryable 语义稳定
 *   P0-A6 现有 11 个 action 全部仍有 handler
 *
 * 用法：node20 scripts/check_source_contract.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch (e) {
  ts = require('typescript')
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // 仅在仓库自检脚本里加载转译后的本仓 TS 模块，不执行外部输入
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

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

const SECTION = (name) => console.log(`\n[${name}]`)

SECTION('contract')
const CONTRACT = () => loadTs('src/core/init/userApi/sourceContract.ts')

run('P0-A1 SOURCE_ACTIONS 恰好 11 个且集合稳定', () => {
  const { SOURCE_ACTIONS } = CONTRACT()
  assert.ok(Array.isArray(SOURCE_ACTIONS), 'SOURCE_ACTIONS 必须是数组')
  assert.strictEqual(SOURCE_ACTIONS.length, 11, `期望 11 个，实际 ${SOURCE_ACTIONS.length}`)
  assert.deepStrictEqual(
    [...SOURCE_ACTIONS].sort(),
    ['config', 'exportHealthState', 'health', 'healthEvents', 'lyric', 'musicUrl', 'pic', 'probe', 'restoreHealthState', 'toggle', 'trend'].sort(),
  )
})

run('P0-A3 未知 action 被过滤、合法 action 保留', () => {
  const { normalizeSourceInfo } = CONTRACT()
  const info = normalizeSourceInfo({
    kw: {
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic', 'health', 'toggle', 'probe', 'config', 'trend', 'healthEvents', 'exportHealthState', 'restoreHealthState', 'foo'],
      qualitys: ['128k', 'bogus'],
    },
    bad: { type: 'video', actions: ['musicUrl'], qualitys: ['128k'] },
  })
  assert.deepStrictEqual(Object.keys(info), ['kw'], '非 music 源必须被丢弃')
  assert.ok(info.kw.actions.includes('lyric'), '合法 lyric 必须保留')
  assert.ok(info.kw.actions.includes('exportHealthState'), '合法 exportHealthState 必须保留')
  assert.ok(info.kw.actions.includes('restoreHealthState'), '合法 restoreHealthState 必须保留')
  assert.ok(!info.kw.actions.includes('foo'), '未知 foo 必须被过滤')
  assert.deepStrictEqual(info.kw.qualitys, ['128k'], '非法音质必须被过滤')
})

run('P0-A4 v2 成功 envelope 取 data', () => {
  const { unwrapSourceResult } = CONTRACT()
  const result = unwrapSourceResult({ ok: true, data: { url: 'https://x.test/a.mp3', type: '128k' } })
  assert.deepStrictEqual(result, { url: 'https://x.test/a.mp3', type: '128k' })
})

run('P0-A4 旧 raw 对象原样返回', () => {
  const { unwrapSourceResult } = CONTRACT()
  const legacy = { url: 'https://x.test/a.mp3', type: '128k', subSource: 's' }
  assert.deepStrictEqual(unwrapSourceResult(legacy), legacy)
})

run('P0-A4 v2 失败 envelope 抛 code: message', () => {
  const { unwrapSourceResult } = CONTRACT()
  assert.throws(
    () => unwrapSourceResult({ ok: false, error: { code: 'TIMEOUT', message: '请求超时' } }),
    /TIMEOUT: 请求超时/,
  )
})

run('P0-A5 8 个错误码且 retryable 默认稳定', () => {
  const { SOURCE_ERROR_CODES, getErrorRetryable } = CONTRACT()
  assert.deepStrictEqual(
    [...SOURCE_ERROR_CODES].sort(),
    ['INTERNAL', 'INVALID_REQUEST', 'NETWORK', 'NO_MATCH', 'NOT_AUDIO', 'RATE_LIMITED', 'TIMEOUT', 'UNSUPPORTED_ACTION'].sort(),
  )
  for (const code of ['TIMEOUT', 'RATE_LIMITED', 'NETWORK']) {
    assert.strictEqual(getErrorRetryable(code), true, `${code} 应默认可重试`)
  }
  for (const code of ['NO_MATCH', 'NOT_AUDIO', 'INVALID_REQUEST', 'UNSUPPORTED_ACTION', 'INTERNAL']) {
    assert.strictEqual(getErrorRetryable(code), false, `${code} 应默认不可重试`)
  }
})

SECTION('fallback-owner')
run('P1-A1 normalizeSourceInfo 透出 owner，缺省/非法回退 host', () => {
  const { normalizeSourceInfo } = CONTRACT()
  const info = normalizeSourceInfo({
    kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'], fallbackOwner: 'source' },
    tx: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'], fallbackOwner: 'bogus' },
    wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
  })
  assert.strictEqual(info.kw.fallbackOwner, 'source')
  assert.strictEqual(info.tx.fallbackOwner, 'host')
  assert.strictEqual(info.wy.fallbackOwner, 'host')
})

run('P1-A4 shouldHostFallback 仅 source 关闭 host 换源', () => {
  const { shouldHostFallback } = CONTRACT()
  assert.strictEqual(shouldHostFallback('source'), false)
  assert.strictEqual(shouldHostFallback('host'), true)
  assert.strictEqual(shouldHostFallback(undefined), true)
})

SECTION('preload')
run('P0-A2 preload 不再维护 supportActions 白名单', () => {
  const source = read('android/app/src/main/assets/script/user-api-preload.js')
  assert.ok(!source.includes('supportActions'), 'preload 仍存在 supportActions')
  assert.ok(source.includes('actions: userSource.actions'), 'actions 必须直接来自 userSource.actions')
})

run('P0-A4 preload 在分发前解 v2 envelope', () => {
  const source = read('android/app/src/main/assets/script/user-api-preload.js')
  assert.ok(source.includes('const unwrapResponse'), 'preload 缺少 unwrapResponse')
  assert.ok(source.includes('response = unwrapResponse(response)'), 'preload 未在 switch 前解 envelope')
})

run('P1-A2 preload 透传 fallbackOwner', () => {
  const source = read('android/app/src/main/assets/script/user-api-preload.js')
  assert.ok(source.includes('fallbackOwner: userSource.fallbackOwner'), 'preload 未透传 fallbackOwner')
})

SECTION('init')
run('P1-A3 App 保存 fallbackOwners 映射并在换源前判断', () => {
  const source = read('src/core/init/userApi/index.ts')
  assert.ok(source.includes('global.lx.fallbackOwners'), 'index.ts 未写入 fallbackOwners')
  assert.ok(read('src/core/music/utils.ts').includes('shouldHostFallback'), 'utils.ts 换源前缺少 host gate')
})

run('P0-A7 preload 透传 export/restore 两个宿主持久化 action', () => {
  const preload = read('android/app/src/main/assets/script/user-api-preload.js')
  for (const action of ['exportHealthState', 'restoreHealthState']) {
    assert.ok(preload.includes(`case '${action}'`), `preload handleRequest 缺少 case '${action}'`)
  }
})

run('P0-A6 App switch 覆盖全部 SOURCE_ACTIONS', () => {
  const { SOURCE_ACTIONS } = CONTRACT()
  const source = read('src/core/init/userApi/index.ts')
  const cases = new Set([...source.matchAll(/case '([^']+)':/g)].map(m => m[1]))
  for (const action of SOURCE_ACTIONS) assert.ok(cases.has(action), `index.ts 缺少 case '${action}'`)
})

const total = checks + failures
console.log(`\n===== 音源契约检查汇总：${checks} 通过 / ${failures} 失败 / 共 ${total} =====`)
if (failures) process.exit(1)
