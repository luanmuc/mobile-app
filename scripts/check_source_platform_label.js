#!/usr/bin/env node
/**
 * 音源标签实际平台透传契约检查。
 *
 * 用法：
 *   node scripts/check_source_platform_label.js
 *
 * 说明：
 *   - 行为层：直接转译 `src/core/music/sourceLabel.ts`，用例锁住「实际平台 · 子源名」拼装与旧字段回退；
 *   - 链路段：静态断言 preload → userApi → music/utils → online → PlayInfo/通知栏 全链路不丢 sourcePlatform。
 *   - 失败退出码 1；成功打印通过数。
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

const read = (rel) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少文件：${rel}`)
  return fs.readFileSync(file, 'utf-8')
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

let checks = 0
let failures = 0
const run = (name, fn) => {
  checks++
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`✗ ${name} — ${e.message}`)
  }
}

const assertIncludes = (text, needle, label) => {
  assert(text.includes(needle), `${label} 缺少 ${JSON.stringify(needle)}`)
}

// 1. VM 桥不能丢 sourcePlatform
run('L1 preload 透传 sourcePlatform', () => {
  const preload = read('android/app/src/main/assets/script/user-api-preload.js')
  assertIncludes(preload, "let sourcePlatform = ''", 'preload')
  assertIncludes(preload, "response.sourcePlatform", 'preload')
  assertIncludes(preload, 'sourcePlatform,', 'preload 返回 data')
})

run('L1 userApi 映射 sourcePlatform', () => {
  const text = read('src/core/init/userApi/index.ts')
  assertIncludes(text, 'sourcePlatform', 'userApi')
})

// 2. 取链结果向上透传
run('L2 music/utils 返回 sourcePlatform', () => {
  const text = read('src/core/music/utils.ts')
  const count = (text.match(/sourcePlatform/g) || []).length
  assert(count >= 4, `music/utils.ts 中 sourcePlatform 出现次数过少：${count}`)
})

run('L2 online.ts 构造 playSource.platform', () => {
  const text = read('src/core/music/online.ts')
  assertIncludes(text, 'platform: sourcePlatform', 'online.ts')
  assertIncludes(text, 'recordPlayResult', 'online.ts')
})

// 3. 播放状态与缓存
run('L3 playSource 类型含 platform', () => {
  assertIncludes(read('src/store/player/state.ts'), 'platform?: string', 'state.ts')
  assertIncludes(read('src/store/player/action.ts'), 'platform?: string', 'action.ts')
  assertIncludes(read('src/utils/data.ts'), 'platform?: string', 'data.ts')
})

// 4. 播放页/通知栏消费
run('L4 横屏 PlayInfo 用实际平台', () => {
  const text = read('src/screens/PlayDetail/Horizontal/Player/PlayInfo.tsx')
  assertIncludes(text, "from '@/core/music/sourceLabel'", '横屏 PlayInfo')
  assertIncludes(text, 'resolvePlayPlatform(playSource', '横屏 PlayInfo')
})

run('L4 竖屏 PlayInfo 用实际平台', () => {
  const text = read('src/screens/PlayDetail/Vertical/Player/components/PlayInfo.tsx')
  assertIncludes(text, "from '@/core/music/sourceLabel'", '竖屏 PlayInfo')
  assertIncludes(text, 'resolvePlayPlatform(playSource', '竖屏 PlayInfo')
})

run('L5 通知栏用实际平台', () => {
  const text = read('src/plugins/player/playList.ts')
  assertIncludes(text, "from '@/core/music/sourceLabel'", 'playList')
  assertIncludes(text, 'resolvePlayPlatform(source', 'playList')
})

// 5. 行为层：拼装与回退
run('L4/L5 标签行为矩阵', () => {
  const { buildSourceLabel, getPlatformNameKey, resolvePlatformName } = loadTs('src/core/music/sourceLabel.ts')
  assert(typeof buildSourceLabel === 'function', 'buildSourceLabel 必须是函数')
  assert(typeof resolvePlatformName === 'function', 'resolvePlatformName 必须是函数')
  const nameOf = (p) => ({ kw: '酷我音乐', tx: 'QQ音乐', wy: '网易云音乐' }[p] || '')
  assert.strictEqual(buildSourceLabel(nameOf('tx'), 'Juhe聚合(tx)'), 'QQ音乐 · Juhe聚合(tx)', '回退到 tx')
  assert.strictEqual(buildSourceLabel(nameOf('kw'), '溯音酷我'), '酷我音乐 · 溯音酷我', '主平台 kw')
  assert.strictEqual(buildSourceLabel(nameOf('kw'), '酷我音乐'), '酷我音乐', '子源名等于平台名时不重复')
  assert.strictEqual(buildSourceLabel('', 'Juhe聚合(tx)'), 'Juhe聚合(tx)', '平台名缺失时只显示子源名')
  assert.strictEqual(buildSourceLabel(nameOf('tx'), ''), 'QQ音乐', '子源名缺失时只显示平台名')
  assert.strictEqual(buildSourceLabel('', ''), '', '全缺失时为空')
  assert.strictEqual(buildSourceLabel('QQ音乐·Juhe聚合(tx)', 'Juhe聚合(tx)'), 'QQ音乐·Juhe聚合(tx) · Juhe聚合(tx)', '子源名已含平台时仍按统一分隔拼装（防重复由调用方传纯子源名）')
  assert.strictEqual(getPlatformNameKey('tx'), 'source_real_tx', '已知平台映射到 i18n key')
  assert.strictEqual(getPlatformNameKey('xm'), '', '未知平台不映射翻译 key')
  assert.strictEqual(resolvePlatformName('tx', 'QQ音乐'), 'QQ音乐', '已知平台显示翻译名')
  assert.strictEqual(resolvePlatformName('xm', ''), 'xm', '未知平台回退平台 id，不显示翻译 key')
  assert.strictEqual(resolvePlatformName('local', ''), '', '本地平台不显示平台名')
})

console.log(`\n音源标签实际平台契约：${checks - failures}/${checks} 通过`)
if (failures) {
  console.log(`失败项 ${failures} 条`)
  process.exit(1)
}
