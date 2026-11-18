#!/usr/bin/env node
/**
 * 音源包验签运行时检查（v9.3-b）
 *
 * 真实跨实现验证：用 Node 内置 crypto 的 ed25519 签名，交给 App 侧 @noble/ed25519 验签。
 * 这证明「源仓签名 / App 验签」两端算法一致——不是各自单测自说自话。
 *
 * v9.3-b 修复（CI 红）：@noble/ed25519 v2 是纯 ESM，原先用 tsc 编译成 CJS 再 require()，
 * 在 Node 22 下靠 require(ESM) 侥幸通过，在 CI 的 Node 18/20 下必报 ERR_REQUIRE_ESM。
 * 现改为编译成 ESM（产物改写为 .mjs）再用动态 import() 加载——Node 18~22 全兼容，
 * 且不必抬高 CI 的 Node 版本（Android 构建仍需 RN 0.73 的 Node 18 基线）。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src/core/sourceUpdate/verify.ts')

function compile() {
  // 必须编译到仓库内的 node_modules 下：编译产物要能解析 @noble/*（/tmp 里找不到）
  const base = path.join(ROOT, 'node_modules', '.tmp-verify')
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const out = base
  // esnext + es2022：保留 `import '@noble/ed25519'` 为 ESM 语句，由 Node 原生 ESM 解析
  execFileSync('npx', ['tsc', SRC, '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--outDir', out],
  { cwd: ROOT, stdio: 'pipe' })
  // tsc 不会改扩展名：CJS 包里 .js 仍按 CommonJS 解析，必须改名 .mjs 才按 ESM 加载
  const js = path.join(out, 'verify.js')
  const mjs = path.join(out, 'verify.mjs')
  fs.renameSync(js, mjs)
  return mjs
}

let pass = 0
let fail = 0
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`✗ ${name} — ${e.message}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.log('✗ 缺少 verify.ts')
    process.exit(1)
  }
  const mod = await import(pathToFileURL(compile()).href)

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  mod.SOURCE_PUBLIC_KEYS.push({ keyId: 'tk1', spkiB64 })

  const payload = Buffer.from('// @name 测试音源\n// @version 8.16.4\nmodule.exports = {}')
  const sigB64 = crypto.sign(null, payload, privateKey).toString('base64')
  // 用独立 keyId：内置表里已有真实 k1，复用会命中真公钥导致假红

  check('V1 合法签名通过', () => {
    const r = mod.verifySourcePayload(new Uint8Array(payload), sigB64, 'tk1')
    assert(r.ok === true, `期望 ok，实际 ${JSON.stringify(r)}`)
  })

  check('V2 篡改 payload 被拒', () => {
    const tampered = Buffer.concat([payload, Buffer.from('\n// injected')])
    const r = mod.verifySourcePayload(new Uint8Array(tampered), sigB64, 'tk1')
    assert(r.ok === false && r.reason === 'SIGNATURE_MISMATCH', `期望 SIGNATURE_MISMATCH，实际 ${JSON.stringify(r)}`)
  })

  check('V3 未知 keyId 被拒', () => {
    const r = mod.verifySourcePayload(new Uint8Array(payload), sigB64, 'k9')
    assert(r.ok === false && r.reason === 'UNKNOWN_KEY_ID', `实际 ${JSON.stringify(r)}`)
  })

  check('V4 非法签名长度被拒', () => {
    const r = mod.verifySourcePayload(new Uint8Array(payload), 'AAAA', 'tk1')
    assert(r.ok === false && r.reason === 'BAD_SIG_LENGTH', `实际 ${JSON.stringify(r)}`)
  })

  check('V5 换密钥后旧签名失效', () => {
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    mod.SOURCE_PUBLIC_KEYS.push({ keyId: 'k2', spkiB64: other })
    const r = mod.verifySourcePayload(new Uint8Array(payload), sigB64, 'k2')
    assert(r.ok === false, '换公钥后旧签名必须失败')
  })

  check('V6 base64 解码器与 Buffer 一致', () => {
    const buf = crypto.randomBytes(37)
    const a = Buffer.from(mod.decodeBase64(buf.toString('base64')))
    assert(a.equals(buf), 'decodeBase64 结果与 Buffer 不一致')
  })

  console.log(`\n验签运行时检查：${pass} 通过 / ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log(`✗ 加载失败 — ${e.message}`)
  process.exit(1)
})
