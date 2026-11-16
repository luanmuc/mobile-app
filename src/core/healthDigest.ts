/**
 * 真机健康摘要（v8.17 阶段 3，纯函数）
 *
 * 只做「事件 → 摘要」：不含网络、不含存储、不碰 RN，便于契约脚本直接跑。
 * 摘要要能回答的问题是 CI 探测答不了的：**用户手机上到底能不能出链/能不能放**。
 *
 * 隐私边界：只统计次数与错误码，不带歌名、不带 URL、不带账号；
 * device.id 是安装时随机生成的 16 位 hex，不是任何硬件/账号标识。
 */
export const DIGEST_SCHEMA = 'lx-health-digest/1'
export const DIGEST_WINDOW_HOURS = 24
export const DIGEST_RECENT_EVENTS_MAX = 200

export interface DigestEvent {
  ts: number
  event: string
  sourceId?: string
  platform?: string
  ok?: boolean
  code?: string
  latencyMs?: number
  context?: string
}

export interface DigestMeta {
  deviceId: string
  model?: string
  android?: string
  appVersion: string
  build?: number
  now?: number
}

export interface DigestSourceCount {
  total: number
  ok: number
}

export interface HealthDigest {
  schema: string
  device: { id: string, model?: string, android?: string }
  app: { version: string, build?: number }
  generated_at: string
  window_hours: number
  probe: { total: number, ok: number, by_source: Record<string, DigestSourceCount> }
  play: { total: number, ok: number, by_source: Record<string, DigestSourceCount> }
  chain: { total: number, ok: number, failures: Array<{ source: string, code: string, at: string }> }
  recent_events: Array<{ at: string, kind: string, source?: string, code?: string, ms?: number }>
}

const clip = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)

const count = (target: Record<string, DigestSourceCount>, src: string, ok: boolean) => {
  const key = clip(src, 40) ?? 'unknown'
  const row = target[key] || (target[key] = { total: 0, ok: 0 })
  row.total++
  if (ok) row.ok++
}

export const buildDigest = (events: DigestEvent[], meta: DigestMeta): HealthDigest => {
  const now = meta.now ?? Date.now()
  const from = now - DIGEST_WINDOW_HOURS * 3600 * 1000
  const inWindow = (Array.isArray(events) ? events : []).filter(e => e && typeof e.ts === 'number' && e.ts >= from && e.ts <= now + 60 * 1000)

  const probe: HealthDigest['probe'] = { total: 0, ok: 0, by_source: {} }
  const play: HealthDigest['play'] = { total: 0, ok: 0, by_source: {} }
  const chain: HealthDigest['chain'] = { total: 0, ok: 0, failures: [] }

  for (const e of inWindow) {
    const src = e.sourceId ?? e.platform ?? 'unknown'
    if (e.event === 'probe_result') {
      probe.total++
      if (e.ok) probe.ok++
      count(probe.by_source, src, !!e.ok)
    } else if (e.event === 'play_result') {
      // probe 上下文不是用户播放，必须排除，否则真机播放率被探测样本污染
      if (e.context === 'probe') continue
      play.total++
      if (e.ok) play.ok++
      count(play.by_source, src, !!e.ok)
    } else if (e.event === 'chain_result') {
      chain.total++
      if (e.ok) chain.ok++
      if (!e.ok && chain.failures.length < 200) {
        chain.failures.push({
          source: clip(e.sourceId ?? e.platform, 40) ?? 'unknown',
          code: clip(e.code, 40) ?? 'UNKNOWN',
          at: new Date(e.ts).toISOString().slice(0, 40),
        })
      }
    }
  }

  const failures = inWindow
    .filter(e => e && e.ok === false && e.event !== 'cache_hit')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, DIGEST_RECENT_EVENTS_MAX)
    .map(e => ({
      at: new Date(e.ts).toISOString().slice(0, 40),
      kind: clip(e.event, 40) ?? 'unknown',
      source: clip(e.sourceId ?? e.platform, 40),
      code: clip(e.code, 40),
      ms: typeof e.latencyMs === 'number' ? Math.max(0, Math.min(999999, Math.round(e.latencyMs))) : undefined,
    }))

  return {
    schema: DIGEST_SCHEMA,
    device: { id: meta.deviceId, model: clip(meta.model, 80), android: clip(meta.android, 40) },
    app: { version: clip(meta.appVersion, 32) ?? 'unknown', build: meta.build },
    generated_at: new Date(now).toISOString(),
    window_hours: DIGEST_WINDOW_HOURS,
    probe,
    play,
    chain,
    recent_events: failures,
  }
}

/** 距上次成功上报是否已满 20h（不做后台定时器：启动/回前台时判断即可） */
export const shouldUploadDigest = (lastUploadAt: number | null, now = Date.now()): boolean =>
  lastUploadAt == null ? true : now - lastUploadAt >= 20 * 3600 * 1000

/** 队列最多留 7 天，超期直接丢（避免一次积压几十条把 Issue 刷爆） */
export const pruneDigestQueue = <T extends { at: number }>(queue: T[], now = Date.now()): T[] =>
  (Array.isArray(queue) ? queue : []).filter(q => q && typeof q.at === 'number' && now - q.at <= 7 * 864e5).slice(-7)

export const digestIssueTitle = (digest: HealthDigest): string =>
  `[digest] ${digest.device.id} ${digest.generated_at.slice(0, 10)}`

export const digestIssueBody = (digest: HealthDigest): string =>
  '```json\n' + JSON.stringify(digest) + '\n```\n'
