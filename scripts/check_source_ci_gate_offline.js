#!/usr/bin/env node
/**
 * 源仓 HEAD CI 闸门离线复核（check_source_ci_gate.js 的旁路证据）
 *
 * 背景：本地匿名 IP 调 GitHub API 可能 403 限流；构建 runner 有 GITHUB_TOKEN，
 * 不受本地限额影响。本脚本优先走 API（结构化、稳定），无 token / 被限流时才退回
 * Actions 页面内嵌 JSON（页面结构一变就失效，只作兜底）。
 *
 * 用法：
 *   node scripts/check_source_ci_gate_offline.js
 *   GITHUB_TOKEN=xxx node scripts/check_source_ci_gate_offline.js   # 推荐，走 API 不抓页面
 *   SOURCE_REPO_PATH=../lx-music-source node scripts/check_source_ci_gate_offline.js
 *
 * 退出码：0 通过；1 闸门不成立（绿提交不是当前 HEAD 祖先）；3 未验证（读不到 / 未完成 / 结构变了）。
 * 注意：这是本地发布预检的补充证据，不替代 CI runner 内的 check_source_ci_gate.js。
 */
'use strict'

const { execFileSync } = require('child_process')
const path = require('path')
const REPO = process.env.SOURCE_REPO || 'luanmuc/backend-api'
const SRC = process.env.SOURCE_REPO_PATH || path.resolve(__dirname, '..', '..', 'lx-music-source')
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const API = `https://api.github.com/repos/${REPO}/actions/workflows/ci.yml/runs?branch=master&per_page=5`
const HTML = `https://github.com/${REPO}/actions/workflows/ci.yml?query=event%3Apush+branch%3Amaster`

function git(args, opts = {}) {
  return execFileSync('git', ['-C', SRC, ...args], { encoding: 'utf8', ...opts }).trim()
}

const SUCCESS = new Set(['success', 'WORKFLOW_RUN_CONCLUSION_SUCCESS'])

/** 主路径：REST API（返回结构化 workflow_runs） */
async function viaApi() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'lx-music-audit' }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  const res = await fetch(API, { headers })
  // 403（限额）/ 401（token 无效）→ 通报后交给兜底，不当成「闸门不成立」
  if (res.status === 403 || res.status === 401) {
    console.log(`… API ${res.status}（限流或 token 无效），退回页面兜底`)
    return null
  }
  if (!res.ok) throw new Error(`API HTTP ${res.status}`)
  const data = await res.json()
  const runs = (data.workflow_runs || []).filter(r => r.name === 'lx-source CI' || r.path === '.github/workflows/ci.yml')
  if (!runs.length) throw new Error('API 里没有 lx-source CI push run（未验证）')
  const latest = runs[0]
  return {
    id: latest.id,
    num: latest.run_number,
    status: latest.status,
    conclusion: latest.conclusion,
    sha: latest.head_sha,
    source: 'api',
  }
}

/** 兜底：Actions 页面内嵌 JSON（结构变动即 3，不再静默） */
async function viaPage() {
  const res = await fetch(HTML, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Actions 页面 HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('页面未找到 embeddedData JSON（结构可能已变，未验证）')
  const data = JSON.parse(m[1])
  const runs = data?.payload?.workflowRunsRoute?.workflowRuns || []
  const latest = runs.find(r => r.name === 'lx-source CI')
  if (!latest) throw new Error('页面里没有 lx-source CI push run（未验证）')
  const link = latest.description?.linkUrl || ''
  const sha = (link.match(/commit\/([0-9a-f]{40})/) || [])[1]
  if (!sha) throw new Error('run 里没有 commit SHA（未验证）')
  return {
    id: latest.id,
    num: latest.runNumber,
    status: latest.state?.status,
    conclusion: latest.state?.conclusion,
    sha,
    source: 'page',
  }
}

async function main() {
  const run = (await viaApi()) || (await viaPage())
  console.log(`最近 push run：${run.id} #${run.num} ${run.conclusion || run.status}（来源：${run.source}）`)
  console.log(`  run head=${run.sha}`)
  if (run.status !== 'completed' && run.status !== 'WORKFLOW_RUN_STATUS_COMPLETED') throw new Error(`run 未完成：${run.status}`)
  if (!SUCCESS.has(run.conclusion)) throw new Error(`run 非 success：${run.conclusion}`)

  // 用 ls-remote 取远端 HEAD，不改本地 refs（避免闸门脚本顺带 fetch 污染工作区）
  const line = git(['ls-remote', 'origin', 'refs/heads/master'])
  const headSha = line.split(/\s+/)[0]
  if (!headSha) throw new Error('ls-remote 读不到 origin/master（未验证）')
  console.log(`源仓远端 HEAD=${headSha}`)
  try {
    execFileSync('git', ['-C', SRC, 'merge-base', '--is-ancestor', run.sha, headSha])
  } catch {
    throw new Error(`绿提交不是当前 HEAD 的祖先：${run.sha} ⊄ ${headSha}`)
  }
  console.log(`✅ 离线闸门通过：绿提交 ${run.sha} 是当前 HEAD ${headSha} 的祖先`)
}

// 退出码语义（与源仓 docs/TESTING.md 的约定一致）：
//   0 通过 / 1 真阻断（读到了，但绿提交不是当前 HEAD 祖先）/ 3 未验证（读不到、结构变了、run 未完成）
// A13-P2-15：源仓目录缺失时 execFileSync 抛 ENOENT / 'no such file or directory'，
// 这属于「未验证」而不是「闸门不成立」，必须归入 3 而非 1。
const UNVERIFIED = /HTTP \d+|未验证|未完成|fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENOENT|no such file or directory|结构可能已变/i
main().catch(e => {
  const unverified = UNVERIFIED.test(String(e && e.message))
  console.error(`❌ 离线闸门${unverified ? '未验证' : '失败'}：${e.message}`)
  process.exitCode = unverified ? 3 : 1
})
