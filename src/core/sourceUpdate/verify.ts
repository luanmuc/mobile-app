/**
 * 音源发布包验签（v9.3-b）
 *
 * 为什么需要：Release 资产可被替换，md5 只是完整性不是真实性。ed25519 私钥在源仓 CI secret，
 * 公钥内置在 App（用户口径：公钥走 App 内置方式），keyId 预留以支持轮换。
 *
 * 依赖：@noble/ed25519（纯 JS，可跑在 RN）+ @noble/hashes/sha512。
 * noble v2 需要显式挂 sha512Sync，否则 verify 抛错。
 */
import { sha512 } from '@noble/hashes/sha512'
import * as ed from '@noble/ed25519'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

export interface SourcePublicKey {
  keyId: string
  /** SPKI DER 的 base64（源仓 sign-release.js --gen-key 打印的"公钥"原样贴入） */
  spkiB64: string
}

export interface VerifyResult {
  ok: boolean
  reason?: 'UNKNOWN_KEY_ID' | 'BAD_SIG_LENGTH' | 'BAD_PUBKEY' | 'SIGNATURE_MISMATCH' | 'VERIFY_ERROR'
}

/**
 * App 内置公钥表。轮换策略：新增 keyId 而不是替换，旧 key 至少保留一个发布周期，
 * 这样已签名的历史包在过渡期仍可验证。
 */
export const SOURCE_PUBLIC_KEYS: SourcePublicKey[] = [
  {
    keyId: 'k1',
    spkiB64: 'MCowBQYDK2VwAyEA72onGCEiDfN+SQDOEHnqkqsIyl8G/ma7tgrRJvC71dQ=',
  },
]

/** ed25519 SPKI DER 固定头长度；后 32 字节即 noble 需要的 raw 公钥 */
const SPKI_HEADER_BYTES = 12

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 纯 JS base64 解码：不依赖 atob/Buffer（RN、node、Hermes 都能跑） */
export const decodeBase64 = (input: string): Uint8Array => {
  const clean = (input || '').replace(/[\s=]+/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let bits = 0
  let acc = 0
  let idx = 0
  for (const ch of clean) {
    const v = B64_CHARS.indexOf(ch)
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[idx++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, idx)
}

const spkiToRaw = (spkiB64: string): Uint8Array | null => {
  const der = decodeBase64(spkiB64)
  if (der.length !== SPKI_HEADER_BYTES + 32) return null
  return der.subarray(SPKI_HEADER_BYTES)
}

/**
 * 验签。body 为音源文件原始字节（必须是字节，不能是解码后的字符串——
 * 文本编码/换行任何差异都会让签名对不同人算出不同结果）。
 */
export const verifySourcePayload = (
  body: Uint8Array,
  sigB64: string,
  keyId = 'k1',
): VerifyResult => {
  const entry = SOURCE_PUBLIC_KEYS.find(k => k.keyId === keyId)
  if (!entry) return { ok: false, reason: 'UNKNOWN_KEY_ID' }
  const raw = spkiToRaw(entry.spkiB64)
  if (!raw) return { ok: false, reason: 'BAD_PUBKEY' }
  const sig = decodeBase64(sigB64)
  if (sig.length !== 64) return { ok: false, reason: 'BAD_SIG_LENGTH' }
  try {
    const ok = ed.verify(sig, body, raw)
    return ok ? { ok: true } : { ok: false, reason: 'SIGNATURE_MISMATCH' }
  } catch {
    return { ok: false, reason: 'VERIFY_ERROR' }
  }
}
