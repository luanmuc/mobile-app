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
  const behavior = { primary: 'ok', candidates: [], delays: {}, failCodes: {}, picUrl: 'https://mock/pic.jpg', lyric: '[00:00.00]mock lyric', storeLyric: null }
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
    sdk[source].getPic = async() => behavior.picUrl
    sdk[source].getLyric = () => ({ promise: Promise.resolve({ lyric: behavior.lyric, tlyric: '', rlyric: '', lxlyric: '' }) })
  }
  const findMusic = async(info) => {
    counts.findMusic.push(info)
    return behavior.candidates
  }
  const stubs = {
    '@/utils/musicSdk': { __esModule: true, default: sdk, findMusic },
    '@/utils/data': {
      getMusicUrl: async() => null,
      getPlayerLyric: async() => behavior.storeLyric,
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
    '@/utils/musicSdk/api-source': {
      apis: () => ({
        getMusicUrl: () => ({ promise: Promise.resolve({ url: 'https://mock/local/url.mp3' }) }),
        getLyric: () => ({ promise: Promise.resolve({ lyric: '[00:00.00]local lyric', tlyric: '', rlyric: '', lxlyric: '' }) }),
        getPic: () => ({ promise: Promise.resolve('https://mock/local/pic.jpg') }),
      }),
    },
    '@/core/init/userApi/sourceContract': { shouldHostFallback: (owner) => owner !== 'source' },
  }
  global.lx = {
    apiInitPromise: [Promise.resolve(true)],
    fallbackOwners: {},
    qualityList: { kw: ['128k'], wy: ['128k'], tx: ['128k'] },
  }
  global.i18n = { t: (key) => key }
  const utils = loadTs('src/core/music/utils.ts', stubs)
  return { utils, sdk, counts, behavior, settings: stubs['@/store/setting/state'].default.setting }
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

  console.log('\n[播放纯函数行为]')
  await run('P1U-Q1 getPlayQuality 高音质可用时取请求档', async() => {
    const h = setup()
    global.lx.qualityList.kw = ['flac24bit', 'flac', '320k', '128k']
    const info = music('kw', 'q1', { meta: { _qualitys: { flac24bit: true, flac: true, '320k': true, '128k': true } } })
    assert.strictEqual(h.utils.getPlayQuality('flac', info), 'flac')
    assert.strictEqual(h.utils.getPlayQuality('flac24bit', info), 'flac24bit')
  })

  await run('P1U-Q2 getPlayQuality 请求档不可用时回退 128k', async() => {
    const h = setup()
    global.lx.qualityList.kw = ['flac', '128k']
    const info = music('kw', 'q2', { meta: { _qualitys: { '128k': true } } })
    assert.strictEqual(h.utils.getPlayQuality('flac', info), '128k')
    assert.strictEqual(h.utils.getPlayQuality('320k', info), '128k')
  })

  await run('P1U-Q3 getDownloadQuality 按完整音质表回退', async() => {
    const h = setup()
    global.lx.qualityList.kw = ['flac', 'wav', '320k', '128k']
    const info = music('kw', 'q3', { meta: { _qualitys: { wav: true, '128k': true } } })
    assert.strictEqual(h.utils.getDownloadQuality('flac', info), 'wav')
    assert.strictEqual(h.utils.getDownloadQuality('ape', info), '128k')
  })

  await run('P1U-L1 getPlayQualityLabel 实际音质标签', () => {
    const h = setup()
    assert.strictEqual(h.utils.getPlayQualityLabel('flac24bit'), 'FLAC24')
    assert.strictEqual(h.utils.getPlayQualityLabel('320k'), '320K')
    assert.strictEqual(h.utils.getPlayQualityLabel('m4a'), 'M4A')
    assert.strictEqual(h.utils.getPlayQualityLabel(''), '')
  })

  await run('P1U-E1 formatPlayError 错误码中文化', () => {
    const h = setup()
    global.i18n.t = (key) => key === 'player__error' ? '播放失败' : key
    assert.strictEqual(h.utils.formatPlayError(fail('NOT_FOUND')), '歌曲不可用：mock')
    assert.strictEqual(h.utils.formatPlayError(new Error('PREVIEW_FRAGMENT: 该曲目只提供试听片段')), '仅提供试听片段：该曲目只提供试听片段')
    assert.strictEqual(h.utils.formatPlayError(new Error('WEIRD_CODE: x')), 'WEIRD_CODE：x')
  })

  await run('P1U-E2 formatPlayError 聚合明细与兜底截断', () => {
    const h = setup()
    global.i18n.t = (key) => key === 'player__error' ? '播放失败' : key
    const agg = h.utils.formatPlayError(new Error('NOT_AUDIO: 所有源均失败 [[flac] wyOuter=NOT_AUDIO | [128k] kw=NOT_AUDIO]'))
    assert(agg.startsWith('返回的不是有效音频：'), agg)
    assert(agg.includes('wyOuter=NOT_AUDIO'), agg)
    assert(agg.includes('kw=NOT_A'), agg)
    const long = h.utils.formatPlayError(new Error('x'.repeat(60)))
    assert.strictEqual(long.length, 41, `无码长文本应截断到 40+省略号，实际 ${long.length}`)
    assert.strictEqual(h.utils.formatPlayError({}), '播放失败', '空错误回退 i18n 兜底文案')
  })

  console.log('\n[歌词/封面获取行为]')
  await run('P1U-Y1 buildLyricInfo 关闭简繁转换时补 rawlrcInfo', async() => {
    const h = setup()
    const input = { lyric: '[00:00.00]a', tlyric: '', rlyric: '', lxlyric: '' }
    const out = await h.utils.buildLyricInfo(input)
    assert.strictEqual(out.lyric, '[00:00.00]a')
    assert(out.rawlrcInfo && out.rawlrcInfo.lyric === input.lyric, '未补 rawlrcInfo')
  })

  await run('P1U-Y2 buildLyricInfo 开启简繁转换时转换四轨', async() => {
    const h = setup()
    h.settings['player.isS2t'] = true
    const out = await h.utils.buildLyricInfo({ lyric: 'a', tlyric: 'b', rlyric: 'c', lxlyric: 'd' })
    assert(out.lyric === 'a' && out.tlyric === 'b' && out.rlyric === 'c' && out.lxlyric === 'd', '四轨转换不符')
    assert(out.rawlrcInfo && out.rawlrcInfo.lyric === 'a', 'S2T 时也应保留原文')
  })

  await run('P1U-Y3 getCachedLyricInfo 命中缓存与平台白名单', async() => {
    const h = setup()
    h.behavior.storeLyric = { lyric: '[00:00.00]cached', tlyric: '', rlyric: null, lxlyric: null }
    assert((await h.utils.getCachedLyricInfo(music('kw', 'l-cache'))).lyric === '[00:00.00]cached', 'kw 应收下带时间轴缓存')
    assert(await h.utils.getCachedLyricInfo(music('wy', 'l-cache2')) === null, 'wy 缺 rlyric 应返回 null 触发在线拉取')
  })

  await run('P1U-Y4 本地歌曲取链/歌词/封面', async() => {
    const h = setup()
    h.behavior.storeLyric = { lyric: '[00:00.00]cached', tlyric: '', rlyric: null, lxlyric: null }
    const info = { ...music('local', 'loc-1'), source: 'local' }
    const u = await h.utils.getOnlineOtherSourceMusicUrlByLocal(info, true)
    assert(u.url === 'https://mock/local/url.mp3' && u.quality === '128k' && u.isFromCache === false, '本地取链不符')
    const l = await h.utils.getOnlineOtherSourceLyricByLocal(info, true)
    assert(l.lyricInfo.lyric === '[00:00.00]local lyric' && l.isFromCache === false, '本地歌词不符')
    const p = await h.utils.getOnlineOtherSourcePicByLocal(info)
    assert(p.url === 'https://mock/local/pic.jpg', '本地封面不符')
  })

  await run('P1U-Y5 getOnlineOtherSourcePicUrl 优先缓存封面', async() => {
    const h = setup()
    const r = await h.utils.getOnlineOtherSourcePicUrl({ musicInfos: [music('kw', 'p-cache', { meta: { picUrl: 'https://cached/pic.jpg' } })], onToggleSource: () => {}, isRefresh: false })
    assert(r.url === 'https://cached/pic.jpg' && r.isFromCache === true, '封面缓存优先不符')
  })

  await run('P1U-Y6 handleGetOnlinePicUrl 走平台封面接口', async() => {
    const h = setup()
    const r = await h.utils.handleGetOnlinePicUrl({ musicInfo: music('kw', 'p-net'), isRefresh: true, onToggleSource: () => {}, allowToggleSource: false })
    assert(r.url === 'https://mock/pic.jpg' && r.isFromCache === false, '在线封面不符')
  })

  await run('P1U-Y7 getOnlineOtherSourceLyricInfo 换源拉歌词', async() => {
    const h = setup()
    const r = await h.utils.getOnlineOtherSourceLyricInfo({ musicInfos: [music('kw', 'l-net')], onToggleSource: () => {}, isRefresh: true })
    assert(r.lyricInfo.lyric === '[00:00.00]mock lyric' && r.isFromCache === false, '在线歌词不符')
  })

  await run('P1U-Y8 handleGetOnlineLyricInfo 走平台歌词接口', async() => {
    const h = setup()
    const r = await h.utils.handleGetOnlineLyricInfo({ musicInfo: music('kw', 'l-main'), onToggleSource: () => {}, isRefresh: true, allowToggleSource: false })
    assert(r.lyricInfo.lyric === '[00:00.00]mock lyric' && r.isFromCache === false, '主平台歌词不符')
  })

  console.log(`\n===== P1 运行时所有权审计：${checks} 通过 / ${failures} 失败 =====`)
  process.exit(failures ? 1 : 0)
})()
