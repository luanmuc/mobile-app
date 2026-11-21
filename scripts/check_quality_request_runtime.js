#!/usr/bin/env node
/**
 * 音质请求档运行时断言（P0）
 * 真实加载 src/core/music/utils.ts，stub 外部依赖，
 * 验证自定义源按 qualityList 请求设置档，内置源保持 _qualitys 裁剪。
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
    // R74：源码迁到 file logger 后，加载器统一给 @/utils/logger 兜桩。
    // 不给桩会 fall through 到真实文件，logger.ts 再拉 react-native-fs 与 store → 未 mock 崩。
    if (id === '@/utils/logger') {
      return {
        logger: { info() {}, warn() {}, error() {}, debug() {}, musicResolve() {}, player() {} },
        toLogText: (v) => String(v),
      }
    }
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

const makeMusicInfo = (source, qualitys = {}) => ({
  source,
  id: `${source}_test`,
  name: '测试歌曲',
  singer: '测试歌手',
  interval: '00:00',
  meta: { albumName: '', _qualitys: qualitys },
})

const makeSetup = (qualityList = { kw: ['128k', '320k', 'flac'], tx: ['128k', '320k', 'flac'] }, fallbackOwners = { kw: 'source', tx: 'host' }, musicSdk = {}) => {
  global.lx = {
    qualityList,
    fallbackOwners,
    apis: { kw: { getMusicUrl: () => ({}) } },
    apiInitPromise: [true],
  }
  const settingState = { setting: { 'player.playQuality': 'flac' } }
  const noop = () => {}
  const apiImpl = { kw: { getMusicUrl: () => ({}) }, tx: undefined }
  const mod = loadTs('src/core/music/utils.ts', {
    '@/utils/musicSdk': { __esModule: true, default: musicSdk, findMusic: async() => [] },
    '@/utils/data': { getMusicUrl: async() => '', getPlayerLyric: async() => null, getStoreMusicSource: async() => null },
    '@/utils': { langS2T: async(s) => s, toNewMusicInfo: (v) => v, toOldMusicInfo: (v) => v },
    '@/utils/tools': { assertApiSupport: () => true },
    '@/store/setting/state': { __esModule: true, default: settingState },
    '@/utils/log': { log: { diagnose: noop, info: noop, warn: noop, error: noop } },
    '@/utils/message': { requestMsg: { tooManyRequests: '请求过于频繁' } },
    'react-native-background-timer': { __esModule: true, default: { setTimeout: () => 1, clearTimeout: noop } },
    '@/utils/musicSdk/api-source': { apis: apiImpl },
    '@/core/init/userApi/sourceContract': { shouldHostFallback: (owner) => owner !== 'source' },
    './playbackBudget': {
      classifyPlaybackErrorCode: () => 'PLAY_FAIL',
      createBudgetExhaustedError: (attempts) => Object.assign(new Error('BUDGET'), { attempts }),
      createPlaybackBudget: () => ({ startedAt: 0, deadline: 1e9, totalMs: 1e9 }),
      isBudgetExhausted: () => false,
      racePlaybackCandidates: async() => { throw new Error('not used') },
      raceWithBudget: async(p) => p,
      resolvePlaybackOwner: (owner) => owner === 'source' ? 'source' : 'host',
    },
    './otherSourceCache': {
      createOtherSourceCache: () => new Map(),
      readOtherSourceCache: () => undefined,
      writeOtherSourceCache: noop,
      OTHER_SOURCE_CACHE_TTL_MS: 1,
      OTHER_SOURCE_NEGATIVE_TTL_MS: 1,
    },
  })
  return { mod, settingState }
}

console.log('\n[P0 quality request]')
run('P0-1 自定义源：list=flac、_qualitys=128k → 请求 flac', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('kw', { '128k': true })), 'flac')
})
run('P0-2 自定义源：list=flac、_qualitys=128k+320k → 请求 flac', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('kw', { '128k': true, '320k': true })), 'flac')
})
run('P0-3 自定义源：list=320k、_qualitys=128k → 请求 320k', async() => {
  const { mod } = makeSetup({ kw: ['128k', '320k'] })
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('kw', { '128k': true })), '320k')
})
run('P0-4 自定义源：list=128k → 请求 128k', async() => {
  const { mod } = makeSetup({ kw: ['128k'] })
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('kw', { '128k': true })), '128k')
})
run('P0-5 内置源：list=flac、_qualitys=128k → 保持 128k', async() => {
  const { mod } = makeSetup({ tx: ['128k', '320k', 'flac'] }, { tx: 'host' })
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('tx', { '128k': true })), '128k')
})
run('P0-6 内置源：list=flac、_qualitys=flac → 保持 flac', async() => {
  const { mod } = makeSetup({ tx: ['128k', '320k', 'flac'] }, { tx: 'host' })
  assert.strictEqual(mod.getPlayQuality('flac', makeMusicInfo('tx', { flac: true })), 'flac')
})
run('P0-7 设置 320k 不越级到 flac', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.getPlayQuality('320k', makeMusicInfo('kw', { '128k': true })), '320k')
})
run('P0-8 设置 128k 不升档', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.getPlayQuality('128k', makeMusicInfo('kw', { flac: true })), '128k')
})
run('P0-9 下载：自定义源 list=flac、_qualitys=128k → flac', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.getDownloadQuality('flac24bit', makeMusicInfo('kw', { '128k': true })), 'flac')
})
run('P0-10 下载：自定义源 list 空 → 128k', async() => {
  const { mod } = makeSetup({ kw: [] })
  assert.strictEqual(mod.getDownloadQuality('flac24bit', makeMusicInfo('kw', { '128k': true })), '128k')
})
run('P1-E2E 自定义源端到端：设置 flac、搜索无 flac 标记 → 实收 type=flac，attempts 带请求/交付档', async() => {
  let requested = ''
  const { mod } = makeSetup(undefined, undefined, {
    kw: {
      getMusicUrl: (_info, quality) => {
        requested = quality
        return { promise: Promise.resolve({ url: 'https://example.com/a.flac', type: 'flac' }) }
      },
    },
  })
  const result = await mod.handleGetOnlineMusicUrl({
    musicInfo: makeMusicInfo('kw', { '128k': true }),
    isRefresh: true,
    allowToggleSource: true,
    onToggleSource: () => {},
  })
  assert.strictEqual(requested, 'flac')
  assert.strictEqual(result.requestedQuality, 'flac')
  assert.strictEqual(result.quality, 'flac')
  assert.strictEqual(result.attempts.length, 1)
  assert.strictEqual(result.attempts[0].requestedQuality, 'flac')
  assert.strictEqual(result.attempts[0].deliveredQuality, 'flac')
})

run('P1-CACHE 片段缓存命中：缓存里 fragment=true 时，onSource/onFragment 必须保留试听语义', async() => {
  let seenSource = null
  let seenFragment = false
  const online = loadTs('src/core/music/online.ts', {
    '@/utils/data': {
      saveLyric: async() => {},
      saveMusicUrl: async() => {},
      saveMusicSource: async() => {},
      getMusicUrl: async() => 'https://example.com/fragment.m4a',
      getStoreMusicSource: async() => ({ id: 'kw', name: '酷我音乐', platform: 'kw', fragment: true }),
    },
    '@/core/list': { updateListMusics: () => {} },
    '@/store/setting/state': { __esModule: true, default: { setting: { 'player.playQuality': 'flac' } } },
    './utils': {
      buildLyricInfo: () => null,
      getPlayQuality: () => 'flac',
      handleGetOnlineLyricInfo: async() => null,
      handleGetOnlineMusicUrl: async() => { throw new Error('cache hit should not call network') },
      handleGetOnlinePicUrl: async() => null,
      getCachedLyricInfo: async() => null,
    },
    '@/utils/log': { log: { diagnose: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
    '@/core/healthLog': { createHealthTraceId: () => 't', recordCacheHit: async() => {}, recordPlayResult: async() => {}, setPendingPlayback: () => {} },
  })
  const url = await online.getMusicUrl({
    musicInfo: makeMusicInfo('kw', { flac: true }),
    isRefresh: false,
    onSource: (source) => { seenSource = source },
    onFragment: (fragment) => { seenFragment = fragment },
  })
  assert.strictEqual(url, 'https://example.com/fragment.m4a')
  assert.strictEqual(seenFragment, true)
  assert.strictEqual(seenSource?.fragment, true)
})

Promise.all(tasks).then(() => {
  console.log(`\n===== P0 音质请求档：${checks} 通过 / ${failures} 失败 =====`)
  if (failures) process.exit(1)
})
