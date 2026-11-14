#!/usr/bin/env node
/**
 * 下载文件名模板运行时断言（I-05）
 * 真实加载 src/utils/fileNameTemplate.ts，验证：
 * - 旧中文模板迁移为 {title}/{artist}
 * - 自定义模板缺失 token 时回退默认模板
 * - 文件名按当前 song 渲染，不再依赖中文字面量
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

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
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

const tpl = loadTs('src/utils/fileNameTemplate.ts')

console.log('\n[I-05 download file name template]')
run('I05-1 旧「歌名 - 歌手」迁移为 {title} - {artist}', () => {
  assert.strictEqual(tpl.normalizeFileNameTemplate('歌名 - 歌手'), '{title} - {artist}')
})
run('I05-2 旧「歌手 - 歌名」迁移为 {artist} - {title}', () => {
  assert.strictEqual(tpl.normalizeFileNameTemplate('歌手 - 歌名'), '{artist} - {title}')
})
run('I05-3 空模板回退默认 {title} - {artist}', () => {
  assert.strictEqual(tpl.normalizeFileNameTemplate(''), '{title} - {artist}')
  assert.strictEqual(tpl.normalizeFileNameTemplate(null), '{title} - {artist}')
})
run('I05-4 无 token 的自定义模板回退默认', () => {
  assert.strictEqual(tpl.normalizeFileNameTemplate('我的文件名'), '{title} - {artist}')
})
run('I05-5 默认模板渲染为「歌名 - 歌手」', () => {
  assert.strictEqual(tpl.formatFileNameTemplate('{title} - {artist}', { name: '夜曲', singer: '周杰伦' }), '夜曲 - 周杰伦')
})
run('I05-6 反向模板渲染为「歌手 - 歌名」', () => {
  assert.strictEqual(tpl.formatFileNameTemplate('{artist} - {title}', { name: '夜曲', singer: '周杰伦' }), '周杰伦 - 夜曲')
})
run('I05-7 旧模板直接渲染仍兼容', () => {
  assert.strictEqual(tpl.formatFileNameTemplate('歌名 - 歌手', { name: '夜曲', singer: '周杰伦' }), '夜曲 - 周杰伦')
})
run('I05-8 hasFileNameToken 识别旧中文与 token', () => {
  assert.strictEqual(tpl.hasFileNameToken('歌名'), true)
  assert.strictEqual(tpl.hasFileNameToken('{artist}'), true)
  assert.strictEqual(tpl.hasFileNameToken('随便写'), false)
})
run('I05-9 Settings 预设已改为 token，不再用中文字面量', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Download/Settings.tsx'), 'utf8')
  assert.ok(src.includes("'{title} - {artist}'"))
  assert.ok(!src.includes("'歌名 - 歌手'"))
  assert.ok(src.includes('hasFileNameToken'))
})
run('I05-10 默认设置已改为 token', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/config/defaultSetting.ts'), 'utf8')
  assert.ok(src.includes("'download.fileName': '{title} - {artist}'"))
})

console.log(`\n===== I-05 文件名模板：${checks} 通过 / ${failures} 失败 =====`)
if (failures) process.exit(1)
