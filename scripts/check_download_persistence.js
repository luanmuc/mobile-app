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

// K33：接线断言改用 AST 判定——注释掉即不成立（防假绿），换行/空格不误伤（防假红）
const ast = require('./lib/ast-match')
const managerSf = ast.parseSource('src/core/downloadManager.ts', manager)

check('D1 stripStatusText 用副本删除字段，save() 对整表剥离', () => {
  assert(ast.findDecls(managerSf, 'stripStatusText').length > 0, '缺 stripStatusText 声明')
  assert(ast.hasDeleteOf(managerSf, 'copy.statusText'), 'stripStatusText 未 delete copy.statusText')
  assert(
    ast.hasCallWithArgs(managerSf, 'saveData', [/^DOWNLOAD_STORAGE_KEY$/, /downloadState\.list\.map\(\s*stripStatusText\s*\)/]),
    'save() 未对整表剥离 statusText（AST 判定：saveData 第二参不是 downloadState.list.map(stripStatusText)）',
  )
})

check('D2 migrateDownloadDir 二次保存同样剥离', () => {
  assert(
    ast.hasCallWithArgs(managerSf, 'saveData', [/^DOWNLOAD_STORAGE_KEY$/, /updated\.map\(\s*stripStatusText\s*\)/]),
    '迁移二次保存未剥离 statusText（AST 判定：saveData 第二参不是 updated.map(stripStatusText)）',
  )
})

check('D3 显示层不再回退 item.statusText', () => {
  assert(!/\bitem\.statusText\b/.test(ui), '显示层仍回退 item.statusText')
  assert(/['"`]dl_status_error['"`]/.test(ui), '未知状态应回退 i18n 文案 dl_status_error')
})

console.log(`\n===== 下载持久化契约：${passed} 通过 / ${failures.length} 失败 =====`)
if (failures.length) process.exit(1)
process.exit(0)
