#!/usr/bin/env node
/**
 * 断言台账校验器（assertion ledger）
 *
 * 解决的问题：49 个 check_*.js 各自输出「N 通过 / M 失败」，但没人核对
 * **实测断言数是否与 AUDIT_PLAN 6b 台账声明的一致**。脚本被删几条断言、
 * 或循环被改成只跑一个分支，preflight 仍显示「47/47 通过」，闸门实际已经变松。
 *
 * 做法：读 6b 台账 → 逐脚本实跑 → 从输出里提取 通过/失败/跳过 → 与台账逐行比对。
 * 差异即失败；解析不出数字记为 unparsed（不阻塞，但显式列出，逼着把输出补成有数字）。
 *
 * 用法：
 *   node scripts/check_assertion_ledger.js                # 全量（约 2.5 分钟）
 *   node scripts/check_assertion_ledger.js --only health  # 只跑名字含 health 的
 *   node scripts/check_assertion_ledger.js --json         # 机器可读
 *   node scripts/check_assertion_ledger.js --list         # 只列台账，不执行
 *   node scripts/check_assertion_ledger.js --quick        # 跳过 stress 类（约 40 秒）
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const LEDGER = path.join(ROOT, 'docs', 'AUDIT_PLAN.md')
// 真实存在的脚本名（供台账里 `_suffix` 简写解析）
const ALL_SCRIPTS = fs.readdirSync(path.join(ROOT, 'scripts'))
  .filter(f => f.startsWith('check_') && f.endsWith('.js'))
  .map(f => f.replace(/\.js$/, ''))

// 不参与断言比对的脚本（网络门禁 / 纯工具），与台账 note 一致
const SKIP = new Set([
  'check_source_ci_gate',
  'check_source_ci_gate_offline',
])
// 断言 ID：`✓ HS1 标题` / `  ✅ [G7] 说明` / `✔ V12 ...` 这类行首标记 + 1~3 字母 + 数字(+单字母后缀)
// 用途：抓「数量没变但某条断言被换成了另一条」——只比条数抓不到这种漂移。
// ID 形态：HS1 / U45 / G4b / EQ01 / C1 / X1b / A7b / P1B-A1 / P1F-A1 / R-01-W1 / P0-10 / I05-11 / N2-D1
// 三段以上（P1B-A1、R-01-W1、P0-10）都是历史既有形态，此前识别不到；纳管不需要改脚本。
// 注意 `-\\d{1,3}` 必须能作为**末段**（P0-10 曾因模式写成「数字后必须跟字母段」而被截成 P0）。
const ID_PATTERN =
  '[A-Z]{1,3}\\d{1,3}[a-zA-Z]?(?:-[A-Z]?\\d{1,3}[a-z]?)*' +
  '|[A-Z]-\\d{1,3}-[A-Z]\\d{1,3}[a-z]?'
const RE_ID = new RegExp(`^\\s*(?:✓|✔|✅)\\s*(?:\\[\\s*)?(${ID_PATTERN})\\b`, 'gm')
// 排序键：把每段字母+数字的编号补零，兼容 R-01-W1 这种带连字符的 ID
const idSortKey = s => s.replace(/([A-Z]+)(\d+)([a-z]?)/g, (_, p, n, x) => p + String(n).padStart(4, '0') + x)
// 返回 Map<ID, 出现次数>：同一个 ID 可以挂多条子断言（如 H7×5），按次数比对才能抓到「少一条 H7」
const extractIdCounts = output => {
  const m = new Map()
  for (const x of output.matchAll(RE_ID)) m.set(x[1], (m.get(x[1]) || 0) + 1)
  return m
}
const sortedIdKeys = m => [...m.keys()].sort((a, b) => (idSortKey(a) < idSortKey(b) ? -1 : 1))

const TOOLING = new Set(['check_upstream_divergence', 'check_assertion_ledger'])
// 台账条数是「文件数 / 文档数」而非断言数
const COUNT_KIND = { check_ts_syntax: 'files', check_docs_consistency: 'docs' }
// --quick 跳过的重脚本
const HEAVY = /stress|deep|diagnostics_deep/

// 输出解析：先试「N 通过 / M 失败(/ K 跳过)」，再一次试英文、条断言、x/9
const RE_PASS_FAIL = /(\d+)\s*(?:项通过|通过|条断言)\s*[/／，,]\s*(\d+)\s*(?:项失败|新增失败|失败)(?:\s*[/／，,]\s*(\d+)\s*(?:未执行|跳过|已知遗留))?/
const RE_PASSED_FAILED = /(\d+)\s*passed(?:\s*,\s*(\d+)\s*failed)?/
const RE_X_OF_Y = /(\d+)\/(\d+)\s*通过/

function parseCounts(output) {
  const m = output.match(RE_PASS_FAIL)
  if (m) {
    return {
      passed: Number(m[1]),
      failed: Number(m[2]),
      skipped: Number(m[3] || 0),
      form: 'chinese',
    }
  }
  const m2 = output.match(RE_PASSED_FAILED)
  if (m2) return { passed: Number(m2[1]), failed: Number(m2[2] || 0), skipped: 0, form: 'english' }
  const m3 = output.match(RE_X_OF_Y)
  if (m3) return { passed: Number(m3[1]), failed: 0, skipped: Number(m3[2]) - Number(m3[1]), form: 'x-of-y' }
  // 只输出「全部一致」而不报数字的脚本：数逐条断言行（`✅ [Gxx] ...`），不含总结行
  const gateLines = (output.match(/^\s*✅\s*\[[A-Z]\d+/gm) || []).length
  if (gateLines > 0) return { passed: gateLines, failed: 0, skipped: 0, form: 'gate-lines' }
  return null
}

// 从 6b 表解析台账：| `脚本` | 条数 | 守什么 |
// 6c：断言 ID 台账。6b 只比条数，抓不到「数量不变但断言被换掉」
function readIdLedger(txt) {
  const map = new Map()
  let inSec = false
  for (const line of txt.split('\n')) {
    if (/^### 6c\./.test(line)) { inSec = true; continue }
    if (inSec && /^#{2,3} /.test(line)) break
    if (!inSec) continue
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*\d+\s*\|\s*([^|]*)\|/)
    if (!m) continue
    const counts = new Map()
    for (const tok of m[2].trim().split(/\s+/).filter(Boolean)) {
      // 与 RE_ID 同一套模式：台账里写的 ID 必须能被同一规则读回来
      const mm = tok.match(new RegExp(`^(${ID_PATTERN})×(\\d+)$`)) ||
        tok.match(new RegExp(`^(${ID_PATTERN})$`))
      if (!mm) continue
      counts.set(mm[1], Number(mm[2] || 1))
    }
    if (counts.size) map.set(m[1], counts)
  }
  return map
}

function readLedger() {
  const text = fs.readFileSync(LEDGER, 'utf8')
  const seg = text.split('### 6b.')[1]
  if (!seg) throw new Error('AUDIT_PLAN 里找不到 6b 小节')
  const section = seg.split(/\n### /)[0]
  const rows = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
    const nameCell = cells[0]
    const countCell = cells[1] || ''
    const note = cells[2] || ''
    // 一行多脚本：`check_a` / `_b` / `_c`，条数为 3 / 3 / 7。
    // 简写 `_suffix` 不能简单拼接（`check_download_persistence` + `_restore_runtime` 实际是
    // `check_download_restore_runtime`），按「以该后缀结尾的真实脚本文件」解析最稳。
    const scriptNames = [...nameCell.matchAll(/`([^`]+)`/g)].map(m => m[1])
    const expanded = scriptNames.length > 1 ? scriptNames.map(n => {
      if (!n.startsWith('_')) return n
      const hit = ALL_SCRIPTS.find(f => f.endsWith(n))
      return hit || n
    }) : []
    if (expanded.length) {
      const parts = countCell.split('/').map(s => s.trim())
      expanded.forEach((name, i) => {
        rows.push({ script: name, declared: parseDeclared(parts[i]), note, multi: true })
      })
      continue
    }
    const script = scriptNames[0]
    if (!script) continue
    rows.push({ script, declared: parseDeclared(countCell), note })
  }
  return rows
}

function parseDeclared(cell) {
  if (typeof cell !== 'string') return 0
  const digits = cell.match(/\d+/)
  if (!digits) return 0
  return Number(digits[0])
}

function runScript(name, timeoutMs) {
  const file = path.join(ROOT, 'scripts', `${name}.js`)
  if (!fs.existsSync(file)) return { missing: true }
  const started = Date.now()
  const res = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env, LX_REQUIRE_SOURCE: '' },
  })
  const elapsed = Date.now() - started
  const output = `${res.stdout || ''}\n${res.stderr || ''}`
  return {
    exitCode: res.status,
    timedOut: !!(res.error && res.error.code === 'ETIMEDOUT'),
    output,
    elapsed,
    counts: parseCounts(output),
  }
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const list = args.includes('--list')
  // preflight 用 `LX_LEDGER_QUICK=1` 走快速档（跳过 stress/deep 重脚本）；CI 不设则跑全量
  const quick = args.includes('--quick') || process.env.LX_LEDGER_QUICK === '1'
  const genIds = args.includes('--gen-ids')
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : ''

  const ID_LEDGER = readIdLedger(fs.readFileSync(LEDGER, 'utf-8'))
  let rows = readLedger()
  if (only) rows = rows.filter(r => r.script.includes(only))
  const targets = rows.filter(r => !SKIP.has(r.script) && !TOOLING.has(r.script))

  if (list) {
    for (const r of rows) console.log(`${r.script}\t声明 ${r.declared}`)
    console.log(`\n台账 ${rows.length} 行 / 参与比对 ${targets.length} 个`)
    return 0
  }

  const results = []
  for (const row of targets) {
    if (quick && HEAVY.test(row.script)) {
      results.push({ ...row, state: 'skipped-quick', elapsed: 0 })
      continue
    }
    const r = runScript(row.script, 180000)
    if (r.missing) {
      results.push({ ...row, state: 'missing', elapsed: 0 })
      continue
    }
    // 脚本自身崩溃（exitCode != 0）优先判定为失败：不能因为「输出解析不出数字」就降级成未解析，
    // 否则 syntax error / 运行时异常会被当成无害
    if (r.exitCode !== 0) {
      results.push({ ...row, state: 'failing', actual: null, exitCode: r.exitCode, elapsed: r.elapsed })
      continue
    }
    const kind = COUNT_KIND[row.script]
    if (kind) {
      // 文件数 / 文档数：只校验非零且与台账一致
      const n = Number((r.output.match(kind === 'files' ? /(\d+)\s*个\s*TS\/TSX/ : /(\d+)\s*个文档/) || [])[1] || 0)
      results.push({ ...row, actual: n, counts: { passed: n, skipped: 0 }, state: n === row.declared ? 'ok' : 'drift', elapsed: r.elapsed, output: r.output })
      continue
    }
    if (!r.counts) {
      // 环境缺失导致的整体跳过（如跨仓脚本未检出源仓产物）不算漂移，也不算未解析
      if (/未检出源仓|\u23ed\s*SKIP|LX_SOURCE_ROOT/.test(r.output)) {
        results.push({ ...row, state: 'skipped-env', elapsed: r.elapsed })
        continue
      }
      results.push({ ...row, state: 'unparsed', elapsed: r.elapsed, sample: r.output.trim().split('\n').slice(-2).join(' ').slice(0, 90) })
      continue
    }
    if (r.counts.failed > 0) {
      results.push({ ...row, actual: r.counts.passed, failed: r.counts.failed, state: 'failing', elapsed: r.elapsed })
      continue
    }
    // 跳过项不参与比对：台账记的是「实际执行的断言数」，环境缺失导致的跳过不是漂移
    // 台账口径有两种（纯通过数 / 通过+跳过），任一成立即视为一致
    const ok = row.declared === 0
      ? true
      : r.counts.passed === row.declared || r.counts.passed + r.counts.skipped === row.declared
    if (!ok) {
      results.push({ ...row, actual: r.counts.passed, skipped: r.counts.skipped, counts: r.counts, state: 'drift', elapsed: r.elapsed, output: r.output })
      continue
    }
    // 条数对上了，再验身份：6c 登记的脚本，ID 集合必须逐个相同
    const wantIds = ID_LEDGER.get(row.script)
    if (wantIds && wantIds.size) {
      const gotIds = extractIdCounts(r.output)
      const diffs = []
      for (const [id, n] of wantIds) {
        const g = gotIds.get(id) || 0
        if (g === 0) diffs.push(`少 ${id}`)
        else if (g < n) diffs.push(`少 ${id}×${n - g}（应 ${n} 实 ${g}）`)
      }
      for (const [id, g] of gotIds) if (!wantIds.has(id)) diffs.push(`多 ${id}${g > 1 ? `×${g}` : ''}`)
      if (diffs.length) {
        results.push({ ...row, actual: r.counts.passed, skipped: r.counts.skipped, counts: r.counts, state: 'id-drift', diffs, elapsed: r.elapsed, output: r.output })
        continue
      }
    }
    results.push({ ...row, actual: r.counts.passed, skipped: r.counts.skipped, counts: r.counts, state: 'ok', elapsed: r.elapsed, output: r.output })
  }

  const drift = results.filter(r => r.state === 'drift' || r.state === 'id-drift')
  const failing = results.filter(r => r.state === 'failing')
  const unparsed = results.filter(r => r.state === 'unparsed')
  const missing = results.filter(r => r.state === 'missing')
  const skipped = results.filter(r => r.state === 'skipped-quick')
  const skippedEnv = results.filter(r => r.state === 'skipped-env')
  if (genIds) {
    // 只列「ID 数 == 台账声明数」的脚本：这类脚本能一对一校验断言身份
    // 注意：不能用 `state === 'ok'` 过滤——6c 旧登记会让脚本处于 id-drift，
    // 那样永远补不进 6c（循环依赖）。只要脚本跑成功、拿到了条数就参与生成。
    const all = results
      .filter(r => (r.state === 'ok' || r.state === 'id-drift') && r.counts)
      .map(r => ({ script: r.script, declared: r.declared, ids: extractIdCounts(r.output || '') }))
    const sumOf = x => [...x.ids.values()].reduce((a, b) => a + b, 0)
    // 只收「ID 总次数 == 声明数」的；其余必须显式列出，否则会像上次那样静默漏两个脚本
    const lines = all.filter(x => sumOf(x) === x.declared)
    console.log('| 脚本 | 断言数 | ID 清单（复用标 ×N） |')
    console.log('|---|---|---|')
    for (const x of lines) {
      const cell = sortedIdKeys(x.ids).map(k => (x.ids.get(k) > 1 ? `${k}×${x.ids.get(k)}` : k)).join(' ')
      console.log(`| \`${x.script}\` | ${x.declared} | ${cell} |`)
    }
    const total = lines.reduce((a, x) => a + x.declared, 0)
    console.log(`\n（${lines.length} 个脚本 / ${total} 条断言 ID 全覆盖）`)
    const partial = all.filter(x => sumOf(x) !== x.declared)
    if (partial.length) {
      console.log('\n⚠ 以下脚本 ID 不全或形态不稳定，未列入 6c（只能按条数校验）：')
      for (const x of partial) console.log(`  ${x.script}: 声明 ${x.declared} / 提到 ${sumOf(x)} 个 ID`)
    }
    return 0
  }
  const okRows = results.filter(r => r.state === 'ok')
  const totalAssertions = results.reduce((s, r) => s + (r.actual || 0), 0)

  if (json) {
    console.log(JSON.stringify({
      ok: drift.length === 0 && failing.length === 0 && missing.length === 0,
      totalDeclared: results.reduce((s, r) => s + (r.declared || 0), 0),
      totalActual: totalAssertions,
      counts: { ok: okRows.length, drift: drift.length, failing: failing.length, unparsed: unparsed.length, missing: missing.length, skippedEnv: skippedEnv.length, skipped: skipped.length },
      rows: results.map(r => ({
        script: r.script,
        declared: r.declared,
        actual: r.actual ?? null,
        skippedInRun: r.skipped ?? null,
        state: r.state,
        elapsed: r.elapsed,
      })),
    }, null, 2))
  } else {
    console.log('\n断言台账校验（AUDIT_PLAN 6b ↔ 实测）\n')
    console.log('| 脚本 | 台账 | 实测 | 跳过 | 状态 | 耗时 |')
    console.log('|---|---:|---:|---:|---|---:|')
    for (const r of results) {
      const st = r.state === 'ok' ? '✅' : r.state === 'drift' ? '⛔ 漂移' : r.state === 'id-drift' ? '⛔ ID 漂移' : r.state === 'failing'
        ? (r.exitCode ? '❌ 崩溃' : '❌ 断言失败') : r.state === 'unparsed' ? '❓ 未解析' : r.state === 'missing' ? '⛔ 缺脚本'
            : r.state === 'skipped-env' ? '⏭ 环境跳过' : '⏭ 快速跳过'
      console.log(`| \`${r.script}\` | ${r.declared} | ${r.actual ?? '-'} | ${r.skipped ?? '-'} | ${st} | ${(r.elapsed / 1000).toFixed(1)}s |`)
    }
    console.log('')
    if (drift.length) {
      const countDrift = drift.filter(r => r.state === 'drift')
      const idDrift = drift.filter(r => r.state === 'id-drift')
      if (countDrift.length) {
        console.log('断言数漂移（台账声明 ≠ 实测，说明有断言被增删或分支被跳过）：')
        for (const r of countDrift) console.log(`  ⛔ ${r.script}: 声明 ${r.declared} / 实测 ${r.actual}${r.skipped ? ` + 跳过 ${r.skipped}` : ''}`)
      }
      if (idDrift.length) {
        console.log('断言 ID 漂移（条数没变，但某几条断言被换掉）：')
        for (const r of idDrift) {
          console.log(`  ⛔ ${r.script}: ${r.diffs.join(' / ')}`)
        }
      }
      console.log('')
    }
    if (unparsed.length) {
      console.log('输出无法解析断言数（需给脚本补「N 通过 / M 失败」汇总行）：')
      for (const r of unparsed) console.log(`  ❓ ${r.script}: ${r.sample || ''}`)
      console.log('')
    }
    console.log(`汇总：${okRows.length} 一致 / ${drift.length} 漂移 / ${failing.length} 失败 / ${unparsed.length} 未解析 / ${missing.length} 缺脚本 / ${skippedEnv.length} 环境跳过 / ${skipped.length} 快速跳过`)
    console.log(`断言：台账合计 ${results.reduce((s, r) => s + (r.declared || 0), 0)} / 实测合计 ${totalAssertions}`)
  }

  return drift.length === 0 && failing.length === 0 && missing.length === 0 ? 0 : 1
}

process.exit(main())
