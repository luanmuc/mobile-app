#!/usr/bin/env node
/**
 * 全量 TS/TSX 语法检查。
 *
 * 用法：
 *   node scripts/check_ts_syntax.js
 *
 * 说明：
 *   - 用 typescript 的 createSourceFile + parseDiagnostics 逐文件做纯语法解析
 *     （不生成输出、不解析类型，速度快且稳定）
 *   - 合并上游、提交前必跑
 *   - 有语法错误时退出码为 1，并在末尾汇总
 */
'use strict'

const fs = require('fs')
const path = require('path')

let ts
try {
  // 优先项目内 typescript（npm ci 后存在）；找不到则退回全局
  ts = require(path.resolve(__dirname, '..', 'node_modules', 'typescript'))
} catch (e) {
  try {
    ts = require('typescript')
  } catch (e2) {
    console.error('未找到 typescript 依赖，请先执行: npm ci（或 npm i -D typescript）')
    process.exit(1)
  }
}

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

/** 递归收集 .ts / .tsx 文件 */
function listTsFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      listTsFiles(full, out)
    } else if (/\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const files = listTsFiles(SRC)
let errors = []

for (const file of files) {
  const source = fs.readFileSync(file, 'utf-8')
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  )
  for (const d of sourceFile.parseDiagnostics || []) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
    const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null
    const loc = pos ? `:${pos.line + 1}:${pos.character + 1}` : ''
    errors.push(`${path.relative(ROOT, file)}${loc} ${msg}`)
  }
}

if (errors.length) {
  console.error(`语法检查失败：${errors.length} 个错误（共 ${files.length} 个文件）`)
  for (const e of errors.slice(0, 30)) console.error('  ' + e)
  if (errors.length > 30) console.error(`  ... 其余 ${errors.length - 30} 个错误省略`)
  process.exit(1)
}
console.log(`语法检查通过：${files.length} 个 TS/TSX 文件 0 错误`)
