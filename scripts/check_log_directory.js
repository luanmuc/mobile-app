#!/usr/bin/env node
/**
 * 日志目录审计：公共优先 / 私有降级 / 私有日志回迁 / 四类文件补齐。
 * 用内存 RNFS 加载真实生产 TS 模块，不复制实现。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let ts
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch (e) { ts = require('typescript') }

const loadTs = (rel, customRequire) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, customRequire || require, mod, file, path.dirname(file))
  return mod.exports
}

const makeEnv = (initialFiles = {}) => {
  const files = new Map(Object.entries(initialFiles))
  const dirs = new Set(['/public', '/public/lx-music', '/public/lx-music/logs', '/private', '/private/lx-music', '/private/lx-music/logs'])
  const flags = { publicWriteFail: false, publicMkdirFail: false }
  const fake = {
    DownloadDirectoryPath: '/public',
    TemporaryDirectoryPath: '/private',
    exists: async p => files.has(p) || dirs.has(p),
    mkdir: async p => {
      if (flags.publicMkdirFail && p.startsWith('/public')) throw new Error('mkdir denied')
      dirs.add(p)
    },
    readDir: async p => [...files.keys()]
      .filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
      .map(name => ({ name: name.slice(p.length + 1), isFile: () => true })),
    stat: async p => {
      if (!files.has(p)) throw new Error('missing')
      return { size: files.get(p).length, isFile: () => true }
    },
    readFile: async p => files.get(p) || '',
    writeFile: async(p, c) => {
      if (flags.publicWriteFail && p.startsWith('/public')) throw new Error('write denied')
      files.set(p, c)
    },
    appendFile: async(p, c) => {
      if (flags.publicWriteFail && p.startsWith('/public')) throw new Error('append denied')
      files.set(p, (files.get(p) || '') + c)
    },
    moveFile: async(a, b) => {
      if (!files.has(a)) throw new Error('missing')
      files.set(b, files.get(a))
      files.delete(a)
    },
    copyFile: async(a, b) => {
      if (!files.has(a)) throw new Error('missing')
      files.set(b, files.get(a))
    },
    unlink: async p => { files.delete(p) },
  }
  const req = id => id === 'react-native-fs' ? { default: fake } : require(id)
  return { files, dirs, flags, fake, req }
}

const loadLog = env => loadTs('src/utils/log.ts', env.req)
const loadHealth = (env, logApi) => loadTs('src/core/healthLog.ts', id => {
  if (id === 'react-native-fs') return { default: env.fake }
  if (id === '../utils/log') return logApi
  return require(id)
})

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('L1 公共目录可用时优先公共，并把私有日志迁回', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/error.log': 'public\n',
    '/private/lx-music/logs/error.log': 'private\n',
    '/private/lx-music/logs/source.log': 'source-private\n',
  })
  const log = loadLog(env)
  assert(await log.checkLogPermission() === true, '公共目录应判定可用')
  assert(log.getLogsDir() === '/public/lx-music/logs', '未切回公共目录')
  assert(env.files.get('/public/lx-music/logs/error.log') === 'public\nprivate\n', 'error.log 未合并')
  assert(!env.files.has('/private/lx-music/logs/error.log'), '私有 error.log 未删除')
  assert(env.files.get('/public/lx-music/logs/source.log') === 'source-private\n', '私有 source.log 未迁移')
})

test('L2 公共不可写时降级私有，日志页仍可读', async() => {
  const env = makeEnv({ '/private/lx-music/logs/error.log': 'private-only\n' })
  env.flags.publicWriteFail = true
  env.flags.publicMkdirFail = true
  const log = loadLog(env)
  assert(await log.checkLogPermission() === false, '公共不可写时应返回 false')
  assert(log.getLogsDir() === '/private/lx-music/logs', '应降级私有目录')
  assert((await log.getLogs('error')).includes('private-only'), '私有日志页读不到')
})

test('L3 JSONL 同名按追加合并，行不丢', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/source_health_20261111.jsonl': '{"a":1}\n',
    '/private/lx-music/logs/source_health_20261111.jsonl': '{"b":2}\n',
  })
  const log = loadLog(env)
  await log.checkLogPermission()
  assert(env.files.get('/public/lx-music/logs/source_health_20261111.jsonl') === '{"a":1}\n{"b":2}\n', 'JSONL 未追加合并')
})

test('L4 非文本同名不覆盖，改名保留', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/diag.json': '{"public":true}',
    '/private/lx-music/logs/diag.json': '{"private":true}',
  })
  const log = loadLog(env)
  await log.checkLogPermission()
  assert(env.files.get('/public/lx-music/logs/diag.json') === '{"public":true}', '公共 JSON 被覆盖')
  const renamed = [...env.files.keys()].find(k => k.startsWith('/public/lx-music/logs/diag.json.migrated-'))
  assert(renamed && env.files.get(renamed) === '{"private":true}', '私有 JSON 未改名保留')
})

test('L5 重复检查权限不重复追加', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/error.log': 'public\n',
    '/private/lx-music/logs/error.log': 'private\n',
  })
  const log = loadLog(env)
  await log.checkLogPermission()
  await log.checkLogPermission()
  assert(env.files.get('/public/lx-music/logs/error.log') === 'public\nprivate\n', '重复迁移造成重复内容')
})

test('L6 任一分类写入前补齐四类固定文件', async() => {
  const env = makeEnv({ '/public/lx-music/logs/error.log': 'old\n' })
  const log = loadLog(env)
  await log.checkLogPermission()
  log.log.error('new-line')
  await sleep(30)
  for (const n of ['error.log', 'source.log', 'diagnose.log', 'lx_debug_log.txt']) {
    assert(env.files.has('/public/lx-music/logs/' + n), `缺少 ${n}`)
  }
  assert(env.files.get('/public/lx-music/logs/error.log').includes('new-line'), '目标日志未写入')
  assert(env.files.get('/public/lx-music/logs/source.log') === '', '新建日志不应有内容')
})

test('L7 已存在的其他日志内容不被清空', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/error.log': 'old-error\n',
    '/public/lx-music/logs/source.log': 'keep-source\n',
  })
  const log = loadLog(env)
  await log.checkLogPermission()
  await log.ensureAllLogFiles('/public/lx-music/logs')
  assert(env.files.get('/public/lx-music/logs/source.log') === 'keep-source\n', '已有 source.log 被清空')
})

test('L8 私有降级时清空日志仍有效', async() => {
  const env = makeEnv({ '/private/lx-music/logs/error.log': 'private\n' })
  env.flags.publicWriteFail = true
  env.flags.publicMkdirFail = true
  const log = loadLog(env)
  await log.checkLogPermission()
  await log.clearLogs('error')
  assert(env.files.get('/private/lx-music/logs/error.log') === '', '私有 error.log 未清空')
})

test('L9 健康诊断目录父级被删后逐级重建', async() => {
  const env = makeEnv()
  env.dirs.delete('/public/lx-music/logs')
  env.dirs.delete('/public/lx-music')
  const health = loadHealth(env, {
    getActiveLogsDir: () => '/public/lx-music/logs',
    ensureAllLogFiles: async() => {},
  })
  const dir = await health.ensureHealthLogsDir()
  assert(dir === '/public/lx-music/logs', '返回目录错误')
  assert(env.dirs.has('/public/lx-music'), '父目录未重建')
  assert(env.dirs.has('/public/lx-music/logs'), 'logs 未重建')
})

test('L10 健康事件写入同时补齐四类固定日志', async() => {
  const env = makeEnv()
  let ensuredDir = null
  const health = loadHealth(env, {
    getActiveLogsDir: () => '/public/lx-music/logs',
    ensureAllLogFiles: async dir => {
      ensuredDir = dir
      for (const n of ['error.log', 'source.log', 'diagnose.log', 'lx_debug_log.txt']) {
        if (!env.files.has(dir + '/' + n)) env.files.set(dir + '/' + n, '')
      }
    },
  })
  const tsNow = new Date('2026-11-11T12:00:00+08:00').getTime()
  const out = await health.appendHealthEvent({ ts: tsNow, traceId: 't1', event: 'source_result', sourceId: 's1', ok: false, code: 'E' })
  assert(out && out.endsWith('source_health_20261111.jsonl'), `健康文件路径错误：${out}`)
  assert(ensuredDir === '/public/lx-music/logs', '未调用四类日志补齐')
  for (const n of ['error.log', 'source.log', 'diagnose.log', 'lx_debug_log.txt']) {
    assert(env.files.has('/public/lx-music/logs/' + n), `健康事件后缺少 ${n}`)
  }
  assert(env.files.get(out).includes('"event":"source_result"'), '健康事件未落盘')
})

test('L11 并发检查权限只迁移一次', async() => {
  const env = makeEnv({
    '/public/lx-music/logs/error.log': 'public\n',
    '/private/lx-music/logs/error.log': 'private\n',
  })
  const log = loadLog(env)
  await Promise.all([log.checkLogPermission(), log.checkLogPermission()])
  assert(env.files.get('/public/lx-music/logs/error.log') === 'public\nprivate\n', '并发迁移造成重复')
})

test('L12 500 个私有日志文件回迁 < 300ms', async() => {
  const env = makeEnv({ '/public/lx-music/logs/error.log': '' })
  for (let i = 0; i < 500; i++) env.files.set(`/private/lx-music/logs/source_health_2026${String(1000 + i).slice(-4)}.jsonl`, `{"i":${i}}\n`)
  const log = loadLog(env)
  const start = Date.now()
  await log.checkLogPermission()
  const cost = Date.now() - start
  console.log(`  L12 实测 ${cost}ms`)
  assert(cost < 300, `500 文件回迁耗时 ${cost}ms`)
  assert(![...env.files.keys()].some(k => k.startsWith('/private/lx-music/logs/')), '仍有私有日志未迁走')
})

test('L13 10000 次补齐四类文件 < 400ms', async() => {
  const env = makeEnv()
  const log = loadLog(env)
  await log.checkLogPermission()
  const start = Date.now()
  for (let i = 0; i < 10000; i++) await log.ensureAllLogFiles('/public/lx-music/logs')
  const cost = Date.now() - start
  console.log(`  L13 实测 ${cost}ms`)
  assert(cost < 400, `10000 次补齐耗时 ${cost}ms`)
  assert(env.files.has('/public/lx-music/logs/lx_debug_log.txt'), '补齐后缺文件')
})

const run = async() => {
  let passed = 0
  const failures = []
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`✓ ${t.name}`)
    } catch (e) {
      failures.push(`${t.name} — ${e && e.message}`)
      console.log(`✗ ${t.name} — ${e && e.message}`)
    }
  }
  console.log(`\n===== 日志目录审计汇总：${passed} 通过 / ${failures.length} 失败 =====`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log(' - ' + f)
    process.exit(1)
  }
}

run()
