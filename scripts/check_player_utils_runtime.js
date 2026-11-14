#!/usr/bin/env node
/**
 * 播放器热点运行时断言（N2）
 * 真实加载 src/plugins/player/utils.ts，mock TrackPlayer/BackgroundTimer/存储边界，
 * 验证未初始化时不调用原生播放器、临时 trackId 判定、setResource 透传。
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
const tasks = []
const run = (name, fn) => {
  tasks.push((async() => {
    try { await fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
      failures++; console.error(`  ✗ ${name}`)
      console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
    }
  })())
}

const makeSetup = () => {
  const calls = []
  const player = {
    play: async() => calls.push('play'),
    pause: async() => calls.push('pause'),
    seekTo: async() => calls.push('seek'),
    getPosition: async() => { calls.push('position'); return 12 },
    getDuration: async() => { calls.push('duration'); return 100 },
    setVolume: async() => calls.push('volume'),
    setRate: async() => calls.push('rate'),
  }
  global.lx = { playerTrackId: 'x//default', playerStatus: { isInitialized: false } }
  const mod = loadTs('src/plugins/player/utils.ts', {
    'react-native-track-player': {
      __esModule: true,
      default: player,
      Capability: {},
      Event: {},
      RepeatMode: {},
      State: {},
    },
    'react-native-background-timer': {
      __esModule: true,
      default: { setTimeout: () => 1, clearTimeout: () => {} },
    },
    './playList': { playMusic: (...args) => calls.push(['playMusic', ...args]) },
    '@/utils/fs': { existsFile: async() => false, moveFile: async() => {}, privateStorageDirectoryPath: '', temporaryDirectoryPath: '' },
    '@/utils/tools': { toast: () => {} },
  })
  return { mod, calls, player }
}

console.log('\n[N2 player utils]')
run('N2-PU1 isEmpty 识别空 id / default id', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.isEmpty('abc'), false)
  assert.strictEqual(mod.isEmpty('abc//default'), true)
  assert.strictEqual(mod.isEmpty(''), true)
})
run('N2-PU2 isTempId 识别 default / restorePlay', async() => {
  const { mod } = makeSetup()
  assert.strictEqual(mod.isTempId('abc'), false)
  assert.strictEqual(mod.isTempId('abc//default'), true)
  assert.strictEqual(mod.isTempId('abc//default//restorePlay'), true)
})
run('N2-PU3 未初始化时 getPosition 返回 0 且不调原生', async() => {
  const { mod, calls } = makeSetup()
  assert.strictEqual(await mod.getPosition(), 0)
  assert.ok(!calls.includes('position'))
})
run('N2-PU4 未初始化时 getDuration 返回 0 且不调原生', async() => {
  const { mod, calls } = makeSetup()
  assert.strictEqual(await mod.getDuration(), 0)
  assert.ok(!calls.includes('duration'))
})
run('N2-PU5 未初始化时 setPlay/setVolume/setRate 不调原生', async() => {
  const { mod, calls } = makeSetup()
  await mod.setPlay()
  await mod.setVolume(0.5)
  await mod.setPlaybackRate(1.2)
  assert.ok(!calls.some(c => ['play', 'volume', 'rate'].includes(c)))
})
run('N2-PU6 未初始化时 resetPlay 安全返回', async() => {
  const { mod, calls } = makeSetup()
  await mod.resetPlay()
  assert.ok(!calls.includes('pause'))
  assert.ok(!calls.includes('seek'))
})
run('N2-PU7 setResource 透传 musicInfo/url/duration', async() => {
  const { mod, calls } = makeSetup()
  const info = { id: 'song-1', name: '夜曲', singer: '周杰伦' }
  mod.setResource(info, 'https://example.com/a.mp3', 30)
  const call = calls.find(c => Array.isArray(c) && c[0] === 'playMusic')
  assert.ok(call, '未调用 playMusic')
  assert.deepStrictEqual(call[1], info)
  assert.strictEqual(call[2], 'https://example.com/a.mp3')
  assert.strictEqual(call[3], 30)
})

Promise.all(tasks).then(() => {
  console.log(`\n===== N2 播放器热点：${checks} 通过 / ${failures} 失败 =====`)
  if (failures) process.exit(1)
})
