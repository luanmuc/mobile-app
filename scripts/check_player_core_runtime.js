#!/usr/bin/env node
/**
 * 播放器核心运行时断言（N2 / core）
 * 真实加载 src/core/player/player.ts，只 mock 原生/Store/网络边界，
 * 覆盖播控入口、收藏/不喜欢、下一曲模式与临时列表/已播放列表分支。
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
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++; console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const mkMusic = (id = 'm1', name = '夜曲') => ({ id, name, singer: '周杰伦', source: 'kw' })

const setup = (over = {}) => {
  const state = {
    playMusicInfo: { musicInfo: over.music === undefined ? mkMusic() : over.music, listId: 'list1', isTempPlay: false },
    playInfo: { playerListId: over.listId === undefined ? 'list1' : over.listId, playerPlayIndex: over.playerIndex || 0 },
    isPlay: false,
    tempPlayList: over.tempPlayList || [],
    playedList: over.playedList || [],
    playQuality: '128k',
    playSource: null,
  }
  const settingState = {
    setting: {
      'player.togglePlayMethod': over.mode || 'listLoop',
      'player.isAutoCleanPlayedList': false,
      'list.addMusicLocationType': 'top',
    },
  }
  const lists = over.lists || { list1: [mkMusic('a'), mkMusic('b'), mkMusic('c')] }
  const calls = { setPlay: 0, setPause: 0, setStop: 0, setResource: 0, initTrackInfo: 0, addList: 0, removeList: 0, dislike: 0, removePlayed: 0, removeTemp: 0 }
  const playerApi = {
    isInitialized: true,
    isEmpty: () => over.isEmpty === true,
    setPlay: () => { calls.setPlay++ },
    setPause: async() => { calls.setPause++ },
    setStop: async() => { calls.setStop++ },
    setResource: () => { calls.setResource++ },
    initial: () => { calls.initTrackInfo++ },
    initTrackInfo: () => { calls.initTrackInfo++ },
  }
  const playerActions = { setPlayQuality: () => {}, setPlaySource: () => {}, setStatusText: () => {} }
  global.lx = {
    isPlayedStop: false,
    gettingUrlId: 'm1',
    playerTrackId: '',
    playInfo: {},
    apis: {},
  }
  global.i18n = { t: k => k }
  global.app_event = { stop: () => {} }
  const mod = loadTs('src/core/player/player.ts', {
    '@/plugins/player': playerApi,
    '@/store/player/state': { __esModule: true, default: state },
    '@/store/setting/state': { __esModule: true, default: settingState },
    '@/store/player/action': { __esModule: true, default: playerActions },
    '@/core/player/playInfo': {
      getList: id => lists[id] || [],
      setPlayMusicInfo: () => {},
      setMusicInfo: () => {},
      setPlayListId: () => {},
    },
    '@/core/player/playedList': {
      clearPlayedList: () => {},
      addPlayedList: () => {},
      removePlayedList: () => { calls.removePlayed++ },
    },
    '@/core/player/tempPlayList': {
      clearTempPlayeList: () => {},
      removeTempPlayList: () => { calls.removeTemp++ },
    },
    '@/core/music': {
      getMusicUrl: async() => 'https://audio.test/a.mp3',
      getPicPath: async() => '',
      getLyricInfo: async() => ({}),
    },
    '@/core/music/utils': { formatPlayError: e => String(e) },
    '@/utils/message': { requestMsg: { tooManyRequests: 'tooManyRequests', cancelRequest: 'cancelRequest' } },
    '@/utils/common': { getRandom: over.random === undefined ? 0 : over.random },
    '@/utils/logger': { logger: { error: () => {}, musicResolve: () => {} } },
    '@/utils/tools': {
      checkIgnoringBatteryOptimization: async() => {},
      checkNotificationPermission: async() => {},
      debounceBackgroundTimer: fn => fn,
      toast: () => {},
    },
    '@/config/constant': { LIST_IDS: { LOVE: 'love' } },
    '@/core/list': {
      addListMusics: () => { calls.addList++ },
      removeListMusics: () => { calls.removeList++ },
    },
    '@/core/dislikeList': { addDislikeInfo: async() => { calls.dislike++ } },
    '@/core/player/repeatMode': { syncNotificationRepeatMode: () => {} },
    '@/core/desktopLyric': { syncLyricButtonByState: () => {} },
    '@/core/player/playStatus': { setStatusText: () => {} },
    './utils': { filterList: over.filterList || (async({ list, playerIndex }) => ({ filteredList: list, playerIndex })) },
    'react-native-background-timer': {
      __esModule: true,
      default: { setTimeout: () => 1, clearTimeout: () => {} },
    },
  })
  return { mod, state, settingState, lists, calls }
}

console.log('\n[N2 player core]')

run('N2-PC1 无当前歌曲时 play 不触碰原生', () => {
  const h = setup({ music: null })
  h.mod.play()
  assert.strictEqual(h.calls.setPlay, 0)
})

run('N2-PC2 有可用 URL 时 play 调 setPlay', () => {
  const h = setup({ isEmpty: false })
  h.mod.play()
  assert.strictEqual(h.calls.setPlay, 1)
})

run('N2-PC3 pause 调 setPause', async() => {
  const h = setup()
  await h.mod.pause()
  assert.strictEqual(h.calls.setPause, 1)
})

run('N2-PC4 stop 调 setStop 并触发 app_event.stop', async() => {
  const h = setup()
  let stopped = false
  global.app_event.stop = () => { stopped = true }
  await h.mod.stop()
  await flush()
  assert.strictEqual(h.calls.setStop, 1)
  assert.strictEqual(stopped, true)
})

run('N2-PC5 togglePlay 在 isPlay 时走 pause，否则走 play', async() => {
  const h1 = setup({ isEmpty: false })
  h1.state.isPlay = true
  h1.mod.togglePlay()
  await flush()
  assert.strictEqual(h1.calls.setPause, 1)
  assert.strictEqual(h1.calls.setPlay, 0)

  const h2 = setup({ isEmpty: false })
  h2.state.isPlay = false
  h2.mod.togglePlay()
  assert.strictEqual(h2.calls.setPlay, 1)
})

run('N2-PC6 collectMusic 空歌曲不写收藏，普通歌曲写列表', () => {
  const h = setup({ music: null })
  h.mod.collectMusic()
  assert.strictEqual(h.calls.addList, 0)
  h.state.playMusicInfo.musicInfo = mkMusic('m1')
  h.mod.collectMusic()
  assert.strictEqual(h.calls.addList, 1)
})

run('N2-PC7 uncollectMusic 临时列表项取 metadata.musicInfo.id', () => {
  const h = setup({ music: null })
  h.mod.uncollectMusic()
  assert.strictEqual(h.calls.removeList, 0)
  h.state.playMusicInfo.musicInfo = { id: 'd1', metadata: { musicInfo: mkMusic('inner') }, progress: {} }
  h.mod.uncollectMusic()
  assert.strictEqual(h.calls.removeList, 1)
})

run('N2-PC8 dislikeMusic 空歌曲不写不喜欢', async() => {
  const h = setup({ music: null })
  await h.mod.dislikeMusic()
  assert.strictEqual(h.calls.dislike, 0)
})

run('N2-PC9 getNextPlayMusicInfo 优先取稍后播放列表', async() => {
  const item = { musicInfo: mkMusic('temp'), listId: 'temp', isTempPlay: true }
  const h = setup({ tempPlayList: [item] })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.deepStrictEqual(next, item)
})

run('N2-PC10 无歌曲/无列表时 getNextPlayMusicInfo 返回 null', async() => {
  const h1 = setup({ music: null })
  assert.strictEqual(await h1.mod.getNextPlayMusicInfo(), null)
  const h2 = setup({ listId: '' })
  assert.strictEqual(await h2.mod.getNextPlayMusicInfo(), null)
})

run('N2-PC11 listLoop 末曲回绕到首曲', async() => {
  const h = setup({ mode: 'listLoop', playerIndex: 2 })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.strictEqual(next.musicInfo.id, 'a')
})

run('N2-PC12 list 模式末曲返回 null，不越界', async() => {
  const h = setup({ mode: 'list', playerIndex: 2 })
  assert.strictEqual(await h.mod.getNextPlayMusicInfo(), null)
})

run('N2-PC13 singleLoop 保持在当前曲', async() => {
  const h = setup({ mode: 'singleLoop', playerIndex: 1 })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.strictEqual(next.musicInfo.id, 'b')
})

run('N2-PC14 random 模式走 getRandom 并缓存下一次结果', async() => {
  const h = setup({ mode: 'random', random: 1 })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.strictEqual(next.musicInfo.id, 'b')
  const again = await h.mod.getNextPlayMusicInfo()
  assert.deepStrictEqual(again, next)
})

run('N2-PC15 已播放列表里被删除的歌曲会被清理', async() => {
  const h = setup({
    mode: 'listLoop',
    playerIndex: 0,
    playedList: [
      { musicInfo: mkMusic('a'), listId: 'list1' },
      { musicInfo: mkMusic('gone'), listId: 'list1' },
    ],
  })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.strictEqual(h.calls.removePlayed, 1)
  assert.strictEqual(next.musicInfo.id, 'b')
})

console.log(`\n===== N2 播放器核心：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
