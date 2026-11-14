#!/usr/bin/env node
/**
 * 下载记录持久化契约（D1~D3）
 *
 * D1 save() 落盘前剥离 statusText
 * D2 migrateDownloadDir() 二次保存同样剥离
 * D3 显示层不再回退持久化的中文 statusText
 *
 * 用法：node scripts/check_download_persistence.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const assert = (c, m) => { if (!c) throw new Error(m) }
let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) } catch (e) { failures.push(`${name} — ${e.message}`); console.log(`✗ ${name} — ${e.message}`) }
}

const manager = read('src/core/downloadManager.ts')
const ui = read('src/screens/Home/Views/Download/index.tsx')

check('D1 stripStatusText 用副本删除字段，save() 对整表剥离', () => {
  assert(manager.includes('const stripStatusText = (item: LX.Download.ListItem)'), '缺 stripStatusText')
  assert(manager.includes('delete copy.statusText'), 'stripStatusText 未删除 statusText')
  assert(manager.includes('saveData(DOWNLOAD_STORAGE_KEY, downloadState.list.map(stripStatusText))'), 'save() 未剥离 statusText')
})

check('D2 migrateDownloadDir 二次保存同样剥离', () => {
  assert(manager.includes('saveData(DOWNLOAD_STORAGE_KEY, updated.map(stripStatusText))'), '迁移二次保存未剥离 statusText')
})

check('D3 显示层不再回退 item.statusText', () => {
  assert(!ui.includes('item.statusText'), '显示层仍回退 item.statusText')
  assert(ui.includes("t('dl_status_error')"), '未知状态应回退 i18n 文案')
})

console.log(`\n===== 下载持久化契约：${passed} 通过 / ${failures.length} 失败 =====`)
if (failures.length) process.exit(1)
process.exit(0)
