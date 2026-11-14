#!/usr/bin/env node
/**
 * 播放进度分母运行时断言（N3）
 * 真实加载 src/store/player/action.ts，只 mock state/工具边界，
 * 验证 setProgress 使用 totalTime 而不是 currentTime 作分母。
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

const setup = () => {
  const state = {
    musicInfo: {},
    progress: {
      nowPlayTime: 0,
      nowPlayTimeStr: '00:00',
      maxPlayTime: 0,
      maxPlayTimeStr: '00:00',
      progress: 0,
    },
    playedList: [],
  }
  global.state_event = { playProgressChanged: () => {} }
  const mod = loadTs('src/store/player/action.ts', {
    '@/utils': {
      arrPush: (list, item) => { list.push(item) },
      arrUnshift: (list, item) => { list.unshift(item) },
      formatPlayTime2: (time) => String(time),
    },
    './state': { __esModule: true, default: state },
  })
  return { action: mod.default, state }
}

console.log('\n[N3 player progress]')
run('N3-P1 setProgress(30,100) 应为 0.3', () => {
  const h = setup()
  h.action.setProgress(30, 100)
  assert.strictEqual(h.state.progress.progress, 0.3, `实际 ${h.state.progress.progress}`)
})

run('N3-P2 setProgress(0,100) 应为 0', () => {
  const h = setup()
  h.action.setProgress(0, 100)
  assert.strictEqual(h.state.progress.progress, 0, `实际 ${h.state.progress.progress}`)
})

run('N3-P3 setProgress(100,100) 应为 1', () => {
  const h = setup()
  h.action.setProgress(100, 100)
  assert.strictEqual(h.state.progress.progress, 1, `实际 ${h.state.progress.progress}`)
})

run('N3-P4 setProgress(0,0) 仍应为 0（空时长不除零）', () => {
  const h = setup()
  h.action.setProgress(0, 0)
  assert.strictEqual(h.state.progress.progress, 0, `实际 ${h.state.progress.progress}`)
})

console.log(`\n===== N3 播放进度：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
