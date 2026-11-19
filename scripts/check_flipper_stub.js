#!/usr/bin/env node
/**
 * K32：release 源集 Flipper 空桩的包名/目录/依赖作用域一致性。
 *
 * 历史问题：`MainApplication.java` import 的是 `com.facebook.react.flipper.ReactNativeFlipper`，
 * 而 release 桩文件放在 `cn/toside/music/ReactNativeFlipper.java`、package 是 `cn.toside.music.mobile`
 * —— 包名与目录都不匹配，release 构建实际解析到 `flipper-integration` AAR 里的实现，
 * 「空桩」从未接管，调试工具被带进正式包。
 *
 * 注意：只改桩的 package 而不改依赖作用域也不行——release 仍会打包 AAR，两个同名类会 duplicate class。
 * 三者必须同时成立：依赖只在 debug / 桩在 release / 包名与 import 对齐。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let passed = 0
const failures = []
const check = (name, fn) => {
  try { fn(); passed++; console.log('✓ ' + name) } catch (e) {
    failures.push(name + ' — ' + e.message)
    console.log('✗ ' + name + ' — ' + e.message)
  }
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MAIN_APP = 'android/app/src/main/java/cn/toside/music/mobile/MainApplication.java'
const STUB_DIR = 'android/app/src/release/java/com/facebook/react/flipper'
const STUB = STUB_DIR + '/ReactNativeFlipper.java'
const GRADLE = 'android/app/build.gradle'

check('F1 MainApplication 的 import 是全限定名 com.facebook.react.flipper.ReactNativeFlipper', () => {
  const src = read(MAIN_APP)
  assert(/import\s+com\.facebook\.react\.flipper\.ReactNativeFlipper\s*;/.test(src), 'import 路径不是 com.facebook.react.flipper.ReactNativeFlipper')
  assert(/ReactNativeFlipper\.initializeFlipper\(/.test(src), 'MainApplication 未调用 initializeFlipper')
})

check('F2 release 桩位于 com/facebook/react/flipper 目录且 package 与之比对', () => {
  assert(fs.existsSync(path.join(ROOT, STUB)), '缺少 release 空桩：' + STUB)
  const src = read(STUB)
  const pkg = (src.match(/^package\s+([\w.]+);/m) || [])[1]
  assert(pkg === 'com.facebook.react.flipper', '桩的 package 是 ' + pkg + '，应为 com.facebook.react.flipper')
  // 目录必须与 package 一致，否则 javac 依然按源集根目录推导，类不可见
  const dirFromPkg = STUB_DIR.split('/').slice(5).join('/') // 去掉 android/app/src/release/java 这 5 段
  assert(dirFromPkg === pkg.replace(/\./g, '/'), '桩所在目录 ' + dirFromPkg + ' 与 package ' + pkg + ' 不一致')
})

check('F3 旧位置的桩已不存在（防止两份同名类）', () => {
  const legacy = 'android/app/src/release/java/cn/toside/music/ReactNativeFlipper.java'
  assert(!fs.existsSync(path.join(ROOT, legacy)), '旧位置的桩仍存在，会与 com/facebook/react/flipper 版本重复')
})

check('F4 flipper-integration 只作用于 debug', () => {
  const gradle = read(GRADLE)
  assert(!/^\s*implementation\("com\.facebook\.react:flipper-integration"\)/m.test(gradle), 'flipper-integration 仍用 implementation（release 会打包 AAR 并 duplicate class）')
  assert(/^\s*debugImplementation\("com\.facebook\.react:flipper-integration"\)/m.test(gradle), '未找到 debugImplementation("com.facebook.react:flipper-integration")')
})

console.log('\n===== K32 Flipper 空桩一致性：' + passed + ' 通过 / ' + failures.length + ' 失败 =====')
if (failures.length) process.exit(1)
