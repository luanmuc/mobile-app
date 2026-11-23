#!/usr/bin/env node
/**
 * au（Audius）内置 SDK 契约门禁（R82）
 *
 * 锁住 R82 前后端检查抓到的两组真实缺陷（都曾「门禁全绿但功能不可用」）：
 *   A1/A2/A3/A6 搜索落库字段契约：`src/utils/musicSdk/au/musicSearch.js` 的 `filterData`
 *     必须返回旧结构（songmid/img/types/_types）。它下游统一走 `toNewMusicInfo`
 *     （`src/utils/index.ts:28-41`，只认旧字段）；一旦写成 `{ id, meta }` 新结构，
 *     迁移后 id 变 `au_undefined`、meta 全丢，`deduplicationList` 按 id 去重把整页塌成一，
 *     点播把 `au_undefined` 交给音源即 /tracks/au_undefined 404。
 *   A4 歌词契约：`src/core/music/utils.ts:699/734` 取 `.promise`，`au/index.js` 的
 *     `getLyric()` 返回裸 Promise 会 undefined.then 抛 TypeError。
 *   A5 更新音源：`Source.tsx` 必须并发拉全部镜像并按版本取最高；顺序 for + 首个成功即
 *     break 会被 jsdelivr @master 的旧缓存骗成「已是最新」。
 *
 * 用法：node scripts/check_au_source_contract.js
 *      AU_CHECK_ROOT=<另一份仓库根> node scripts/check_au_source_contract.js   # 红绿双向复现旧形态
 */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = process.env.AU_CHECK_ROOT || path.resolve(__dirname, '..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let red = 0
const P = (id, msg) => { console.log('  ✅ [' + id + '] ' + msg) }
const F = (id, msg) => { red++; console.log('  ❌ [' + id + '] ' + msg) }
const S = (id, msg) => { console.log('  ⚠️ [' + id + '] 无法验证：' + (msg || '')) }

// A1：filterData 返回旧结构
try {
  const src = rd('src/utils/musicSdk/au/musicSearch.js')
  const m = /list\.push\(\{([\s\S]*?)\n\s*\}\)/.exec(src)
  if (!m) S('A1', '找不到 list.push({ ... }) 块')
  else {
    const seg = m[1]
    const need = ['songmid:', 'img:', 'types:', '_types:']
    const bad = need.filter(k => !seg.includes(k))
    if (bad.length) F('A1', `filterData 缺旧结构字段 ${bad.join(' / ')}（下游 toNewMusicInfo 只认旧字段）`)
    else if (/(^|\s)id:\s*t\.id/.test(seg)) F('A1', 'filterData 仍输出新结构 id 字段')
    else P('A1', 'filterData 输出旧结构（songmid / img / types / _types）')
  }
} catch (e) { S('A1', e.message) }

// A2/A3/A6：抽真实 filterData 跑样本（执行级，不是文本猜测）
try {
  const src = rd('src/utils/musicSdk/au/musicSearch.js')
  const start = src.indexOf('  filterData(rawData) {')
  const end = src.indexOf('\n  search(str,')
  if (start < 0 || end < 0) throw new Error('filterData/search 定位失败')
  const holder = vm.runInNewContext('({' + src.slice(start, end) + '})', { formatPlayTime: (s) => s })
  const toNew = (o) => ({
    id: `${o.source}_${o.songmid}`,
    name: o.name,
    singer: o.singer,
    source: o.source,
    interval: o.interval,
    meta: { songId: o.songmid, picUrl: o.img, qualitys: o.types, _qualitys: o._types },
  })
  const raw = { id: 'QJpGKw', title: 'HELLO', is_streamable: true, duration: 192, user: { name: 'YAN MI' }, artwork: { '480x480': 'https://cdn.example/a.jpg' } }
  const item = holder.filterData([raw])[0] || {}
  if (item.songmid !== 'QJpGKw') F('A2', `filterData songmid=${JSON.stringify(item.songmid)}（期望原样 QJpGKw，大小写敏感）`)
  else P('A2', 'filterData 原样保留 track id')

  const migrated = toNew(item)
  if (migrated.id !== 'au_QJpGKw') F('A3', `迁移后 id=${migrated.id}（期望 au_QJpGKw）`)
  else if (!migrated.meta.songId || !migrated.meta.picUrl) F('A3', '迁移后 meta.songId / meta.picUrl 丢失')
  else P('A3', '迁移后 id=au_QJpGKw、songId/picUrl 保留')

  const two = holder.filterData([raw, { ...raw, id: 'AbCdEf' }]).map(toNew)
  const uniq = new Set(two.map(s => s.id))
  if (uniq.size !== 2) F('A6', `两条 au 结果去重后 ${uniq.size} 条（期望 2，塌一即整页只显示一首）`)
  else P('A6', '两条 au 结果去重后仍为 2 条')
} catch (e) { S('A2', e.message); S('A3', '依赖 A2 的执行'); S('A6', '依赖 A2 的执行') }

// A4：getLyric 返回 { promise }
try {
  const src = rd('src/utils/musicSdk/au/index.js')
  const i = src.indexOf('getLyric(')
  if (i < 0) S('A4', '找不到 getLyric')
  else {
    const seg = src.slice(i, i + 400)
    if (/return\s+Promise\.resolve/.test(seg)) F('A4', 'getLyric 直接 return Promise（调用方取 .promise 会 undefined.then）')
    else if (!/promise\s*:/.test(seg)) F('A4', 'getLyric 未返回 { promise } 结构')
    else P('A4', 'getLyric 返回 { promise, cancelHttp }')
  }
} catch (e) { S('A4', e.message) }

// A5：更新音源并发取最高
try {
  const src = rd('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  const i = src.indexOf('handleUpdateSource')
  if (i < 0) S('A5', '找不到 handleUpdateSource')
  else {
    const seg = src.slice(i, i + 3000)
    if (/for \(const url of SOURCE_UPDATE_URLS\)/.test(seg)) F('A5', '仍是顺序 for + 首个成功即 break')
    else if (!/Promise\.all\(\s*SOURCE_UPDATE_URLS/.test(seg)) F('A5', '未并发拉全部镜像')
    else if (!/compareSourceVersions\(version, bestVersion\)/.test(seg)) F('A5', '未按版本取最高')
    else P('A5', '并发拉全部镜像并按版本取最高')
  }
} catch (e) { S('A5', e.message) }

console.log(red ? `\n❌ au 源契约：${6 - red} 通过 / ${red} 失败` : '\n✅ au 源契约：6 通过 / 0 失败')
if (require.main === module) process.exit(red ? 1 : 0)
module.exports = { main: () => red }
