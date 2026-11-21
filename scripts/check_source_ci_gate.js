#!/usr/bin/env node
/**
 * 源仓 HEAD CI 闸门（构建前阻断）
 *
 * 目的：App 构建取源仓库 master 的 lx-source.js 前，确认源仓最近一次 push CI 为绿，
 * 且该绿提交是当前源 HEAD 的祖先（允许绿提交之后只有 docs/巡检类提交）。
 *
 * 背景：b113 曾从源仓红提交 1da2f56 构建；源仓 2e9b204 修测试转绿后，App 侧没有自动闸门，
 * 只靠 DEV_GUIDE 的发布 SOP 人工检查。本脚本把该检查变成构建硬阻断。
 *
 * 用法：
 *   node scripts/check_source_ci_gate.js
 *   SOURCE_REPO=luanmuc/backend-api SOURCE_REF=master node scripts/check_source_ci_gate.js
 *   SOURCE_REF=<sha> node scripts/check_source_ci_gate.js   # 复现指定提交的闸门结论
 *
 * 退出码：0 通过；1 阻断；3 查询失败/无法判定（与 check_source_ci_gate_offline.js 保持一致）。
 */
'use strict'

const REPO = process.env.SOURCE_REPO || 'luanmuc/backend-api'
const REF = process.env.SOURCE_REF || 'master'
const API = `${process.env.GITHUB_API_BASE || 'https://api.github.com'}/repos/${REPO}`
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'lx-music-mobile-source-ci-gate',
}
// K16（2026-11-21 定案）：此前本机跑这条闸门恒 403「API rate limit exceeded for <IP>」，
// 被记成「需要有效凭据/额度」。实际额度充足（认证配额 5000，used 20）——
// 真因是本机既没设 GITHUB_TOKEN，`gh` 的凭据也没被用上，请求走了**未认证**通道，
// 吃的是「按出口 IP 的 60 次/小时」。CI runner 不在本地限流 IP 上，所以 CI 里一直绿。
// 这里补一层兜底：环境变量没有时，尝试从 gh 的 hosts.yml 读 oauth_token（只读、不外传）。
function ghTokenFromConfig() {
  try {
    const p = require('path').join(require('os').homedir(), '.config', 'gh', 'hosts.yml')
    const txt = require('fs').readFileSync(p, 'utf8')
    const m = txt.match(/oauth_token:\s*(\S+)/)
    return m ? m[1] : ''
  } catch { return '' }
}
const TOKEN = process.env.GITHUB_TOKEN || ghTokenFromConfig()
if (TOKEN) HEADERS.Authorization = `Bearer ${TOKEN}`

async function getJson(url) {
  let res = await fetch(url, { headers: HEADERS })
  // App 仓的 GITHUB_TOKEN 对源仓可能只有公开读、也可能跨仓 404；
  // 401/403/404 时退回匿名公开 API（Actions runner 出口不在本地限流 IP 上）。
  if (!res.ok && HEADERS.Authorization && [401, 403, 404].includes(res.status)) {
    const anon = { ...HEADERS }
    delete anon.Authorization
    res = await fetch(url, { headers: anon })
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`GitHub API ${res.status} ${url} ${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function fail(msg) {
  console.error(`❌ 源仓 CI 闸门阻断：${msg}`)
  process.exit(1)
}

(async() => {
  let head
  try {
    head = await getJson(`${API}/commits/${encodeURIComponent(REF)}`)
  } catch (e) {
    console.error(`❌ 源仓 CI 闸门无法读取 ${REPO}@${REF}：${e.message}`)
    process.exit(3)
  }
  const headSha = head.sha
  console.log(`源仓 ${REPO} ${REF} HEAD：${headSha}`)

  let runs
  try {
    runs = await getJson(`${API}/actions/runs?branch=master&event=push&per_page=20`)
  } catch (e) {
    console.error(`❌ 源仓 CI 闸门无法读取 ${REPO} 的 push runs：${e.message}`)
    process.exit(3)
  }
  const latest = (runs.workflow_runs || []).find(r => r.name === 'lx-source CI')
  if (!latest) fail('找不到 lx-source CI 的 push run，无法确认源仓 CI 绿')
  console.log(`最近 push CI：${latest.html_url}`)
  console.log(`  head_sha=${latest.head_sha} status=${latest.status} conclusion=${latest.conclusion}`)
  if (latest.status !== 'completed') fail(`最近 push CI 尚未完成（${latest.status}）`)
  if (latest.conclusion !== 'success') fail(`最近 push CI 结论为 ${latest.conclusion}，不是 success`)

  let cmp
  try {
    cmp = await getJson(`${API}/compare/${latest.head_sha}...${headSha}`)
  } catch (e) {
    console.error(`❌ 源仓 CI 闸门无法比较 ${latest.head_sha}...${headSha}：${e.message}`)
    process.exit(3)
  }
  console.log(`绿提交 → 当前 HEAD compare status=${cmp.status}`)
  if (cmp.status !== 'ahead' && cmp.status !== 'identical') {
    fail(`绿提交不是当前 HEAD 的祖先（compare=${cmp.status}），拒绝取源构建`)
  }
  console.log(`✅ 源仓 CI 闸门通过：当前 HEAD ${headSha} 基于绿提交 ${latest.head_sha}`)
})().catch(e => {
  console.error(`❌ 源仓 CI 闸门异常：${(e && e.stack) || e}`)
  process.exit(3)
})
