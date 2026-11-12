#!/usr/bin/env node
/**
 * P2 桥媒体传输：App 侧 base64 信封
 *
 * P2-A1 1MiB 信封体积 < 1.6x 且不含 Buffer 对象形状
 * P2-A2 64B 单体内联，SHA 一致
 * P2-A3 8MiB 分片 32 片，拼接 SHA 一致
 * P2-A4 0 字节保留零长语义
 * P2-A5/A6 能力协商与实际接线
 *
 * 用法：node20 scripts/check_media_body.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, require, mod, file, path.dirname(file))
  return mod.exports
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const decode = (base64) => Buffer.from(base64, 'base64')

let failures = 0
let checks = 0
const run = (name, fn) => {
  try { fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.message ? e.message : e}`)
  }
}
const SECTION = (name) => console.log(`\n[${name}]`)
const MEDIA = () => loadTs('src/core/init/userApi/mediaBody.ts')

SECTION('envelope')
run('P2-A1 1MiB 信封体积 < 1.6x 且无 Buffer 对象形状', () => {
  const { encodeMediaBody, MEDIA_CHUNK_BYTES } = MEDIA()
  assert.strictEqual(MEDIA_CHUNK_BYTES, 262_144)
  const raw = crypto.randomBytes(1024 * 1024)
  const envelope = encodeMediaBody(new Uint8Array(raw))
  const json = JSON.stringify(envelope)
  assert.ok(envelope.__lxMedia === 2, `__lxMedia=${envelope.__lxMedia}`)
  assert.strictEqual(envelope.encoding, 'base64')
  assert.strictEqual(envelope.byteLength, raw.length)
  assert.ok(!json.includes('"type":"Buffer"'), '信封仍含 Buffer 对象形状')
  assert.ok(Buffer.byteLength(json) < raw.length * 1.6, `体积 ${Buffer.byteLength(json)} 超过 1.6x`)
  assert.ok(envelope.chunks.length > 1, '1MiB 应分片')
})

run('P2-A2 64B 单体内联且 SHA 一致', () => {
  const { encodeMediaBody } = MEDIA()
  const raw = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(0), Buffer.alloc(60, 7)])
  const envelope = encodeMediaBody(new Uint8Array(raw))
  assert.strictEqual(envelope.byteLength, 64)
  assert.strictEqual(typeof envelope.body, 'string')
  assert.ok(!envelope.chunks, '64B 不应分片')
  assert.strictEqual(sha(decode(envelope.body)), sha(raw))
})

run('P2-A3 8MiB 分片 32 片且拼接 SHA 一致', () => {
  const { encodeMediaBody } = MEDIA()
  const raw = crypto.randomBytes(8 * 1024 * 1024)
  const envelope = encodeMediaBody(new Uint8Array(raw))
  assert.strictEqual(envelope.byteLength, raw.length)
  assert.strictEqual(envelope.chunks.length, 32, `分片数 ${envelope.chunks.length}`)
  assert.ok(!envelope.body, '分片模式不应再带 body')
  assert.strictEqual(sha(Buffer.concat(envelope.chunks.map(decode))), sha(raw))
})

run('P2-A4 0 字节保留零长语义', () => {
  const { encodeMediaBody } = MEDIA()
  const envelope = encodeMediaBody(new Uint8Array(0))
  assert.strictEqual(envelope.__lxMedia, 2)
  assert.strictEqual(envelope.byteLength, 0)
  assert.ok(!envelope.body, '空体不应带 body')
  assert.ok(!envelope.chunks, '空体不应带 chunks')
  assert.strictEqual(decode(envelope.body || '').length, 0)
})

SECTION('wiring')
run('P2-A5 request.js binary 分支按能力使用信封', () => {
  const source = read('src/core/init/userApi/request.js')
  assert.ok(source.includes('encodeMediaBody'), 'request.js 未引入 encodeMediaBody')
  assert.ok(source.includes('mediaEnvelope ? encodeMediaBody(buffer) : buffer'), 'binary 分支未按 mediaEnvelope 分流')
})

run('P2-A6 能力协商链路：inited 声明 → App 记录 → 请求带 sourceId', () => {
  const preload = read('android/app/src/main/assets/script/user-api-preload.js')
  assert.ok(preload.includes('sourceId: id'), 'preload request 未带 sourceId')
  const index = read('src/core/init/userApi/index.ts')
  assert.ok(index.includes('global.lx.mediaEnvelopes[info.id] = info.mediaEnvelope === 2'), 'App 未记录脚本媒体能力')
  assert.ok(index.includes('event.data.sourceId'), 'App 未把 sourceId 传给 sendScriptRequest')
  const type = read('src/types/user_api.d.ts')
  assert.ok(type.includes('mediaEnvelope?: number'), 'UserApiInfo 缺 mediaEnvelope 能力字段')
})

console.log(`\n===== 桥媒体信封审计：${checks} 通过 / ${failures} 失败 =====`)
process.exit(failures ? 1 : 0)
