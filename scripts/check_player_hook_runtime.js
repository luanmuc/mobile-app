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
// K31：setInterval / clearInterval 同样是跨用例共享的全局钩子（hook.ts 的缓冲轮询用它），
// 交错并发下会被后一个 setup 覆盖，计时器句柄记到别人的 calls 上 —— HK5 的 clearInterval 归零即此因。
for (const key of ['app_event', 'lx', 'setInterval', 'clearInterval']) {
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

const State = { None: 'none', Ready: 'ready', Stopped: 'stopped', Paused: 'paused', Playing: 'playing', Buffering: 'buffering', Connecting: 'connecting' }
const Event = { PlaybackState: 'playback-state' }

const setup = (over = {}) => {
  const scoped = currentScope()
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
  scoped.lx = { playerStatus: { isInitialized: over.isInitialized === true } }
  // K31：写入本用例的私有袋（而不是 global），并发时不再互相覆盖
  scoped.setInterval = (fn, ms) => { calls.setInterval++; global.__pollFn = fn; return 7 }
  scoped.clearInterval = () => { calls.clearInterval++ }
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
    scoped.setInterval = SCOPE_FALLBACK.setInterval
    scoped.clearInterval = SCOPE_FALLBACK.clearInterval
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

Promise.all(tasks).then(() => {
  const staleWhitelist = [...KNOWN_FAILED.keys()].filter(k => passedNames.includes(k))
  if (staleWhitelist.length) {
    console.log('\n提示：以下白名单条目本次已通过，可从 KNOWN_FAILED 删除：')
    for (const k of staleWhitelist) console.log('  - ' + k)
  }
  console.log(`\n===== N2 播放器 hooks：${checks} 通过 / ${failures} 新增失败 / ${knownFailed} 已知遗留 =====`)
  process.exit(failures ? 1 : 0)
})
