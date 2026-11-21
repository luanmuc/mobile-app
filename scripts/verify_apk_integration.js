#!/usr/bin/env node
/**
 * P7 集成落地断言（rntp STRESS_PLAN）：定制资源与桥方法**真的进了 APK**。
 *
 * 背景：rntp 的 P7 一直是 L3「未执行」——图标数、方法名都只在源码层看过，
 * 从没打过包再解包确认。本轮补上：直接读 APK 里的 `resources.arsc` 与 `classes*.dex`
 * 的字符串池（两者都是 UTF-8 明文，不依赖 aapt2 / dexdump）。
 *
 * 用法：
 *   node scripts/check_apk_integration.js <apk 路径>
 *   node scripts/check_apk_integration.js            # 自动找 android/app/build/outputs/apk/release/*universal*.apk
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

let pass = 0
let fail = 0
function expect(name, ok) {
  if (ok) {
    pass++
    console.log('  ✅ ' + name)
  } else {
    fail++
    console.log('  ❌ ' + name)
  }
}

function findApk(argv) {
  if (argv[2]) return argv[2]
  const dir = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release')
  if (!fs.existsSync(dir)) return null
  const list = fs.readdirSync(dir).filter(f => f.endsWith('.apk'))
  if (!list.length) return null
  return path.join(dir, (list.find(f => f.includes('universal')) || list[0]))
}

function unzipEntry(apk, entry, tmpdir) {
  try {
    execFileSync('unzip', ['-o', '-q', apk, entry, '-d', tmpdir], { stdio: 'pipe' })
    const p = path.join(tmpdir, entry)
    if (fs.existsSync(p)) return fs.readFileSync(p)
  } catch (e) {
    return null
  }
  return null
}

function listEntries(apk) {
  try {
    return execFileSync('unzip', ['-Z', '-1', apk], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

const apk = findApk(process.argv)
console.log('P7 集成落地断言（解包 APK）')
if (!apk || !fs.existsSync(apk)) {
  console.log('  ⏭ 未找到 APK（本地未构建时可跳过；CI 构建后必须跑）')
  process.exit(2)
}
console.log(`  APK: ${apk}（${(fs.statSync(apk).size / 1048576).toFixed(1)} MB）`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-int-'))
try {
  const entries = listEntries(apk)
  expect('APK 可解包且含 resources.arsc', entries.includes('resources.arsc'))

  const arsc = unzipEntry(apk, 'resources.arsc', tmp)
  expect('resources.arsc 可读', arsc != null && arsc.length > 0)

  // 四种播放模式图标必须都能在资源表里找到名字
  const needed = ['notify_mode_loop', 'notify_mode_order', 'notify_mode_random', 'notify_mode_single']
  for (const n of needed) {
    expect(`资源表含 ${n}`, arsc != null && arsc.includes(Buffer.from(n, 'utf8')))
  }

  // 密度目录在 aapt2 的 resources.arsc 里按 config 存储、不保留 drawable-mdpi 这类目录名，
  // 因此这里不验密度（源层 20 张 = 4 态 × 5 密度已由 rntp docs-audit 锁定）。
  // 桥方法：通知栏重复模式
  const dexNames = entries.filter(e => /^classes\d*\.dex$/.test(e))
  expect('APK 含 classes.dex', dexNames.length > 0)
  let hasBridge = false
  for (const d of dexNames) {
    const buf = unzipEntry(apk, d, tmp)
    if (buf && buf.includes(Buffer.from('setNotificationRepeatMode', 'utf8'))) { hasBridge = true; break }
  }
  expect('dex 含桥方法 setNotificationRepeatMode', hasBridge)

  // 音高桥方法（b160 需求，方法名在 rntp 侧是 setPitch）顺带锁一条
  let hasPitch = false
  for (const d of dexNames) {
    const buf = unzipEntry(apk, d, tmp)
    if (buf && buf.includes(Buffer.from('setPitch', 'utf8'))) { hasPitch = true; break }
  }
  expect('dex 含桥方法 setPitch', hasPitch)
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
