#!/usr/bin/env node
/**
 * R-01 发布状态契约：workflow 必须 fail-closed，tag 必须指向构建提交，
 * publish/build-state.json 与 publish/version.json 必须同一 bN。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let failures = 0
let checks = 0
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++; console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
  }
}

const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'publish/build-state.json'), 'utf8'))
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'publish/version.json'), 'utf8'))
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')

console.log('\n[R-01 release state]')
run('R-01-W1 tag 固定到实际构建提交', () => {
  assert(/target_commitish:\s*\$\{\{ github\.sha \}\}/.test(workflow), '缺少 target_commitish')
})
run('R-01-W2 Release 提交前 fetch/rebase 远端', () => {
  assert(workflow.includes('git fetch origin master'), '缺少 fetch origin master')
  assert(workflow.includes('git rebase origin/master'), '缺少 rebase origin/master')
})
run('R-01-W3 push 失败必须 fail-closed', () => {
  assert(!/git push[\s\S]{0,200}\|\|/.test(workflow), 'git push 仍存在 || 吞错')
})
run('R-01-S1 build-state 与 version.json 同一 bN', () => {
  const m = version.version.match(/^([\d.]+)-b(\d+)$/)
  assert(m, `version.json 版本格式异常：${version.version}`)
  assert.strictEqual(Number(m[2]), state.build, `version=${version.version} state.build=${state.build}`)
  assert.strictEqual(`${m[1]}`, state.baseVersion, `baseVersion=${state.baseVersion}`)
})
run('R-01-S2 versionCode 为正整数且 README 同步', () => {
  assert(Number.isInteger(state.versionCode) && state.versionCode > 0, `versionCode=${state.versionCode}`)
  assert(readme.includes(`至 b${state.build}`), `README 未同步 b${state.build}`)
})

console.log(`\n===== R-01 发布状态契约：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
