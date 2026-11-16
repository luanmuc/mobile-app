#!/usr/bin/env node
/**
 * 本地预检：把 CI 会跑的门禁在本地一次性跑完，别让云端当发现问题的地方。
 *
 * 为什么存在：2026-11-16 一次推送花了 50 分钟——三次源仓 `npm test`、两轮 9 分钟的源仓 CI
 * 因为「日志横幅被改成派生」触发 self-check 开包正则、App 首轮 CI 因为新增脚本后
 * 没跑口径门禁（G7 39≠40）而红。教训不是「下次记得多跑几条」，而是把清单固化成一条命令。
 *
 * 判据来源：直接解析 `.github/workflows/release.yml` 的 `checks:` 段与 `lint:` 段，
 * 不手抄列表——手抄必然与 CI 漂移（这次 G7 就是漂移的典型）。
 *
 * 用法：
 *   node scripts/preflight.js              # App 侧（tsc + eslint + CI 全部 check）
 *   node scripts/preflight.js --with-source # 再加源仓（self-check / docs-audit / npm test / verify:bundle）
 *   node scripts/preflight.js --fast        # 跳过耗时最长的 npm test（仅自查用，不许当发布证据）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const ROOT = process.env.PREFLIGHT_ROOT ? path.resolve(process.env.PREFLIGHT_ROOT) : path.resolve(__dirname, '..')
const SRC_DIR = path.resolve(ROOT, '..', 'lx-music-source')
const args = process.argv.slice(2)
const withSource = args.includes('--with-source')
const fast = args.includes('--fast')

const readWorkflow = () => fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')

// 从 workflow 里取某个 job 段内的命令（只认 node / npx / npm 开头的行）
const jobCommands = jobName => {
  const lines = readWorkflow().split('\n')
  const start = lines.findIndex(l => l.replace(/\s+$/, '') === `  ${jobName}:`)
  if (start < 0) return []
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-zA-Z_-]+:\s*$/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end)
    .filter(l => /^\s*(node|npx|npm)\s/.test(l))
    .map(l => l.trim())
    .filter((c, i, arr) => arr.indexOf(c) === i)
}

const steps = []
const add = (name, cmd, cwd = ROOT) => steps.push({ name, cmd, cwd })

// 变更范围判定：release.yml 对 docs/**、README.md、publish/**、npm-version-info/** 设了 paths-ignore，
// 纯这类改动云端整个 workflow 都不会触发。本地若照跑 tsc+eslint，等于白等 250s 去复现一个不会发生的检查。
// 判据只用于「跳过」，不放宽任何一条 check；只要有一个 src/scripts/android/.github 改动就照常全跑。
const changedFiles = () => {
  const run = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }) } catch (e) { return '' } }
  const raw = [
    run('git diff --name-only HEAD'),
    run('git diff --name-only origin/master...HEAD'),
    run('git status --porcelain'),
  ].join('\n')
  return [...new Set(raw.split('\n').map(l => l.replace(/^\s*\S+\s+/, '').trim()).filter(Boolean))]
}
const isDocsOnly = files => files.length > 0 &&
  files.every(f => /^(docs\/|.*\.md$|README|publish\/|npm-version-info\/)/.test(f))

// lint job：编译器 + linter（CI 里是两条独立 step，本地合成一条命令也照跑）
// 本地加缓存/增量：判据不变（同一 tsc / 同一 eslint 配置），只是别每次重算
add('tsc --noEmit', 'node node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc.tsbuildinfo')
add('eslint', 'node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx --cache --cache-location node_modules/.cache/eslint/')

// checks job：完全照 workflow 的顺序
for (const cmd of jobCommands('checks')) add(cmd.replace('node scripts/', '').replace('.js', ''), cmd)

// 跨仓往返门禁（不在 CI：只检 App 仓会永远 SKIP）；有源仓才跑
if (fs.existsSync(path.join(SRC_DIR, 'lx-source.js'))) {
  add('cross_repo_health_roundtrip', 'node scripts/check_cross_repo_health_roundtrip.js')
}

if (withSource) {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(`\n⚠️  --with-source 但没检出源仓：${SRC_DIR}`)
  } else {
    add('源仓 build-source', 'node scripts/build-source.js', SRC_DIR)
    add('源仓 self-check', 'node scripts/self-check.js', SRC_DIR)
    add('源仓 docs-audit', 'node scripts/docs-audit.js --dry-run', SRC_DIR)
    add('源仓 verify:bundle', 'npm run -s verify:bundle', SRC_DIR)
    add('源仓 npm test', 'npm test', SRC_DIR)
  }
}

const results = []
const t0 = Date.now()
const CONCURRENCY = Number(process.env.PREFLIGHT_JOBS || 8)

// 每个 check 脚本都是「读文件 + 断言」，互不写盘（已核过 scripts/check_*.js 无 writeFileSync），
// 所以按 App 内部并发、源仓串行（源仓 build-source 会写文件、npm test 本身会开一堆子进程）。
const runStep = s => new Promise(resolve => {
  const t = Date.now()
  const child = spawn(s.cmd, { cwd: s.cwd, shell: true })
  let out = ''
  const keep = d => { out = (out + d).slice(-4000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.on('close', code => {
    const ms = Date.now() - t
    const ok = code === 0
    const tail = out.trim().split('\n').filter(Boolean).slice(-3).join('\n')
    const r = { name: s.name, ok, ms, tail }
    results.push(r)
    console.log(`${ok ? '✅' : '❌'} ${s.name} (${(ms / 1000).toFixed(1)}s)`)
    if (!ok && tail) console.log(tail.replace(/^/gm, '   '))
    resolve(r)
  })
})

const pool = async(items, limit) => {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async() => {
    while (queue.length) await runStep(queue.shift())
  })
  await Promise.all(workers)
}

;(async() => {
  let appSteps = steps.filter(s => s.cwd === ROOT && !(fast && s.name.includes('源仓 npm test')))
  // 纯文档改动：与云端同判据地跳过 tsc/eslint（release.yml 的 paths-ignore 让这两个 job 根本不跑）
  const touched = changedFiles()
  if (isDocsOnly(touched)) {
    appSteps = appSteps.filter(s => s.name !== 'tsc --noEmit' && s.name !== 'eslint')
    console.log(`📄 本次只改文档（${touched.length} 个文件）：跳过 tsc/eslint（云端 paths-ignore 同样不触发）`)
  }
  const srcSteps = steps.filter(s => s.cwd !== ROOT)
  await pool(appSteps, CONCURRENCY)
  for (const s of srcSteps) await runStep(s)

  const failed = results.filter(r => !r.ok)
  const total = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n预检：${results.length - failed.length} 通过 / ${failed.length} 失败 · 共 ${total}s`)
  if (failed.length) {
    console.log('失败项：\n' + failed.map(f => ` - ${f.name}`).join('\n'))
    process.exit(1)
  }
  console.log('本地与 CI 同判据：可以推。')
})()
