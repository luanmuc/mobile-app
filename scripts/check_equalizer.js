// 均衡器门禁：原生模块契约 + JS 接线 + 档位纯函数数值
//
// 与 check_pitch.js 同一套约定：
// - 跨仓断言（rntp）只在能读到 ../rntp 时执行，缺仓显式 SKIP 并计数；
// - 数值层把 equalizerBands.ts 单独编译后 require，断言真实行为。
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

let pass = 0
let fail = 0
let skip = 0
const failures = []

// 断言序号 ID（EQ01...）：给台账 6c 的多重集校验提供稳定身份
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
    console.log(`  ✓ EQ${String(++__assertSeq).padStart(2, '0')} ${name}`)
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

console.log('== 一、rntp 内核：audioSessionId ==')
if (hasRntp) {
  const exo = readRntp('android/src/main/java/com/guichaguri/trackplayer/service/player/ExoPlayback.java')
  check('ExoPlayback 有 getAudioSessionId()', () => /public\s+int\s+getAudioSessionId\s*\(\s*\)/.test(exo))
  check('getAudioSessionId 用 instanceof ExoPlayer 判断（Player 接口没有此方法）', () => {
    const m = exo.match(/public\s+int\s+getAudioSessionId\s*\(\s*\)\s*\{([\s\S]*?)\n {4}\}/)
    return !!m && /instanceof\s+ExoPlayer/.test(m[1])
  })
  check('未建立会话时返回 C.AUDIO_SESSION_ID_UNSET', () => {
    const m = exo.match(/public\s+int\s+getAudioSessionId\s*\(\s*\)\s*\{([\s\S]*?)\n {4}\}/)
    return !!m && /C\.AUDIO_SESSION_ID_UNSET/.test(m[1])
  })
  const mod = readRntp('android/src/main/java/com/guichaguri/trackplayer/module/MusicModule.java')
  check('MusicModule 暴露 @ReactMethod getAudioSessionId', () => /@ReactMethod\s+public\s+void\s+getAudioSessionId/.test(mod))
  check('getAudioSessionId 走 waitForConnection', () => {
    const m = mod.match(/public\s+void\s+getAudioSessionId[\s\S]*?\n {4}\}/)
    return !!m && /waitForConnection/.test(m[0])
  })
  const js = readRntp('src/trackPlayer.ts')
  check('JS 层 getAudioSessionId 未就绪时返回 0', () => {
    const m = js.match(/async\s+function\s+getAudioSessionId[\s\S]*?\n\}/)
    return !!m && /isSetupedPlayer/.test(m[0]) && /resolve\(0\)/.test(m[0])
  })
  check('JS 层导出 getAudioSessionId', () => /^\s+getAudioSessionId,/m.test(js))
} else {
  skipCheck('rntp 内核 5 条', '未找到 ../rntp')
}

console.log('== 二、原生模块契约（Java）==')
const modPath = 'android/app/src/main/java/cn/toside/music/mobile/equalizer/EqualizerModule.java'
const javaMod = read(modPath)
check('模块名 EqualizerModule', () => /return\s+"EqualizerModule"/.test(javaMod))
check('sessionId 为 0 时拒绝绑定（未起播无会话）', () => /sessionId\s*==\s*0/.test(javaMod))
check('同一会话复用，不重建 effect', () => /boundSessionId\s*==\s*sessionId/.test(javaMod))
check('重建前先 release 旧实例（且早于 new Equalizer）', () => {
  const start = javaMod.indexOf('public synchronized void bind')
  const body = javaMod.slice(start, javaMod.indexOf('\n  }', start))
  const releaseIdx = body.indexOf('releaseInternal();')
  const newIdx = body.indexOf('new Equalizer(0, sessionId)')
  return releaseIdx >= 0 && newIdx > 0 && releaseIdx < newIdx
})
check('构造 Equalizer 用 try/catch，失败 resolve(false) 不崩', () => {
  const m = javaMod.match(/\} catch \(Throwable[\s\S]*?\n {2}\}/)
  return !!m
})
check('applyBands 支持空串（全归零）', () => /levelsCsv\s*==\s*null\s*\?\s*""/.test(javaMod))
check('applyBands 非法项回落 0 而非抛异常', () => {
  const m = javaMod.match(/catch\s*\(NumberFormatException\s+ignored\)\s*\{([\s\S]{0,120})/)
  return !!m && /level\s*=\s*0/.test(m[1]) && !/throw/.test(m[1])
})
check('release 后清空 boundSessionId', () => {
  const m = javaMod.match(/private\s+synchronized\s+void\s+releaseInternal[\s\S]*?\n {2}\}/)
  return !!m && /boundSessionId\s*=\s*0/.test(m[0])
})
check('isSupported 语义：全部方法在 equalizer==null 时早退', () => {
  const count = (javaMod.match(/if \(equalizer == null\)/g) || []).length
  return count >= 3
})
check('EqualizerPackage 注册模块', () => {
  const pkg = read('android/app/src/main/java/cn/toside/music/mobile/equalizer/EqualizerPackage.java')
  return /new EqualizerModule\(reactContext\)/.test(pkg)
})
check('MainApplication 手动注册 EqualizerPackage', () => {
  const app = read('android/app/src/main/java/cn/toside/music/mobile/MainApplication.java')
  return /packages\.add\(new EqualizerPackage\(\)\)/.test(app) && /import cn\.toside\.music\.mobile\.equalizer\.EqualizerPackage/.test(app)
})

console.log('== 三、JS 接线 ==')
const pluginBridge = read('src/plugins/equalizer.ts')
for (const fn of ['bind', 'getInfo', 'applyBands', 'setEnabled', 'release']) {
  check(`plugins/equalizer 导出 ${fn}`, () => new RegExp(`export\\s+const\\s+${fn}\\s*=`).test(pluginBridge))
}
check('桥接层 5 个调用各自 try/catch（原生异常不外溢）', () => {
  const tryCount = (pluginBridge.match(/try\s*\{/g) || []).length
  return tryCount >= 5
})
check('iOS/桌面端不取模块（Platform.OS == android 才取）', () => /Platform\.OS\s*==\s*'android'/.test(pluginBridge))

const utils = read('src/plugins/player/utils.ts')
check('utils 导出 getAudioSessionId', () => /export\s+const\s+getAudioSessionId\s*=/.test(utils))
check('getAudioSessionId 有旧 sha 存在性守卫', () => {
  const m = utils.match(/export\s+const\s+getAudioSessionId[\s\S]*?\n\}/)
  return !!m && /typeof\s+[.\w]*getAudioSessionId\s*!=\s*'function'/.test(m[0])
})

const ctrl = read('src/core/player/equalizer.ts')
check('控制器开关关闭时不做绑定', () => {
  // 注意：applyEqualizer 是串行化外壳，实际逻辑在 applyEqualizerInternal —— 断言必须盯实现体
  const m = ctrl.match(/const\s+applyEqualizerInternal\s*=[\s\S]*?\n\}/)
  return !!m && /player\.equalizer\.enable/.test(m[0])
})
check('串行化闸存在（applyEqualizer 不再直接跑实现）', () => {
  const m = ctrl.match(/export\s+const\s+applyEqualizer\s*=[\s\S]*?\n\}/)
  return !!m && /gate\.applying/.test(m[0]) && /applyEqualizerInternal\(/.test(m[0])
})
check('sessionId <= 0 时早退（未起播不建 effect）', () => /sessionId\s*<=\s*0/.test(ctrl))
check('sessionId 变化才重新 bind', () => /sessionId\s*!=\s*boundSessionId/.test(ctrl))
check('应用前先 normalizeBandsCsv（不透传脏值）', () => /applyBands\(normalizeBandsCsv\(/.test(ctrl))

const player = read('src/core/player/player.ts')
check('handlePlay 初始化后应用均衡器', () => /void\s+applyEqualizer\(\)/.test(player))
const initEq = read('src/core/init/player/equalizer.ts')
check('订阅 configUpdated 的 equalizer 两键', () => /keys\.includes\('player\.equalizer\.enable'\)/.test(initEq) && /keys\.includes\('player\.equalizer\.bands'\)/.test(initEq))
const initIndex = read('src/core/init/player/index.ts')
check('initEqualizer 已注册', () => /initEqualizer\(\)/.test(initIndex))

console.log('== 四、设置项与 UI 闭合 ==')
const defs = read('src/config/defaultSetting.ts')
check('defaultSetting 有 enable/bands 两键', () => /'player\.equalizer\.enable':\s*false/.test(defs) && /'player\.equalizer\.bands':\s*'0,0,0,0,0'/.test(defs))
const types = read('src/types/app_setting.d.ts')
check('类型声明两键', () => /'player\.equalizer\.enable':\s*boolean/.test(types) && /'player\.equalizer\.bands':\s*string/.test(types))
const ui = read('src/screens/PlayDetail/components/SettingPopup/settings/SettingEqualizer.tsx')
check('面板用 parseBands 解析（脏值不炸滑块）', () => /parseBands\(/.test(ui))
check('面板拖动时实时试听', () => /previewEqualizerBands\(/.test(ui))
check('面板支持「设备不支持」提示', () => /isEqualizerSupported\(\)/.test(ui))
const popup = read('src/screens/PlayDetail/components/SettingPopup/index.tsx')
check('设置弹窗已注册均衡器面板', () => /<SettingEqualizer\s*\/>/.test(popup))

console.log('== 五、三语言键闭合 ==')
const langs = ['zh-cn', 'zh-tw', 'en-us']
const keyCounts = []
const eqKeys = ['play_detail_setting_equalizer', 'play_detail_setting_equalizer_enable', 'play_detail_setting_equalizer_unsupported']
for (const lang of langs) {
  const data = JSON.parse(read(`src/lang/${lang}.json`))
  keyCounts.push(Object.keys(data).length)
  check(`${lang} 含 3 个均衡器键`, () => eqKeys.every(k => typeof data[k] == 'string' && data[k].length > 0))
}
check('三语言键数一致', () => keyCounts.every(n => n == keyCounts[0]))

console.log('== 六、档位纯函数（编译 equalizerBands.ts 后实跑）==')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-gate-'))
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(root, 'src/core/player/equalizerBands.ts'),
  '--target', 'es2019', '--module', 'commonjs',
  '--outDir', tmp, '--skipLibCheck',
], { stdio: 'pipe' })
const { EQ_BAND_COUNT, EQ_LEVEL_MIN, EQ_LEVEL_MAX, EQ_BANDS_DEFAULT, parseBands, normalizeBandsCsv, serializeBands, isFlatBands } = require(path.join(tmp, 'equalizerBands.js'))

check('常量：5 段 / ±1500 mB / 默认全零', () => EQ_BAND_COUNT == 5 && EQ_LEVEL_MIN == -1500 && EQ_LEVEL_MAX == 1500 && EQ_BANDS_DEFAULT == '0,0,0,0,0')
check('parseBands 不足 5 项补 0', () => JSON.stringify(parseBands('300')) == '[300,0,0,0,0]')
check('parseBands 超过 5 项截断', () => parseBands('1,2,3,4,5,6').length == 5)
check('空串解析为 5 个 0', () => JSON.stringify(parseBands('')) == '[0,0,0,0,0]')
check('越上界夹到 1500', () => parseBands('9999')[0] == 1500)
check('越下界夹到 -1500', () => parseBands('-9999')[0] == -1500)
check('非法项归 0（NaN/脏串）', () => parseBands('abc,NaN')[0] == 0 && parseBands('abc,NaN')[1] == 0)
check('小数四舍五入', () => parseBands('350.6')[0] == 351)
check('normalizeBandsCsv 输出恒为 5 项', () => normalizeBandsCsv('1,2').split(',').length == 5)
check('normalizeBandsCsv(null) 回落默认', () => normalizeBandsCsv(null) == '0,0,0,0,0')
check('serializeBands 与 parseBands 往返一致', () => serializeBands(parseBands('-300,0,0,200,500')) == '-300,0,0,200,500')
check('isFlatBands 判定正确', () => isFlatBands('0,0') === true && isFlatBands('0,1') === false)
check('任意输入的结果恒在 [MIN, MAX]', () => {
  const samples = ['-9999,9999,abc,NaN,0', '-1e9', '1e9', '', ',,,', '375.7,-375.7']
  return samples.every(s => parseBands(s).every(v => v >= EQ_LEVEL_MIN && v <= EQ_LEVEL_MAX))
})

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n===== 均衡器门禁：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过` : ''} =====`)
if (fail) {
  console.log(failures.map(f => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
