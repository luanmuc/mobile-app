#!/usr/bin/env node
/**
 * 同步客户端热点断言（N2）
 * 真实加载 src/plugins/sync/client/client.ts，mock 网络/加密边界，
 * 验证状态广播与 message 透传，避免只改字符串、无行为断言。
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

const loadTs = (rel, stubs) => {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (id) => {
    if (id in stubs) return stubs[id]
    if (id.startsWith('./') || id.startsWith('../')) {
      const target = path.resolve(path.dirname(file), id)
      if (fs.existsSync(target + '.ts')) return loadTs(path.relative(ROOT, target + '.ts'), stubs)
      if (fs.existsSync(target + '.js')) return require(target + '.js')
    }
    return require(id)
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

let failures = 0
let checks = 0
const tasks = []
const run = (name, fn) => {
  tasks.push((async() => {
    try { await fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
      failures++; console.error(`  ✗ ${name}`)
      console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
    }
  })())
}

const makeSetup = () => {
  const broadcasts = []
  const mod = loadTs('src/plugins/sync/client/client.ts', {
    './utils': { encryptMsg: () => '', decryptMsg: () => '' },
    './sync': { callObj: {} },
    '../log': { __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {} } },
    '../utils': { aesEncrypt: () => '' },
    '@/core/sync': { setSyncStatus: (s) => broadcasts.push({ ...s }) },
    '@/utils/common': { dateFormat: () => '2026-11-14' },
    message2call: { createMsg2call: () => ({}) },
    '@/utils/tools': { toast: () => {} },
    '../constants': { SYNC_CLOSE_CODE: { normal: 1000 }, SYNC_CODE: {} },
  })
  return { mod, broadcasts }
}

console.log('\n[N2 sync client]')
run('N2-SC1 初始状态为未连接', async() => {
  const { mod } = makeSetup()
  assert.deepStrictEqual(mod.getStatus(), { status: false, message: '' })
})
run('N2-SC2 sendSyncStatus 广播 status/message', async() => {
  const { mod, broadcasts } = makeSetup()
  mod.sendSyncStatus({ status: true, message: 'connected' })
  assert.strictEqual(broadcasts.length, 1)
  assert.deepStrictEqual(broadcasts[0], { status: true, message: 'connected' })
  assert.deepStrictEqual(mod.getStatus(), { status: true, message: 'connected' })
})
run('N2-SC3 sendSyncMessage 只更新 message 并广播', async() => {
  const { mod, broadcasts } = makeSetup()
  mod.sendSyncMessage('sync list updated')
  assert.strictEqual(broadcasts.length, 1)
  assert.strictEqual(broadcasts[0].message, 'sync list updated')
  assert.strictEqual(mod.getStatus().message, 'sync list updated')
})
run('N2-SC4 未连接时 disconnect 安全返回', async() => {
  const { mod, broadcasts } = makeSetup()
  await mod.disconnect()
  assert.strictEqual(broadcasts.length, 0)
})

Promise.all(tasks).then(() => {
  console.log(`\n===== N2 同步客户端：${checks} 通过 / ${failures} 失败 =====`)
  if (failures) process.exit(1)
})
