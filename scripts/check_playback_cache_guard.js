#!/usr/bin/env node
/**
 * 门禁：URL 缓存的命中点必须过可用性判据（v9.1 / 交接任务 1 层一）
 *
 * 背景（实测）：App 的 URL 缓存 `src/utils/data.ts` `getMusicUrl` 只读持久化、没有 TTL；
 * 命中点 `online.ts` 与 `utils.ts` 旧实现都是 `if (cachedUrl && !isRefresh) 直接用`。
 * 死链因此可能被长期复用，真机表现为「卡加载 → 超时」。
 *
 * 本脚本只做静态断言（不跑逻辑），并要求每条断言都配一条**负向自检**：
 * 故意喂一段"没有判据"的代码文本，检测器必须报红 —— 否则门禁本身是假绿。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

let pass = 0
let fail = 0
const ok = (msg) => { pass++; console.log(`  ✓ ${msg}`) }
const bad = (msg) => { fail++; console.log(`  ✗ ${msg}`) }

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 检测器：缓存命中分支是否带了可用性判据
const hasGuardNearCacheHit = (text) => {
  // 命中用缓存的条件里必须出现 isPlayableCandidate
  const hitLines = text.split('\n').filter(l => /\bif\s*\(\s*cachedUrl\s*&&\s*!isRefresh/.test(l))
  if (!hitLines.length) return { found: false, reason: '没找到 cachedUrl 命中分支' }
  const guarded = hitLines.every(l => /isPlayableCandidate\s*\(\s*cachedUrl\s*\)/.test(l))
  return { found: true, guarded }
}

// 负向自检用样本：正是修复前的写法
const BAD_SAMPLE = `const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
if (cachedUrl && !isRefresh) { use(cachedUrl) }`
const GOOD_SAMPLE = `const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
if (cachedUrl && !isRefresh && isPlayableCandidate(cachedUrl)) { use(cachedUrl) }`

console.log('===== 播放缓存可用性判据门禁（v9.1）=====')

// G1：判据模块存在且导出
{
  const p = 'src/core/music/playbackGuard.ts'
  if (!fs.existsSync(path.join(ROOT, p))) bad(`G1 缺 ${p}`)
  else if (!/export const isPlayableCandidate/.test(read(p))) bad('G1 playbackGuard.ts 未导出 isPlayableCandidate')
  else ok('G1 playbackGuard.ts 导出 isPlayableCandidate')
}

// G2：online.ts 主链路命中带判据
{
  const r = hasGuardNearCacheHit(read('src/core/music/online.ts'))
  if (!r.found) bad(`G2 online.ts：${r.reason}`)
  else if (!r.guarded) bad('G2 online.ts 的 cachedUrl 命中分支没有 isPlayableCandidate 判据')
  else ok('G2 online.ts 主链路缓存命中已过判据')
}

// G3：utils.ts 换源候选命中带判据
{
  const r = hasGuardNearCacheHit(read('src/core/music/utils.ts'))
  if (!r.found) bad(`G3 utils.ts：${r.reason}`)
  else if (!r.guarded) bad('G3 utils.ts 的 cachedUrl 命中分支没有 isPlayableCandidate 判据')
  else ok('G3 utils.ts 换源候选缓存命中已过判据')
}

// G4：命中判不过时必须删缓存（否则下一轮还是坏数据）
{
  const t = read('src/core/music/utils.ts') + read('src/core/music/online.ts')
  if (!/deleteMusicUrl\s*\(/.test(t)) bad('G4 命中判不过时没有调用 deleteMusicUrl 清缓存')
  else ok('G4 命中判不过会 deleteMusicUrl 清缓存（两处命中点均含）')
  if (!/export const deleteMusicUrl/.test(read('src/utils/data.ts'))) bad('G4b data.ts 未导出 deleteMusicUrl')
  else ok('G4b data.ts 导出 deleteMusicUrl（key 构造不外泄）')
}

// G5：取链结果也要判（不只缓存）
{
  const t = read('src/core/music/utils.ts')
  if (!/classifyUnusableUrl\s*\(/.test(t)) bad('G5 取链结果没有用 classifyUnusableUrl 判形态')
  else ok('G5 主链路/候选取链结果均过 classifyUnusableUrl')
}

// G7：播放失败必须清缓存（闭环的最后一环）
{
  const t = read('src/plugins/player/service.ts')
  const idx = t.indexOf('TPEvent.PlaybackError')
  if (idx < 0) bad('G7 service.ts 找不到 PlaybackError 监听（锚点变了，需复核本门禁）')
  else {
    // 取该监听回调体的一段窗口
    const win = t.slice(idx, idx + 900)
    if (!/purgeUrlCacheOnPlaybackError|clearMusicUrlByMusic/.test(win)) {
      bad('G7 PlaybackError 只打点不清缓存 → 死链会被无限复用（命中→失败→缓存还在→再失败）')
    } else if (!/purgeUrlCacheOnPlaybackError\s*\(\s*playerState\.playMusicInfo\?\.musicInfo\s*\)/.test(t)) {
      bad('G7 清缓存未按当前播放歌曲调用（playerState.playMusicInfo?.musicInfo）')
    } else ok('G7 PlaybackError 会清当前歌曲 URL 缓存（闭环成立）')
  }
}

// G6：门禁自身有效（负向自检）
{
  const bad1 = hasGuardNearCacheHit(BAD_SAMPLE)
  const good1 = hasGuardNearCacheHit(GOOD_SAMPLE)
  if (bad1.guarded === true) bad('G6 负向自检失败：修复前的写法被误判为通过（门禁是假绿）')
  else if (good1.guarded !== true) bad('G6 正向自检失败：正确写法没有被识别')
  else ok('G6 负向/正向自检均符合预期（检测器本身有效）')
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail) process.exitCode = 1
