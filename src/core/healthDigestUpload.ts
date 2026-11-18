/**
 * 真机健康摘要上报（v8.17 阶段 3，运行时）
 *
 * 通道：用户自己填一个 fine-grained PAT（仅 Issues: Read and write），App 用它
 * 在公开仓 luanmuc/lx-telemetry 开 issue；telemetry 仓的 workflow 负责校验/去重/落库/关 issue。
 * 因此 APK 里**不含任何共享凭据**，PAT 只存在本机 AsyncStorage。
 *
 * 触发：App 启动/回前台时调用 maybeUploadDigest()，距上次成功 ≥20h 才发。
 * 失败进本地队列（最多 7 条 / 7 天），下次成功时一起补发，不做后台定时器。
 */
import { Platform } from 'react-native'
import { getData, saveData } from '@/plugins/storage'
import { readRecentHealthEvents } from '@/core/healthLog'
import {
  buildDigest,
  digestIssueBody,
  digestIssueTitle,
  pruneDigestQueue,
  shouldUploadDigest,
  type HealthDigest,
} from '@/core/healthDigest'

export const DIGEST_TOKEN_KEY = '@health_digest_token'
export const DIGEST_DEVICE_KEY = '@health_digest_device_id'
export const DIGEST_LAST_KEY = '@health_digest_last_upload_at'
export const DIGEST_QUEUE_KEY = '@health_digest_queue'

const API_URL = 'https://api.github.com/repos/luanmuc/lx-telemetry/issues'

const randomHex = (len: number) => {
  let out = ''
  while (out.length < len) out += Math.random().toString(16).slice(2)
  return out.slice(0, len)
}

export const getDeviceId = async(): Promise<string> => {
  let id = await getData<string>(DIGEST_DEVICE_KEY)
  if (typeof id === 'string' && /^[a-f0-9]{8,32}$/.test(id)) return id
  id = randomHex(16)
  await saveData(DIGEST_DEVICE_KEY, id)
  return id
}

export const getDigestToken = async(): Promise<string> => {
  const v = await getData<string>(DIGEST_TOKEN_KEY)
  return typeof v === 'string' ? v.trim() : ''
}

export const setDigestToken = async(token: string) => {
  await saveData(DIGEST_TOKEN_KEY, (token || '').trim())
}

const postIssue = async(token: string, digest: HealthDigest): Promise<{ ok: boolean, status?: number }> => {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: digestIssueTitle(digest), body: digestIssueBody(digest) }),
  })
  return { ok: res.ok, status: res.status }
}

export interface UploadResult {
  ok: boolean
  reason: 'ok' | 'no-token' | 'too-soon' | 'network' | 'auth' | 'rate-limit' | 'error'
  detail?: string
}

const doUpload = async(token?: string): Promise<UploadResult> => {
  const tk = token ?? await getDigestToken()
  if (!tk) return { ok: false, reason: 'no-token' }
  const last = await getData<number>(DIGEST_LAST_KEY)
  if (token == null && !shouldUploadDigest(typeof last === 'number' ? last : null)) return { ok: false, reason: 'too-soon' }

  const events = await readRecentHealthEvents(5000)
  const digest = buildDigest(events, {
    deviceId: await getDeviceId(),
    model: String((Platform.constants as { Model?: string })?.Model ?? ''),
    android: String((Platform.constants as { Version?: string })?.Version ?? ''),
    appVersion: String((process as unknown as { versions?: { app?: string } }).versions?.app ?? 'unknown'),
    build: Number((process as unknown as { versions?: { appBuild?: number } }).versions?.appBuild ?? 0) || undefined,
    now: Date.now(),
  })

  // A01-006：统一的入队助手。此前只有「网络异常」才入队，HTTP 非 2xx（401 PAT 过期 /
  // 429 限流 / 5xx）直接 return，本次 24h 摘要既没发出去也没进队列 → 永久丢失。
  const enqueue = async(target: HealthDigest) => {
    const q = pruneDigestQueue((await getData<Array<{ at: number, digest: HealthDigest }>>(DIGEST_QUEUE_KEY)) ?? [])
    q.push({ at: Date.now(), digest: target })
    await saveData(DIGEST_QUEUE_KEY, q)
  }

  try {
    const res = await postIssue(tk, digest)
    if (res.ok) {
      await saveData(DIGEST_LAST_KEY, Date.now())
      // A01-007：补发历史队列时**只移除真正发送成功的条目**。原实现 `try { await postIssue } catch {}`
      // 后无条件 `saveData(QUEUE, [])`，某条因限流/网络失败会连同其它条目一起被清掉，下次不再补发。
      const queue = pruneDigestQueue((await getData<Array<{ at: number, digest: HealthDigest }>>(DIGEST_QUEUE_KEY)) ?? [])
      const remained: typeof queue = []
      for (const item of queue) {
        try {
          const r = await postIssue(tk, item.digest)
          if (!r.ok) remained.push(item)
        } catch {
          remained.push(item)
        }
      }
      if (remained.length !== queue.length) await saveData(DIGEST_QUEUE_KEY, remained)
      return { ok: true, reason: 'ok' }
    }
    // A01-006：鉴权失败 / 限流 / 5xx 也要把本次摘要留在队列里（token 换了或限流解除后仍可补发）
    await enqueue(digest)
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', detail: `HTTP ${res.status}` }
    if (res.status === 429) return { ok: false, reason: 'rate-limit', detail: 'HTTP 429' }
    return { ok: false, reason: 'error', detail: `HTTP ${res.status}` }
  } catch (e: any) {
    await enqueue(digest)
    return { ok: false, reason: 'network', detail: e?.message }
  }
}

// 单飞：启动触发与手动「立即上报」可能同时打进来，双击会生成两个 issue（同 device+时间点）。
// 复用同一个 Promise，既防重复投递，也让双击拿到同一结果。
let inFlight: Promise<UploadResult> | null = null

export const uploadDigestNow = async(token?: string): Promise<UploadResult> => {
  if (inFlight) return inFlight
  inFlight = doUpload(token).finally(() => { inFlight = null })
  return inFlight
}

/** 启动/回前台调用：没有 PAT、未满 20h 都直接静默返回 */
export const maybeUploadDigest = async(): Promise<UploadResult | null> => {
  try {
    const token = await getDigestToken()
    if (!token) return null
    const last = await getData<number>(DIGEST_LAST_KEY)
    if (!shouldUploadDigest(typeof last === 'number' ? last : null)) return null
    return await uploadDigestNow(token)
  } catch {
    return null
  }
}
