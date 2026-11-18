#!/usr/bin/env node
/**
 * 在线更新落地检查（v9.3-d）
 *
 * 核心要证明的一件事：**未验签 / 校验失败 / 版本不合格的包，一次都不会写到音源库**。
 * 所以这里给 overwrite/add 装了计数器——断言不是「结果对不对」，而是「有没有被调用」。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
// A13-P1-03：路径可覆盖，便于 CI 把源仓 clone 到任意位置（默认仍是 ../lx-music-source）。
const SOURCE_ROOT = process.env.LX_SOURCE_ROOT
  ? path.resolve(process.env.LX_SOURCE_ROOT)
  : path.join(ROOT, '..', 'lx-music-source')
const SRC = path.join(ROOT, 'src/core/sourceUpdate/apply.ts')

if (!fs.existsSync(SOURCE_ROOT)) {
  // A13-P1-03：同上 —— 缺失即跳过等于让「安装/应用更新」的跨仓断言永远不执行。
  if (process.env.LX_REQUIRE_SOURCE === '1') {
    console.error('✗ 跨仓断言不允许跳过：LX_REQUIRE_SOURCE=1 但未找到源仓')
    console.error('  已查找：' + SOURCE_ROOT)
    console.error('  请设 LX_SOURCE_ROOT 指向源仓（或把源仓 clone 到该位置）')
    process.exit(1)
  }
  console.log('（跳过：未检出源仓；设 LX_SOURCE_ROOT=<源仓路径> 可强制执行，CI 用 LX_REQUIRE_SOURCE=1 强制）')
  process.exit(0)
}
const realScript = path.join(SOURCE_ROOT, 'lx-source.js')
if (!fs.existsSync(realScript)) {
  console.log('✗ 源仓在但缺少产物 lx-source.js，先跑源仓 node scripts/build-source.js')
  process.exit(1)
}

const out = path.join(ROOT, 'node_modules', '.tmp-apply')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
execFileSync('npx', ['tsc', SRC, '--module', 'commonjs', '--target', 'es2019',
  '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', out],
{ cwd: ROOT, stdio: 'pipe' })

const mod = require(path.join(out, 'apply.js'))
const verifyMod = require(path.join(out, 'verify.js'))

const body = fs.readFileSync(realScript)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
verifyMod.SOURCE_PUBLIC_KEYS.push({ keyId: 'tak', spkiB64 })

const sha256hex = buf => crypto.createHash('sha256').update(buf).digest('hex')
const manifestOf = bytes => ({
  version: '8.16.4',
  size: bytes.length,
  sha256: sha256hex(bytes),
  sigAlg: 'ed25519',
  keyId: 'tak',
  sig: crypto.sign(null, bytes, privateKey).toString('base64'),
  signedAt: '2026-11-18T00:00:00Z',
})

const BASE = 'https://example.test/rel'
const URLS = { manifest: `${BASE}/lx-source.js.manifest.json`, script: `${BASE}/lx-source.js` }
const makeGet = store => async(url) => {
  const e = store[url]
  if (!e) return { status: 404, text: async() => '', bytes: async() => new Uint8Array() }
  return { status: 200, text: async() => Buffer.from(e.body).toString('utf8'), bytes: async() => new Uint8Array(e.body) }
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

const baseDeps = (store, over = {}) => {
  const calls = { overwrite: 0, add: 0 }
  return {
    calls,
    deps: {
      baseUrl: BASE,
      get: makeGet(store),
      enabled: true,
      builtinVersion: '8.15.0',
      builtinSourceId: 'builtin-id',
      overwrite: async() => {
        calls.overwrite++
      },
      add: async() => {
        calls.add++
        return { id: 'new-id' }
      },
      ...over,
    },
  }
}

const run = async() => {
  // A1 正常：就地覆盖同一 id，不新增
  {
    const m = manifestOf(body)
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store)
    const r = await mod.applySourceUpdate(deps)
    check('A1 采用远端并就地覆盖同一 id', () => {
      assert(r.action === 'overwritten', `action=${r.action} reason=${r.reason}`)
      assert(calls.overwrite === 1, `overwrite 调用 ${calls.overwrite} 次`)
      assert(calls.add === 0, `add 不应被调用，实际 ${calls.add} 次`)
      assert(r.version === '8.16.4', `version=${r.version}`)
      assert(r.sourceId === 'builtin-id', `sourceId=${r.sourceId}`)
    })
  }

  // A2 库里没有内置源：新增
  {
    const m = manifestOf(body)
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store, { builtinSourceId: null })
    const r = await mod.applySourceUpdate(deps)
    check('A2 无内置源时新增一份', () => {
      assert(r.action === 'added', `action=${r.action}`)
      assert(calls.add === 1 && calls.overwrite === 0, `add=${calls.add} overwrite=${calls.overwrite}`)
      assert(r.sourceId === 'new-id', `sourceId=${r.sourceId}`)
    })
  }

  // A3 内容被篡改：一次写入都不能发生
  {
    const tampered = Buffer.from(body)
    tampered[100] ^= 0xff
    const m = manifestOf(body)
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body: tampered },
    }
    const { calls, deps } = baseDeps(store)
    const r = await mod.applySourceUpdate(deps)
    check('A3 篡改包：零写入', () => {
      assert(r.action === 'skipped', `action=${r.action}`)
      assert(r.reason === 'SHA256_MISMATCH', `reason=${r.reason}`)
      assert(calls.overwrite === 0 && calls.add === 0, `发生了写入 overwrite=${calls.overwrite} add=${calls.add}`)
    })
  }

  // A4 假签名：零写入
  {
    const m = { ...manifestOf(body), sig: Buffer.alloc(64, 7).toString('base64') }
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store)
    const r = await mod.applySourceUpdate(deps)
    check('A4 假签名：零写入', () => {
      assert(r.action === 'skipped' && /SIG_/.test(r.reason), `action=${r.action} reason=${r.reason}`)
      assert(calls.overwrite === 0 && calls.add === 0, '发生了写入')
    })
  }

  // A5 远端版本过低：零写入
  {
    const m = { ...manifestOf(body), version: '8.10.0' }
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store)
    const r = await mod.applySourceUpdate(deps)
    check('A5 远端版本跨 minor 更低：零写入', () => {
      assert(r.action === 'skipped', `action=${r.action}`)
      assert(r.reason === 'REMOTE_OLDER', `reason=${r.reason}`)
      assert(calls.overwrite === 0 && calls.add === 0, '发生了写入')
    })
  }

  // A6 开关关闭：零请求零写入
  {
    let requests = 0
    const get = async() => {
      requests++
      return { status: 200, text: async() => '{}', bytes: async() => new Uint8Array() }
    }
    const { calls, deps } = baseDeps({}, { enabled: false, get })
    const r = await mod.applySourceUpdate(deps)
    check('A6 开关关闭：零请求零写入', () => {
      assert(r.action === 'skipped' && r.reason === 'DISABLED', `action=${r.action} reason=${r.reason}`)
      assert(requests === 0, `发了 ${requests} 次请求`)
      assert(calls.overwrite === 0 && calls.add === 0, '发生了写入')
    })
  }

  // A7 同 minor 补丁回退：允许覆盖（修坏包场景）
  {
    const m = { ...manifestOf(body), version: '8.16.2' }
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store, { builtinVersion: '8.16.4' })
    const r = await mod.applySourceUpdate(deps)
    check('A7 同 minor 补丁回退允许覆盖（SAME_FIX）', () => {
      assert(r.action === 'overwritten' && r.reason === 'SAME_FIX', `action=${r.action} reason=${r.reason}`)
      assert(calls.overwrite === 1, `overwrite=${calls.overwrite}`)
    })
  }

  // A8 同版本：零写入
  {
    const m = manifestOf(body)
    const store = {
      [URLS.manifest]: { body: Buffer.from(JSON.stringify(m)) },
      [URLS.script]: { body },
    }
    const { calls, deps } = baseDeps(store, { builtinVersion: '8.16.4' })
    const r = await mod.applySourceUpdate(deps)
    check('A8 同版本：零写入', () => {
      assert(r.action === 'skipped' && r.reason === 'SAME', `action=${r.action} reason=${r.reason}`)
      assert(calls.overwrite === 0 && calls.add === 0, '发生了写入')
    })
  }

  // R1 正常回滚：覆盖回内置包
  {
    let written = null
    const r = await mod.restoreBuiltinSource({
      readBuiltinScript: async() => 'x'.repeat(2000),
      builtinSourceId: 'builtin-id',
      overwrite: async(id, script) => {
        written = { id, len: script.length }
      },
    })
    check('R1 回滚覆盖同一 id', () => {
      assert(r.ok && r.reason === 'RESTORED', `reason=${r.reason}`)
      assert(written && written.id === 'builtin-id' && written.len === 2000, `written=${JSON.stringify(written)}`)
    })
  }

  // R2 没有内置源目标：拒绝，不凭空新增
  {
    let called = 0
    const r = await mod.restoreBuiltinSource({
      readBuiltinScript: async() => 'x'.repeat(2000),
      builtinSourceId: null,
      overwrite: async() => {
        called++
      },
    })
    check('R2 无目标时拒绝回滚（零写入）', () => {
      assert(!r.ok && r.reason === 'NO_TARGET', `reason=${r.reason}`)
      assert(called === 0, `发生了 ${called} 次写入`)
    })
  }

  // R3 内置包读不出来：拒绝
  {
    let called = 0
    const r = await mod.restoreBuiltinSource({
      readBuiltinScript: async() => {
        throw new Error('boom')
      },
      builtinSourceId: 'builtin-id',
      overwrite: async() => {
        called++
      },
    })
    check('R3 内置包读取失败：拒绝且零写入', () => {
      assert(!r.ok && r.reason === 'BUILTIN_UNREADABLE', `reason=${r.reason}`)
      assert(called === 0, '发生了写入')
    })
  }

  // R4 内置包过短（截断）：拒绝，避免写进坏包
  {
    let called = 0
    const r = await mod.restoreBuiltinSource({
      readBuiltinScript: async() => 'x'.repeat(200),
      builtinSourceId: 'builtin-id',
      overwrite: async() => {
        called++
      },
    })
    check('R4 内置包过短：拒绝且零写入', () => {
      assert(!r.ok && r.reason === 'BUILTIN_TOO_SHORT', `reason=${r.reason}`)
      assert(called === 0, '发生了写入')
    })
  }

  console.log(`\n在线更新落地检查：${pass} 通过 / ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

run().catch(e => {
  console.log(`✗ 未捕获异常：${e && e.message}`)
  process.exit(1)
})
