/**
 * 音源健康本地日志（2.4 方案）。
 *
 * 只落本地，不上传：
 * - `source_health_YYYYMMDD.jsonl` 按天滚动
 * - 单文件 2MB 封顶，超限保留尾部
 * - 保留 7 天，启动/写入时清理
 * - 失败 100% 记；成功 1/5 采样；缓存命中单独记 cache_hit
 * - 失败时抓同 traceId 的音源事件一起落盘
 *
 * 纯函数与运行时函数放在同一模块，运行时依赖全部惰性 require，
 * 便于契约脚本直接转译执行纯函数（不在模块加载阶段碰 RN）。
 */

declare const require: (name: string) => any
declare const global: any

export interface PlayAttempt {
  source: string
  owner?: 'host' | 'source'
  stage?: string
  ok?: boolean
  code?: string
  latencyMs?: number
}

export interface PlayResultInput {
  traceId?: string
  platform?: string
  quality?: string
  ok: boolean
  code?: string
  latencyMs?: number
  sourceId?: string
  sampleWeight?: number
  attempts?: PlayAttempt[]
}

export interface HealthLogEntry {
  ts: number
  traceId?: string
  event: string
  platform?: string
  quality?: string
  sourceId?: string
  ok?: boolean
  code?: string
  latencyMs?: number
  sampleWeight?: number
  sourceEvents?: unknown[]
  attempts?: PlayAttempt[]
}

const DAY = 24 * 60 * 60 * 1000
export const HEALTH_FILE_MAX_BYTES = 2 * 1024 * 1024
export const HEALTH_KEEP_DAYS = 7
// 成功按 1/5 采样落盘；聚合时用 5 作为权重，估算未采样成功量（对齐 OTel adjusted count）。
// 本地诊断是单机低频场景，1/20 会让“听几首歌仍为 0”，因此放宽到 1/5。
export const SUCCESS_SAMPLE_RATE = 5
// 报告读取上限：约覆盖 7 天中等流量；超过时报告标 truncated，不把截断数据叫 7 天。
export const REPORT_EVENT_LIMIT = 20000
const HEALTH_FILE_RE = /^source_health_(\d{8})\.jsonl$/

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

export const healthFileName = (now: Date = new Date()): string => `source_health_${dateKey(now)}.jsonl`

export const shouldSampleSuccess = (random: () => number = Math.random): boolean => Math.floor(random() * 5) === 0

export const isExpiredHealthFileName = (name: string, today: string, keepDays: number = HEALTH_KEEP_DAYS): boolean => {
  const m = HEALTH_FILE_RE.exec(name)
  if (!m) return false
  const y = Number(m[1].slice(0, 4))
  const mo = Number(m[1].slice(4, 6)) - 1
  const day = Number(m[1].slice(6, 8))
  const fileTs = Date.UTC(y, mo, day)
  const todayTs = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1, Number(today.slice(6, 8)))
  const diffDays = Math.floor((todayTs - fileTs) / DAY)
  return diffDays > keepDays
}

/** UTF-8 字节数（不依赖 Node Buffer，RN 运行时也能用） */
const utf8Bytes = (text: string): number => {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** 按字节上限保留 JSONL 尾部，且必须从完整行开始，避免写出残行 */
export const trimJsonlTail = (text: string, maxBytes: number): string => {
  if (!text) return ''
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  let start = lines.length
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const add = utf8Bytes(lines[i]) + (start < lines.length ? 1 : 0)
    if (size + add > maxBytes) break
    size += add
    start = i
  }
  return lines.slice(start).join('\n')
}

export interface CacheHitInput {
  platform?: string
  quality?: string
  sourceId?: string
}

/** 缓存命中只证明“本地有可用 URL”，不证明音源当前可出链；单独记事件，绝不混入成功率。 */
export const buildCacheHitEntry = (input: CacheHitInput): HealthLogEntry => {
  const entry: HealthLogEntry = {
    ts: Date.now(),
    event: 'cache_hit',
  }
  if (input.platform) entry.platform = String(input.platform)
  if (input.quality) entry.quality = String(input.quality)
  if (input.sourceId) entry.sourceId = String(input.sourceId)
  return entry
}

const MAX_PLAY_ATTEMPTS = 20

// attempts 只允许诊断必需字段，避免把 URL/歌名等敏感内容带进本地日志。
export const normalizePlayAttempts = (attempts?: PlayAttempt[]): PlayAttempt[] | undefined => {
  if (!Array.isArray(attempts)) return undefined
  const out: PlayAttempt[] = []
  for (const item of attempts) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.source !== 'string' || !item.source) continue
    const attempt: PlayAttempt = { source: item.source }
    if (item.owner === 'host' || item.owner === 'source') attempt.owner = item.owner
    if (typeof item.stage === 'string' && item.stage) attempt.stage = item.stage
    if (typeof item.ok === 'boolean') attempt.ok = item.ok
    if (typeof item.code === 'string' && item.code) attempt.code = item.code
    if (Number.isFinite(item.latencyMs)) attempt.latencyMs = Math.round(Number(item.latencyMs))
    out.push(attempt)
    if (out.length >= MAX_PLAY_ATTEMPTS) break
  }
  return out.length ? out : undefined
}

export const buildPlayResultEntry = (input: PlayResultInput): HealthLogEntry => {
  const entry: HealthLogEntry = {
    ts: Date.now(),
    event: 'play_result',
    ok: input.ok,
  }
  if (input.traceId) entry.traceId = String(input.traceId)
  if (input.platform) entry.platform = String(input.platform)
  if (input.quality) entry.quality = String(input.quality)
  if (input.sourceId) entry.sourceId = String(input.sourceId)
  if (input.code) entry.code = String(input.code)
  if (Number.isFinite(input.latencyMs)) entry.latencyMs = Math.round(Number(input.latencyMs))
  if (Number.isFinite(input.sampleWeight) && Number(input.sampleWeight) > 0) entry.sampleWeight = Number(input.sampleWeight)
  const attempts = normalizePlayAttempts(input.attempts)
  if (attempts) entry.attempts = attempts
  return entry
}

/** 逐行解析 JSONL；坏行/空行跳过，绝不因一行损坏丢整份日志 */
export const parseHealthLines = (text: string): HealthLogEntry[] => {
  const out: HealthLogEntry[] = []
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && typeof parsed.event === 'string') out.push(parsed as HealthLogEntry)
    } catch {}
  }
  return out
}

export const buildExportFileName = (now: Date = new Date()): string =>
  `source_health_diag_${dateKey(now)}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`

/** 一次播放（含换源重试）共用一个 traceId；只含随机与时间，不含设备/账号信息 */
export const createHealthTraceId = (): string => `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

interface HealthFs {
  exists: (path: string) => Promise<boolean>
  mkdir: (path: string) => Promise<void>
  readDir: (path: string) => Promise<Array<{ name?: string }>>
  unlink: (path: string) => Promise<void>
  stat: (path: string) => Promise<{ size: number }>
  readFile: (path: string, encoding: string) => Promise<string>
  writeFile: (path: string, content: string, encoding: string) => Promise<void>
  appendFile: (path: string, content: string, encoding: string) => Promise<void>
}

const getFs = (): HealthFs => {
  const mod = require('react-native-fs')
  return mod.default || mod
}

const getLogsDir = (): string => {
  const mod = require('../utils/log')
  return mod.getActiveLogsDir()
}

const ensureDir = async(dir: string): Promise<void> => {
  const fs = getFs()
  try {
    // RNFS.mkdir 不递归：父目录被整体删除时，必须先逐级补回父目录再建 logs
    const parent = dir.slice(0, dir.lastIndexOf('/'))
    if (parent && parent !== dir && !await fs.exists(parent)) await ensureDir(parent)
    if (!await fs.exists(dir)) await fs.mkdir(dir)
  } catch {}
}

export const ensureHealthLogsDir = async(): Promise<string | null> => {
  try {
    const dir = getLogsDir()
    await ensureDir(dir)
    return dir
  } catch {
    return null
  }
}

export const cleanupOldHealthFiles = async(now: Date = new Date()): Promise<number> => {
  try {
    const fs = getFs()
    const dir = getLogsDir()
    if (!await fs.exists(dir)) return 0
    const today = dateKey(now)
    const names = await fs.readDir(dir)
    let removed = 0
    for (const item of names) {
      const name = item?.name
      if (!name || !HEALTH_FILE_RE.test(name)) continue
      if (!isExpiredHealthFileName(name, today)) continue
      try {
        await fs.unlink(dir + '/' + name)
        removed++
      } catch {}
    }
    return removed
  } catch {
    return 0
  }
}

export const appendHealthEvent = async(entry: HealthLogEntry): Promise<string | null> => {
  try {
    const fs = getFs()
    const dir = getLogsDir()
    await ensureDir(dir)
    try {
      const logMod = require('../utils/log')
      if (typeof logMod.ensureAllLogFiles === 'function') await logMod.ensureAllLogFiles(dir)
    } catch {}
    await cleanupOldHealthFiles()
    const path = dir + '/' + healthFileName(new Date(entry.ts || Date.now()))
    try {
      const stat = await fs.stat(path)
      if (stat && stat.size > HEALTH_FILE_MAX_BYTES) {
        const text = await fs.readFile(path, 'utf8')
        await fs.writeFile(path, trimJsonlTail(text, HEALTH_FILE_MAX_BYTES - 4096), 'utf8')
      }
    } catch {}
    await fs.appendFile(path, JSON.stringify(entry) + '\n', 'utf8')
    return path
  } catch {
    return null
  }
}

export const readRecentHealthEvents = async(limit = 800, now: Date = new Date()): Promise<HealthLogEntry[]> => {
  try {
    const fs = getFs()
    const dir = getLogsDir()
    if (!await fs.exists(dir)) return []
    const today = dateKey(now)
    const names = (await fs.readDir(dir) as Array<{ name?: string }>)
      .map(item => item?.name)
      .filter((name): name is string => typeof name === 'string' && HEALTH_FILE_RE.test(name) && !isExpiredHealthFileName(name, today))
      .sort()
    const out: HealthLogEntry[] = []
    for (const name of names) {
      try {
        const text = await fs.readFile(dir + '/' + name, 'utf8')
        out.push(...parseHealthLines(text))
      } catch {}
    }
    return out.slice(-limit)
  } catch {
    return []
  }
}

/** 按 UTF-8 字节保留字符串尾部，不切断多字节字符（Array.from 保证代理对整体计入） */
export const trimTailByBytes = (text: string, maxBytes: number): string => {
  if (!text || maxBytes <= 0) return ''
  const chars = Array.from(text)
  let bytes = 0
  let start = chars.length
  for (let i = chars.length - 1; i >= 0; i--) {
    const unit = utf8Bytes(chars[i])
    if (bytes + unit > maxBytes) break
    bytes += unit
    start = i
  }
  return chars.slice(start).join('')
}

export const readDiagnoseLogTail = async(maxBytes = 64 * 1024): Promise<string> => {
  try {
    const fs = getFs()
    const path = getLogsDir() + '/diagnose.log'
    if (!await fs.exists(path)) return ''
    const text = await fs.readFile(path, 'utf8')
    return utf8Bytes(text) > maxBytes ? trimTailByBytes(text, maxBytes) : text
  } catch {
    return ''
  }
}

const fetchSourceEvents = async(traceId: string): Promise<unknown[]> => {
  try {
    const apis = global.lx?.apis as Record<string, { healthEvents?: (params: { traceId: string }) => { promise: Promise<{ events?: unknown[] }> } }> | undefined
    if (!apis || !traceId) return []
    const sourceId = Object.keys(apis).find(id => typeof apis[id]?.healthEvents === 'function')
    if (!sourceId) return []
    const healthEvents = apis[sourceId].healthEvents
    if (!healthEvents) return []
    const res = await healthEvents({ traceId }).promise
    return Array.isArray(res?.events) ? res.events : []
  } catch {
    return []
  }
}

export const recordCacheHit = async(input: CacheHitInput): Promise<void> => {
  await appendHealthEvent(buildCacheHitEntry(input))
}

export const recordPlayResult = async(input: PlayResultInput): Promise<void> => {
  // 失败 100% 落盘；成功只落 1/5，但落盘时带权重 5，聚合端才能还原真实成功率。
  if (input.ok && !shouldSampleSuccess()) return
  const entry = buildPlayResultEntry({ ...input, sampleWeight: input.ok ? SUCCESS_SAMPLE_RATE : 1 })
  await appendHealthEvent(entry)
  if (!input.ok && input.traceId) {
    const sourceEvents = await fetchSourceEvents(String(input.traceId))
    if (sourceEvents.length) {
      await appendHealthEvent({
        ts: Date.now(),
        traceId: String(input.traceId),
        event: 'source_events',
        sourceEvents,
      })
    }
  }
}


const seenProbeEventKeys = new Set<string>()
export const recordProbeEvents = async(events: unknown[]): Promise<number> => {
  let written = 0
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const event = String(e.event || '')
    if (event !== 'probe_result' && event !== 'health_transition') continue
    const key = `${String(e.ts || '')}|${String(e.traceId || '')}|${String(e.sourceId || '')}|${String(e.quality || '')}|${event}|${String(e.code || '')}`
    if (seenProbeEventKeys.has(key)) continue
    seenProbeEventKeys.add(key)
    if (seenProbeEventKeys.size > 1000) seenProbeEventKeys.delete(seenProbeEventKeys.values().next().value!)
    const entry: HealthLogEntry = {
      ts: Number(e.ts) || Date.now(),
      traceId: typeof e.traceId === 'string' ? e.traceId : undefined,
      event,
      sourceId: typeof e.sourceId === 'string' ? e.sourceId : undefined,
      quality: typeof e.quality === 'string' ? e.quality : undefined,
      ok: typeof e.ok === 'boolean' ? e.ok : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
      latencyMs: typeof e.latencyMs === 'number' ? e.latencyMs : undefined,
    }
    await appendHealthEvent(entry)
    written++
  }
  return written
}

export const exportDiagnostics = async(payload: unknown, now: Date = new Date()): Promise<string | null> => {
  try {
    const fs = getFs()
    const dir = getLogsDir()
    await ensureDir(dir)
    const path = dir + '/' + buildExportFileName(now)
    await fs.writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
    return path
  } catch {
    return null
  }
}

export const shareDiagnosticsFile = async(path: string): Promise<void> => {
  try {
    const { Platform, Share } = require('react-native')
    if (Platform.OS === 'android') {
      const mod = require('../utils/nativeModules/utils')
      await mod.shareFile(path, '分享音源诊断包', 'source_health_diag')
    } else {
      await Share.share({ url: 'file://' + path, title: '音源健康诊断' })
    }
  } catch {}
}

export const exportAndShareDiagnostics = async(payload: unknown, now: Date = new Date()): Promise<string | null> => {
  const path = await exportDiagnostics(payload, now)
  if (path) await shareDiagnosticsFile(path)
  return path
}
