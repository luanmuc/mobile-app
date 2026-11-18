#!/usr/bin/env node
/**
 * 跨仓健康态往返自检（HC-X1）：真实 App 持久化模块 ↔ 真实源仓产物。
 *
 * 为什么需要这个：健康态跨版本恢复曾经"两边单测都绿、链路其实是断的"——
 * 源仓 v8.15.1 加了 `HEALTH_STATE_ACCEPTED_SOURCE_VERSIONS` 白名单并写了"升级不丢
 * 健康账本"，但 App 在更前面用 `sourceVersion === expectedVersion` 精确相等把快照
 * 物理删除，白名单永远走不到。各自单测都覆盖不到这个交点。
 *
 * 本脚本不做 mock 捷径：App 侧用真实 `src/core/sourceHealthPersistence.ts`（tsc 转译），
 * 源侧用真实 `../lx-music-source/lx-source.js` 产物（含真实 `restoreHealthState`）。
 *
 * 用法：node scripts/check_cross_repo_health_roundtrip.js
 * 依赖：本地同时检出源仓；只检出 App 仓时打印 SKIP 并以 0 退出（不伪造通过）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
// A13-P1-03：与 check_source_update_fetch/apply 同口径支持路径覆盖 + 强制开关。
const SRC_DIR = process.env.LX_SOURCE_ROOT
  ? path.resolve(process.env.LX_SOURCE_ROOT)
  : path.resolve(ROOT, '..', 'lx-music-source')
const SRC_BUNDLE = path.join(SRC_DIR, 'lx-source.js')

// A12-005：原来只按仓库内绝对路径取 typescript —— 依赖未装/被提升走全局时脚本启动即崩，
// 崩溃退 1 与"断言失败退 1"同码，CI 里分不清是环境问题还是真回归。补全局回退。
const ts = (() => {
  try {
    return require(path.join(ROOT, 'node_modules', 'typescript'))
  } catch {
    return require('typescript')
  }
})()
const loadTs = rel => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

if (!fs.existsSync(SRC_BUNDLE)) {
  if (process.env.LX_REQUIRE_SOURCE === '1') {
    console.error('✗ 跨仓健康态往返不允许跳过：LX_REQUIRE_SOURCE=1 但未找到源仓产物')
    console.error('  已查找：' + SRC_BUNDLE)
    process.exit(1)
  }
  console.log('⏭ SKIP 跨仓健康态往返（未检出源仓产物；设 LX_SOURCE_ROOT=<源仓路径> 可强制执行）')
  process.exit(0)
}

// 源仓产物是 LX 宿主脚本，加载前需要最小宿主环境（与源仓 audit 夹具一致）。
const setLxHost = () => {
  globalThis.lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
    version: '2.0.0',
    env: 'mobile',
    utils: { buffer: { from: (d, e) => Buffer.from(d, e), bufToString: (b, e) => b.toString(e) } },
    request(url, opts, cb) {
      setTimeout(() => cb(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }), null), 2)
      return () => {}
    },
    on() {},
    send() {},
  }
  globalThis.__lxSourceConfig = {}
}
const loadSource = () => {
  setLxHost()
  const p = require.resolve(SRC_BUNDLE)
  if (require.cache[p]) delete require.cache[p]
  return require(SRC_BUNDLE)
}

const mod = loadTs('src/core/sourceHealthPersistence.ts')
// 源仓产物是单例模块：整个脚本只 load 一次，restore 与 export 必须落在同一实例上，
// 否则“恢复后导出为空”测出来的是模块隔离，不是恢复逻辑。
const SRC = loadSource()
const NOW = Date.now()

const fakeStorage = () => {
  const map = new Map()
  return {
    map,
    getData: async k => map.has(k) ? JSON.parse(map.get(k)) : null,
    saveData: async(k, v) => { map.set(k, JSON.stringify(v)) },
    removeData: async k => { map.delete(k) },
  }
}

// 模拟一台从 8.15.1 音源升到 8.16.0 的设备：账本里已有 3 次取链失败 + 播放摘除。
// 关键：基线必须用源仓真实 `exportHealthState()` 产出的形状再回拨版本号——
// 手搓字段会与源侧 schema 不符（首次实跑就是被 `failureCount 非法` 抓住的），
// 那样测的就不是"跨版本恢复"，而是"我编的字段能不能过校验"。
const moodState = sourceVersion => {
  const exported = JSON.parse(JSON.stringify(SRC.exportHealthState()))
  exported.sourceVersion = sourceVersion
  exported.savedAt = NOW
  const s = exported.sources.suyinKuwo
  s.breaker.state = 'open'
  s.breaker.failureCount = 3
  s.breaker.totalRequests = 5
  s.playDead.streak = 3
  s.playDead.deadline = NOW + 300 * 1000
  exported.qualityShortCircuit = { 'suyinKuwo:flac': NOW + 3600 * 1000 }
  return exported
}

let passed = 0
const failures = []
// 串行执行：用例共用源仓单例（每次 loadSource 会重置模块状态），并发会互相污染。
const queue = []
const check = (name, fn) => queue.push({ name, fn })
const runQueue = async() => {
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log(`✓ ${name}`) } catch (e) {
      failures.push(`${name} — ${e && e.message}`); console.log(`✗ ${name} — ${e && e.message}`)
    }
  }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

const sourceApi = () => ({
  restoreHealth: state => ({ promise: Promise.resolve(SRC.restoreHealthState(state)) }),
  exportHealth: () => ({ promise: Promise.resolve(SRC.exportHealthState()) }),
})

check('X1 8.15.1 账本在 8.16.0 音源下完整恢复（App 不删、源不拒）', async() => {
  const st = fakeStorage()
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, moodState('8.15.1'))
  const apis = { suyinKuwo: sourceApi() }
  const r = await mod.restoreSourceHealth(apis, 'suyinKuwo', '8.16.0', st, NOW)
  assert(r.restored > 0, `健康态未恢复到源：${JSON.stringify(r)}`)
  // 源侧真的吃下了这份快照：立即导出应带着原熔断/摘除计数，而不是空账本。
  const exported = await apis.suyinKuwo.exportHealth().promise
  const s = exported && exported.sources && exported.sources.suyinKuwo
  assert(s && s.breaker && s.breaker.failureCount === 3, `源侧熔断计数丢失：${JSON.stringify(s)}`)
  assert(s.playDead && s.playDead.streak === 3, `源侧播放摘除丢失：${JSON.stringify(s.playDead)}`)
  assert(exported.qualityShortCircuit && exported.qualityShortCircuit['suyinKuwo:flac'], '档位短路丢失')
})

check('X1b 源侧单独收到旧版本快照也必须接受（白名单不得成为第二道误拦）', async() => {
  // App 现在会在交源前把 sourceVersion 归一为当前版本，所以 X1 走不到源侧的比较逻辑。
  // 这里直接把 8.15.1 快照喂给源，覆盖源仓自身的放宽（否则白名单只认 3 个版本号，升级即丢）。
  // 用不在白名单里的旧版本（8.13.0）才有判别力：只认白名单时必然被拒，
  // 改成“数值 ≤ 当前”才放行——这才是修掉“每升一版丢账本”的那条判定。
  const old = moodState('8.13.0')
  const r = SRC.restoreHealthState(old)
  assert(r && r.ok === true, `源侧仍拒绝旧版本：${JSON.stringify(r)}`)
  const exported = SRC.exportHealthState()
  const s = exported.sources && exported.sources.suyinKuwo
  assert(s && s.breaker && s.breaker.failureCount === 3, `源侧恢复后计数丢失：${JSON.stringify(s)}`)
})

check('X2 未来版本快照在两仓都不被接受（不得回灌更新音源的元数据）', async() => {
  const st = fakeStorage()
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, moodState('9.9.9'))
  const apis = { suyinKuwo: sourceApi() }
  const r = await mod.restoreSourceHealth(apis, 'suyinKuwo', '8.16.0', st, NOW)
  assert(r.restored === 0, `未来版本竟被 App 恢复：${JSON.stringify(r)}`)
  // 直接绕过 App 喂给源，源也必须拒绝（两道闸都要挡住）。
  const direct = SRC.restoreHealthState(Object.assign(moodState('9.9.9'), { sourceVersion: '9.9.9' }))
  assert(direct && direct.ok === false, `源侧未拒绝未来版本：${JSON.stringify(direct)}`)
})

check('X3 空账本与非法结构仍被拒绝（跨版本放宽不得变成"什么都收"）', async() => {
  const st = fakeStorage()
  const junk = moodState('8.15.1')
  junk.sources = { suyinKuwo: { breaker: { state: 'nope' } } }
  await st.saveData(mod.HEALTH_STATE_CANONICAL_KEY, junk)
  const apis = { suyinKuwo: sourceApi() }
  const r = await mod.restoreSourceHealth(apis, 'suyinKuwo', '8.16.0', st, NOW)
  assert(r.restored === 0, `结构非法竟被恢复：${JSON.stringify(r)}`)
  assert(!st.map.has(mod.HEALTH_STATE_CANONICAL_KEY), '非法快照应被清理，不得留在盘上')
})

runQueue().then(() => {
  console.log(`\n跨仓健康态往返：${passed} 通过 / ${failures.length} 失败`)
  if (failures.length) { console.log(failures.map(f => ` - ${f}`).join('\n')); process.exit(1) }
  // 源仓产物会起探测/健康调度定时器，显式退出避免脚本挂住。
  process.exit(0)
})
