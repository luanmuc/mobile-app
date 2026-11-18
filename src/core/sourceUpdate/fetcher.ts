/**
 * 在线音源包下载与验收（v9.3-c）
 *
 * 顺序是硬性的：拉 manifest → 校验 size → 下载包 → 校验 sha256 → 验签 → 版本区间判定。
 * 任何一步失败都不继续，且返回具体 reason——线上「更新按钮点了没反应」基本都是因为
 * 判定链条上某一步静默吞了错误，所以这里每个失败分支都必须能说出原因。
 *
 * 网络层通过 `get` 注入，不在模块里直接摸 fetch：既能被单测喂本地文件，
 * 也能避免 RN/Hermes 环境下全局 fetch 的差异。
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { verifySourcePayload, type SourcePublicKey } from './verify'
import { planSourceUpdate, type UpdateDecision } from './plan'

export interface HttpResponseLike {
  status: number
  text: () => Promise<string>
  bytes: () => Promise<Uint8Array>
}

export type HttpGet = (url: string) => Promise<HttpResponseLike>

export interface ReleaseManifest {
  version: string
  size: number
  sha256: string
  sigAlg: string
  keyId: string
  sig: string
  signedAt: string
}

export interface FetchSourceOptions {
  /** 远端目录前缀，例如 https://github.com/<owner>/<repo>/releases/latest/download */
  baseUrl: string
  get: HttpGet
  builtinVersion: string
  enabled: boolean
  publicKeys?: SourcePublicKey[]
}

export interface FetchSourceResult {
  decision: UpdateDecision
  manifest: ReleaseManifest | null
  script: string | null
  reason?: string
}

const SCRIPT_NAME = 'lx-source.js'
const MANIFEST_NAME = 'lx-source.js.manifest.json'

export const parseManifest = (text: string): ReleaseManifest | null => {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.version !== 'string' || typeof raw.sha256 !== 'string') return null
    if (typeof raw.sig !== 'string' || typeof raw.keyId !== 'string') return null
    if (typeof raw.size !== 'number') return null
    return {
      version: raw.version,
      size: raw.size,
      sha256: raw.sha256,
      sigAlg: String(raw.sigAlg || ''),
      keyId: raw.keyId,
      sig: raw.sig,
      signedAt: String(raw.signedAt || ''),
    }
  } catch {
    return null
  }
}

const keep = (reason: string, manifest: ReleaseManifest | null = null): FetchSourceResult => ({
  decision: { action: 'keep-builtin', reason: 'NO_REMOTE' },
  manifest,
  script: null,
  reason,
})

/**
 * 下载并验收远端音源包。返回的 script 只有在 decision.action === 'use-remote' 时非空，
 * 调用方不需要（也不应该）自己再过一遍判定。
 */
export const fetchAndVerifySource = async(opts: FetchSourceOptions): Promise<FetchSourceResult> => {
  if (!opts.enabled) return keep('DISABLED')

  let manifestRes: HttpResponseLike
  try {
    manifestRes = await opts.get(`${opts.baseUrl}/${MANIFEST_NAME}`)
  } catch {
    return keep('MANIFEST_UNREACHABLE')
  }
  if (manifestRes.status !== 200) return keep(`MANIFEST_HTTP_${manifestRes.status}`)

  let manifest: ReleaseManifest | null
  try {
    manifest = parseManifest(await manifestRes.text())
  } catch {
    return keep('MANIFEST_READ_FAILED')
  }
  if (!manifest) return keep('MANIFEST_INVALID')

  let scriptRes: HttpResponseLike
  try {
    scriptRes = await opts.get(`${opts.baseUrl}/${SCRIPT_NAME}`)
  } catch {
    return keep('SCRIPT_UNREACHABLE', manifest)
  }
  if (scriptRes.status !== 200) return keep(`SCRIPT_HTTP_${scriptRes.status}`, manifest)

  let bytes: Uint8Array
  try {
    bytes = await scriptRes.bytes()
  } catch {
    return keep('SCRIPT_READ_FAILED', manifest)
  }

  if (bytes.length !== manifest.size) {
    return keep(`SIZE_MISMATCH_${bytes.length}_${manifest.size}`, manifest)
  }
  const digest = bytesToHex(sha256(bytes))
  if (digest !== manifest.sha256) return keep('SHA256_MISMATCH', manifest)

  const verified = verifySourcePayload(bytes, manifest.sig, manifest.keyId)
  if (!verified.ok) return keep(`SIG_${verified.reason}`, manifest)

  const decision = planSourceUpdate({
    builtinVersion: opts.builtinVersion,
    remoteVersion: manifest.version,
    remoteVerified: true,
    enabled: opts.enabled,
  })

  if (decision.action !== 'use-remote') {
    return { decision, manifest, script: null, reason: decision.reason }
  }

  return {
    decision,
    manifest,
    script: new TextDecoder().decode(bytes),
  }
}
