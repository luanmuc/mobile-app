#!/usr/bin/env node
/**
 * 真机摘要契约（v8.17 阶段 3）：只跑纯函数，不碰 RN / 网络 / 存储。
 * 用法：node scripts/check_health_digest.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const src = fs.readFileSync(file, 'utf-8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText
  const Module = require('module')
  const mod = new Module(file)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(js, file)
  return mod.exports
}
const D = loadTs('src/core/healthDigest.ts')
let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`) } catch (e) { failures.push(name); console.log(`✗ ${name} — ${e.message}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

const NOW = Date.UTC(2026, 10, 17, 2, 0, 0)
const H = 3600 * 1000
const ev = (over = {}) => ({ ts: NOW - H, event: 'play_result', sourceId: 'suyinKuwo', platform: 'kw', ok: true, latencyMs: 300, ...over })
const meta = { deviceId: 'a1b2c3d4e5f6', appVersion: '1.9.2', build: 305, now: NOW }

check('A1 探测/播放/取链分别计数；probe 上下文的 play_result 不算用户播放', () => {
  const d = D.buildDigest([
    ev({ event: 'probe_result', ok: true }),
    ev({ event: 'probe_result', ok: false, code: 'NETWORK_TIMEOUT' }),
    ev({ event: 'play_result', ok: true, context: 'probe' }),
    ev({ event: 'play_result', ok: true, context: 'user' }),
    ev({ event: 'chain_result', ok: false, code: 'NOT_AUDIO' }),
  ], meta)
  assert(d.probe.total === 2 && d.probe.ok === 1, 'probe 计数错：' + JSON.stringify(d.probe))
  assert(d.play.total === 1 && d.play.ok === 1, 'probe 上下文的 play 被计入：' + JSON.stringify(d.play))
  assert(d.chain.total === 1 && d.chain.ok === 0 && d.chain.failures[0].code === 'NOT_AUDIO', 'chain 计数/失败明细错')
  assert(d.schema === 'lx-health-digest/1' && d.window_hours === 24, 'schema/window 错')
})

check('A2 by_source 按 sourceId 聚合', () => {
  const d = D.buildDigest([
    ev({ sourceId: 'suyinKuwo', ok: true }), ev({ sourceId: 'suyinKuwo', ok: false }), ev({ sourceId: 'huibq', ok: true }),
  ], meta)
  assert(d.play.by_source.suyinKuwo.total === 2 && d.play.by_source.suyinKuwo.ok === 1, 'suyinKuwo 聚合错')
  assert(d.play.by_source.huibq.total === 1 && d.play.by_source.huibq.ok === 1, 'huibq 聚合错')
})

check('A3 24h 窗口外的旧事件不进摘要；失败明细上限 200 条', () => {
  const old = ev({ ts: NOW - 30 * H, ok: false })
  const d = D.buildDigest([old, ...Array.from({ length: 260 }, (_, i) => ev({ ts: NOW - i * 1000, ok: false, code: 'E' + i }))], meta)
  assert(d.play.total === 260, '窗口过滤错：' + d.play.total)
  assert(d.recent_events.length === 200, '失败明细未截断：' + d.recent_events.length)
})

check('A4 距上次成功满 20h 才自动上报', () => {
  assert(D.shouldUploadDigest(null) === true, '首次应上报')
  assert(D.shouldUploadDigest(NOW - 19 * H, NOW) === false, '19h 内不该上报')
  assert(D.shouldUploadDigest(NOW - 21 * H, NOW) === true, '21h 应上报')
})

check('A5 队列只保留 7 天内、最多 7 条', () => {
  const q = D.pruneDigestQueue([
    { at: NOW - 8 * 24 * H }, { at: NOW - 6 * 24 * H }, ...Array.from({ length: 9 }, (_, i) => ({ at: NOW - i * H })),
  ], NOW)
  assert(q.length === 7, '队列条数错：' + q.length)
  assert(q.every(x => NOW - x.at <= 7 * 24 * H), '队列含超期项')
})

check('A6 issue 标题/正文格式可被 telemetry 解析（fenced JSON 可还原）', () => {
  const d = D.buildDigest([ev()], meta)
  const title = D.digestIssueTitle(d)
  assert(/^\[digest\] [a-f0-9]{8,32} \d{4}-\d{2}-\d{2}$/.test(title), '标题格式错：' + title)
  const body = D.digestIssueBody(d)
  const m = body.match(/```json\n([\s\S]*?)\n```/)
  assert(m && JSON.parse(m[1]).schema === 'lx-health-digest/1', 'body 里的 JSON 无法还原')
})

check('A7 代码里不得出现任何写死的 GitHub token 或 PAT 前缀', () => {
  for (const rel of ['src/core/healthDigestUpload.ts', 'src/core/healthDigest.ts', 'src/core/init/index.ts']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    assert(!/github_pat_|ghp_[A-Za-z0-9]{20,}/.test(src), rel + ' 含硬编码凭据')
  }
})

check('A8 三语摘要相关键齐备（各 11 个）', () => {
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lang', lang + '.json'), 'utf8'))
    const keys = Object.keys(dict).filter(k => k.startsWith('health_digest_'))
    assert(keys.length === 11, lang + ' 摘要键数 ' + keys.length)
  }
})

check('A9 上报单飞：inFlight 复用，双击/启动并发不会发两条 issue', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/healthDigestUpload.ts'), 'utf8')
  assert(/let\s+inFlight\s*:\s*Promise<UploadResult>\s*\|\s*null/.test(src), '缺少 inFlight 单飞锁')
  assert(/if\s*\(inFlight\)\s*return\s+inFlight/.test(src), 'inFlight 存在时未复用')
  assert(/finally\(\(\)\s*=>\s*\{\s*inFlight\s*=\s*null/.test(src), '未在 finally 释放单飞锁')
})

check('A10 by_quality 按档位分桶：同源 128k 通、flac 挂必须能分开', () => {
  const d = D.buildDigest([
    ev({ quality: '128k', ok: true }),
    ev({ quality: '128k', ok: true }),
    ev({ quality: 'flac', ok: false, code: 'QUALITY_MISMATCH' }),
    ev({ quality: undefined, ok: true }),
  ], meta)
  assert(d.play.by_quality['128k'].total === 2 && d.play.by_quality['128k'].ok === 2, '128k 分桶错：' + JSON.stringify(d.play.by_quality))
  assert(d.play.by_quality.flac.total === 1 && d.play.by_quality.flac.ok === 0, 'flac 分桶错：' + JSON.stringify(d.play.by_quality))
  assert(d.play.by_quality.unknown.total === 1, '无 quality 事件未归到 unknown')
  assert(d.play.total === 4, 'by_quality 不得影响总数')
})

check('A11 摘要带音源版本；缺省时不伪造', () => {
  const withV = D.buildDigest([ev()], { ...meta, sourceVersion: '9.1.3' })
  assert(withV.source && withV.source.version === '9.1.3', 'source.version 错：' + JSON.stringify(withV.source))
  const noV = D.buildDigest([ev()], meta)
  assert(noV.source && noV.source.version === undefined, '缺 sourceVersion 时被伪造：' + JSON.stringify(noV.source))
})

check('A12 失败明细带档位；同毫秒同源不同档不合并、同档重复仍去重', () => {
  const t = NOW - H
  const two = D.buildDigest([
    ev({ ts: t, quality: '128k', ok: false, code: 'NOT_FOUND' }),
    ev({ ts: t, quality: 'flac', ok: false, code: 'NOT_FOUND' }),
  ], meta)
  assert(two.recent_events.length === 2, '不同档被误合并：' + two.recent_events.length)
  assert(two.recent_events.every(x => typeof x.q === 'string'), '失败明细缺档位：' + JSON.stringify(two.recent_events))
  const dup = D.buildDigest([
    ev({ ts: t, quality: 'flac', ok: false, code: 'NOT_FOUND' }),
    ev({ ts: t, quality: 'flac', ok: false, code: 'NOT_FOUND' }),
  ], meta)
  assert(dup.recent_events.length === 1, '同档同毫秒未去重：' + dup.recent_events.length)
})

console.log(`\n摘要契约：${passed} 通过 / ${failures.length} 失败`)
if (require.main === module) process.exit(failures.length ? 1 : 0)
module.exports = { failures }
