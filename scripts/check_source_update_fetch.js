#!/usr/bin/env node
/**
 * 在线更新下载器端到端检查（v9.3-c）
 *
 * 用源仓**真实产物**（lx-source.js，36 万字节）+ Node crypto 真签名，走完整的
 * manifest → size → sha256 → 验签 → 版本区间链路。网络层用内存 Map 模拟，
 * 但字节流、哈希、签名全部是真的——这不是 mock 行为，是替换传输介质。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_ROOT = path.join(ROOT, '..', 'lx-music-source')
const SRC = path.join(ROOT, 'src/core/sourceUpdate/fetcher.ts')

function compile() {
  const out = path.join(ROOT, 'node_modules', '.tmp-fetch')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  execFileSync('npx', ['tsc', SRC, '--module', 'commonjs', '--target', 'es2019',
    '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', out],
  { cwd: ROOT, stdio: 'pipe' })
  return out
}

const outDir = compile()
const mod = require(path.join(outDir, 'fetcher.js'))
const verifyMod = require(path.join(outDir, 'verify.js'))

// CI 的 checks job 不 checkout 源仓（与 check_cross_repo_linkage 同口径）：整仓缺失时跳过。
// 但源仓在、产物却不在 → 说明忘了 build，必须报错而不是静默跳过。
if (!fs.existsSync(SOURCE_ROOT)) {
  console.log('（跳过：未检出源仓，CI 单仓环境不强制）')
  process.exit(0)
}
const realScript = path.join(SOURCE_ROOT, 'lx-source.js')
if (!fs.existsSync(realScript)) {
  console.log('✗ 源仓在但缺少产物 lx-source.js，先跑源仓 node scripts/build-source.js')
  process.exit(1)
}
const body = fs.readFileSync(realScript)

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
// 用独立 keyId：内置表已有真实 k1，复用会命中真公钥
verifyMod.SOURCE_PUBLIC_KEYS.push({ keyId: 'tk1', spkiB64 })

const sha256hex = buf => crypto.createHash('sha256').update(buf).digest('hex')
const makeManifest = (bytes, over = {}) => ({
  version: '8.16.4',
  size: bytes.length,
  sha256: sha256hex(bytes),
  sigAlg: 'ed25519',
  keyId: 'tk1',
  sig: crypto.sign(null, bytes, privateKey).toString('base64'),
  signedAt: '2026-11-18T00:00:00Z',
  ...over,
})

// 传输介质：内存里按 URL 取字节；可注入故障
const makeGet = store => async(url) => {
  const entry = store[url]
  if (!entry) return { status: 404, text: async() => 'not found', bytes: async() => new Uint8Array() }
  return {
    status: entry.status || 200,
    text: async() => Buffer.from(entry.body).toString('utf8'),
    bytes: async() => new Uint8Array(entry.body),
  }
}

const BASE = 'https://example.test/releases/latest/download'
const urls = {
  manifest: `${BASE}/lx-source.js.manifest.json`,
  script: `${BASE}/lx-source.js`,
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

const run = async() => {
  // F1 正常更新
  {
    const manifest = makeManifest(body)
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F1 正常远端包采用（NEWER）', () => {
      assert(r.decision.action === 'use-remote', `decision=${JSON.stringify(r.decision)} reason=${r.reason}`)
      assert(r.decision.reason === 'NEWER', `reason=${r.decision.reason}`)
      assert(r.script && r.script.length > 1000, 'script 未返回')
      assert(r.script.includes('@name'), 'script 内容不像音源包')
    })
  }

  // F2 包被篡改：size 不变但内容变 → sha256 必须拦住
  {
    // 改中间一个字节：产物末尾本身是换行，替换末尾等于没改（首版踩过）
    const tampered = Buffer.from(body)
    tampered[Math.floor(tampered.length / 2)] ^= 0xff
    const manifest = makeManifest(body) // manifest 仍记录原产物
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body: tampered },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F2 内容被替换 → SHA256_MISMATCH', () => {
      assert(r.script === null, '篡改包不应返回 script')
      assert(r.reason === 'SHA256_MISMATCH', `reason=${r.reason}`)
    })
  }

  // F3 签名被替换（sha256 一致、签名假）
  {
    const manifest = makeManifest(body, { sig: Buffer.alloc(64, 1).toString('base64') })
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F3 假签名 → SIG_SIGNATURE_MISMATCH', () => {
      assert(r.reason === 'SIG_SIGNATURE_MISMATCH', `reason=${r.reason}`)
    })
  }

  // F4 未知 keyId
  {
    const manifest = makeManifest(body, { keyId: 'k9' })
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F4 未知 keyId → SIG_UNKNOWN_KEY_ID', () => {
      assert(r.reason === 'SIG_UNKNOWN_KEY_ID', `reason=${r.reason}`)
    })
  }

  // F5 manifest 不存在
  {
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet({}),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F5 manifest 404 → MANIFEST_HTTP_404', () => {
      assert(r.reason === 'MANIFEST_HTTP_404', `reason=${r.reason}`)
    })
  }

  // F6 开关关闭：一次网络请求都不发
  {
    let calls = 0
    const get = async() => {
      calls++
      return { status: 200, text: async() => '{}', bytes: async() => new Uint8Array() }
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get,
      builtinVersion: '8.15.0',
      enabled: false,
    })
    check('F6 开关关闭 → 零请求 + DISABLED', () => {
      assert(r.reason === 'DISABLED', `reason=${r.reason}`)
      assert(calls === 0, `关闭开关仍发了 ${calls} 次请求`)
    })
  }

  // F7 同版本：验签通过但不需要更新
  {
    const manifest = makeManifest(body)
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.16.4',
      enabled: true,
    })
    check('F7 同版本 → keep-builtin/SAME 且不返回 script', () => {
      assert(r.decision.action === 'keep-builtin' && r.decision.reason === 'SAME', `decision=${JSON.stringify(r.decision)}`)
      assert(r.script === null, '同版本不应返回 script')
    })
  }

  // F8 size 与 manifest 不符（截断攻击）
  {
    const manifest = makeManifest(body)
    const store = {
      [urls.manifest]: { body: Buffer.from(JSON.stringify(manifest)) },
      [urls.script]: { body: body.subarray(0, 1000) },
    }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F8 包被截断 → SIZE_MISMATCH', () => {
      assert(/SIZE_MISMATCH/.test(r.reason || ''), `reason=${r.reason}`)
    })
  }

  // F9 manifest 不是合法 JSON
  {
    const store = { [urls.manifest]: { body: Buffer.from('<html>bad gateway</html>') } }
    const r = await mod.fetchAndVerifySource({
      baseUrl: BASE,
      get: makeGet(store),
      builtinVersion: '8.15.0',
      enabled: true,
    })
    check('F9 manifest 非 JSON → MANIFEST_INVALID', () => {
      assert(r.reason === 'MANIFEST_INVALID', `reason=${r.reason}`)
    })
  }

  console.log(`\n在线更新端到端检查：${pass} 通过 / ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

run().catch(e => {
  console.log(`✗ 未捕获异常：${e && e.message}`)
  process.exit(1)
})
