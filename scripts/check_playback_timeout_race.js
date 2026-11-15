#!/usr/bin/env node
/**
 * 25s 超时竞态回归：超时已记账后，晚到的成功不得补记成功、不得留 pending。
 * 直接转译生产 online.ts，用假定时器只截获 25s 那一次。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  const localRequire = name => {
    switch (name) {
      case '@/utils/data':
        return {
          saveLyric: async() => {},
          saveMusicUrl: async() => {},
          saveMusicSource: async() => {},
          getMusicUrl: async() => null,
          getStoreMusicSource: async() => null,
        }
      case '@/core/list':
        return { updateListMusics: async() => {} }
      case '@/store/setting/state':
        return { default: { setting: { 'player.playQuality': '128k' } } }
      case './utils':
        return {
          buildLyricInfo: x => x,
          getPlayQuality: () => '128k',
          handleGetOnlineLyricInfo: async() => ({}),
          handleGetOnlineMusicUrl: () => urlDeferred,
          handleGetOnlinePicUrl: async() => ({}),
          getCachedLyricInfo: async() => null,
        }
      case '@/utils/log':
        return { log: { diagnose: () => {} } }
      case '@/core/healthLog':
        return healthMock
      default:
        throw new Error(`未模拟依赖：${name}`)
    }
  }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

let resolveUrl
let rejectUrl
const urlDeferred = new Promise((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
const calls = { play: [], chain: [], pending: [], cache: [], quality: [] }
const healthMock = {
  createHealthTraceId: () => 'trace-timeout',
  recordCacheHit: input => { calls.cache.push(input) },
  recordPlayResult: input => { calls.play.push(input) },
  setPendingPlayback: input => { calls.pending.push(input) },
}
const online = loadTs('src/core/music/online.ts')
const musicInfo = { id: 'song-timeout', name: '超时歌', source: 'kw' }

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const flush = () => new Promise(resolve => setImmediate(resolve))

;(async() => {
  const realSetTimeout = global.setTimeout
  const realClearTimeout = global.clearTimeout
  let timeoutFn = null
  global.setTimeout = (fn, ms, ...args) => {
    if (ms === 25_000) {
      timeoutFn = () => fn(...args)
      return { fakeTimer: true }
    }
    return realSetTimeout(fn, ms, ...args)
  }
  global.clearTimeout = id => {
    if (id && id.fakeTimer) {
      timeoutFn = null
      return
    }
    realClearTimeout(id)
  }
  try {
    const pending = online.getMusicUrl({
      musicInfo,
      quality: '128k',
      isRefresh: true,
      recordPlay: true,
      onQuality: q => { calls.quality.push(q) },
    })
    await flush()
    assert(timeoutFn, '未挂载 25s 超时定时器')
    timeoutFn()
    let err = null
    try { await pending } catch (e) { err = e }
    assert(err && String(err.message).includes('超时'), `超时未 reject：${err}`)
    assert(calls.play.length === 1 && calls.play[0].ok === false, `超时应只记 1 条失败账：${JSON.stringify(calls.play)}`)
    assert(calls.pending.length === 0, '超时后不得留 pending')

    // 晚到成功：不得补写成功账、不得补 pending、不得回放 UI 回调
    resolveUrl({
      url: 'https://example.invalid/late.mp3',
      quality: '128k',
      musicInfo,
      isFromCache: false,
      subSource: 'kw',
      subSourceName: 'kw',
      sourcePlatform: 'kw',
      fragment: false,
      attempts: [{ source: 'kw', owner: 'source', ok: true }],
    })
    await flush()
    await flush()
    assert(calls.play.length === 1, `晚到成功补记了成功账：${JSON.stringify(calls.play)}`)
    assert(calls.pending.length === 0, '晚到成功补留了 pending')
    assert(calls.quality.length === 0, '晚到成功仍触发了 onQuality')
    console.log('✓ T1 25s 超时后晚到成功不补账、不留 pending')
    console.log('\n1 passed, 0 failed')
  } catch (e) {
    console.log(`✗ T1 25s 超时后晚到成功不补账、不留 pending — ${e.message}`)
    console.log('\n0 passed, 1 failed')
    process.exitCode = 1
  } finally {
    global.setTimeout = realSetTimeout
    global.clearTimeout = realClearTimeout
    rejectUrl(new Error('test end'))
  }
})()
