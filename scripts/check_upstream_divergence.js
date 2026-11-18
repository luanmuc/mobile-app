#!/usr/bin/env node
/**
 * 上游基座偏离开具（审计型，非阻塞）
 *
 * 规则来源：docs/DEV_CONVENTIONS.md「八、上游基座对照规则」
 *
 * 用法：
 *   LX_UPSTREAM_ROOT=/tmp/upstream-lx node scripts/check_upstream_divergence.js
 *   LX_UPSTREAM_ROOT=/tmp/upstream-lx node scripts/check_upstream_divergence.js --list
 *
 * 输出三档：
 *   ① 定制文件（上游不存在）—— 我们自己写的，按项目口径维护
 *   ② 上游存在且有差异 —— 必须有 `A<两位>-<编号>` 或 `RT-` 之类的留痕注释；
 *      无留痕的列为「待复核」，供人工确认是否属 A 档（上游真缺陷）
 *   ③ 上游存在且零差异 —— 未改动，合规
 *
 * 退出码恒 0（审计用）；加 --strict 时只要存在「有差异且无留痕」就退 1。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const UPSTREAM = process.env.LX_UPSTREAM_ROOT || '/tmp/upstream-lx'
const STRICT = process.argv.includes('--strict')
const LIST = process.argv.includes('--list')

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', 'android', 'ios', 'vendor', '.git'])

// 留痕方式一：缺陷修复编号 A12-012 / A07-024 / A13-P2-15 / RT-03 / LT-02
// 留痕方式二：功能改造标记「定制」（v9 平台化改造等，不对应缺陷编号）
const MARK = /(A\d\d-(?:P\d-)?\d+|RT-\d+|LT-\d+|LX\s*定制|lx\s*定制|定制[:：])/

if (!fs.existsSync(UPSTREAM)) {
  console.log(`⚠ 找不到上游源码目录：${UPSTREAM}`)
  console.log('  重新拉取：')
  console.log('    cd /tmp && rm -rf upstream-lx')
  console.log('    git clone --depth 1 --branch v1.9.2 \\')
  console.log('      https://github.com/lyswhut/lx-music-mobile upstream-lx')
  console.log('  （应得到 commit 0669d1b「发布 v1.9.2」）')
  process.exit(0)
}

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXTS.has(path.extname(name))) out.push(full)
  }
  return out
}

// 单文件查询：动手前先看清这个文件的基座状态
const target = process.argv.find((a) => a.startsWith('--file='))
if (target) {
  const rel = path.relative(ROOT, path.resolve(ROOT, target.slice(7)))
  const me = path.join(ROOT, rel)
  const up = path.join(UPSTREAM, rel)
  console.log(`文件：${rel}`)
  if (!fs.existsSync(me)) { console.log('  本仓不存在'); process.exit(0) }
  if (!fs.existsSync(up)) {
    console.log('  ① 定制文件：上游 v1.9.2 不存在此文件 → 按项目口径维护')
    process.exit(0)
  }
  const same = fs.readFileSync(me, 'utf8') === fs.readFileSync(up, 'utf8')
  console.log(same ? '  ④ 与上游零差异（未改动）→ 改动前必须走 A/B/C 判定' : '  ② 上游存在且有差异')
  const marked = MARK.test(fs.readFileSync(me, 'utf8'))
  console.log(`  留痕：${marked ? '有' : '无（改动前请确认是否 A 档，并补编号注释）'}`)
  console.log(`  查看差异：diff -u ${up} ${me}`)
  process.exit(0)
}

const files = walk(path.join(ROOT, 'src'))
const buckets = { custom: [], marked: [], unmarked: [], same: [] }

for (const me of files) {
  const rel = path.relative(ROOT, me)
  const up = path.join(UPSTREAM, rel)
  if (!fs.existsSync(up)) {
    buckets.custom.push(rel)
    continue
  }
  const mine = fs.readFileSync(me, 'utf8')
  const theirs = fs.readFileSync(up, 'utf8')
  if (mine === theirs) {
    buckets.same.push(rel)
    continue
  }
  const marked = MARK.test(mine)
  ;(marked ? buckets.marked : buckets.unmarked).push(rel)
}

console.log('===== 上游基座偏离开具（v1.9.2 判据）=====\n')
console.log(`上游源码：${UPSTREAM}`)
console.log(`扫描范围：${path.join(ROOT, 'src')}（${files.length} 个 .ts/.tsx/.js/.jsx）\n`)
console.log(`① 定制文件（上游不存在）      : ${buckets.custom.length}`)
console.log(`② 上游存在 · 已改动 · 有留痕  : ${buckets.marked.length}`)
console.log(`③ 上游存在 · 已改动 · 无留痕  : ${buckets.unmarked.length}  ← 待复核`)
console.log(`④ 上游存在 · 零差异（未改动）  : ${buckets.same.length}\n`)

if (buckets.unmarked.length) {
  console.log('待复核清单（上游有、我们改了但代码里没有 A 编号留痕）：')
  const shown = LIST ? buckets.unmarked : buckets.unmarked.slice(0, 30)
  shown.forEach((f) => console.log(`  - ${f}`))
  if (!LIST && buckets.unmarked.length > shown.length) {
    console.log(`  … 另 ${buckets.unmarked.length - shown.length} 个（加 --list 看全部）`)
  }
  console.log('\n处置口径（docs/DEV_CONVENTIONS.md 8.2）：')
  console.log('  A 档 上游真缺陷   → 可改，代码内补 `A<编号>` + 「上游原样缺/错」注释')
  console.log('  B 档 上游有意设计 → 不该改，回滚并登记')
  console.log('  C 档 我们口径不同 → 写明影响面；第三方可观察行为不得擅改')
}

console.log('\n---- 判据速查 ----')
console.log('  上游不存在 → 定制文件，按项目口径维护')
console.log('  上游存在   → 先 diff -u，再判 A/B/C，只有 A 档才动')
console.log('  上游零差异 → 不得改动（除非 A 档 + 注释说明）')

if (STRICT && buckets.unmarked.length) {
  console.log('\n❌ --strict：存在上游文件被改动且未留痕')
  process.exit(1)
}
