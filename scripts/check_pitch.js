// 音高（pitch）门禁：静态接线 + 数值边界
//
// 设计要点：
// 1. 跨仓断言（rntp 内核）只在能读到 ../rntp 时执行（本地开发）；CI 只含 App 仓，
//    缺仓时显式标 SKIP 并计数，不伪装成通过。
// 2. 数值层把纯函数 pitch.ts 单独编译到临时目录后 require，断言真实行为，
//    不做「正则看代码像不像」的自欺。
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

let pass = 0
let fail = 0
let skip = 0
const failures = []

// 断言序号 ID（PT01...）：给台账 6c 的多重集校验提供稳定身份
let __assertSeq = 0
function check(name, fn) {
  let ok = false
  let reason = ''
  try {
    ok = fn() !== false
  } catch (e) {
    reason = e.message
  }
  if (ok) {
    pass++
    console.log(`  ✓ PT${String(++__assertSeq).padStart(2, '0')} ${name}`)
  } else {
    fail++
    failures.push(`${name}${reason ? ` :: ${reason}` : ''}`)
    console.log(`  ✗ ${name}${reason ? ` :: ${reason}` : ''}`)
  }
}
function skipCheck(name, why) {
  skip++
  console.log(`  - SKIP ${name}（${why}）`)
}

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const rntp = path.resolve(root, '..', 'rntp')
const hasRntp = fs.existsSync(path.join(rntp, 'android'))
const readRntp = p => fs.readFileSync(path.join(rntp, p), 'utf8')

console.log('== 一、rntp 内核：pitch 与 speed 互不覆盖 ==')
if (hasRntp) {
  const exo = readRntp('android/src/main/java/com/guichaguri/trackplayer/service/player/ExoPlayback.java')
  check('ExoPlayback 提供 setPitch(float)', () => /public\s+void\s+setPitch\s*\(\s*float\s+pitch\s*\)/.test(exo))
  check('ExoPlayback 提供 getPitch()', () => /public\s+float\s+getPitch\s*\(\s*\)/.test(exo))
  check('setPitch 保留当前 speed（new PlaybackParameters(...speed, pitch)）', () => {
    const m = exo.match(/public\s+void\s+setPitch\s*\([^)]*\)\s*\{([\s\S]*?)\n {4}\}/)
    if (!m) return false
    return /getPlaybackParameters\(\)\.speed/.test(m[1]) && /\bpitch\b/.test(m[1])
  })
  check('setRate 保留当前 pitch（不把音高重置为 1）', () => {
    const m = exo.match(/public\s+void\s+setRate\s*\([^)]*\)\s*\{([\s\S]*?)\n {4}\}/)
    if (!m) return false
    return /getPlaybackParameters\(\)\.pitch/.test(m[1])
  })
  const mod = readRntp('android/src/main/java/com/guichaguri/trackplayer/module/MusicModule.java')
  check('MusicModule 暴露 @ReactMethod setPitch', () => /@ReactMethod\s+public\s+void\s+setPitch\s*\(\s*final\s+float/.test(mod))
  check('MusicModule 暴露 @ReactMethod getPitch', () => /@ReactMethod\s+public\s+void\s+getPitch\s*\(\s*final\s+Promise/.test(mod))
  check('setPitch 走 waitForConnection（连接后才写内核）', () => {
    const m = mod.match(/public\s+void\s+setPitch\s*\([\s\S]*?\n {4}\}/)
    return !!m && /waitForConnection/.test(m[0])
  })
  const js = readRntp('src/trackPlayer.ts')
  check('JS 层 setPitch 有 isSetupedPlayer 早退', () => {
    const m = js.match(/async\s+function\s+setPitch[\s\S]*?\n\}/)
    return !!m && /isSetupedPlayer/.test(m[0])
  })
  check('JS 层导出 setPitch 与 getPitch', () => /^\s+setPitch,/m.test(js) && /^\s+getPitch,/m.test(js))
} else {
  skipCheck('rntp 内核 6 条', '未找到 ../rntp')
}

console.log('== 二、App 接线 ==')
const utils = read('src/plugins/player/utils.ts')
check('utils 导出 setPlaybackPitch', () => /export\s+const\s+setPlaybackPitch\s*=/.test(utils))
check('setPlaybackPitch 先判 isReady', () => {
  const m = utils.match(/export\s+const\s+setPlaybackPitch\s*=[\s\S]*?\n\}/)
  return !!m && /isReady\(\)/.test(m[0])
})
check('setPlaybackPitch 写原生前过 normalizePitch（不透传 NaN）', () => {
  const m = utils.match(/export\s+const\s+setPlaybackPitch\s*=[\s\S]*?\n\}/)
  return !!m && /normalizePitch\(/.test(m[0])
})
check('setPlaybackPitch 有「旧包无此法」存在性守卫', () => {
  const m = utils.match(/export\s+const\s+setPlaybackPitch\s*=[\s\S]*?\n\}/)
  return !!m && /typeof\s+[.\w]*setPitch\s*!=\s*'function'/.test(m[0])
})

const pluginIndex = read('src/plugins/player/index.ts')
check('initial 接收 playPitch 参数', () => /playPitch:\s*number/.test(pluginIndex))
check('initial 初始化时应用音高', () => /await\s+setPlaybackPitch\(playPitch\)/.test(pluginIndex))
check('plugins/player 默认导出含 setPlaybackPitch', () => /^\s+setPlaybackPitch,/m.test(pluginIndex))

const player = read('src/core/player/player.ts')
check('handlePlay 把持久化音高传给 playerInitial', () => /playPitch:\s*settingState\.setting\['player\.playbackPitch'\]/.test(player))

console.log('== 三、设置项三处闭合 ==')
const defs = read('src/config/defaultSetting.ts')
check("defaultSetting 有 'player.playbackPitch': 1", () => /'player\.playbackPitch':\s*1,/.test(defs))
const types = read('src/types/app_setting.d.ts')
check("类型声明 'player.playbackPitch': number", () => /'player\.playbackPitch':\s*number/.test(types))
const ui = read('src/screens/PlayDetail/components/SettingPopup/settings/SettingPlaybackPitch.tsx')
check('音高面板走 normalizePitch 初始化（脏值不炸滑块）', () => /normalizePitch\(useSettingValue\('player\.playbackPitch'\)\)/.test(ui))
check('音高面板拖动时实时应用 setPlaybackPitch', () => /void\s+setPlaybackPitch\(/.test(ui))
const popup = read('src/screens/PlayDetail/components/SettingPopup/index.tsx')
check('设置弹窗已注册音高面板', () => /<SettingPlaybackPitch\s*\/>/.test(popup))

console.log('== 四、三语言键闭合 ==')
const langs = ['zh-cn', 'zh-tw', 'en-us']
const keyCounts = []
for (const lang of langs) {
  const data = JSON.parse(read(`src/lang/${lang}.json`))
  keyCounts.push(Object.keys(data).length)
  check(`${lang} 含 play_detail_setting_playback_pitch`, () => typeof data.play_detail_setting_playback_pitch == 'string' && data.play_detail_setting_playback_pitch.length > 0)
}
check('三语言键数一致', () => keyCounts.every(n => n == keyCounts[0]))

console.log('== 五、数值边界（编译 pitch.ts 后实跑）==')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pitch-gate-'))
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(root, 'src/core/player/pitch.ts'),
  '--target', 'es2019', '--module', 'commonjs',
  '--outDir', tmp, '--skipLibCheck',
], { stdio: 'pipe' })
const { normalizePitch, isDefaultPitch, PITCH_MIN, PITCH_MAX, PITCH_DEFAULT } = require(path.join(tmp, 'pitch.js'))

check('PITCH_MIN = 0.5 / PITCH_MAX = 2 / 默认 1', () => PITCH_MIN == 0.5 && PITCH_MAX == 2 && PITCH_DEFAULT == 1)
check('原值透传 1.5 → 1.5', () => normalizePitch(1.5) == 1.5)
check('下越界 0.1 → 夹到 0.5', () => normalizePitch(0.1) == 0.5)
check('上越界 3 → 夹到 2', () => normalizePitch(3) == 2)
check('0 → 夹到 0.5（不是「未设置」语义）', () => normalizePitch(0) == 0.5)
check('NaN → 回落 1', () => normalizePitch(NaN) == 1)
check('undefined → 回落 1', () => normalizePitch(undefined) == 1)
check('null → 回落 1', () => normalizePitch(null) == 1)
check('字符串 "1.3" → 1.3', () => normalizePitch('1.3') == 1.3)
check('脏字符串 "abc" → 1', () => normalizePitch('abc') == 1)
check('负数 -2 → 夹到 0.5（内核不接受 ≤0）', () => normalizePitch(-2) == 0.5)
check('isDefaultPitch(1)=true / (1.2)=false', () => isDefaultPitch(1) === true && isDefaultPitch(1.2) === false)
check('夹取结果始终落在 [PITCH_MIN, PITCH_MAX]', () => {
  const samples = [-5, 0, 0.4999, 0.5, 1, 1.9999, 2, 2.0001, 99, NaN, 'x', '']
  return samples.every(v => {
    const r = normalizePitch(v)
    return r >= PITCH_MIN && r <= PITCH_MAX
  })
})

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n===== 音高门禁：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过` : ''} =====`)
if (fail) {
  console.log(failures.map(f => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
