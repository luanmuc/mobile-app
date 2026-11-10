#!/usr/bin/env node
/**
 * 2.4 方案 · App 本地诊断压力测试。
 *
 * 覆盖：
 *   U1 10000 条事件聚合吞吐与窗口总数
 *   U2 5MB 日志截尾后 ≤2MB 且落在完整行
 *   U3 7 天滚动边界
 *   U4 脏日志行容错
 *   U5 运行时依赖缺失不抛（诊断不阻断主流程）
 *   U6 200 个错误码时 findings 仍 ≤12
 *   U7 证据包 5 键与脱敏
 *   U8 traceId 格式与唯一性
 *   U9 成功 1/20 采样边界
 *   U10 播放结果条目不含歌名/URL
 *
 * 运行：node scripts/check_health_diagnostics_stress.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let ts;
try { ts = require(path.resolve(ROOT, 'node_modules', 'typescript')) } catch { ts = require('typescript') }

const loadTs = (rel) => {
  const file = path.join(ROOT, rel);
  const source = fs.readFileSync(file, 'utf-8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output);
  fn(mod.exports, require, mod, file, path.dirname(file));
  return mod.exports;
};

const log = loadTs('src/core/healthLog.ts');
const diag = loadTs('src/core/healthDiagnostics.ts');

const res = [];
const rec = (id, name, ok, detail) => {
  res.push({ id, ok: !!ok, name, detail: String(detail || '') });
  console.log(`${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
};

const NOW = new Date('2026-11-11T12:00:00+08:00').getTime();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

(async () => {
  // U1
  const events = [];
  for (let i = 0; i < 10000; i++) {
    events.push({
      ts: NOW - (i % (7 * DAY)),
      traceId: `trace-${i % 1000}`,
      event: 'source_result',
      sourceId: `s-${i % 5}`,
      platform: 'kw',
      quality: '128k',
      ok: i % 4 !== 0,
      code: i % 4 === 0 ? `E${i % 200}` : '',
      latencyMs: 100 + (i % 900),
    });
  }
  const t0 = Date.now();
  const agg = diag.aggregateHealthEvents(events, NOW);
  const ms = Date.now() - t0;
  rec('U1', '10000 条聚合 ≤800ms', ms <= 800, `${ms}ms`);
  rec('U1', '三窗口各自 total=10000 且 h1≤h24≤d7', agg.windows.h1.total === 10000 && agg.windows.h24.total === 10000 && agg.windows.d7.total === 10000 && agg.windows.h1.total <= agg.windows.h24.total && agg.windows.h24.total <= agg.windows.d7.total, `${agg.windows.h1.total}/${agg.windows.h24.total}/${agg.windows.d7.total}`);

  // U2
  const bigLines = Array.from({ length: 120000 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(30) }));
  const bigText = bigLines.join('\n') + '\n';
  const trimmed = log.trimJsonlTail(bigText, log.HEALTH_FILE_MAX_BYTES);
  const lines = trimmed.split('\n').filter(Boolean);
  rec('U2', '5MB 截尾 ≤2MB 且首尾完整', Buffer.byteLength(trimmed, 'utf8') <= log.HEALTH_FILE_MAX_BYTES && lines.length > 0 && lines[0].startsWith('{') && lines[0].endsWith('}') && lines[lines.length - 1].endsWith('}'), `bytes=${Buffer.byteLength(trimmed)} lines=${lines.length}`);

  // U3
  rec('U3', '7 天边界（8 天前删、7 天前留）', log.isExpiredHealthFileName('source_health_20261103.jsonl', '20261111') === true && log.isExpiredHealthFileName('source_health_20261104.jsonl', '20261111') === false, '20261103 删 / 20261104 留');

  // U4
  const dirty = '{"event":"play_result","ts":1}\nnot-json\n\n{"event":"source_result","ts":2}\n{"event":';
  const parsed = log.parseHealthLines(dirty);
  rec('U4', '脏日志跳过坏行且保留合法行', parsed.length === 2 && parsed.every(x => typeof x.event === 'string'), `parsed=${parsed.length}`);

  // U5
  let runtimeNoThrow = true;
  try {
    const a = await log.readRecentHealthEvents(800, new Date(NOW));
    const b = await log.appendHealthEvent({ ts: NOW, event: 'play_result', ok: false, code: 'X' });
    const c = await log.exportDiagnostics({ ping: true }, new Date(NOW));
    if (!Array.isArray(a) || b !== null || c !== null) runtimeNoThrow = false;
  } catch (e) {
    runtimeNoThrow = false;
  }
  rec('U5', 'RN 依赖缺失时运行时函数返回空/失败不抛', runtimeNoThrow, 'read/append/export');

  // U6
  const badEvents = Array.from({ length: 200 }, (_, i) => ({
    ts: NOW - MIN, traceId: `bad-${i}`, event: 'source_result', sourceId: 's', platform: 'kw', ok: false, code: `CODE_${i}`, latencyMs: 1,
  }));
  const report = diag.buildHealthReport({ events: badEvents, now: NOW });
  rec('U6', '200 个错误码 findings ≤12', report.findings.length <= 12, `findings=${report.findings.length}`);

  // U7
  const pkg = diag.buildEvidencePackage({
    report,
    events: badEvents.slice(0, 800),
    snapshot: { s: { score: 1 } },
    trend: [{ timestamp: NOW, sources: {} }],
    logTail: 'https://secret.example/a.mp3 歌=秘密歌曲 singer=张三 搜索词=秘密',
  });
  const keys = ['schema', 'generatedAt', 'report', 'events', 'snapshot', 'trend', 'logTail'].filter(k => k in pkg);
  rec('U7', '证据包含 report/events/snapshot/trend/logTail', ['report', 'events', 'snapshot', 'trend', 'logTail'].every(k => k in pkg), `keys=${keys.join(',')}`);
  rec('U7', '日志尾部 URL/歌名/搜索词已脱敏', !/https?:\/\//.test(pkg.logTail) && !pkg.logTail.includes('秘密歌曲') && !pkg.logTail.includes('张三') && !pkg.logTail.includes('秘密'), pkg.logTail);

  // U8
  const ids = new Set();
  let formatOk = true;
  for (let i = 0; i < 1000; i++) {
    const id = log.createHealthTraceId();
    if (!/^app_[a-z0-9]+_[a-z0-9]{1,6}$/.test(id)) formatOk = false;
    ids.add(id);
  }
  rec('U8', '1000 个 traceId 唯一且格式正确', formatOk && ids.size === 1000, `unique=${ids.size}`);

  // U9
  rec('U9', '成功采样边界 0.049→采 / 0.05→不采', log.shouldSampleSuccess(() => 0.049) === true && log.shouldSampleSuccess(() => 0.05) === false, 'floor(r*20)===0');

  // U10
  const entry = log.buildPlayResultEntry({ traceId: 't', platform: 'kw', quality: '128k', ok: true, latencyMs: 12 });
  rec('U10', '播放结果条目无歌名/URL', !('name' in entry) && !('url' in entry) && entry.event === 'play_result', JSON.stringify(entry));

  const failed = res.filter(x => !x.ok);
  console.log(`\n===== App 诊断压力汇总：${res.length - failed.length} 通过 / ${failed.length} 失败 =====`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - [${f.id}] ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => {
  console.error('App 压力脚本自身异常：', e);
  process.exit(1);
});
