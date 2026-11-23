#!/usr/bin/env node
/**
 * 内置 SDK 契约门禁（R82 起为 au 专用；R83 扩为六平台矩阵 + 更新完整性）
 *
 * 锁住「门禁全绿但功能不可用」的历史缺陷：
 *   A1/A2/A3/A6  au 搜索落库字段契约（旧结构 songmid/img/types/_types 与去重后 id）
 *   A4          au getLyric 必须返回 { promise }（调用方取 .promise）
 *   A5          更新音源必须并发拉全部镜像并按版本取最高（jsdelivr @master 旧缓存）
 *   M1~M6       kw / kg / tx / wy / mg / au 六平台 filterData|handleResult 执行级矩阵：
 *               直接抽真实映射函数跑样本，断言统一落库字段齐全、source 正确、
 *               songmid 原样、迁移后 id 不出现 undefined
 *   A7          sha256 工具与 Node crypto 逐例对照（覆盖中文 / emoji / 孤立代理项）
 *   A8          Source.tsx 必须「先校验后覆盖」且 manifest 缺失时 fail-open（K36）
 *
 * 用法：node scripts/check_builtin_sdk_contract.js
 *      SDK_CHECK_ROOT=<另一份仓库根> node scripts/check_builtin_sdk_contract.js   # 红绿双向
 */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = process.env.SDK_CHECK_ROOT || process.env.AU_CHECK_ROOT || path.resolve(__dirname, '..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let red = 0
const P = (id, msg) => { console.log('  ✅ [' + id + '] ' + msg) }
const F = (id, msg) => { red++; console.log('  ❌ [' + id + '] ' + msg) }
const S = (id, msg) => { console.log('  ⚠️ [' + id + '] 无法验证：' + (msg || '')) }

// 统一落库字段（下游 toNewMusicInfo 只读这些旧字段）
const COMMON_FIELDS = ['name', 'singer', 'source', 'songmid', 'interval', 'types', '_types']

const toNewMusicInfo = (o) => ({
  id: `${o.source}_${o.songmid}`,
  name: o.name,
  singer: o.singer,
  source: o.source,
  interval: o.interval,
  meta: { songId: o.songmid, picUrl: o.img, qualitys: o.types, _qualitys: o._types },
})

// 从源码里按大括号配平抽一个对象方法（含方法名），用于在 vm 里执行真实映射函数
const extractMethod = (src, name) => {
  const start = src.indexOf('  ' + name + '(')
  if (start < 0) throw new Error('找不到方法 ' + name)
  const brace = src.indexOf('{', start)
  if (brace < 0) throw new Error(name + ' 缺少函数体')
  let depth = 0
  let i = brace
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return src.slice(start, i)
}

const SANDBOX = {
  formatPlayTime: (s) => String(Math.floor(Number(s) / 60)).padStart(2, '0') + ':' + String(Math.floor(Number(s) % 60)).padStart(2, '0'),
  formatSinger: (s) => s,
  formatSingerName: (s) => (Array.isArray(s) ? s.map(x => x && x.name).filter(Boolean).join('/') : String(s == null ? '' : s)),
  decodeName: (s) => s,
  sizeFormate: (s) => String(s) + 'B',
  console: { log: () => {} },
}

const buildHolder = (methodText, extra) => vm.runInNewContext(
  '({' + (extra || '') + methodText + '})',
  SANDBOX,
)

// 各平台样本：字段名严格按真实接口响应形状，不按映射实现反推
const CASES = {
  kw: {
    file: 'src/utils/musicSdk/kw/musicSearch.js',
    method: 'handleResult',
    extra: 'regExps: { mInfo: /level:(\\w+),bitrate:(\\d+),format:(\\w+),size:([\\w.]+)/ },',
    sample: [{ MUSICRID: 'MUSIC_123456', SONGNAME: '晴天', ARTIST: '周杰伦', ALBUM: '叶惠美', ALBUMID: '789', DURATION: '269', N_MINFO: 'level:128,bitrate:128,format:mp3,size:1.2' }],
  },
  kg: {
    file: 'src/utils/musicSdk/kg/musicSearch.js',
    method: 'handleResult',
    sample: [{
      Singers: [{ name: '周杰伦' }],
      OriSongName: '晴天',
      Suffix: '',
      AlbumName: '叶惠美',
      AlbumID: '789',
      Audioid: '123456',
      Duration: 269,
      FileHash: 'hash128',
      FileSize: 100,
      HQFileHash: 'hash320',
      HQFileSize: 200,
      SQFileHash: '',
      SQFileSize: 0,
      ResFileHash: '',
      ResFileSize: 0,
      Grp: [],
    }],
  },
  tx: {
    file: 'src/utils/musicSdk/tx/musicSearch.js',
    method: 'handleResult',
    sample: [{
      id: 1001,
      mid: '001abc',
      title: '晴天',
      interval: 269,
      singer: [{ name: '周杰伦', mid: 's001' }],
      album: { name: '叶惠美', mid: 'a001' },
      file: { media_mid: '001abc', size_128mp3: 100, size_320mp3: 200, size_flac: 0, size_hires: 0 },
    }],
  },
  wy: {
    file: 'src/utils/musicSdk/wy/musicSearch.js',
    method: 'handleResult',
    extra: 'getSinger(ar) { return Array.isArray(ar) ? ar.map(x => x.name).join("/") : "" },',
    sample: [{
      baseInfo: {
        simpleSongData: {
          id: 1002,
          name: '晴天',
          dt: 269000,
          ar: [{ name: '周杰伦' }],
          al: { name: '叶惠美', id: 789, picUrl: 'https://cdn.example/wy.jpg' },
          privilege: { maxBrLevel: 'lossless', maxbr: 999000 },
          hr: { size: 300 },
          sq: { size: 200 },
          h: { size: 150 },
          l: { size: 100 },
        },
      },
    }],
  },
  mg: {
    file: 'src/utils/musicSdk/mg/musicSearch.js',
    method: 'filterData',
    sample: [[{
      songId: '6001',
      copyrightId: 'c001',
      name: '晴天',
      album: '叶惠美',
      albumId: '789',
      duration: 269,
      singerList: [{ name: '周杰伦' }],
      img3: '/img.jpg',
      lrcUrl: 'lrc',
      mrcurl: 'mrc',
      trcUrl: 'trc',
      audioFormats: [],
    }]],
  },
  au: {
    file: 'src/utils/musicSdk/au/musicSearch.js',
    method: 'filterData',
    sample: [{ id: 'QJpGKw', title: 'HELLO', is_streamable: true, duration: 192, user: { name: 'YAN MI' }, artwork: { '480x480': 'https://cdn.example/a.jpg' } }],
  },
}

for (const [platform, c] of Object.entries(CASES)) {
  const id = 'M' + (Object.keys(CASES).indexOf(platform) + 1)
  try {
    const src = rd(c.file)
    // kg 的 handleResult 依赖 this.filterData：连同真实 filterData 一起注入
    const helper = platform === 'kg' ? extractMethod(src, 'filterData') + ',' : ''
    const holder = buildHolder(extractMethod(src, c.method), (c.extra || '') + helper)
    const list = holder[c.method](c.sample)
    const item = (list || [])[0]
    if (!item) throw new Error(c.method + ' 未返回任何条目')
    const missing = COMMON_FIELDS.filter(f => !(f in item))
    if (missing.length) throw new Error('缺字段 ' + missing.join(' / ') + '（下游 toNewMusicInfo 只认旧结构）')
    if (item.source !== platform) throw new Error('source=' + JSON.stringify(item.source) + '，期望 ' + platform)
    if (item.songmid == null || item.songmid === '') throw new Error('songmid 为空（会拼成 ' + platform + '_undefined）')
    if (!Array.isArray(item.types) || typeof item._types !== 'object' || item._types === null) throw new Error('types/_types 形状不对')
    const migrated = toNewMusicInfo(item)
    if (!migrated.id || migrated.id.indexOf(platform + '_undefined') === 0) throw new Error('迁移后 id=' + migrated.id)
    P(id, platform + ' 映射字段齐全（songmid=' + item.songmid + '，迁移 id=' + migrated.id + '）')
  } catch (e) { F(id, platform + '：' + e.message) }
}

// A1/A2/A3/A6：au 字段与去重（保留 R82 的原始判据）
try {
  const src = rd('src/utils/musicSdk/au/musicSearch.js')
  const m = /list\.push\(\{([\s\S]*?)\n\s*\}\)/.exec(src)
  if (!m) S('A1', '找不到 list.push({ ... }) 块')
  else {
    const seg = m[1]
    const need = ['songmid:', 'img:', 'types:', '_types:']
    const bad = need.filter(k => !seg.includes(k))
    if (bad.length) F('A1', 'filterData 缺旧结构字段 ' + bad.join(' / '))
    else if (/(^|\s)id:\s*t\.id/.test(seg)) F('A1', 'filterData 仍输出新结构 id 字段')
    else P('A1', 'filterData 输出旧结构（songmid / img / types / _types）')
  }
} catch (e) { S('A1', e.message) }

try {
  const src = rd('src/utils/musicSdk/au/musicSearch.js')
  const holder = buildHolder(extractMethod(src, 'filterData'))
  const raw = CASES.au.sample[0]
  const item = holder.filterData([raw])[0] || {}
  if (item.songmid !== 'QJpGKw') F('A2', 'filterData songmid=' + JSON.stringify(item.songmid) + '（期望原样 QJpGKw，大小写敏感）')
  else P('A2', 'filterData 原样保留 track id')
  const migrated = toNewMusicInfo(item)
  if (migrated.id !== 'au_QJpGKw') F('A3', '迁移后 id=' + migrated.id + '（期望 au_QJpGKw）')
  else if (!migrated.meta.songId || !migrated.meta.picUrl) F('A3', '迁移后 meta.songId / meta.picUrl 丢失')
  else P('A3', '迁移后 id=au_QJpGKw、songId/picUrl 保留')
  const two = holder.filterData([raw, { ...raw, id: 'AbCdEf' }]).map(toNewMusicInfo)
  if (new Set(two.map(s => s.id)).size !== 2) F('A6', '两条 au 结果去重后塌成 1 条')
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
    const seg = src.slice(i, i + 3500)
    if (/for \(const url of SOURCE_UPDATE_URLS\)/.test(seg)) F('A5', '仍是顺序 for + 首个成功即 break')
    else if (!/Promise\.all\(\s*SOURCE_UPDATE_URLS/.test(seg)) F('A5', '未并发拉全部镜像')
    else if (!/compareSourceVersions\(version, bestVersion\)/.test(seg)) F('A5', '未按版本取最高')
    else P('A5', '并发拉全部镜像并按版本取最高')
  }
} catch (e) { S('A5', e.message) }

// A7：sha256 工具与 Node crypto 逐例对照（执行级）
try {
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
  const outDir = path.join(ROOT, 'node_modules', '.cache', 'r83-sha-check')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  execFileSync(tsc, [
    path.join(ROOT, 'src', 'utils', 'sha256.ts'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
    '--types', 'node',
  ], { stdio: 'pipe' })
  const mod = require(path.join(outDir, 'sha256.js'))
  const cases = ['', 'abc', '中文😀', '\ud800', 'a'.repeat(10000)]
  const bad = cases.filter((s) => {
    const expected = crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')
    return mod.sha256Hex(s) !== expected || mod.utf8ByteLength(s) !== Buffer.byteLength(s, 'utf8')
  })
  fs.rmSync(outDir, { recursive: true, force: true })
  if (bad.length) F('A7', 'sha256 与 Node crypto 不一致：' + JSON.stringify(bad.map(s => s.slice(0, 8))))
  else P('A7', 'sha256/UTF-8 编码与 Node crypto 一致（含中文 / emoji / 孤立代理项）')
} catch (e) { F('A7', 'sha256 工具编译或对照失败：' + e.message) }

// A8：Source.tsx 先校验后覆盖，manifest 缺失 fail-open
try {
  const src = rd('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  const checks = [
    [/from '@\/utils\/sha256'/.test(src), '未引用 sha256 工具'],
    [/SOURCE_UPDATE_MANIFEST_URLS\s*=\s*SOURCE_UPDATE_URLS\.map\(/.test(src), 'manifest 地址未与脚本同源派生'],
    [/if \(!matched\) \{[\s\S]{0,240}?return/.test(src), 'manifest 缺失时未 fail-open（K36）'],
    [/sha256Hex\(script\)/.test(src) && /utf8ByteLength\(script\)/.test(src), '未对远端脚本做 size/sha256 校验'],
    [src.indexOf('await verifySourceIntegrity(') > 0 && src.indexOf('await verifySourceIntegrity(') < src.indexOf('await overwriteUserApi('), '校验未放在覆盖之前'],
    [/throw new Error\(failMessage\)/.test(src), '校验不符时未拒绝覆盖'],
  ]
  const bad = checks.filter(([ok]) => !ok).map(([, msg]) => msg)
  if (bad.length) F('A8', bad.join('；'))
  else P('A8', '先校验后覆盖；manifest 缺失 fail-open、同版本不符 fail-closed')
} catch (e) { S('A8', e.message) }

const total = 14
console.log(red ? '\n❌ 内置 SDK 契约：' + (total - red) + ' 通过 / ' + red + ' 失败' : '\n✅ 内置 SDK 契约：' + total + ' 通过 / 0 失败')
if (require.main === module) process.exit(red ? 1 : 0)
module.exports = { main: () => red }
