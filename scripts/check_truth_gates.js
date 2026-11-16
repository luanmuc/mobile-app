#!/usr/bin/env node
/**
 * 口径门禁（App 侧）· check_truth_gates
 * 放进 scripts/check_*.js 队列，与其余 38 个门禁一起跑。
 * 只读本仓文件，无网络、无 SDK。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let red = 0
const P = (id, msg) => console.log('  ✅ [' + id + '] ' + (msg || ''))
const F = (id, msg) => { red++; console.log('  ❌ [' + id + '] ' + (msg || '')) }
// 跳过 = 判据失效，必须算红：包内原版 poc 在仓外运行时全部 skip 却报「口径全部一致」，
// 那种「绿」是最危险的假绿（脚本读不到文件不等于没有问题）。
const S = (id, msg) => { red++; console.log('  ❌ [' + id + '] 无法验证：' + (msg || '')) }

// G6 versionCode 多源一致性
try {
  const pkgObj = JSON.parse(rd('package.json'))
  const state = JSON.parse(rd('publish/build-state.json')).versionCode
  // 决策（2026-11-16）：单一真相在发布态 build-state.json，package.json 不再保留该键。
  // 若日后有人把键加回来，就必须与发布态相等，否则红。
  if (!('versionCode' in pkgObj)) P('G6', `versionCode 单一真相在发布态 ${state}（package.json 已移除该键）`)
  else if (Number(pkgObj.versionCode) === Number(state)) P('G6', `versionCode 两源一致 ${pkgObj.versionCode}`)
  else F('G6', `package.json versionCode ${pkgObj.versionCode} ≠ publish/build-state.json ${state}（构建号回退会让 Android 拒绝覆盖安装）`)
} catch (e) { S('G6', '跳过：' + e.message) }

// G7 门禁脚本数：文档声明 vs 实际
try {
  const n = fs.readdirSync(path.join(root, 'scripts')).filter(f => /^check_.*\.js$/.test(f)).length
  let checked = false
  for (const d of ['docs/AUDIT_PLAN.md', 'docs/SCRIPTS.md', 'README.md']) {
    if (!fs.existsSync(path.join(root, d))) continue
    const txt = rd(d)
    for (const m of txt.matchAll(/`scripts\/check_\*\.js`\s*\*\*(\d+) 个\*\*/g)) {
      checked = true
      if (Number(m[1]) === n) P('G7', `${d}: 声明 ${m[1]} = 实际 ${n}`)
      else F('G7', `${d}: 声明 ${m[1]} ≠ 实际 ${n}`)
    }
  }
  if (!checked) S('G7', `无带数字声明（实际 ${n} 个）`)
} catch (e) { S('G7', '跳过：' + e.message) }

// G8 打包命令一致性
try {
  const s = JSON.parse(rd('package.json')).scripts
  const a = s['pack:android'] || ''; const b = s['pack:android:debug'] || ''
  const xplat = (t) => /process\.platform/.test(t)
  if (xplat(a) && xplat(b)) P('G8', '两条打包命令都按平台选 gradlew / gradlew.bat')
  else if (/gradlew\.bat/.test(a) && /\.\/gradlew/.test(b)) F('G8', 'pack:android 用 gradlew.bat，pack:android:debug 用 ./gradlew → 另一平台必失败')
  else P('G8', '两条打包命令写法一致')
} catch (e) { S('G8', '跳过：' + e.message) }


// G10 三语键数：三语互相一致 + 与 docs/AUDIT_PLAN.md 的"硬数字"一致
try {
  const langs = ['en-us', 'zh-cn', 'zh-tw']
  const cnt = (o) => (o && typeof o === 'object') ? Object.values(o).reduce((a, v) => a + cnt(v), 0) : 1
  const nums = langs.map(l => cnt(JSON.parse(rd(`src/lang/${l}.json`))))
  if (new Set(nums).size === 1) P('G10', `三语各 ${nums[0]} 键，互相一致`)
  else F('G10', `三语键数不一致：${langs.map((l, i) => l + '=' + nums[i]).join(' / ')}`)
  const claimed = (rd('docs/AUDIT_PLAN.md').match(/三语各 \*\*(\d+) 键\*\*/) || [])[1]
  if (claimed && Number(claimed) !== nums[0]) F('G10', `文档声明 ${claimed} 键 ≠ 实际 ${nums[0]}（改了文案没回填硬数字）`)
  else if (claimed) P('G10', `文档声明 ${claimed} 键 = 实际`)
} catch (e) { S('G10', '跳过：' + e.message) }

// G11 TS/TSX 文件数 vs 文档硬数字
try {
  const n = []
  const walk = (d) => {
    for (const f of fs.readdirSync(path.join(root, d))) {
      const rel = path.join(d, f); const st = fs.statSync(path.join(root, rel))
      if (st.isDirectory()) walk(rel); else if (/\.(ts|tsx)$/.test(f)) n.push(rel)
    }
  }
  walk('src')
  const claimed = (rd('docs/AUDIT_PLAN.md').match(/TS\/TSX \*\*(\d+) 文件\*\*/) || [])[1]
  if (claimed && Number(claimed) !== n.length) F('G11', `文档声明 ${claimed} ≠ 实际 ${n.length} 个 TS/TSX`)
  else if (claimed) P('G11', `${n.length} 个 TS/TSX = 文档 ${claimed}`)
  else S('G11', `无声明（实际 ${n.length}）`)
} catch (e) { S('G11', '跳过：' + e.message) }

// G12 版本串与 build 号一致：publish/version.json 的 x.y.z-bN vs build-state 的 build
try {
  const v = JSON.parse(rd('publish/version.json')).version
  const b = JSON.parse(rd('publish/build-state.json')).build
  const m = v.match(/-b(\d+)$/)
  if (!m) S('G12', `版本串无 -bN 后缀：${v}`)
  else if (Number(m[1]) === Number(b)) P('G12', `${v} 的 b${m[1]} = build-state build ${b}`)
  else F('G12', `${v} 的 b${m[1]} ≠ build-state build ${b}`)
} catch (e) { S('G12', '跳过：' + e.message) }

// G18 切源超时既不留裸数字也不能漏清定时器
try {
  const t = rd('src/screens/Home/Views/Setting/settings/Basic/Source.tsx')
  // 旧写法长这样：new Promise(resolve => { setTimeout(() => {…}, 8000) })
  const bare = /resolve\(false\)\s*\}\s*,\s*(\d{3,})\s*\)/.test(t)
  const hasConst = /SOURCE_SWITCH_INIT_TIMEOUT\s*=\s*8000|SOURCE_SWITCH_INIT_TIMEOUT\s*=\s*8_000/.test(t)
  const clear = /clearTimeout\(initTimer\)/.test(t)
  if (bare) F('G18', 'Source.tsx 切源超时仍用裸数字（应为 SOURCE_SWITCH_INIT_TIMEOUT）')
  else if (!hasConst) F('G18', '缺少 SOURCE_SWITCH_INIT_TIMEOUT 常量')
  else if (!clear) F('G18', '竞速结束后未清理定时器（Promise.race 另一路会空转）')
  else P('G18', '切源超时用常量且结束后清理定时器')
} catch (e) { S('G18', '跳过：' + e.message) }

// G20 依赖可复现性：github: 依赖必须锁到 40 位 commit sha（N-1136）
try {
  const deps = JSON.parse(rd('package.json')).dependencies || {}
  const gh = Object.entries(deps).filter(([, v]) => String(v).startsWith('github:'))
  const bad = gh.filter(([, v]) => !/#[0-9a-f]{40}$/.test(String(v)))
  if (!gh.length) F('G20', '没有任何 github: 依赖（判据失效）')
  else if (bad.length) F('G20', `${bad.map(([k]) => k).join('、')} 未锁 40 位 sha（分支/tag 会随时漂移）`)
  else P('G20', `${gh.length} 个 github: 依赖全部锁 40 位 sha（无 checksum，仍靠 git 内容寻址）`)
} catch (e) { S('G20', e.message) }

// G21 活跃计划唯一：每仓只允许一份审计计划 + 一份压力测试计划
// 为什么要有这条：2026-11-16 检查发现 docs/ 下同时躺着 AUDIT_PLAN.md 与
// AUDIT_PLAN_HEALTH_DIAGNOSTICS.md（自称“子纲”），以及历史轮次的 round1~5 计划散在
// audit-plans/ 与 archive/ 里——用户的口径是「一个仓库就一套」。计划一旦分叉，
// 审什么（主计划）和怎么验（子纲）就会各改各的，缺口永远对不上。所以把唯一性做成门禁，
// 而不是靠约定。
try {
  const planFiles = fs.readdirSync(path.join(root, 'docs')).filter(f => /^AUDIT_PLAN.*\.md$/.test(f))
  const stressFiles = fs.readdirSync(path.join(root, 'docs')).filter(f => /^STRESS_PLAN.*\.md$/.test(f))
  if (planFiles.length === 1 && stressFiles.length === 1) P('G21', `活跃计划唯一：${planFiles[0]} / ${stressFiles[0]}`)
  else F('G21', `活跃计划不唯一：审计 [${planFiles.join(', ') || '无'}] 压力 [${stressFiles.join(', ') || '无'}]（docs/ 根目录各只许 1 份）`)
} catch (e) { F('G21', '无法枚举 docs/：' + e.message) }

// G22 compileSdk 必须在 AGP 支持范围内（N-1165）
// 背景：compileSdk 36 配 AGP 8.6.1，官方支持上限 35。越界可能只是警告，也可能在
// 独立构建/CI 上升级 SDK 解析失败——每次构建都在赌。判据写成「映射表」而不是硬编码 35，
// 这样升 AGP 时门禁跟着放宽，不需要人记住改。
try {
  const top = rd('android/build.gradle')
  const cs = Number((top.match(/compileSdkVersion\s*=\s*(\d+)/) || [])[1])
  const agp = ((top.match(/com\.android\.tools\.build:gradle:([\d.]+)/) || [])[1] || '').split('.').slice(0, 2).join('.')
  // AGP → 该版本官方支持的最高 compileSdk
  const maxByAgp = Object.fromEntries([
    ['8.3', 34], ['8.4', 34], ['8.5', 34], ['8.6', 35],
    ['8.7', 35], ['8.8', 35], ['8.9', 35],
    ['8.13', 36], ['9.0', 36], // 8.13 官方上限 36（agp-8-13 释放说明）；8.10~8.12 未核实，留空让门禁报「请补映射」
  ])
  const max = maxByAgp[agp]
  if (!cs) F('G22', 'android/build.gradle 未声明 compileSdkVersion')
  else if (max == null) F('G22', `AGP ${agp || '未知'} 不在映射表里，无法判定 compileSdk ${cs} 是否越界（请补映射）`)
  else if (cs > max) F('G22', `compileSdk ${cs} 超出 AGP ${agp} 官方上限 ${max}（要么回 ${max}，要么升 AGP 并重跑 CI）`)
  else P('G22', `compileSdk ${cs} ≤ AGP ${agp} 上限 ${max}`)
} catch (e) { S('G22', e.message) }

// G27 Promise.race 的超时定时器必须清理，延时必须具名常量（N-1168）
// 为什么值得守：race 胜出后超时定时器仍空转到点（Node 实测会把进程拖到定时器到点才退出），
// 且超时回调里的副作用会对已完成的任务再执行一次。注意：它**不会**造成
// unhandledRejection（race 内部对两路都挂了 then，后到的 reject 被吞），别把这条门禁
// 说成“防崩溃”。
// 判据（按标识符，不按“附近有没有 clearTimeout”这种模糊窗口）：
//   1. race 同文件里每次 setTimeout 要么被赋给变量，并且该文件存在 clearTimeout(同名变量)；
//      匿名的 setTimeout(() => reject(...)) 一律算未清理——定时器句柄根本没保留，无从清理。
//   2. 延时参数必须是标识符或常量成员，不能是裸数字（改值时全仓 grep 不到）。
try {
  const srcDir = path.join(root, 'src')
  const files = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(f)) files.push(full)
    }
  }
  walk(srcDir)
  const bad = []
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8')
    if (!/Promise\.race\(/.test(txt)) continue
    const rel = path.relative(root, f)
    for (const m of txt.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*setTimeout\(/g)) {
      if (!new RegExp('clearTimeout\\(\\s*' + m[1] + '\\s*\\)').test(txt)) bad.push(rel + '(' + m[1] + ' 未清理)')
    }
    // 匿名 setTimeout + reject 的超时（race 的典型写法）
    if (/new Promise<never>\(\([^)]*\)\s*=>\s*\{?\s*setTimeout\(/.test(txt)) bad.push(rel + '(超时定时器未保留句柄)')
    // 裸数字延时（只查原生 setTimeout；BackgroundTimer.setTimeout 自带 clear 语义，不算）
    const bareDelay = /(?<![\w.])setTimeout\([^,]{0,200},\s*(\d[\d_]*)\s*\)/.exec(txt)
    if (bareDelay) bad.push(rel + '(裸延时 ' + bareDelay[1] + ')')
  }
  const uniq = [...new Set(bad)]
  if (!files.length) F('G27', 'src 下没有 .ts/.tsx，判据失效')
  else if (uniq.length) F('G27', `${uniq.join('、')}（Promise.race 超时必须 clearTimeout 且延时用具名常量）`)
  else P('G27', `${files.length} 个源文件：race 超时均清理定时器且用常量`)
} catch (e) { S('G27', e.message) }

// G23 SDK 三件套自洽：targetSdk ≤ compileSdk，buildTools 主版本 ≤ compileSdk
try {
  const top = rd('android/build.gradle')
  const num = (re) => Number(((top.match(re) || [])[1]))
  const cs = num(/compileSdkVersion\s*=\s*(\d+)/)
  const ts = num(/targetSdkVersion\s*=\s*(\d+)/)
  const bt = num(/buildToolsVersion\s*=\s*"(\d+)/)
  if (!cs || !ts || !bt) F('G23', `SDK 配置缺项（compileSdk=${cs} targetSdk=${ts} buildTools=${bt}）`)
  else if (ts > cs) F('G23', `targetSdk ${ts} > compileSdk ${cs}（编译期拿不到更高 API，构建会失败）`)
  else if (bt > cs) F('G23', `buildTools ${bt} > compileSdk ${cs}（构建工具比编译 API 还新，aapt2 会报错）`)
  else P('G23', `compileSdk ${cs} / targetSdk ${ts} / buildTools ${bt} 自洽`)
} catch (e) { S('G23', e.message) }

console.log(red ? `\n❌ 口径门禁：${red} 条不一致` : '\n✅ 口径门禁：全部一致')
if (require.main === module) process.exit(red ? 1 : 0)
module.exports = { main: () => red }
