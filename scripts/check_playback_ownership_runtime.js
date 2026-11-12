#!/usr/bin/env node
/**
 * P1 运行时所有权/候选竞速 harness（P1F-A1~A6）
 *
 * 这里加载真实 src/core/music/utils.ts，只替换边界模块（musicSdk/data/setting/log），
 * 用 mock 计数断言 App 侧外呼次数；源内搜索由源仓 V12 覆盖。
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

const realRequire = require
const loadTs = (rel, stubs = {}) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
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
      if (fs.existsSync(target + '.js')) return realRequire(target + '.js')
    }
    return realRequire(id)
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const music = (source, id, overrides = {}) => ({
  id,
  source,
  name: 'Same Song',
  singer: 'Same Singer',
  interval: '00:03',
  meta: { albumName: '', _qualitys: { '128k': true }, ...overrides.meta },
  ...overrides,
})
const fail = (code) => Object.assign(new Error(`${code}: mock`), { code })

const setup = () => {
  const counts = { findMusic: [], urls: [], toggles: [] }
  const behavior = { primary: 'ok', candidates: [], delays: {}, failCodes: {} }
  const sdk = {
    kw: { getMusicUrl: () => { throw new Error('not configured') } },
    wy: { getMusicUrl: () => { throw new Error('not configured') } },
    tx: { getMusicUrl: () => { throw new Error('not configured') } },
  }
  const makeUrl = (source, info, quality) => {
    counts.urls.push({ source, id: info.id, quality })
    const delay = behavior.delays[source] ?? 0
    const mode = source === 'kw' && behavior.primary === 'fail' ? (behavior.primaryCode ?? 'NOT_FOUND') : (behavior.failCodes[source] ?? 'ok')
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (mode === 'ok') resolve({ url: `https://mock/${source}/${info.id}.mp3`, type: quality })
        else reject(fail(mode))
      }, delay)
    })
  }
  for (const source of Object.keys(sdk)) {
    sdk[source].getMusicUrl = (info, quality) => ({ promise: makeUrl(source, info, quality) })
  }
  const findMusic = async(info) => {
    counts.findMusic.push(info)
    return behavior.candidates
  }
  const stubs = {
    '@/utils/musicSdk': { __esModule: true, default: sdk, findMusic },
    '@/utils/data': {
      getMusicUrl: async() => null,
      getPlayerLyric: async() => null,
      getStoreMusicSource: async() => null,
    },
    '@/utils': {
      langS2T: (s) => s,
      toNewMusicInfo: (m) => m,
      toOldMusicInfo: (m) => m,
    },
    '@/utils/tools': { assertApiSupport: () => true },
    '@/store/setting/state': { __esModule: true, default: { setting: { 'player.playQuality': '128k' } } },
    '@/utils/log': { log: { diagnose: () => {} } },
    '@/utils/message': { requestMsg: { tooManyRequests: 'too many requests' } },
    'react-native-background-timer': { __esModule: true, default: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) } },
    '@/utils/musicSdk/api-source': { apis: () => ({ getMusicUrl: () => ({ promise: Promise.reject(new Error('not used')) }) }) },
    '@/core/init/userApi/sourceContract': { shouldHostFallback: (owner) => owner !== 'source' },
  }
  global.lx = {
    apiInitPromise: [Promise.resolve(true)],
    fallbackOwners: {},
    qualityList: { kw: ['128k'], wy: ['128k'], tx: ['128k'] },
  }
  global.i18n = { t: (key) => key }
  const utils = loadTs('src/core/music/utils.ts', stubs)
  return { utils, sdk, counts, behavior }
}

let failures = 0
let checks = 0
const run = async(name, fn) => {
  try { await fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) { failures++; console.error(`  ✗ ${name}`); console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`) }
}

;(async() => {
  console.log('\n[P1 runtime ownership]')
  await run('P1F-A1 主源成功时 App 候选搜索=0', async() => {
    const h = setup(); h.behavior.primary = 'ok'
    const result = await h.utils.handleGetOnlineMusicUrl({ musicInfo: music('kw', 'a1'), quality: '128k', isRefresh: false, allowToggleSource: true, onToggleSource: (m) => h.counts.toggles.push(m?.source) })
    assert.strictEqual(result.url, 'https://mock/kw/a1.mp3')
    assert.strictEqual(h.counts.findMusic.length, 0, `App 不应搜索候选，实际 ${h.counts.findMusic.length}`)
    assert.strictEqual(h.counts.urls.filter(x => x.source === 'kw').length, 1)
  })

  await run('P1F-A2 主源失败 owner=host 时 App 候选搜索=1', async() => {
    const h = setup(); h.behavior.primary = 'fail'; h.behavior.candidates = [music('wy', 'a2')]
    const result = await h.utils.handleGetOnlineMusicUrl({ musicInfo: music('kw', 'a2'), quality: '128k', isRefresh: false, allowToggleSource: true, onToggleSource: (m) => h.counts.toggles.push(m?.source) })
    assert.strictEqual(result.musicInfo.source, 'wy')
    assert.strictEqual(h.counts.findMusic.length, 1, `host 模式应只搜 1 次，实际 ${h.counts.findMusic.length}`)
    assert.deepStrictEqual(h.counts.urls.map(x => x.source), ['kw', 'wy'])
  })

  await run('P1F-A3 主源失败 owner=source 时 App 搜索=0', async() => {
    const h = setup(); h.behavior.primary = 'fail'; global.lx.fallbackOwners = { kw: 'source' }
    await assert.rejects(h.utils.handleGetOnlineMusicUrl({ musicInfo: music('kw', 'a3'), quality: '128k', isRefresh: false, allowToggleSource: true, onToggleSource: (m) => h.counts.toggles.push(m?.source) }), /NOT_FOUND/)
    assert.strictEqual(h.counts.findMusic.length, 0, `source 模式 App 不应搜索，实际 ${h.counts.findMusic.length}`)
    assert.deepStrictEqual(h.counts.urls.map(x => x.source), ['kw'])
  })

  await run('P1F-A4 同一 trace 同平台候选只请求 1 次', async() => {
    const h = setup(); h.behavior.failCodes = { kw: 'NOT_FOUND' }
    const attempts = []
    const result = await h.utils.getOnlineOtherSourceMusicUrl({
      musicInfos: [music('kw', 'a4-1'), music('kw', 'a4-2'), music('wy', 'a4-3')],
      quality: '128k',
      isRefresh: true,
      retryedSource: [],
      onToggleSource: () => {},
      attempts,
    })
    assert.strictEqual(result.musicInfo.source, 'wy')
    assert.deepStrictEqual(h.counts.urls.map(x => x.source), ['kw', 'wy'], `重复平台被请求：${h.counts.urls.map(x => x.source)}`)
  })

  await run('P1F-A6 首成功取消其余候选且无晚到写入', async() => {
    const h = setup(); h.behavior.delays = { kw: 300, wy: 40 }
    const attempts = []
    const result = await h.utils.getOnlineOtherSourceMusicUrl({
      musicInfos: [music('kw', 'a6-slow'), music('wy', 'a6-fast')],
      quality: '128k',
      isRefresh: true,
      retryedSource: [],
      onToggleSource: () => {},
      attempts,
    })
    assert.strictEqual(result.musicInfo.source, 'wy', `应返回先成功的 wy，实际 ${result.musicInfo.source}`)
    await sleep(350)
    assert.deepStrictEqual(attempts.map(x => x.source), ['wy'], `晚到候选写入了 attempts：${attempts.map(x => x.source)}`)
  })

  console.log(`\n===== P1 运行时所有权审计：${checks} 通过 / ${failures} 失败 =====`)
  process.exit(failures ? 1 : 0)
})()
