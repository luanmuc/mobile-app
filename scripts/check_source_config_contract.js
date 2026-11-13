#!/usr/bin/env node
/**
 * 音源配置 / 健康状态契约检查。
 *
 * 用法：
 *   node scripts/check_source_config_contract.js                 # 全部
 *   node scripts/check_source_config_contract.js --only=contract # 只跑契约层
 *   node scripts/check_source_config_contract.js --only=defaults
 *   node scripts/check_source_config_contract.js --only=status
 *   node scripts/check_source_config_contract.js --only=validation
 *   node scripts/check_source_config_contract.js --only=init
 *   node scripts/check_source_config_contract.js --only=i18n
 *
 * 说明：
 *   - 直接转译生产 TS 模块后执行，不复制实现、不 mock；
 *   - 每个 section 独立汇总，失败时退出码 1；
 *   - 这是 App 仓目前唯一的逻辑级单测入口，CI 仍以 check_ts_syntax 为底线。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
const ONLY = (() => {
  const arg = process.argv.find(v => v.startsWith('--only='))
  return arg ? arg.slice('--only='.length) : ''
})()

let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch (e) {
  ts = require('typescript')
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // 仅在仓库自检脚本里加载转译后的本仓 TS 模块，不执行外部输入
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

let failures = 0
let checks = 0
const run = (name, fn) => {
  try {
    fn()
    checks++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}
const section = (name, fn) => {
  if (ONLY && ONLY !== name) return
  console.log(`\n[${name}]`)
  fn()
}

const CFG = () => loadTs('src/core/sourceConfig.ts')

section('contract', () => {
  const c = CFG()
  run('i18n 前缀与显示单位换算', () => {
    assert.strictEqual(c.configLabelKey('cacheTtlMs'), 'health_cfg_label_cacheTtlMs')
    assert.strictEqual(c.configDescKey('cacheTtlMs'), 'health_cfg_desc_cacheTtlMs')
    assert.strictEqual(c.msToDisplay('cacheTtlMs', 6 * 3600000), 6)
    assert.strictEqual(c.msToDisplay('cacheTtlHighQualityMs', 30 * 60000), 30)
    assert.strictEqual(c.msToDisplay('breakerCooldownMs', 0.5 * 60000), 0.5)
    assert.strictEqual(c.msToDisplay('breakerThreshold', 3), 3, '无 msPerUnit 的纯数字键原值返回')
    assert.strictEqual(c.msToDisplay('not-a-key', 1234), 1234, '未知键原值返回')
    assert.strictEqual(c.msToDisplay('raceMatchWaitMs', 600), 0.6, '600ms → 0.6 秒')
  })
  run('28 个数字键 + 9 个布尔键', () => {
    assert.strictEqual(c.NUMERIC_CONFIG_KEYS.length, 28)
    assert.strictEqual(c.BOOL_CONFIG_KEYS.length, 9)
    assert.strictEqual(c.SOURCE_CONFIG_KEYS.length, 37)
  })
  run('所有数字键都有单位配置和下上限', () => {
    for (const key of c.NUMERIC_CONFIG_KEYS) {
      assert(c.CONFIG_UNIT_CONFIG[key], `缺少 CONFIG_UNIT_CONFIG: ${key}`)
      assert(c.PARAM_LIMITS[key], `缺少 PARAM_LIMITS: ${key}`)
    }
  })
  run('启动注入接受完整 37 键', () => {
    const input = {}
    for (const key of c.NUMERIC_CONFIG_KEYS) {
      const spec = c.CONFIG_UNIT_CONFIG[key]
      input[key] = spec.default * (spec.msPerUnit || 1)
    }
    for (const key of c.BOOL_CONFIG_KEYS) input[key] = c.BOOL_CONFIG_DEFAULT[key]
    const out = c.filterConfigForInjection(input)
    assert.deepStrictEqual(Object.keys(out).sort(), c.SOURCE_CONFIG_KEYS.slice().sort())
  })
  run('启动注入保留验真 0 值', () => {
    const out = c.filterConfigForInjection({ verifyDurRatio: 0, verifyDurGapSec: 0 })
    assert.strictEqual(out.verifyDurRatio, 0)
    assert.strictEqual(out.verifyDurGapSec, 0)
  })
  run('启动注入拒绝死键/错误类型/负数/超限', () => {
    const out = c.filterConfigForInjection({
      raceOverallTimeoutMs: 12000,
      verifyDelivery: 'false',
      cacheTtlMs: -1,
      allFailShortTtlMs: 10 * 60 * 1000 + 1,
      raceBatchStaggerMs: 0,
      memoryMapMax: 2000,
    })
    assert.strictEqual(out.raceOverallTimeoutMs, undefined)
    assert.strictEqual(out.verifyDelivery, undefined)
    assert.strictEqual(out.cacheTtlMs, undefined)
    assert.strictEqual(out.allFailShortTtlMs, undefined)
    assert.strictEqual(out.raceBatchStaggerMs, undefined)
    assert.strictEqual(out.memoryMapMax, 2000)
  })
})

section('defaults', () => {
  const c = CFG()
  run('playDeadReviveMs 默认 5 分钟', () => {
    assert.strictEqual(c.CONFIG_UNIT_CONFIG.playDeadReviveMs.default, 5)
    assert.strictEqual(c.CONFIG_UNIT_CONFIG.playDeadReviveMs.msPerUnit, 60000)
  })
  run('allFailShortTtlMs 默认 30 秒', () => {
    assert.strictEqual(c.CONFIG_UNIT_CONFIG.allFailShortTtlMs.default, 0.5)
    assert.strictEqual(c.CONFIG_UNIT_CONFIG.allFailShortTtlMs.msPerUnit, 60000)
    assert.strictEqual(c.CONFIG_UNIT_CONFIG.allFailShortTtlMs.default * 60000, 30000)
  })
  run('所有预设都在上下限内且 0 只允许验真键', () => {
    for (const key of c.NUMERIC_CONFIG_KEYS) {
      const spec = c.CONFIG_UNIT_CONFIG[key]
      const lim = c.PARAM_LIMITS[key] || {}
      for (const p of spec.presets) {
        const v = p * (spec.msPerUnit || 1)
        if (v === 0) assert(c.ZERO_ALLOWED_KEYS.includes(key), `${key} 的 0 预设不可保存`)
        if (v < 0) assert.fail(`${key} 预设为负：${p}`)
        if (lim.min !== undefined) assert(v >= lim.min, `${key} 预设 ${p} 低于 min ${lim.min}`)
        if (lim.max !== undefined) assert(v <= lim.max, `${key} 预设 ${p} 高于 max ${lim.max}`)
      }
    }
  })
  run('已移除 raceBatchStaggerMs=0 与 allFailShortTtlMs=15 预设', () => {
    assert(!c.CONFIG_UNIT_CONFIG.raceBatchStaggerMs.presets.includes(0))
    assert(!c.CONFIG_UNIT_CONFIG.allFailShortTtlMs.presets.includes(15))
  })
})

section('status', () => {
  const h = loadTs('src/core/healthStatus.ts')
  const base = {
    enabled: true,
    sleeping: false,
    state: 'closed',
    successRate: 0.8,
    healthScore: 5,
    reqCount: 1,
    probeCount: 0,
  }
  run('已摘除状态', () => {
    const r = h.classifyHealthMainState({ ...base, playDead: true }, true)
    assert.strictEqual(r.state, 'paused')
    assert.strictEqual(r.reason, 'PLAYBACK_FAILED')
  })
  run('限流状态', () => {
    const a = h.classifyHealthMainState({ ...base, rateLimitActive: true }, true)
    assert.strictEqual(a.state, 'degraded')
    assert.strictEqual(a.reason, 'RATE_LIMITED')
    const b = h.classifyHealthMainState({ ...base, rateLimited: true }, true)
    assert.strictEqual(b.state, 'degraded')
    assert.strictEqual(b.reason, 'RATE_LIMITED')
  })
  run('已关闭 / 休眠由 offReason 单一来源判定', () => {
    const off = h.classifyHealthMainState({ ...base, offReason: 'DEFAULT_OFF' }, true)
    assert.strictEqual(off.state, 'off')
    assert.strictEqual(off.reason, 'DEFAULT_OFF')
    const sleep = h.classifyHealthMainState({ ...base, offReason: 'SLEEPING' }, true)
    assert.strictEqual(sleep.state, 'paused')
    assert.strictEqual(sleep.reason, 'SOURCE_SLEEPING')
  })
  run('摘要按 4 主状态统计，已摘除不落入可用', () => {
    const s = h.buildHealthSummary([
      { ...base, playDead: true },
      { ...base, rateLimitActive: true },
      base,
      { ...base, offReason: 'DEFAULT_OFF' },
    ])
    assert.strictEqual(s.paused, 1)
    assert.strictEqual(s.degraded, 1)
    assert.strictEqual(s.available, 1)
    assert.strictEqual(s.off, 1)
    assert.strictEqual(s.paused + s.degraded + s.available + s.off, 4)
  })
})

section('validation', () => {
  const c = CFG()
  const makeData = () => {
    const data = {}
    for (const key of c.NUMERIC_CONFIG_KEYS) {
      const spec = c.CONFIG_UNIT_CONFIG[key]
      data[key] = spec.default * (spec.msPerUnit || 1)
    }
    for (const key of c.BOOL_CONFIG_KEYS) data[key] = c.BOOL_CONFIG_DEFAULT[key]
    return data
  }
  const makeInputs = () => {
    const inputs = {}
    for (const key of c.NUMERIC_CONFIG_KEYS) inputs[key] = String(c.CONFIG_UNIT_CONFIG[key].default)
    return inputs
  }
  run('全部合法时 37 项更新 0 错误', () => {
    const r = c.buildConfigUpdates(makeData(), makeInputs(), { ...c.BOOL_CONFIG_DEFAULT })
    assert.strictEqual(Object.keys(r.updates).length, 37)
    assert.strictEqual(Object.keys(r.errors).length, 0)
  })
  run('超上限报 above-max 且整次不提交', () => {
    const r = c.buildConfigUpdates(makeData(), { ...makeInputs(), allFailShortTtlMs: '15' }, { ...c.BOOL_CONFIG_DEFAULT })
    assert.strictEqual(r.errors.allFailShortTtlMs, 'above-max')
    assert.strictEqual(Object.keys(r.updates).length, 0)
  })
  run('非法 0 报 zero-not-allowed', () => {
    const r = c.buildConfigUpdates(makeData(), { ...makeInputs(), raceBatchStaggerMs: '0' }, { ...c.BOOL_CONFIG_DEFAULT })
    assert.strictEqual(r.errors.raceBatchStaggerMs, 'zero-not-allowed')
    assert.strictEqual(Object.keys(r.updates).length, 0)
  })
  run('空值报 empty', () => {
    const r = c.buildConfigUpdates(makeData(), { ...makeInputs(), cacheTtlMs: '' }, { ...c.BOOL_CONFIG_DEFAULT })
    assert.strictEqual(r.errors.cacheTtlMs, 'empty')
  })
  run('验真比例 0 合法', () => {
    const r = c.buildConfigUpdates(makeData(), { ...makeInputs(), verifyDurRatio: '0' }, { ...c.BOOL_CONFIG_DEFAULT })
    assert.strictEqual(r.errors.verifyDurRatio, undefined)
    assert.strictEqual(r.updates.verifyDurRatio, 0)
  })
  run('布尔非布尔值被拒', () => {
    const r = c.buildConfigUpdates(makeData(), makeInputs(), { ...c.BOOL_CONFIG_DEFAULT, verifyDelivery: 'false' })
    assert.strictEqual(r.errors.verifyDelivery, 'not-boolean')
  })
})

section('init', () => {
  const src = read('src/core/init/index.ts')
  run('启动注入不再维护旧白名单', () => {
    assert(!src.includes('raceOverallTimeoutMs'), '仍含死键 raceOverallTimeoutMs')
    assert(!src.includes('const ALLOWED_KEYS = ['), '仍维护旧 ALLOWED_KEYS')
    assert(src.includes('filterConfigForInjection'), '未改用 filterConfigForInjection')
  })
})

section('i18n', () => {
  const health = read('src/screens/Home/Views/Setting/settings/Health.tsx')
  run('Health.tsx 不再硬编码三种状态', () => {
    assert(!health.includes("'已摘除'"), '仍硬编码已摘除')
    assert(!health.includes("'限流中'"), '仍硬编码限流中')
    assert(!health.includes("'被限流'"), '仍硬编码被限流')
  })
  run('Health.tsx 不再硬编码弹窗标题/按钮', () => {
    assert(!health.includes('音源配置（运行参数）'), '仍硬编码配置弹窗标题')
    assert(!health.includes('健康趋势（最近'), '仍硬编码趋势弹窗标题')
    assert(!health.includes('>恢复默认<'), '仍硬编码恢复默认')
    assert(!health.includes('>暂无历史数据'), '仍硬编码趋势空态')
  })
  run('三语言 health_* 键集合一致且含新键', () => {
    const langs = ['zh-cn', 'zh-tw', 'en-us']
    const sets = langs.map(l => {
      const d = JSON.parse(read(`src/lang/${l}.json`))
      return new Set(Object.keys(d).filter(k => k.startsWith('health_')))
    })
    for (let i = 1; i < sets.length; i++) {
      for (const k of sets[0]) assert(sets[i].has(k), `${langs[i]} 缺 ${k}`)
      for (const k of sets[i]) assert(sets[0].has(k), `zh-cn 缺 ${k}`)
    }
    for (const k of ['health_main_available', 'health_main_degraded', 'health_main_paused', 'health_main_off']) assert(sets[0].has(k), `缺 ${k}`)
  })
  run('37 个配置名/说明/8 个单位三语言齐全', () => {
    const c = CFG()
    const langs = ['zh-cn', 'zh-tw', 'en-us']
    const ds = langs.map(l => JSON.parse(read(`src/lang/${l}.json`)))
    const keySet = new Set(c.SOURCE_CONFIG_KEYS)
    const unitKeys = new Set(Object.values(c.CONFIG_UNIT_CONFIG).map(v => v.unit))
    for (const d of ds) {
      for (const k of keySet) {
        assert(d[`health_cfg_label_${k}`], `缺配置名 key: health_cfg_label_${k}`)
        assert(d[`health_cfg_desc_${k}`], `缺说明 key: health_cfg_desc_${k}`)
      }
      for (const u of unitKeys) assert(d[u], `缺单位 key: ${u}`)
    }
  })
})

console.log(`\n结果：${checks} 通过 / ${failures} 失败${ONLY ? `（section=${ONLY}）` : ''}`)
process.exit(failures ? 1 : 0)
