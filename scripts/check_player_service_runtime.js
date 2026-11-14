#!/usr/bin/env node
/**
 * 播放器通知栏服务运行时断言（N2 / service）
 * 真实加载 src/plugins/player/service.ts，mock TrackPlayer 与业务边界，
 * 覆盖注册幂等、远程按键路由、通知栏/桌面歌词/播放模式按钮、播放状态回传。
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
const TPState = { None: 'none', Ready: 'ready', Stopped: 'stopped', Paused: 'paused', Playing: 'playing', Buffering: 'buffering', Connecting: 'connecting' }
const TPEvent = {
  RemotePlay: 'remote-play',
  RemotePause: 'remote-pause',
  RemoteNext: 'remote-next',
  RemotePrevious: 'remote-previous',
  RemoteStop: 'remote-stop',
  RemoteToggleDesktopLyric: 'remote-toggle-desktop-lyric',
  PlaybackError: 'playback-error',
  RemoteSeek: 'remote-seek',
  PlaybackState: 'playback-state',
  PlaybackTrackChanged: 'playback-track-changed',
}

const setup = (over = {}) => {
  const listeners = {}
  const calls = {
    register: 0,
    play: 0,
    pause: 0,
    next: 0,
    prev: 0,
    exit: 0,
    update: 0,
    hide: 0,
    show: 0,
    check: 0,
    toast: 0,
    repeat: 0,
    pauseNative: 0,
    report: [],
  }
  const settingState = {
    setting: {
      'desktopLyric.enable': over.desktopLyric === undefined ? false : over.desktopLyric,
      'player.togglePlayMethod': over.mode || 'listLoop',
    },
  }
  const playerState = {
    playSource: over.playSource === undefined ? { id: 's1', platform: 'kw' } : over.playSource,
    playQuality: '128k',
  }
  const trackPlayer = {
    addEventListener: (event, cb) => { listeners[event] = cb; return { remove: () => {} } },
    registerPlaybackService: fn => { calls.register++; global.__registered = fn },
    pause: async() => { calls.pauseNative++ },
  }
  global.lx = {
    isPlayedStop: false,
    gettingUrlId: '',
    playerTrackId: 't1',
    playerStatus: { isRegisteredService: false },
    apis: {
      kw: {
        reportPlayback: (id, data) => {
          calls.report.push({ id, ...data })
          return { promise: Promise.resolve() }
        },
      },
    },
  }
  global.i18n = { t: k => k }
  global.app_event = {
    error: () => {},
    playerError: () => {},
    setProgress: p => { calls.progress = p },
    playerPause: () => { calls.playerPause = (calls.playerPause || 0) + 1 },
    pause: () => { calls.pauseEvent = (calls.pauseEvent || 0) + 1 },
    playerPlaying: () => { calls.playerPlaying = (calls.playerPlaying || 0) + 1 },
    play: () => { calls.playEvent = (calls.playEvent || 0) + 1 },
    playerWaiting: () => { calls.waiting = (calls.waiting || 0) + 1 },
    playerLoadstart: () => { calls.loadstart = (calls.loadstart || 0) + 1 },
    playerEnded: () => {},
    playerEmptied: () => {},
  }
  const mod = loadTs('src/plugins/player/service.ts', {
    'react-native-track-player': {
      __esModule: true,
      default: trackPlayer,
      State: TPState,
      Event: TPEvent,
    },
    './utils': { isTempId: () => false, isEmpty: () => false },
    '@/core/common': {
      exitApp: reason => { calls.exit++; calls.exitReason = reason },
      updateSetting: patch => { calls.update++; calls.lastPatch = patch },
    },
    './playList': { getCurrentTrackId: async() => 'track-next' },
    '@/core/player/player': {
      play: () => { calls.play++ },
      pause: async() => { calls.pause++ },
      playNext: async() => { calls.next++ },
      playPrev: async() => { calls.prev++ },
    },
    '@/core/desktopLyric': {
      hideDesktopLyric: async() => { calls.hide++ },
      showDesktopLyric: over.showFail ? async() => { calls.show++; throw new Error('no overlay') } : async() => { calls.show++ },
      checkDesktopLyricOverlayPermission: async() => { calls.check++ },
    },
    '@/store/setting/state': { __esModule: true, default: settingState },
    '@/store/player/state': { __esModule: true, default: playerState },
    '@/config/constant': {
      MUSIC_TOGGLE_MODE_LIST: ['listLoop', 'singleLoop', 'random', 'none'],
      MUSIC_TOGGLE_MODE: { none: 'none' },
    },
    '@/core/player/repeatMode': { syncNotificationRepeatMode: () => { calls.repeat++ } },
    '@/utils/tools': { toast: () => { calls.toast++ } },
  })
  return { mod, listeners, calls, settingState, playerState, trackPlayer }
}

console.log('\n[N2 player service]')

run('N2-SV1 默认导出注册 service，且重复调用不重复注册', () => {
  const h = setup()
  h.mod.default()
  h.mod.default()
  assert.strictEqual(h.calls.register, 1)
  assert.strictEqual(global.lx.playerStatus.isRegisteredService, true)
})

run('N2-SV2 远程播放/暂停/上一曲/下一曲路由正确', async() => {
  const h = setup()
  h.mod.default()
  await global.__registered()
  h.listeners[TPEvent.RemotePlay]()
  await h.listeners[TPEvent.RemotePause]()
  await h.listeners[TPEvent.RemoteNext]()
  await h.listeners[TPEvent.RemotePrevious]()
  assert.strictEqual(h.calls.play, 1)
  assert.strictEqual(h.calls.pause, 1)
  assert.strictEqual(h.calls.next, 1)
  assert.strictEqual(h.calls.prev, 1)
})

run('N2-SV3 RemoteStop 退出 App，RemoteSeek 回传进度', async() => {
  const h = setup()
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.RemoteStop]()
  await h.listeners[TPEvent.RemoteSeek]({ position: 42 })
  assert.strictEqual(h.calls.exit, 1)
  assert.strictEqual(h.calls.exitReason, 'Remote Stop')
  assert.strictEqual(h.calls.progress, 42)
})

run('N2-SV4 通知栏播放模式按钮跳到下一个非 none 模式', async() => {
  const h = setup({ mode: 'listLoop' })
  h.mod.default()
  await global.__registered()
  await h.listeners['remote-cycle-repeat']()
  assert.strictEqual(h.calls.update, 1)
  assert.deepStrictEqual(h.calls.lastPatch, { 'player.togglePlayMethod': 'singleLoop' })
  assert.strictEqual(h.calls.repeat, 1)
})

run('N2-SV5 桌面歌词开启时点按钮关闭', async() => {
  const h = setup({ desktopLyric: true })
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.RemoteToggleDesktopLyric]()
  assert.strictEqual(h.calls.hide, 1)
  assert.deepStrictEqual(h.calls.lastPatch, { 'desktopLyric.enable': false })
})

run('N2-SV6 桌面歌词关闭时先校验权限再开启', async() => {
  const h = setup({ desktopLyric: false })
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.RemoteToggleDesktopLyric]()
  assert.strictEqual(h.calls.check, 1)
  assert.strictEqual(h.calls.show, 1)
  assert.deepStrictEqual(h.calls.lastPatch, { 'desktopLyric.enable': true })
})

run('N2-SV7 开启桌面歌词失败时回滚设置并提示', async() => {
  const h = setup({ desktopLyric: false, showFail: true })
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.RemoteToggleDesktopLyric]()
  assert.strictEqual(h.calls.toast, 1)
  assert.deepStrictEqual(h.calls.lastPatch, { 'desktopLyric.enable': false })
})

run('N2-SV8 Playing 状态回传一次并触发 play 事件，重复 Playing 不重复回传', async() => {
  const h = setup()
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.PlaybackState]({ state: TPState.Playing })
  await h.listeners[TPEvent.PlaybackState]({ state: TPState.Playing })
  assert.strictEqual(h.calls.playEvent, 1)
  assert.strictEqual(h.calls.playerPlaying, 1)
  assert.strictEqual(h.calls.report.length, 1)
  assert.strictEqual(h.calls.report[0].ok, true)
})

run('N2-SV9 Paused/Buffering 分别触发暂停与等待事件', async() => {
  const h = setup()
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.PlaybackState]({ state: TPState.Paused })
  await h.listeners[TPEvent.PlaybackState]({ state: TPState.Buffering })
  assert.strictEqual(h.calls.playerPause, 1)
  assert.strictEqual(h.calls.pauseEvent, 1)
  assert.strictEqual(h.calls.waiting, 1)
})

run('N2-SV10 TrackChanged 空 track 只更新 id，不暂停原生', async() => {
  const h = setup()
  h.mod.default()
  await global.__registered()
  await h.listeners[TPEvent.PlaybackTrackChanged]({ track: null })
  assert.strictEqual(global.lx.playerTrackId, 'track-next')
  assert.strictEqual(h.calls.pauseNative, 0)
})

console.log(`\n===== N2 播放器服务：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
