#!/usr/bin/env node
/**
 * 播放器 React Hook 运行时断言（N2 / hooks）
 * 真实加载 src/plugins/player/hook.ts，用最小 React 运行时驱动 useEffect，
 * 覆盖状态订阅、进度轮询开关、缓冲进度事件与卸载清理。
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

const State = { None: 'none', Ready: 'ready', Stopped: 'stopped', Paused: 'paused', Playing: 'playing', Buffering: 'buffering', Connecting: 'connecting' }
const Event = { PlaybackState: 'playback-state' }

const setup = (over = {}) => {
  const values = []
  const setters = []
  const cleanups = []
  const listeners = {}
  const calls = { getState: 0, position: 0, duration: 0, buffered: 0, remove: 0, setInterval: 0, clearInterval: 0, initialBuffer: 0 }
  const React = {
    useState(init) {
      const index = values.length
      values.push(init)
      setters.push(next => {
        values[index] = typeof next === 'function' ? next(values[index]) : next
      })
      return [init, setters[index]]
    },
    useRef(init) { return { current: init } },
    useEffect(fn) { cleanups.push(fn()) },
  }
  const trackPlayer = {
    getState: async() => { calls.getState++; return over.state === undefined ? State.Paused : over.state },
    addEventListener: (event, cb) => { listeners[event] = cb; return { remove: () => { calls.remove++ } } },
    getPosition: async() => { calls.position++; return 10 },
    getDuration: async() => { calls.duration++; return 100 },
    getBufferedPosition: async() => { calls.buffered++; return over.buffered === undefined ? 100 : over.buffered },
  }
  global.lx = { playerStatus: { isInitialized: over.isInitialized === true } }
  const oldSetInterval = global.setInterval
  const oldClearInterval = global.clearInterval
  global.setInterval = (fn, ms) => { calls.setInterval++; global.__pollFn = fn; return 7 }
  global.clearInterval = () => { calls.clearInterval++ }
  const mod = loadTs('src/plugins/player/hook.ts', {
    react: React,
    'react-native-track-player': {
      __esModule: true,
      default: trackPlayer,
      State,
      Event,
    },
  })
  const restore = () => {
    global.setInterval = oldSetInterval
    global.clearInterval = oldClearInterval
  }
  return { mod, values, listeners, cleanups, calls, restore }
}

console.log('\n[N2 player hooks]')

run('N2-HK1 usePlaybackState 初始为 None，异步读取后更新为暂停', async() => {
  const h = setup({ state: State.Paused })
  h.mod.usePlaybackState()
  await flush()
  assert.strictEqual(h.values[0], State.Paused)
  assert.strictEqual(h.calls.getState, 1)
  h.restore()
})

run('N2-HK2 usePlaybackState 订阅 PlaybackState 并随事件更新', async() => {
  const h = setup()
  h.mod.usePlaybackState()
  assert.ok(h.listeners[Event.PlaybackState])
  h.listeners[Event.PlaybackState]({ state: State.Playing })
  assert.strictEqual(h.values[0], State.Playing)
  h.restore()
})

run('N2-HK3 usePlaybackState 卸载时移除订阅', async() => {
  const h = setup()
  h.mod.usePlaybackState()
  h.cleanups[0]()
  assert.strictEqual(h.calls.remove, 1)
  h.restore()
})

run('N2-HK4 useProgress 初始非播放态不启动轮询', async() => {
  const h = setup()
  h.mod.useProgress(500)
  await flush()
  assert.strictEqual(h.calls.setInterval, 0)
  h.restore()
})

run('N2-HK5 useBufferProgress 收到 Buffering 后轮询，缓冲满时置 1 并清计时器', async() => {
  const h = setup({ buffered: 100 })
  h.mod.useBufferProgress()
  assert.ok(h.listeners[Event.PlaybackState])
  h.listeners[Event.PlaybackState]({ state: State.Buffering })
  await flush()
  assert.strictEqual(h.calls.setInterval, 1)
  assert.strictEqual(h.calls.buffered, 1)
  assert.strictEqual(h.calls.duration, 1)
  assert.strictEqual(h.values[0], 1)
  assert.strictEqual(h.calls.clearInterval, 1)
  h.restore()
})

run('N2-HK6 useBufferProgress 收到 None 时进度归零', async() => {
  const h = setup()
  h.mod.useBufferProgress()
  h.listeners[Event.PlaybackState]({ state: State.None })
  assert.strictEqual(h.values[0], 0)
  h.restore()
})

run('N2-HK7 useBufferProgress 卸载时移除订阅并清计时器', async() => {
  const h = setup()
  h.mod.useBufferProgress()
  h.listeners[Event.PlaybackState]({ state: State.Buffering })
  await flush()
  h.cleanups[0]()
  assert.strictEqual(h.calls.remove, 1)
  assert.ok(h.calls.clearInterval >= 1)
  h.restore()
})

console.log(`\n===== N2 播放器 hooks：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
