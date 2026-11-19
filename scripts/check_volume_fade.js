#!/usr/bin/env node
// P0 门禁：切歌淡入淡出 / 睡眠渐弱
//
// 分两层：
//   1) 数值层：tsc 单独编译 src/core/player/volumeFadeCurve.ts（零依赖纯函数），在 Node 里跑断言。
//      —— 这层能证明"曲线单调、末帧精确、步数正确、非法时长回落"，不依赖真机。
//   2) 静态层：断言接线没有退化成"某个入口没接管"，以及控制器不碰 store。
//
// 为什么不用 jest/vitest：仓库没有测试框架（devDependencies 里没有任何 test runner），
// 引入框架属于新增基础设施，超出 P0 范围；这里沿用仓库既有的"脚本 + 断言计数"门禁风格。

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
const failures = []

let seq = 0
const check = (name, cond) => {
  const id = 'VF' + String(++seq).padStart(2, '0')
  if (cond) { pass++; console.log(`  ✓ ${id} ${name}`) } else { fail++; failures.push(`${id} ${name}`) }
}

// ── 1) 静态层 ────────────────────────────────────────────────────────────────
const fade = read('src/core/player/volumeFade.ts')
const utils = read('src/plugins/player/utils.ts')
const player = read('src/core/player/player.ts')
const timeoutExit = read('src/core/player/timeoutExit.ts')

check('控制器导出 cancelVolumeFade', /export const cancelVolumeFade\b/.test(fade))
check('控制器导出 fadeVolumeTo', /export const fadeVolumeTo\b/.test(fade))
check('控制器导出 withTrackChangeFade', /export const withTrackChangeFade\b/.test(fade))
check('控制器导出 withResumeFade', /export const withResumeFade\b/.test(fade))
check('控制器导出 fadeOutForSleep', /export const fadeOutForSleep\b/.test(fade))
check('控制器用 generation 作废旧链', /generation\+\+/.test(fade) && /gen !== generation/.test(fade))
check('控制器放掉悬挂 Promise', /pendingResolve/.test(fade))
check('控制器不 import store（不越权读设置）', !/@\/store\//.test(fade))
check('控制器不 import utils（避免与 cancel 形成环）', !/from '@\/plugins\/player/.test(fade))
// 断言必须限定在函数体内：整文件搜 finally 会误匹配到 withResumeFade 的同名调用
const trackFadeBody = fade.slice(fade.indexOf('export const withTrackChangeFade'), fade.indexOf('export const withResumeFade'))
const resumeFadeBody = fade.slice(fade.indexOf('export const withResumeFade'), fade.indexOf('export const fadeOutForSleep'))
check('切歌失败也跑淡入（try/finally 在 withTrackChangeFade 内）',
  /try\s*{[\s\S]{0,160}finally\s*{[\s\S]{0,160}fadeVolumeTo\(0, targetVolume, fadeMs\)/.test(trackFadeBody))
check('起播失败也跑淡入（try/finally 在 withResumeFade 内）',
  /try\s*{[\s\S]{0,160}finally\s*{[\s\S]{0,160}fadeVolumeTo\(0, targetVolume, fadeMs\)/.test(resumeFadeBody))
check('用户改音量先掐渐变', /cancelVolumeFade\(\)[\s\S]{0,80}TrackPlayer\.setVolume\(num\)/.test(utils))
check('playNext 走切歌渐变', /withTrackChangeFade\(getFadeMs\(\), getFadeTargetVolume\(\), async\s*\(\s*\)\s*=>\s*(await\s+)?playNextImpl/.test(player))
check('playPrev 走切歌渐变', /withTrackChangeFade\(getFadeMs\(\), getFadeTargetVolume\(\), async\s*\(\s*\)\s*=>\s*(await\s+)?playPrevImpl/.test(player))
check('恢复播放走淡入', /withResumeFade\(getFadeMs\(\), getFadeTargetVolume\(\), setPlay\)/.test(player))
check('开关关闭时 fadeMs 为 0（透传）', /if \(!settingState\.setting\['player\.fadeOnTrackChange'\]\) return 0/.test(player))
check('睡眠渐弱已接线', /fadeOutForSleep\(fadeMs, Number\(settingState\.setting\['player\.volume'\]\)/.test(timeoutExit))
check('睡眠渐弱只在"会直接退出"时触发', /player\.timeoutExitPlayed'\] && playerState\.isPlay\) return/.test(timeoutExit))
check('睡眠渐弱被打断后恢复音量', /cancelVolumeFade\(\)[\s\S]{0,60}setVolume\(Number\(settingState\.setting\['player\.volume'\]\)/.test(timeoutExit))
check('两个开关默认都关', /'player\.fadeOnTrackChange': false/.test(read('src/config/defaultSetting.ts')) && /'player\.fadeOnSleepTimeout': false/.test(read('src/config/defaultSetting.ts')))
check('i18n 三语言键数一致', (() => {
  const locs = ['zh-cn', 'zh-tw', 'en-us'].map(l => Object.keys(JSON.parse(read(`src/lang/${l}.json`))).length)
  return locs[0] === locs[1] && locs[1] === locs[2]
})())

// ── 2) 数值层 ────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'))
const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
try {
  execFileSync(tsc, [
    path.join(ROOT, 'src/core/player/volumeFadeCurve.ts'),
    '--outDir', tmp,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
  ], { stdio: 'pipe' })
} catch (err) {
  console.log('❌ 编译 volumeFadeCurve.ts 失败：' + (err.stdout || err.message))
  process.exit(1)
}
const outFile = path.join(tmp, 'volumeFadeCurve.js')
if (!fs.existsSync(outFile)) {
  console.log('❌ 找不到编译产物 volumeFadeCurve.js')
  process.exit(1)
}
const { buildFadeSteps, computeFadeVolume, normalizeFadeMs, FADE_STEP_MS, FADE_DEFAULT_MS, FADE_CHOICES_MS } = require(outFile)

// 单调递减
const down = buildFadeSteps(1, 0, 300)
check('300ms 帧数 = ceil(300/60) = 5', down.length === Math.ceil(300 / FADE_STEP_MS))
check('淡出序列严格单调递减', down.every((s, i) => i === 0 || s.volume < down[i - 1].volume))
check('淡出末帧精确等于 0', down[down.length - 1].volume === 0)
check('首帧不为 0（不是瞬间静音）', down[0].volume > 0 && down[0].volume < 1)
check('帧时间点严格递增', down.every((s, i) => i === 0 || s.at > down[i - 1].at))
check('末帧时间点 == 总时长', down[down.length - 1].at === 300)

// 单调递增
const up = buildFadeSteps(0, 1, 150)
check('150ms 帧数 = 3', up.length === Math.ceil(150 / FADE_STEP_MS))
check('淡入序列严格单调递增', up.every((s, i) => i === 0 || s.volume > up[i - 1].volume))
check('淡入末帧精确等于目标', up[up.length - 1].volume === 1)

// ms = 0 立即到位
const immediate = buildFadeSteps(1, 0, 0)
check('ms=0 只有 1 帧', immediate.length === 1)
check('ms=0 立刻到目标', immediate[0].volume === 0 && immediate[0].at === 0)

// 用户音量不是 1 的情况
const fromHalf = buildFadeSteps(0.6, 0, 300)
check('从 0.6 淡出末帧为 0', fromHalf[fromHalf.length - 1].volume === 0)
check('从 0.6 淡出首帧 < 0.6', fromHalf[0].volume < 0.6)

// 非法时长回落
check('非法时长回落到 300', normalizeFadeMs(37) === FADE_DEFAULT_MS)
check('null/undefined 回落到 300', normalizeFadeMs(null) === FADE_DEFAULT_MS && normalizeFadeMs(undefined) === FADE_DEFAULT_MS)
check('字符串 "300" 被接受', normalizeFadeMs('300') === 300)
check('三个合法档位都保留', FADE_CHOICES_MS.every(v => normalizeFadeMs(v) === v))

// 插值边界
check('progress < 0 夹到 0', computeFadeVolume(1, 0, -0.2) === 1)
check('progress > 1 夹到 1', computeFadeVolume(1, 0, 1.5) === 0)

// ── 结果 ─────────────────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

if (fail) {
  console.log(`❌ 淡入淡出门禁：${fail} 项失败 / ${pass + fail} 项`)
  for (const f of failures) console.log('   ✗ ' + f)
  process.exit(1)
}
console.log(`✅ 淡入淡出门禁通过：${pass} 条断言 / 0 失败`)
