#!/usr/bin/env node
/* eslint-disable no-new-func */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
let ts
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch { ts = require('typescript') }
const load = rel => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', out)(mod.exports, mod, require)
  return mod.exports
}
const { buildQualityMatrixRows, classifyHealthMainState, buildHealthSummary, HEALTH_MAIN_STATES, shouldClearHealthLoading } = load('src/core/healthStatus.ts')
const { bindHealthSource } = load('src/core/healthSourceBinding.ts')
const { unwrapSourceResult, isBusinessRejection } = load('src/core/init/userApi/sourceContract.ts')
let pass = 0
let fail = 0
const check = (id, name, fn) => {
  try { fn(); pass++; console.log(`✓ ${id} ${name}`) } catch (e) { fail++; console.log(`✗ ${id} ${name} — ${e.message}`) }
}
const base = { name: 'x', maxQuality: 'flac', enabled: true, successRate: 0, avgTime: 0, state: 'closed', reqCount: 1, probeCount: 0, sleeping: false, healthScore: 0 }
check('HS1', '手动关闭优先于自动关闭/摘除', () => {
  const r = classifyHealthMainState({ ...base, offReason: 'USER_OFF', playDead: true, autoOff: true }, true)
  if (r.state !== 'off' || r.reason !== 'USER_OFF') throw new Error(JSON.stringify(r))
})
check('HS2', '探测自动关闭显示 paused/AUTO_OFF_PROBE', () => {
  const r = classifyHealthMainState({ ...base, offReason: 'AUTO_OFF_PROBE', healthScore: -9 }, true)
  if (r.state !== 'paused' || r.reason !== 'AUTO_OFF_PROBE') throw new Error(JSON.stringify(r))
})
check('HS3', '默认关闭显示 off/DEFAULT_OFF', () => {
  const r = classifyHealthMainState({ ...base, offReason: 'DEFAULT_OFF', userEnabled: false }, true)
  if (r.state !== 'off' || r.reason !== 'DEFAULT_OFF') throw new Error(JSON.stringify(r))
})
check('HS4', '真实播放摘除显示 paused/PLAYBACK_FAILED', () => {
  const r = classifyHealthMainState({ ...base, playDead: true, successRate: 0, healthScore: -9 }, true)
  if (r.state !== 'paused' || r.reason !== 'PLAYBACK_FAILED') throw new Error(JSON.stringify(r))
})
check('HS5', '自动关闭优先于播放摘除', () => {
  const r = classifyHealthMainState({ ...base, offReason: 'AUTO_OFF_PROBE', playDead: true }, true)
  if (r.reason !== 'AUTO_OFF_PROBE') throw new Error(JSON.stringify(r))
})
check('HS6', '休眠显示 paused/SOURCE_SLEEPING', () => {
  const r = classifyHealthMainState({ ...base, offReason: 'SLEEPING' }, true)
  if (r.state !== 'paused' || r.reason !== 'SOURCE_SLEEPING') throw new Error(JSON.stringify(r))
})
check('HS7', '无 offReason 时不再从 enabled/sleeping 推断旧状态', () => {
  const r = classifyHealthMainState({ ...base, enabled: false, sleeping: true }, true)
  if (r.state === 'paused' || r.state === 'off') throw new Error(JSON.stringify(r))
})
check('HS8', '4 主状态只落一个且合计等于源数', () => {
  const r = buildHealthSummary([
    { ...base, offReason: 'USER_OFF' },
    { ...base, offReason: 'AUTO_OFF_PROBE' },
    { ...base, playDead: true },
    { ...base },
  ])
  const total = Object.values(r).reduce((a, b) => a + b, 0)
  if (total !== 4 || r.off !== 1 || r.paused !== 2 || r.available !== 1) throw new Error(JSON.stringify(r))
})
check('HS9', '质量矩阵固定四档，逐档展示 success/fail/state（F16）', () => {
  const rows = buildQualityMatrixRows({
    byQuality: {
      flac: { req: 10, success: 3, fail: 7, rate: 0.3, avgTime: 1200, state: 'open' },
      '128k': { req: 5, success: 5, fail: 0, rate: 1, avgTime: 400, state: 'closed' },
    },
  })
  if (rows.length !== 4) throw new Error(`rows=${rows.length}`)
  const flac = rows.find(r => r.quality === 'flac')
  if (!flac || flac.success !== 3 || flac.fail !== 7 || flac.state !== 'open') throw new Error(JSON.stringify(flac))
  const low = rows.find(r => r.quality === '128k')
  if (!low || low.success !== 5 || low.fail !== 0 || low.hasSample !== true) throw new Error(JSON.stringify(low))
  const empty = rows.find(r => r.quality === '320k')
  if (!empty || empty.req !== 0 || empty.hasSample !== false) throw new Error(JSON.stringify(empty))
})
check('HS10', '健康 API 按 provider platforms 绑定，多源时不取第一个（F19/F60）', () => {
  const apis = { kw: { toggle() {} }, suyin: { toggle() {} }, wy: { toggle() {} }, noAction: {} }
  const platform = bindHealthSource(apis, 'toggle', 'suyinKuwo', ['wy', 'kw'])
  if (!platform || platform.sourceId !== 'wy' || platform.matched !== 'platform') throw new Error(JSON.stringify(platform))
  const explicit = bindHealthSource(apis, 'toggle', 'suyin', ['kw'])
  if (!explicit || explicit.sourceId !== 'suyin' || explicit.matched !== 'explicit') throw new Error(JSON.stringify(explicit))
  const fallback = bindHealthSource(apis, 'toggle', 'missing', ['zz'])
  if (!fallback || fallback.sourceId !== 'kw' || fallback.matched !== 'fallback') throw new Error(JSON.stringify(fallback))
  if (bindHealthSource(apis, 'probeSource', undefined, ['kw']) !== null) throw new Error('不应绑定缺 action 的 API')
})
check('HS15', '手动刷新被静默请求覆盖后 loading 仍由手动请求清（R71 复审）', () => {
  // 场景 C：手动 seq=1 置 loading 并登记 owner=1；静默请求（轮询/探路后刷新）把快照序号推到 2，但不碰 owner
  if (!shouldClearHealthLoading(false, 1, 1)) throw new Error('手动请求未被覆盖时应清 loading')
  if (shouldClearHealthLoading(false, 1, 2)) throw new Error('被静默请求覆盖的手动请求不得用最新快照序号清 loading（这正是修复前的卡死实现）')
  if (shouldClearHealthLoading(true, 2, 2)) throw new Error('静默请求不得清 loading')
  // 场景 D：新手动覆盖旧手动——旧的不得清，新的必须清
  if (shouldClearHealthLoading(false, 1, 2)) throw new Error('旧手动不得清新手动的 loading')
  if (!shouldClearHealthLoading(false, 2, 2)) throw new Error('新手动必须清自己的 loading')
})
check('HS16', 'loadHealth 的 loading 归属写入点与清理点一致（静态契约）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Setting/settings/Health.tsx'), 'utf-8')
  if (!/loadingOwnerSeqRef\.current = seq/.test(src)) throw new Error('setLoading(true) 前未登记 loading 主人')
  if (!/shouldClearHealthLoading\(silent, seq, loadingOwnerSeqRef\.current\)/.test(src)) throw new Error('finally 未按 loading 主人序号清 loading')
  if (/seq === healthReqSeqRef\.current\) setLoading\(false\)/.test(src)) throw new Error('仍用快照序号清 loading（修复前的卡死实现）')
})
check('HS17', 'forceQualityProbe 业务否定经 unwrap 原样透出（R71d：靠 code 明说，不靠「缺 error」）', () => {
  // 源侧 R71d 返回值：ok:false + code:UNSUPPORTED_ACTION，且不带 error
  const notFoundSource = { ok: false, id: '__nope__', quality: 'flac', code: 'UNSUPPORTED_ACTION', reason: 'UNKNOWN_SOURCE' }
  const u1 = unwrapSourceResult(notFoundSource)
  if (u1 !== notFoundSource) throw new Error('未知源返回应原样透出（业务否定不得抛）')
  if (u1.ok !== false) throw new Error('unwrap 后 ok 应为 false，否则 miss 文案不可达')
  if (u1.code !== 'UNSUPPORTED_ACTION') throw new Error(`code 被吃掉：${u1.code}`)
  const okSource = { ok: true, id: 'suyinKuwo', quality: 'flac' }
  if (unwrapSourceResult(okSource) !== okSource) throw new Error('成功返回应原样透出')
})
check('HS18', '对照：带 error 的 v2 envelope 必须抛（failed 分支）', () => {
  let thrown = null
  try { unwrapSourceResult({ ok: false, error: { code: 'CONFIG_ERROR', message: 'boom' } }) } catch (e) { thrown = e }
  if (!thrown) throw new Error('应抛错')
  if (thrown.code !== 'CONFIG_ERROR') throw new Error(`err.code=${thrown.code}`)
})
check('HS19', '业务否定白名单只认 UNSUPPORTED_ACTION，且包装层与三分流都不得吃掉 code（静态契约）', () => {
  // 正面：业务否定
  if (!isBusinessRejection({ ok: false, code: 'UNSUPPORTED_ACTION', reason: 'UNKNOWN_SOURCE' })) throw new Error('UNSUPPORTED_ACTION 应为业务否定')
  // 反面：源脚本内部链路结果也常是 {ok:false, code}，不能被误标成业务否定
  for (const code of ['NOT_AUDIO', 'PREVIEW_FRAGMENT', 'CONFIG_ERROR', 'PARAM_ERROR', 'LINK_EXPIRED']) {
    if (isBusinessRejection({ ok: false, code })) throw new Error(`${code} 不得被当成业务否定`)
  }
  // 带 error 的一律是协议错误，该抛
  if (isBusinessRejection({ ok: false, code: 'UNSUPPORTED_ACTION', error: { code: 'X', message: 'y' } })) throw new Error('带 error 的不得算业务否定')
  if (isBusinessRejection({ ok: true, code: 'UNSUPPORTED_ACTION' })) throw new Error('ok:true 不得算业务否定')
  // 静态 1：包装层 catch 必须透出 err.code，否则上层只剩 ok:false，failed/miss 又并成一句
  const idx = fs.readFileSync(path.join(ROOT, 'src/core/init/userApi/index.ts'), 'utf-8')
  if (!idx.includes("code: typeof err?.code === 'string'")) throw new Error('forceQualityProbe 包装层未透出 err.code')
  // 静态 2：retryQuality 必须按 code 三分流，且 failed 分支真实存在
  const health = fs.readFileSync(path.join(ROOT, 'src/screens/Home/Views/Setting/settings/Health.tsx'), 'utf-8')
  if (!health.includes("res?.code === 'UNSUPPORTED_ACTION'")) throw new Error('retryQuality 未按 code 识别业务否定')
  if (!health.includes("setError(t('health_quality_retry_failed'))")) throw new Error('health_quality_retry_failed 分支不存在')
})
// ── G-A02（2026-11-19）：4 主状态 × 12 reason 判定面的全组合枚举 ──────────────────
// 原口径「144 组合」= offReason(6) × playDead(2) × autoOff(2) × state(3) × sampled(2)。
// 本次补入 resolveDead 维度 → 288 结构，每结构再跑「坏样本 / 好样本」两种极性 = 576 次判定。
// HS1~HS10 是 10 个手写场景，判定树改顺序或加分支时可能整片漂移而不报错；HS11~HS14 补的是面。
const OFF_REASONS = [null, 'USER_OFF', 'DEFAULT_OFF', 'AUTO_OFF_PROBE', 'SLEEPING', 'PLAY_DEAD']
const QUALITY_STATES = ['closed', 'open', 'half-open']
const REASON_WHITELIST = ['ELIGIBLE', 'PENDING_SAMPLE', 'DEGRADED', 'PLAYBACK_FAILED', 'RESOLVE_FAILED', 'RATE_LIMITED', 'QUALITY_OPEN', 'QUALITY_HALF_OPEN', 'SOURCE_SLEEPING', 'AUTO_OFF_PROBE', 'USER_OFF', 'DEFAULT_OFF']
const STATE_STYLE = {
  available: { key: 'health_main_available', tone: 'ok' },
  degraded: { key: 'health_main_degraded', tone: 'warn' },
  paused: { key: 'health_main_paused', tone: 'muted' },
  off: { key: 'health_main_off', tone: 'muted' },
}
// oracle 用「显式优先级表」复述语义（顺序即语义），与实现互为镜像：
// 改实现不改表、或改表不改实现，都会在这里红。
const oracle = (item, sampled) => {
  const o = item.offReason
  if (o === 'USER_OFF') return ['off', 'USER_OFF']
  if (o === 'DEFAULT_OFF') return ['off', 'DEFAULT_OFF']
  if (o === 'AUTO_OFF_PROBE' || item.autoOff === true) return ['paused', 'AUTO_OFF_PROBE']
  if (o === 'SLEEPING') return ['paused', 'SOURCE_SLEEPING']
  if (o === 'PLAY_DEAD' || item.playDead === true) return ['paused', 'PLAYBACK_FAILED']
  if (item.resolveDead === true) return ['paused', 'RESOLVE_FAILED']
  if (!sampled) return ['available', 'PENDING_SAMPLE']
  if (item.rateLimitActive === true || item.rateLimited === true) return ['degraded', 'RATE_LIMITED']
  if (item.state === 'open') return ['degraded', 'QUALITY_OPEN']
  if (item.state === 'half-open') return ['degraded', 'QUALITY_HALF_OPEN']
  if (item.successRate === 0 && item.healthScore < 0) return ['degraded', 'DEGRADED']
  return ['available', 'ELIGIBLE']
}
const POLARITY = [
  { name: '坏样本', successRate: 0, healthScore: -9 },
  { name: '好样本', successRate: 1, healthScore: 12 },
]
const COMBOS = OFF_REASONS.flatMap(offReason =>
  [false, true].flatMap(playDead =>
    [false, true].flatMap(autoOff =>
      [false, true].flatMap(resolveDead =>
        QUALITY_STATES.flatMap(state =>
          [false, true].map(sampled => ({ offReason, playDead, autoOff, resolveDead, state, sampled })),
        ),
      ),
    ),
  ),
)
const runCombo = (c, pol) => {
  const item = { ...base, offReason: c.offReason, playDead: c.playDead, autoOff: c.autoOff, resolveDead: c.resolveDead, state: c.state, successRate: pol.successRate, healthScore: pol.healthScore }
  return { item, sampled: c.sampled, r: classifyHealthMainState(item, c.sampled) }
}
check('HS11', `判定面 ${COMBOS.length} 结构 × ${POLARITY.length} 极性全枚举，与优先级表逐条一致`, () => {
  let n = 0
  for (const c of COMBOS) {
    for (const pol of POLARITY) {
      const { item, sampled, r } = runCombo(c, pol)
      const exp = oracle(item, sampled)
      if (r.state !== exp[0] || r.reason !== exp[1]) throw new Error(`组合 ${JSON.stringify({ ...c, 极性: pol.name })} → 实得 ${r.state}/${r.reason}，期望 ${exp[0]}/${exp[1]}`)
      if (!HEALTH_MAIN_STATES.includes(r.state)) throw new Error(`非法 state: ${r.state}`)
      if (!REASON_WHITELIST.includes(r.reason)) throw new Error(`非法 reason: ${r.reason}`)
      const st = STATE_STYLE[r.state]
      if (!st || r.key !== st.key || r.tone !== st.tone) throw new Error(`state↔key/tone 不自洽: ${JSON.stringify(r)}`)
      n++
    }
  }
  if (n !== COMBOS.length * POLARITY.length) throw new Error(`实际判定次数 ${n}`)
})
check('HS12', '优先级不变式：关闭信号不被降级为可用，旧 sleeping/enabled 不再参与推断', () => {
  for (const c of COMBOS) {
    for (const pol of POLARITY) {
      const { item, sampled, r } = runCombo(c, pol)
      // ① 只要存在任何一种关闭/暂停信号，就不能被判成「可用」
      const hasOffSignal = item.offReason != null || item.autoOff === true || item.playDead === true || item.resolveDead === true
      if (hasOffSignal && r.state === 'available') throw new Error(`关闭信号被降级为可用: ${JSON.stringify({ ...c, 极性: pol.name })} → ${r.state}/${r.reason}`)
      // ② 两个绝对关闭态：任何其它字段都压不住
      if ((item.offReason === 'USER_OFF' || item.offReason === 'DEFAULT_OFF') && r.state !== 'off') throw new Error(`绝对关闭态被降级: ${JSON.stringify({ ...c, 极性: pol.name })} → ${r.state}/${r.reason}`)
      // ③ 单一关闭信号且无更高优先时，reason 必须精确（autoOff 优先级高于 SLEEPING/PLAY_DEAD）
      if (item.offReason === 'AUTO_OFF_PROBE' && r.reason !== 'AUTO_OFF_PROBE') throw new Error(`AUTO_OFF_PROBE 未独占: ${JSON.stringify({ ...c, 极性: pol.name })} → ${r.state}/${r.reason}`)
      if (item.offReason === 'SLEEPING' && item.autoOff !== true && r.reason !== 'SOURCE_SLEEPING') throw new Error(`SLEEPING 未独占: ${JSON.stringify({ ...c, 极性: pol.name })} → ${r.state}/${r.reason}`)
      if (item.offReason === 'PLAY_DEAD' && item.autoOff !== true && r.reason !== 'PLAYBACK_FAILED') throw new Error(`PLAY_DEAD 未独占: ${JSON.stringify({ ...c, 极性: pol.name })} → ${r.state}/${r.reason}`)
      // ④ 旧字段彻底退出推断：翻转 sleeping / enabled / userEnabled 不得改变结果
      const alt = classifyHealthMainState({ ...item, sleeping: !item.sleeping, enabled: !item.enabled, userEnabled: !(item.userEnabled !== false) }, sampled)
      if (alt.state !== r.state || alt.reason !== r.reason) throw new Error(`旧字段影响了判定: ${JSON.stringify({ ...c, 极性: pol.name })} → ${alt.state}/${alt.reason}`)
    }
  }
})
check('HS13', '判定面可达性：4 主状态与 12 reason 都能被真实组合命中（无死分支）', () => {
  const seenState = new Set()
  const seenReason = new Set()
  for (const c of COMBOS) {
    for (const pol of POLARITY) {
      const { r } = runCombo(c, pol)
      seenState.add(r.state)
      seenReason.add(r.reason)
    }
  }
  for (const flag of [true, false]) {
    const r = classifyHealthMainState({ ...base, rateLimited: flag, rateLimitActive: flag }, true)
    seenState.add(r.state)
    seenReason.add(r.reason)
  }
  if (seenState.size !== HEALTH_MAIN_STATES.length) throw new Error(`主状态只命中 ${seenState.size}/4: ${[...seenState]}`)
  if (seenReason.size !== REASON_WHITELIST.length) throw new Error(`reason 只命中 ${seenReason.size}/${REASON_WHITELIST.length}，缺 ${REASON_WHITELIST.filter(x => !seenReason.has(x))}`)
})
check('HS14', '纯函数：不改入参、同输入可重复', () => {
  for (const c of COMBOS) {
    for (const pol of POLARITY) {
      const { item, sampled, r } = runCombo(c, pol)
      const snap = JSON.stringify(item)
      const r2 = classifyHealthMainState(item, sampled)
      if (JSON.stringify(item) !== snap) throw new Error(`入参被修改: ${JSON.stringify({ ...c, 极性: pol.name })}`)
      if (JSON.stringify(r2) !== JSON.stringify(r)) throw new Error(`同输入结果不稳定: ${JSON.stringify({ ...c, 极性: pol.name })}`)
    }
  }
})
console.log(`\nHealth status refactor: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
