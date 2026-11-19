/**
 * scripts/lib/ast-match.js —— 接线类门禁的 AST 级断言工具（K33）
 *
 * 背景：此前多处门禁用 `源码.includes('某行字面量')` 验证「某函数被调用」。
 * 实测变异：把 `saveData(DOWNLOAD_STORAGE_KEY, downloadState.list.map(stripStatusText))`
 * 整行注释掉后，`check_download_persistence` 仍 3/0 全绿 —— 门禁对真实接线零守护。
 *
 * 本工具用 TypeScript AST，达到三个目的：
 *   1. 注释掉的代码不在 AST 里 → 不再假绿；
 *   2. 换行/缩进/空格/引号风格不影响 AST 文本之外的判定 → 不再假红；
 *   3. 能断言「调用的参数形态」，而不只是「这串字符出现在文件某处」。
 *
 * 用法：
 *   const { parseSource, hasCallWithArgs, hasDeleteOf, hasDecl } = require('./lib/ast-match')
 *   const sf = parseSource('src/core/downloadManager.ts', read('src/core/downloadManager.ts'))
 *   assert(hasCallWithArgs(sf, 'saveData', [/^DOWNLOAD_STORAGE_KEY$/, /stripStatusText/]), '...')
 */
'use strict'

const ts = require('typescript')

function parseSource(fileName, text) {
  const kind = /\.tsx$/i.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(fileName)
      ? ts.ScriptKind.JSX
      : /\.js$/i.test(fileName)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
}

function walk(node, fn) {
  fn(node)
  node.forEachChild((c) => walk(c, fn))
}

/** 所有 `calleeText(...)` 形式的调用表达式（calleeText 为源码中的精确文本，如 `saveData`） */
function findCalls(sf, calleeText) {
  const out = []
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === calleeText) out.push(n)
  })
  return out
}

function argTexts(sf, call) {
  return call.arguments.map((a) => a.getText(sf))
}

/**
 * 是否存在一处 `calleeText(...)`，其第 i 个实参文本匹配 argRes[i]（undefined 表示不校验）。
 * 全限定名（如 `foo.bar`）也可作为 calleeText。
 */
function hasCallWithArgs(sf, calleeText, argRes) {
  const res = argRes || []
  return findCalls(sf, calleeText).some((c) => {
    const args = argTexts(sf, c)
    if (args.length < res.length) return false
    return res.every((re, i) => (re == null ? true : re.test(args[i])))
  })
}

/** 是否存在 `delete <operandText>`（operand 精确文本匹配，如 `copy.statusText`） */
function hasDeleteOf(sf, operandText) {
  let found = false
  walk(sf, (n) => {
    if (ts.isDeleteExpression(n) && n.expression.getText(sf) === operandText) found = true
  })
  return found
}

/** 是否存在名为 name 的声明（const/let/var/function），返回声明节点数组 */
function findDecls(sf, name) {
  const out = []
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name) out.push(n)
    else if (ts.isFunctionDeclaration(n) && n.name && n.name.getText(sf) === name) out.push(n)
  })
  return out
}

/** 某个声明节点的初始化器源码文本（无则空串） */
function initText(sf, decl) {
  return decl.initializer ? decl.initializer.getText(sf) : ''
}

module.exports = { ts, parseSource, walk, findCalls, argTexts, hasCallWithArgs, hasDeleteOf, findDecls, initText }

/**
 * 去掉 `//` 行注释与 `/* *\/` 块注释，保留字符串/模板内容。
 * 用途：`源码.includes('xxx')` 类断言的替身——注释掉的代码不该再被判为「存在」（防假绿），
 * 配合正则里的 `\s*` 又能容忍换行/缩进差异（防假红）。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let quote = null
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue }
    out += c
    i++
  }
  return out
}

/** 去注释后做正则匹配（接线类断言统一入口） */
function hasCode(src, re) { return re.test(stripComments(src)) }

module.exports = module.exports || {}
module.exports.stripComments = stripComments
module.exports.hasCode = hasCode
