#!/usr/bin/env node
/**
 * E15 / R75：错误码文案全映射。
 *
 * 守的是一条最容易被忽略的断链：音源 `ERROR_CODES` 增码 → App 的
 * `FAIL_CODE_I18N_KEY`（src/core/music/utils.ts）没跟着加 → `formatPlayError`
 * 落 `player_error_unknown` → 用户看到「未知错误」，而真实语义是「这源没这能力」。
 *
 * R71d 新增 `UNSUPPORTED_ACTION` 时正是这个情况：码表到 19，文案表停在 18。
 *
 * 口径：
 *   · 源仓码表读 `src/core/02-error-codes.js`（跨仓，支持 LX_SOURCE_ROOT + 候选探测）
 *   · App 文案表读 `src/core/music/utils.ts` 的 `FAIL_CODE_I18N_KEY`
 *   · 三语读 `src/lang/{zh-cn,zh-tw,en-us}.json`
 *   · `PLAYBACK_FAILED` 是 healthReason（src/core/healthStatus.ts:21），不是播放错误码，
 *     不要求进文案表 —— 显式豁免，避免以后被当成漏项反复报。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let checks = 0
let failures = 0
const run = (name, fn) => {
  try {
    fn()
    checks++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}

const SRC_CANDIDATES = ['lx-music-source', 'backend-api']
const sourceRoot = process.env.LX_SOURCE_ROOT
  ? path.resolve(process.env.LX_SOURCE_ROOT)
  : (SRC_CANDIDATES
      .map(d => path.join(ROOT, '..', d))
      .find(d => fs.existsSync(path.join(d, 'src', 'core', '02-error-codes.js'))) ??
    path.join(ROOT, '..', 'lx-music-source'))

const codeFile = path.join(sourceRoot, 'src', 'core', '02-error-codes.js')
const utilsTs = fs.readFileSync(path.join(ROOT, 'src', 'core', 'music', 'utils.ts'), 'utf8')
const LANGS = ['zh-cn', 'zh-tw', 'en-us']
const langOf = l => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lang', `${l}.json`), 'utf8'))

// ---- 解析音源码表：`KEY: 'VALUE',` 逐行 ----
const parseSourceCodes = () => {
  assert(fs.existsSync(codeFile), `源仓码表不存在：${codeFile}（设 LX_SOURCE_ROOT=<源仓路径>）`)
  const text = fs.readFileSync(codeFile, 'utf8')
  const block = text.match(/const ERROR_CODES = \{([\s\S]*?)\n\}/)
  assert(block, '02-error-codes.js 未找到 ERROR_CODES 块')
  const codes = []
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*:\s*'([A-Z_]+)'/)
    if (m) codes.push({ key: m[1], value: m[2] })
  }
  return codes
}

// ---- 解析 App 文案表 ----
const parseI18nMap = () => {
  const block = utilsTs.match(/const FAIL_CODE_I18N_KEY = \{([\s\S]*?)\n\} as const/)
  assert(block, 'utils.ts 未找到 FAIL_CODE_I18N_KEY 块')
  const map = {}
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*:\s*'([a-z0-9_]+)'/)
    if (m) map[m[1]] = m[2]
  }
  return map
}

const sourceCodes = parseSourceCodes()
const i18nMap = parseI18nMap()
const langs = Object.fromEntries(LANGS.map(l => [l, langOf(l)]))

// healthReason 不是播放错误码，不要求文案
const EXEMPT = new Set(['PLAYBACK_FAILED'])

console.log('\n[E15 error code map]')

run('EC01 源仓 ERROR_CODES 恰好 19 个', () => {
  assert.strictEqual(sourceCodes.length, 19, `实际 ${sourceCodes.length} 个：${sourceCodes.map(c => c.key).join(',')}`)
})

run('EC02 App 文案表覆盖源仓全部码（除 healthReason 豁免）', () => {
  const missing = sourceCodes
    .map(c => c.value)
    .filter(v => !EXEMPT.has(v) && !i18nMap[v])
  assert.strictEqual(missing.length, 0, `缺文案：${missing.join(',')}`)
})

run('EC03 UNSUPPORTED_ACTION 有独立文案，不落 unknown', () => {
  assert(i18nMap.UNSUPPORTED_ACTION, 'FAIL_CODE_I18N_KEY 缺 UNSUPPORTED_ACTION')
  assert.notStrictEqual(i18nMap.UNSUPPORTED_ACTION, 'player_error_unknown', 'UNSUPPORTED_ACTION 仍映射到 unknown')
})

run('EC04 每个文案键在三语都存在', () => {
  const keys = [...new Set(Object.values(i18nMap))]
  for (const l of LANGS) {
    const miss = keys.filter(k => !(k in langs[l]))
    assert.strictEqual(miss.length, 0, `${l} 缺键：${miss.join(',')}`)
  }
})

run('EC05 三语文案均非空', () => {
  const keys = [...new Set(Object.values(i18nMap))]
  for (const l of LANGS) {
    const empty = keys.filter(k => !String(langs[l][k] ?? '').trim())
    assert.strictEqual(empty.length, 0, `${l} 空文案：${empty.join(',')}`)
  }
})

run('EC06 同一语言内不同键的文案不重复（防复制粘贴）', () => {
  const keys = [...new Set(Object.values(i18nMap))]
  for (const l of LANGS) {
    const seen = new Map()
    const dup = []
    for (const k of keys) {
      const v = langs[l][k]
      if (seen.has(v)) dup.push(`${seen.get(v)}=${k}(${v})`)
      else seen.set(v, k)
    }
    assert.strictEqual(dup.length, 0, `${l} 文案重复：${dup.join(' / ')}`)
  }
})

run('EC07 历史别名与主码映射同一文案键', () => {
  assert.strictEqual(i18nMap.TIMEOUT, i18nMap.NETWORK_TIMEOUT, 'TIMEOUT 与 NETWORK_TIMEOUT 不同键')
  assert.strictEqual(i18nMap.TOO_MANY_REQUESTS, i18nMap.RATE_LIMIT, 'TOO_MANY_REQUESTS 与 RATE_LIMIT 不同键')
  assert.strictEqual(i18nMap.MISMATCH, i18nMap.SONG_MISMATCH, 'MISMATCH 与 SONG_MISMATCH 不同键')
})

run('EC08 未知码兜底键存在', () => {
  assert.strictEqual(i18nMap.UNKNOWN, 'player_error_unknown', 'UNKNOWN 未映射到 player_error_unknown')
  for (const l of LANGS) assert(langs[l].player_error_unknown, `${l} 缺 player_error_unknown`)
})

run('EC09 音源码表与 docs/ARCHITECTURE.md 声明的 19 一致', () => {
  const arch = fs.readFileSync(path.join(sourceRoot, 'docs', 'ARCHITECTURE.md'), 'utf8')
  const m = arch.match(/(\d+)\s*个错误码/)
  assert(m, 'ARCHITECTURE.md 未找到「N 个错误码」')
  assert.strictEqual(Number(m[1]), sourceCodes.length, `文档 ${m[1]} ≠ 实际 ${sourceCodes.length}`)
})

run('EC10 三语键总数一致', () => {
  const count = o => {
    let n = 0
    const walk = x => {
      for (const k of Object.keys(x)) {
        if (x[k] && typeof x[k] === 'object') walk(x[k])
        else n++
      }
    }
    walk(o)
    return n
  }
  const n0 = count(langs[LANGS[0]])
  for (const l of LANGS) assert.strictEqual(count(langs[l]), n0, `${l} 键数 ${count(langs[l])} ≠ ${n0}`)
})

console.log(`\n===== E15 错误码文案映射：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
