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
    if (id.startsWith('@/')) {
      // '@' 别名指向 src；门禁加载器原来只认相对路径，新模块用别名导入会 Cannot find module
      const target = path.join(ROOT, 'src', id.slice(2))
      if (fs.existsSync(target + '.ts')) return loadTs(path.relative(ROOT, target + '.ts'), stubs)
      if (fs.existsSync(target + '.js')) return require(target + '.js')
      const idx = path.join(target, 'index.ts')
      if (fs.existsSync(idx)) return loadTs(path.relative(ROOT, idx), stubs)
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
let knownFailed = 0
// A13-P1-01：原来 `run` 同步调用 fn() 后立刻记 ✓，完全不看返回的 Promise ——
// 用例体内 `await flush()` 之后的断言抛错只会变成未处理 rejection，既不计失败也不退码（假绿）。
// 改为把每个用例包成 async task 收集起来，最后串行跑完再统计（串行是为了保持原本的
// 严格顺序语义，避免并发让 timer 交错引入新的假红/假绿）。
const { AsyncLocalStorage } = require('async_hooks')
// K31：产品代码读 global.app_event / global.lx 这类**全局单例**（真机只有一个实例，产品侧没问题）。
// 但本门禁的 run() 是「立即启动、到第一个 await 让出」的交错并发：后一个 setup() 会把 global
// 覆盖成自己的，前一个用例的监听器回调里读到的就是别人的 mock。
// 这里把这两个键改成 getter，值来自 AsyncLocalStorage 中**当前用例**的 scoped 袋；
// 用例之外（如门禁自身初始化）回落到 FALLBACK，行为与原来一致。
const caseStore = new AsyncLocalStorage()
const SCOPE_FALLBACK = {}
for (const key of ['app_event', 'lx']) {
  Object.defineProperty(global, key, {
    configurable: true,
    enumerable: true,
    get() {
      const store = caseStore.getStore()
      return (store && store.scoped && store.scoped[key]) !== undefined
        ? store.scoped[key]
        : SCOPE_FALLBACK[key]
    },
    set(v) { SCOPE_FALLBACK[key] = v },
  })
}
/** 取当前用例的私有袋；setup() 只能跑在 run() 的异步上下文里 */
const currentScope = () => {
  const store = caseStore.getStore()
  if (!store) throw new Error('setup() 必须在 run() 的异步上下文中调用')
  return store.scoped
}

const tasks = []
// A13-P1-01：**立即启动**每个用例（保持原实现「调用 fn 立即跑到第一个 await」的副作用时机，
// 也就是原本就存在的交错并发语义），只把返回的 promise 收集起来等最终结果。
// 之前试过「收集成函数、末尾串行 await」的写法 → 时序被整体推迟，core 5 条 / service 9 条
// 用例变成假红（断言依赖 run 之间对 mock 的即时修改），故必须保持立即启动 + Promise.all。
const passedNames = []
// A13-P1-01：这组用例原先靠「run 同步调用 fn、完全不看返回的 promise」把失败吞掉（假绿）。
// 修成真正 await 后暴露 16 条历史失败（core 6 / hook 1 / service 9）。根因是用例自身缺陷：
// service 全部是 `h.listeners[...] is not a function`（mock 的监听器注册机制让用例拿不到），
// core 是 mock 缺 getRandom / 用例间共享可变状态。不是产品代码 bug，但也不能继续装作全绿。
// 处理：显式登记基线失败 —— 白名单内只告警不计红；白名单外（新增回归）照常判红并退码。
// 白名单里已通过的用例会打印提示，说明债已还、可以删条目。
// K31 收尾：本组用例的历史失败已全部还清（见上），白名单置空。
// 保留空 Map 与下方判定逻辑，后续若再暴露历史债仍可逐条登记。
const KNOWN_FAILED = new Map()

const run = (name, fn) => {
  // K31：每个用例一个私有 scoped 袋，交错并发下 global.* 不再互相覆盖
  const task = caseStore.run({ scoped: {} }, async() => {
    try {
      await fn()
      checks++
      passedNames.push(name)
      console.log(`  ✓ ${name}`)
    } catch (e) {
      if (KNOWN_FAILED.has(name)) {
        knownFailed++
        console.log(`  ⚠ ${name}（已知遗留失败：${KNOWN_FAILED.get(name)}）`)
        return
      }
      failures++
      console.error(`  ✗ ${name}`)
      console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
    }
  })
  tasks.push(task)
  return task
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const mkMusic = (id = 'm1', name = '夜曲') => ({ id, name, singer: '周杰伦', source: 'kw' })

const setup = (over = {}) => {
  const scoped = currentScope()
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
  scoped.lx = {
    isPlayedStop: false,
    gettingUrlId: 'm1',
    playerTrackId: '',
    playInfo: {},
    apis: {},
  }
  global.i18n = { t: k => k }
  scoped.app_event = { stop: () => {} }
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
    // K31：产品是 `getRandom(0, filteredList.length)`（player.ts:445），必须是被调用的函数；
    // 原来 mock 成数字 0 → PC14 报 "getRandom is not a function"。
    '@/utils/common': { getRandom: () => over.random === undefined ? 0 : over.random },
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
    // K31：真实 filterList（src/core/player/utils.ts）的契约是「拿 playerMusicInfo 在列表里
    // findIndex 出 playerIndex」，调用方 player.ts:430 也只传 list/listId/playedList/playerMusicInfo/isNext。
    // 原 mock 却从入参解构 playerIndex（调用方根本不给）→ 恒为 undefined → 下游 filteredList[undefined] 为
    // undefined → PC11/PC12/PC13 全红。按真实契约重写。
    './utils': {
      filterList: over.filterList || (async({ list, playedList = [], playerMusicInfo }) => {
        const filteredList = list.filter(m => !playedList.some(p => p.musicInfo && p.musicInfo.id === m.id))
        const playerIndex = playerMusicInfo ? filteredList.findIndex(m => m.id === playerMusicInfo.id) : -1
        return { filteredList, playerIndex }
      }),
    },
    // player.ts 经 volumeFade 间接 import 了原生桥；Node 里无法加载真实 RN 包（ESM + 原生绑定）
    'react-native-track-player': {
      __esModule: true,
      default: { setVolume: async() => {}, play: async() => {}, pause: async() => {} },
    },
    // player.ts 经 equalizer 控制器间接 import 原生均衡器桥；Node 里没有原生模块，直接 stub 掉
    '@/plugins/equalizer': {
      isSupported: () => false,
      bind: async() => false,
      getInfo: async() => null,
      applyBands: async() => false,
      setEnabled: async() => false,
      release: async() => {},
    },
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
  // K31：产品 player.ts:417-425 的语义是「从当前曲在已播放列表里的位置往后扫，
  // 遇到『已从播放列表删除』的就 removePlayedList(index) 并继续，
  // 遇到第一首仍存在的就 break —— 因为那首就是下一首，不必再往后找」。
  // 原用例把仍在列表的 'a' 排在 'gone' 前面，扫到 'a' 立即 break，清理分支根本到不了。
  // 按真实语义把待删除项排在前面。
  const h = setup({
    mode: 'listLoop',
    playerIndex: 0,
    playedList: [
      { musicInfo: mkMusic('gone'), listId: 'list1' },
      { musicInfo: mkMusic('a'), listId: 'list1' },
    ],
  })
  const next = await h.mod.getNextPlayMusicInfo()
  assert.strictEqual(h.calls.removePlayed, 1, '已从列表删除的已播放项应被清理')
  // 清理后 index 停在第一首仍存在的已播放项上，产品直接把它作为结果返回
  assert.strictEqual(next.musicInfo.id, 'a')
})

Promise.all(tasks).then(() => {
  const staleWhitelist = [...KNOWN_FAILED.keys()].filter(k => passedNames.includes(k))
  if (staleWhitelist.length) {
    console.log('\n提示：以下白名单条目本次已通过，可从 KNOWN_FAILED 删除：')
    for (const k of staleWhitelist) console.log('  - ' + k)
  }
  console.log(`\n===== N2 播放器核心：${checks} 通过 / ${failures} 新增失败 / ${knownFailed} 已知遗留 =====`)
  process.exit(failures ? 1 : 0)
})
