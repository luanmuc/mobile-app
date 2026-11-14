#!/usr/bin/env node
/**
 * 下载失败提示标点/三语断言（I-07）
 * 断言标点由语言模板提供：英文半角 `: ` / `()`，中文全角 `：` / `（）`；
 * 同时禁止源码里再用字符串拼接中文标点。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const zh = readJson('src/lang/zh-cn.json')
const tw = readJson('src/lang/zh-tw.json')
const en = readJson('src/lang/en-us.json')

let failures = 0
let checks = 0
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++; console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
  }
}

const format = (tpl, values) => tpl.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')

console.log('\n[I-07 download error punctuation]')
run('I07-1 三语都提供 error status/detail 模板', () => {
  for (const data of [zh, tw, en]) {
    assert.ok(data.dl_error_status)
    assert.ok(data.dl_error_status_detail)
  }
})
run('I07-2 英文模板使用半角冒号/括号', () => {
  const text = format(en.dl_error_status_detail, { status: 'Download failed', reason: 'Network error', detail: 'HTTP 403' })
  assert.strictEqual(text, 'Download failed: Network error (HTTP 403)')
  assert.ok(!text.includes('：') && !text.includes('（') && !text.includes('）'))
})
run('I07-3 英文无 detail 模板使用半角冒号', () => {
  assert.strictEqual(format(en.dl_error_status, { status: 'Download failed', reason: 'Network error' }), 'Download failed: Network error')
})
run('I07-4 简体模板保留全角标点', () => {
  assert.strictEqual(format(zh.dl_error_status_detail, { status: '下载失败', reason: '网络错误', detail: 'HTTP 403' }), '下载失败：网络错误（HTTP 403）')
})
run('I07-5 繁体模板保留全角标点', () => {
  assert.strictEqual(format(tw.dl_error_status_detail, { status: '下載失敗', reason: '網路錯誤', detail: 'HTTP 403' }), '下載失敗：網路錯誤（HTTP 403）')
})
run('I07-6 downloadManager 不再拼中文冒号/括号', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/downloadManager.ts'), 'utf8')
  assert.ok(!src.includes("dl_status_error')}："), '仍存在中文冒号拼接')
  assert.ok(!src.includes(['$', '{errMsg}）'].join('')), '仍存在中文括号拼接')
  assert.ok(src.includes('dl_error_status_detail'))
})
run('I07-7 Download/index.tsx 不再拼中文标点', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Download/index.tsx'), 'utf8')
  assert.ok(!src.includes(['`：$', '{reason}`'].join('')), '仍存在中文冒号拼接')
  assert.ok(!src.includes(['`（$', '{item.error}）`'].join('')), '仍存在中文括号拼接')
  assert.ok(src.includes("t('dl_error_status_detail'"))
})

console.log(`\n===== I-07 下载错误标点：${checks} 通过 / ${failures} 失败 =====`)
if (failures) process.exit(1)
