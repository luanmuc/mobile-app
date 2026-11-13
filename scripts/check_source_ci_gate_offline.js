#!/usr/bin/env node
/**
 * 源仓 HEAD CI 闸门离线复核（check_source_ci_gate.js 的旁路证据）
 *
 * 背景：本地匿名 IP 调 GitHub API 可能 403 限流；构建 runner 有 GITHUB_TOKEN，
 * 不受本地限额影响。本脚本从 Actions 页面内嵌 JSON 取最近一次 push run 的
 * conclusion/commit，再用本地 git 验证绿提交是源仓 HEAD 的祖先。
 *
 * 用法：
 *   node scripts/check_source_ci_gate_offline.js
 *   SOURCE_REPO_PATH=../lx-music-source node scripts/check_source_ci_gate_offline.js
 *
 * 退出码：0 通过；1 闸门不成立；2 页面解析/网络失败。
 * 注意：这是本地发布预检的补充证据，不替代 CI runner 内的 check_source_ci_gate.js。
 */
'use strict'

const { execFileSync } = require('child_process')
const path = require('path')
const REPO = process.env.SOURCE_REPO || 'luanmuc/backend-api'
const SRC = process.env.SOURCE_REPO_PATH || path.resolve(__dirname, '..', '..', 'lx-music-source')
const HTML = `https://github.com/${REPO}/actions/workflows/ci.yml?query=event%3Apush+branch%3Amaster`

function git(args, opts = {}) {
  return execFileSync('git', ['-C', SRC, ...args], { encoding: 'utf8', ...opts }).trim()
}

async function main() {
  const res = await fetch(HTML, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Actions 页面 HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('未找到 embeddedData JSON')
  const data = JSON.parse(m[1])
  const runs = data?.payload?.workflowRunsRoute?.workflowRuns || []
  const latest = runs.find(r => r.name === 'lx-source CI')
  if (!latest) throw new Error('页面里没有 lx-source CI push run')
  const conclusion = latest.state?.conclusion || ''
  const status = latest.state?.status || ''
  const link = latest.description?.linkUrl || ''
  const runSha = (link.match(/commit\/([0-9a-f]{40})/) || [])[1]
  if (!runSha) throw new Error('run 页面里没有 commit SHA')
  console.log(`最近 push run：${latest.id} #${latest.runNumber} ${conclusion}`)
  console.log(`  run head=${runSha}`)
  if (status !== 'WORKFLOW_RUN_STATUS_COMPLETED') throw new Error(`run 未完成：${status}`)
  if (conclusion !== 'WORKFLOW_RUN_CONCLUSION_SUCCESS') throw new Error(`run 非 success：${conclusion}`)

  git(['fetch', 'origin', 'master', '--quiet'])
  const headSha = git(['rev-parse', 'origin/master'])
  console.log(`源仓远端 HEAD=${headSha}`)
  try {
    execFileSync('git', ['-C', SRC, 'merge-base', '--is-ancestor', runSha, headSha])
  } catch {
    throw new Error(`绿提交不是当前 HEAD 的祖先：${runSha} ⊄ ${headSha}`)
  }
  console.log(`✅ 离线闸门通过：绿提交 ${runSha} 是当前 HEAD ${headSha} 的祖先`)
}

main().catch(e => {
  console.error(`❌ 离线闸门失败：${e.message}`)
  process.exitCode = 2
})
