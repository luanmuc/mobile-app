#!/usr/bin/env node
/**
 * 文档一致性检查（check_docs_consistency.js）
 *
 * 作用：扫描仓库文档中"过时引用"，防止代码/版本已变更但文档没同步。
 * 用法：node scripts/check_docs_consistency.js
 * 退出码：0 = 无遗漏；1 = 发现过时引用（推送前必须修复）
 *
 * 维护：新增"容易过时的引用"时，在下方 RULES 中追加一条即可。
 * 依据：package.json version（底座版本）、package.json react-native-track-player 锁定 commit、
 *       publish/build-state.json（当前 bN / versionCode）。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const baseVersion = pkg.version

// 当前 track-player 锁定 commit（package.json 中 "github:luanmuc/react-native-track-player#<sha>"）
const tpMatch = (pkg.dependencies['react-native-track-player'] || '').match(/#([0-9a-f]{7,40})/)
const tpCurrent = tpMatch ? tpMatch[1] : null

// 扫描范围：仓库内全部文档（排除历史归档 / 上游文件 / CI 生成目录）
const DOC_GLOBS = [
  'README.md', 'AGENTS.md', 'FAQ.md', 'MERGE_GUIDE.md', 'docs/**/*.md',
]
const EXCLUDE = ['CUSTOM_CHANGELOG.md', 'CHANGELOG.md', 'AUDIT_REPORT-2026-11-07.md'] // 历史归档（含 docs/archive/ 下带日期的报告），允许出现旧版本号

// 规则：每个规则 = { name, test(内容行, 行号上下文) -> 匹配行数组 }
// 通用取行号函数
function lineMatches(content, regex) {
  const hits = []
  content.split('\n').forEach((line, i) => {
    if (regex.test(line)) hits.push(i + 1)
  })
  return hits
}

// 历史锚点豁免词：行内含这些词时视为"历史事实/时间点"描述（如 "v1.9.1-b74 起移除"），不算过时
// v9.5：补「此前 / 上一版 / 已推送」——这些行明确在叙述历史，不是当前口径残留。
const HISTORY_MARK = /起|至|自|以来|当时|曾|历史|归档|→|此前|上一版|已推送|（20\d\d-/

const RULES = []
if (baseVersion) {
  // 检查文档中出现的任意 "X.Y.Z-bN"：若底座版本不是当前值，且该行不含当前底座版本
  // （说明性示例如 "1.9.1-b79 → 1.9.2-b1" 行内含当前版本，视为合法说明），则判定为过时引用
  RULES.push({
    name: `文档仍引用旧底座版本号（当前底座 ${baseVersion}）`,
    test(content) {
      const hits = []
      content.split('\n').forEach((line, i) => {
        const m = line.match(/\d+\.\d+\.\d+-b[\w]+/g)
        if (!m) return
        const hasCurrent = line.includes(baseVersion)
        const isHistory = HISTORY_MARK.test(line)
        if (m.some(v => v !== `${baseVersion}-b` && !v.startsWith(`${baseVersion}-b`)) && !hasCurrent && !isHistory) {
          hits.push(i + 1)
        }
      })
      return hits
    },
  })
}
if (tpCurrent) {
  // 依赖清单/状态文档里的 track-player 当前锁定 commit（已知曾出现的旧值）
  RULES.push({
    name: `track-player 锁定已更新为 ${tpCurrent}，但文档仍写旧 commit`,
    test(content) {
      const hits = lineMatches(content, /commit\s+`0f0acb4`/g)
      return hits
    },
  })
}
// 旧版本机制残留（v1.9.2 起已被 build-state.json 取代）
RULES.push({
  name: '文档仍引用已废弃的版本机制（GITHUB_RUN_NUMBER / 80+N / 恒为固定底座号）',
  test(content) {
    return lineMatches(content, /GITHUB_RUN_NUMBER|80\s*\+\s*N|恒为\s*`?1\.9\.\d+`?/g)
  },
})

function walkMd(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f)
    const st = fs.statSync(full)
    if (st.isDirectory()) walkMd(full, out)
    else if (f.endsWith('.md')) out.push(full)
  }
}

function collectFiles() {
  const files = []
  for (const g of DOC_GLOBS) {
    if (g.includes('**')) {
      // docs/**/*.md → 从 '**' 之前的目录开始递归
      walkMd(path.join(ROOT, g.slice(0, g.indexOf('**'))), files)
    } else if (g.includes('*')) {
      const dir = path.join(ROOT, path.dirname(g))
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md')) files.push(path.join(dir, f))
      }
    } else if (fs.existsSync(path.join(ROOT, g))) {
      files.push(path.join(ROOT, g))
    }
  }
  // 去重 + 排除历史归档
  return [...new Set(files)].filter(f => !EXCLUDE.includes(path.basename(f)))
}

let problems = 0
const files = collectFiles()
for (const file of files) {
  const rel = path.relative(ROOT, file)
  const content = fs.readFileSync(file, 'utf8')
  for (const rule of RULES) {
    const hits = rule.test(content)
    if (hits.length) {
      problems++
      console.log(`✗ [${rel}] ${rule.name}（行 ${hits.join('、')}）`)
    }
  }
}

if (problems) {
  console.log(`\n发现 ${problems} 处过时引用，请同步更新文档后再推送（更新后重跑本脚本清零）。`)
  process.exit(1)
} else {
  console.log(`文档一致性检查通过：${files.length} 个文档无过时引用。`)
  process.exit(0)
}
