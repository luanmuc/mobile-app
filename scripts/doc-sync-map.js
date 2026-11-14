#!/usr/bin/env node
/**
 * doc-sync-map.js — 改动文件 → 必同步文档清单（mobile-app 定制版）
 *
 * 用途（配合 scripts/hooks/ 下的 git hook，commit 时自动运行）：
 *   - 默认模式：列出本次暂存改动触发的「必同步文档清单」，账号照单在同提交内更新；
 *   - --check 模式：若本次改动含「硬触发文件」（改代码必更文档）但提交中不含任何文档更新，
 *     打印红色警告并返回非 0（拒绝提交，可用 --no-verify 绕过）。
 *
 * 规则表新增映射时，在此文件 RULES 中加一行即可（活文档原则）。
 */
'use strict'

const { execSync } = require('child_process')

// ── 规则表：路径模式（子串匹配） → 必同步文档/动作（数组）──────────────────
// 顺序优先：先匹配到即命中。数组元素格式：'docs:路径' 或 'action:描述'。
const RULES = [
  // 语言词条：改一语言必须三语言同步 + changelog
  {
    match: 'src/lang/',
    docs: [
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
      'action:三语言同步核对：zh-cn / zh-tw / en-us 键数一致（当前基线 958 键），新增词条三语言都要加',
      'action:若涉及音源相关文案 → 核对 docs/SYNC_POINTS.md lang 行',
    ],
  },
  // 音源接入层：改 userApi 必须同步音源指南 + 同步点总表
  {
    match: 'src/core/init/userApi/',
    docs: [
      'docs:docs/MUSIC_SOURCE_GUIDE.md（action 表 / 透传链路）',
      'docs:docs/SYNC_POINTS.md（actions 数核对）',
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
  // 健康面板：改 Health.tsx 必须同步健康分语义文档
  {
    match: 'Health.tsx',
    docs: [
      'docs:docs/MUSIC_SOURCE_GUIDE.md（四b 节：健康分语义 / 面板排序 / 趋势）',
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
  // 下载器：改下载相关代码必须同步技术设计
  {
    match: 'src/core/downloadManager',
    docs: [
      'docs:docs/DOWNLOAD_DESIGN.md（状态机 / 并发 / 断点等对应节）',
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
  // 播放器核心
  {
    match: 'src/core/player/',
    docs: [
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
      'action:播放器高冲突区 → 若上游合并相关，同步 docs/MERGE_GUIDE.md 冲突点速查',
    ],
  },
  // 默认设置：改默认值必须走迁移机制 + 同步默认设置表
  {
    match: 'src/config/defaultSetting.ts',
    docs: [
      'docs:docs/MERGE_GUIDE.md（设置迁移规则/历史）',
      'docs:README.md（默认设置差异表）',
      'docs:docs/KNOWN_ISSUES.md（如涉及）',
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
  // CI/发布：改 workflow 必须同步发布 SOP
  {
    match: '.github/workflows/',
    docs: [
      'docs:docs/RELEASE_SOP.md（发布流程/版本规则）',
      'docs:docs/AGENTS.md（常用命令/发布段）',
    ],
  },
  // 依赖：改 package.json 必须同步依赖生命周期
  {
    match: 'package.json',
    docs: [
      'docs:docs/UPSTREAM_LIFECYCLE.md（依赖清单）',
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
  // 工程脚本：改脚本需同步命令段/发布 SOP
  {
    match: 'scripts/',
    docs: [
      'docs:docs/AGENTS.md（命令段）',
      'docs:docs/RELEASE_SOP.md（如涉及发布流程）',
    ],
  },
  // 兜底：任何 src/ 代码改动必须补 changelog 顶部
  {
    match: 'src/',
    docs: [
      'docs:docs/CUSTOM_CHANGELOG.md（顶部补记）',
    ],
  },
]

// ── 硬触发：这些文件被改、而提交不含任何 docs/README 更新 → --check 拒绝 ──
const HARD_TRIGGER = ['src/']
const HARD_TRIGGER_EXCLUDE = ['scripts/hooks/', 'scripts/doc-sync-map.js', 'scripts/install-hooks.sh']

// ── 实现 ────────────────────────────────────────────────────────────────
function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
  } catch (_) {
    return []
  }
}

function hasDocUpdate(files) {
  return files.some(f => f.startsWith('docs/') || f === 'README.md')
}

function main() {
  const checkMode = process.argv.includes('--check')
  const files = getStagedFiles()
  if (files.length === 0) {
    console.log('doc-sync-map: 无暂存改动。')
    return 0
  }

  const triggered = new Set()
  for (const f of files) {
    for (const rule of RULES) {
      if (f.includes(rule.match)) {
        for (const d of rule.docs) triggered.add(d)
      }
    }
  }

  if (checkMode) {
    const hard = files.filter(f =>
      HARD_TRIGGER.some(m => f.includes(m)) &&
      !HARD_TRIGGER_EXCLUDE.some(x => f.includes(x)),
    )
    if (hard.length > 0 && !hasDocUpdate(files)) {
      console.error('\n\x1b[31m⚠️ [doc-sync] 本次改动包含代码（src/），但未包含任何文档更新：\x1b[0m')
      for (const f of hard) console.error(`   - ${f}`)
      console.error('   → 请按上文清单在同提交内更新对应文档（docs/*、README.md）。')
      console.error('   → 确认无需文档时可 `git commit --no-verify` 绕过。\n')
      return 1
    }
  }

  console.log('\n\x1b[36m📋 [doc-sync] 本次改动触发的「必同步文档」清单：\x1b[0m')
  if (triggered.size === 0) {
    console.log('   （无——本次改动不涉及需同步的文档）')
  } else {
    for (const d of triggered) console.log(`   • ${d}`)
  }
  console.log('')
  return 0
}

process.exit(main())
