#!/usr/bin/env node
/**
 * 音源健康本地诊断闭环（2.4 方案）契约检查。
 *
 * 用法：
 *   node scripts/check_health_diagnostics.js
 *
 * 说明：
 *   - 直接转译生产 TS 模块执行纯函数，不复制实现、不 mock；
 *   - 覆盖 H4~H9：traceId 透传、本地事件落盘、聚合/异常/报告/证据包、隐私边界；
 *   - 任一条失败退出码 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let ts;
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'));
} catch (e) {
  ts = require('typescript');
}

const loadTs = (rel) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${rel}`);
  const source = fs.readFileSync(file, 'utf-8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output);
  fn(mod.exports, require, mod, file, path.dirname(file));
  return mod.exports;
};

const read = rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`缺少文件：${rel}`);
  return fs.readFileSync(file, 'utf-8');
};

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failures.push(`${name} — ${e && e.message}`);
    console.log(`✗ ${name} — ${e && e.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const NOW = new Date('2026-11-11T12:00:00+08:00').getTime();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const result = (traceId, sourceId, ok, code, latencyMs, ts) => ({
  traceId, event: 'source_result', sourceId, platform: 'kw', quality: '128k', ok, code, latencyMs, ts,
});

const events = [
  { traceId: 't-ok', event: 'play_start', platform: 'kw', quality: '128k', ts: NOW - 10 * MIN },
  { traceId: 't-ok', event: 'source_attempt', sourceId: 'suyinKuwo', platform: 'kw', quality: '128k', ts: NOW - 9 * MIN },
  result('t-ok', 'suyinKuwo', true, '', 300, NOW - 8 * MIN),
  result('t-fail', 'suyinKuwo', false, 'SERVER_ERROR', 900, NOW - 20 * MIN),
  result('t-new', 'suyinKuwo', false, 'NEW_CODE', 2000, NOW - 30 * MIN),
  // 本地 0% 但快照健康
  result('t-dead1', 'deadLocal', false, 'NETWORK_ERROR', 100, NOW - 2 * HOUR),
  result('t-dead2', 'deadLocal', false, 'NETWORK_ERROR', 120, NOW - 3 * HOUR),
  result('t-dead3', 'deadLocal', false, 'NETWORK_ERROR', 140, NOW - 4 * HOUR),
  // 成功率跌 20pp：前 24h 全成，近 24h 全败
  result('t-drop-old1', 'dropSrc', true, '', 100, NOW - 30 * HOUR),
  result('t-drop-old2', 'dropSrc', true, '', 100, NOW - 31 * HOUR),
  result('t-drop-old3', 'dropSrc', true, '', 100, NOW - 32 * HOUR),
  result('t-drop-old4', 'dropSrc', true, '', 100, NOW - 33 * HOUR),
  result('t-drop-old5', 'dropSrc', true, '', 100, NOW - 34 * HOUR),
  result('t-drop-new1', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 2 * HOUR),
  result('t-drop-new2', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 3 * HOUR),
  result('t-drop-new3', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 4 * HOUR),
  result('t-drop-new4', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 5 * HOUR),
  result('t-drop-new5', 'dropSrc', false, 'SERVER_ERROR', 100, NOW - 6 * HOUR),
  // P95 翻倍：旧 100ms，新 2000ms
  result('t-spike-old1', 'spikeSrc', true, '', 100, NOW - 30 * HOUR),
  result('t-spike-old2', 'spikeSrc', true, '', 100, NOW - 31 * HOUR),
  result('t-spike-old3', 'spikeSrc', true, '', 100, NOW - 32 * HOUR),
  result('t-spike-old4', 'spikeSrc', true, '', 100, NOW - 33 * HOUR),
  result('t-spike-old5', 'spikeSrc', true, '', 100, NOW - 34 * HOUR),
  result('t-spike-new1', 'spikeSrc', true, '', 2000, NOW - 2 * HOUR),
  result('t-spike-new2', 'spikeSrc', true, '', 2000, NOW - 3 * HOUR),
  result('t-spike-new3', 'spikeSrc', true, '', 2000, NOW - 4 * HOUR),
  result('t-spike-new4', 'spikeSrc', true, '', 2000, NOW - 5 * HOUR),
  result('t-spike-new5', 'spikeSrc', true, '', 2000, NOW - 6 * HOUR),
];
const snapshot = {
  suyinKuwo: { name: '溯音酷我', successRate: 0.8, healthScore: 5.0 },
  deadLocal: { name: '本地零成功源', successRate: 0.8, healthScore: 4.0 },
  dropSrc: { name: '跌 20pp 源', successRate: 0.4, healthScore: 1.0 },
  spikeSrc: { name: 'P95 翻倍源', successRate: 0.8, healthScore: 4.0 },
};

let diag = null;
let healthLog = null;
try { diag = loadTs('src/core/healthDiagnostics.ts'); } catch (e) { console.log(`✗ 加载 healthDiagnostics.ts — ${e.message}`); }
try { healthLog = loadTs('src/core/healthLog.ts'); } catch (e) { console.log(`✗ 加载 healthLog.ts — ${e.message}`); }
if (diag) passed++;
else failures.push('加载 healthDiagnostics.ts');
if (healthLog) passed++;
else failures.push('加载 healthLog.ts');

if (diag) {
  check('H7 聚合 1h/24h/7d 成功率与 P95', () => {
    const agg = diag.aggregateHealthEvents(events, NOW);
    assert(agg && agg.windows, '缺少 windows');
    assert(agg.windows.h1.total === 3, `1h total 应为 3，实际 ${agg.windows.h1 && agg.windows.h1.total}`);
    assert(Math.abs(agg.windows.h1.successRate - 1 / 3) < 0.02, `1h 成功率应约 33%，实际 ${agg.windows.h1.successRate}`);
    assert(agg.windows.h1.p95 === 2000, `1h P95 应为 2000，实际 ${agg.windows.h1.p95}`);
    assert(agg.windows.d7.total === events.filter(e => e.event === 'source_result' || e.event === 'play_result').length, '7d 样本数不符');
  });

  check('H7 Top 错误码', () => {
    const agg = diag.aggregateHealthEvents(events, NOW);
    assert(Array.isArray(agg.topCodes) && agg.topCodes.length >= 2, '缺少 topCodes');
    const codes = agg.topCodes.map(x => x.code);
    assert(codes.includes('SERVER_ERROR'), 'Top 码缺 SERVER_ERROR');
    assert(codes.includes('NEW_CODE'), 'Top 码缺 NEW_CODE');
  });

  check('H7 异常规则：本地 0% 快照健康', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW });
    assert(findings.some(f => f.id === 'local_zero_snapshot_healthy'), '未识别本地 0% 但快照健康');
    assert(findings.some(f => (f.traceIds || []).includes('t-dead1')), '本地 0% 异常缺 traceId 证据');
  });

  check('H7 异常规则：成功率跌 20pp', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW });
    assert(findings.some(f => f.id === 'rate_drop'), '未识别成功率跌 20pp');
  });

  check('H7 异常规则：P95 翻倍', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW });
    assert(findings.some(f => f.id === 'p95_spike'), '未识别 P95 翻倍');
  });

  check('H7 异常规则：新错误码', () => {
    const findings = diag.detectHealthAnomalies({ events, snapshot, now: NOW });
    assert(findings.some(f => f.id === 'new_code' && f.evidence.includes('NEW_CODE')), '未识别新错误码');
  });

  check('H8 报告含结论/证据/建议/traceId', () => {
    const report = diag.buildHealthReport({ events, snapshot, now: NOW });
    assert(typeof report.summary === 'string' && report.summary.length > 0, '报告缺 summary');
    assert(Array.isArray(report.findings) && report.findings.length >= 4, '报告 findings 不足');
    const f = report.findings.find(x => x.id === 'rate_drop');
    assert(f && f.evidence && f.suggestion, '异常缺 evidence/suggestion');
    assert(Array.isArray(report.traceIds) && report.traceIds.length > 0, '报告缺 traceIds');
    assert(report.traceIds.includes('t-drop-new1'), '报告 traceIds 未包含失败链');
  });

  check('H8 证据包 5 个载荷键', () => {
    const report = diag.buildHealthReport({ events, snapshot, now: NOW });
    const pkg = diag.buildEvidencePackage({ report, events, snapshot, trend: [], logTail: 'tail' });
    assert(pkg.schema === 1, 'schema 应为 1');
    for (const k of ['report', 'events', 'snapshot', 'trend', 'logTail']) assert(k in pkg, `证据包缺 ${k}`);
    assert(pkg.events.length === events.length, '证据包事件数不符');
  });

  check('H3 脱敏：URL 与歌名不落证据', () => {
    const out = diag.redactDiagnosticText('u=https://secret.test/a?b=1 歌=SECRET_SONG 源=kw');
    assert(!out.includes('secret.test'), `URL 未脱敏：${out}`);
    assert(!out.includes('SECRET_SONG'), `歌名未脱敏：${out}`);
    assert(out.includes('源=kw'), '非敏感字段被误删');
  });
}

if (healthLog) {
  check('H6 按天文件名', () => {
    const d = new Date(2026, 10, 11, 12, 0, 0);
    assert(healthLog.healthFileName(d) === 'source_health_20261111.jsonl', `实际 ${healthLog.healthFileName(d)}`);
  });

  check('H5 成功 1/20 采样', () => {
    assert(healthLog.shouldSampleSuccess(() => 0.01) === true, '0.01 应采样');
    assert(healthLog.shouldSampleSuccess(() => 0.06) === false, '0.06 不应采样');
    assert(healthLog.shouldSampleSuccess(() => 0.999) === false, '0.999 不应采样');
  });

  check('H6 2MB 封顶保留尾部并落在行边界', () => {
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(20) }));
    const text = lines.join('\n') + '\n';
    const out = healthLog.trimJsonlTail(text, 100);
    assert(out.length <= 100, `超长：${out.length}`);
    const first = out.split('\n')[0];
    assert(first.startsWith('{') && first.endsWith('}'), '输出未从完整 JSON 行开始');
    assert(out.trim().split('\n').every(l => { try { JSON.parse(l); return true } catch { return false } }), '输出含残行');
  });

  check('H6 7 天清理判定', () => {
    assert(healthLog.isExpiredHealthFileName('source_health_20261101.jsonl', '20261111', 7) === true, '10 天前应清理');
    assert(healthLog.isExpiredHealthFileName('source_health_20261105.jsonl', '20261111', 7) === false, '6 天前不应清理');
  });

  check('H5 播放结果条目无歌名/URL', () => {
    const entry = healthLog.buildPlayResultEntry({
      traceId: 't-x', platform: 'kw', quality: '128k', ok: false, code: 'SERVER_ERROR', latencyMs: 12,
    });
    assert(entry.event === 'play_result', 'event 应为 play_result');
    assert(entry.traceId === 't-x' && entry.ok === false && entry.code === 'SERVER_ERROR', '字段不符');
    assert(!('name' in entry) && !('url' in entry), '条目不得含歌名/URL');
  });

  check('H8 诊断包文件名', () => {
    const d = new Date(2026, 10, 11, 12, 0, 0);
    assert(/^source_health_diag_20261111_120000\.json$/.test(healthLog.buildExportFileName(d)), `实际 ${healthLog.buildExportFileName(d)}`);
  });
}

check('H4 traceId 透传：online → utils → userApi → 5 平台', () => {
  const files = [
    'src/core/music/online.ts',
    'src/core/music/utils.ts',
    'src/core/init/userApi/index.ts',
    'src/utils/musicSdk/kw/index.js',
    'src/utils/musicSdk/kg/index.js',
    'src/utils/musicSdk/tx/index.js',
    'src/utils/musicSdk/wy/index.js',
    'src/utils/musicSdk/mg/index.js',
  ];
  for (const f of files) assert(read(f).includes('traceId'), `${f} 未透传 traceId`);
});

check('H4/H8 user_api action 联合类型含 healthEvents', () => {
  assert(read('src/types/user_api.d.ts').includes('healthEvents'), 'user_api.d.ts 未声明 healthEvents');
});

check('H9 新模块无任何上传通道', () => {
  for (const f of ['src/core/healthDiagnostics.ts', 'src/core/healthLog.ts']) {
    const src = read(f);
    for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'axios', 'http://', 'https://']) {
      assert(!src.includes(bad), `${f} 含上传通道 ${bad}`);
    }
  }
});

check('H8 健康页接入最近异常 + 导出诊断包', () => {
  const src = read('src/screens/Home/Views/Setting/settings/Health.tsx');
  assert(src.includes('health_recent_anomaly'), '健康页缺最近异常文案键');
  assert(src.includes('health_export_diag') || src.includes('exportDiagnostics'), '健康页缺导出诊断包入口');
});

console.log(`\n===== 健康诊断契约汇总：${passed} 通过 / ${failures.length} 失败 =====`);
if (failures.length) {
  console.log('失败项：');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
