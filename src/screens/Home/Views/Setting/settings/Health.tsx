import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { StyleSheet, View, ScrollView, TextInput, Modal, Switch } from 'react-native'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { saveData, getData } from '@/plugins/storage'
import { logger } from '@/utils/logger'

// 音源健康快照（音源 getHealthSnapshot 聚合查询；v4.0：无样本 successRate/avgTime 为 null + 样本计数；v4.0：sleeping 休眠字段）
interface HealthItem {
  id?: string
  name: string
  maxQuality: string
  enabled: boolean
  successRate: number | null
  avgTime: number | null
  state: 'closed' | 'open' | 'half-open'
  reqCount: number
  probeCount: number
  sleeping: boolean
  healthScore: number
  // v6.0：真实播放请求最后使用时间戳（音源快照提供；0=从未用过）——五级分区"使用中"判定
  lastUsedAt?: number
  // 音源快照 v26.1 / v17.2 提供：播放连续失败被摘除、连续 429 被限流
  playDead?: boolean
  rateLimited?: boolean
  // 第五轮审计：429 退避期的"当前不可用"状态。
  // rateLimited 需要连续 3 次被上游真拒才置位，而第一次 429 就把该源退避 30s、
  // 后续请求被本地拦下不构成新证据——串行使用中它几乎永远为 false，
  // 旧界面于是把"正在退避、完全不参与竞速"的源显示成正常。这两个字段分开用。
  rateLimitUntil?: number
  rateLimitActive?: boolean
}
type HealthSnapshot = Record<string, HealthItem>

// 音源熔断器语义：closed=正常放行、open=熔断(冷却中)、half-open=半开试探
const STATE_COLOR: Record<HealthItem['state'], string> = {
  closed: '#52c41a',
  'half-open': '#faad14',
  open: '#ff4d4f',
}

// v8.11.7：配置参数中文映射（覆盖音源 config 读模式返回的全部可编辑键）
const CONFIG_LABELS: Record<string, string> = {
  cacheTtlMs: '成功缓存有效期',
  cacheTtlHighQualityMs: '高音质缓存有效期',
  failCacheNotFoundMs: '404 失败缓存',
  failCacheExpiredMs: '过期/死链失败缓存',
  breakerThreshold: '熔断阈值',
  breakerCooldownMs: '熔断冷却时间',
  rateLimitBackoffMs: '限速退避时间',
  maxConcurrency: '单源最大并发',
  rateWindowMs: '限速窗口',
  rateWindowMax: '限速窗口最大请求数',
  healthCheckIntervalMs: '健康探测间隔',
  raceBudgetMs: '竞速总预算',
  raceBudgetFloorMs: '末档保底预算',
  raceBatchSize: '每批并发源数',
  raceBatchStaggerMs: '批间错峰间隔',
  raceMatchWaitMs: '竞速匹配等待',
  coldStartTimeoutMs: '冷启动源单源超时',
  coldStartProbeTimeoutMs: '冷启动源探测超时',
  coldStartWarmTtlMs: '冷启动预热间隔',
  qualityShortCircuitSamples: '档位短路样本门槛',
  qualityShortCircuitProbeMs: '档位短路放行探路间隔',
  verifyTimeoutMs: '交付验真超时',
  verifyMinOriginalSec: '验真最短原曲时长',
  verifyDurRatio: '验真时长比例阈值',
  verifyDurGapSec: '验真时长差阈值',
  allFailShortTtlMs: '全失败短缓存',
  playDeadReviveMs: '已摘除源复活试探',
  memoryMapMax: '记忆表条目上限',
  verifyDelivery: '交付前验真',
  truthfulQuality: '音质标签回填真话',
  qualityFloor: '128K 保底',
  verifyOnCacheHit: '缓存命中再验真',
  previewUrlPreFilter: '试听 URL 预筛',
  fragmentFallback: '全档片段兜底',
  qualityShortCircuit: '档位短路',
  coldStartWarmEnabled: '冷启动预热',
}

// v8.11.7：每个配置项一句人话说明（弹窗里显示在名称下方）
const CONFIG_DESCS: Record<string, string> = {
  cacheTtlMs: '低音质成功取链缓存时长，命中后不再请求上游。',
  cacheTtlHighQualityMs: 'flac/320k 成功取链缓存时长；签名链寿命短，不宜过长。',
  failCacheNotFoundMs: '确认“歌不存在/无版权”后，多久内不再重复请求。',
  failCacheExpiredMs: '签名过期、410 死链的短期失败缓存。',
  breakerThreshold: '同一源连续失败多少次进入熔断。',
  breakerCooldownMs: '熔断后冷却多久，再放一个半开试探。',
  rateLimitBackoffMs: '被上游 429 后至少退避多久。',
  maxConcurrency: '同一源允许同时发出的请求数，太大容易触发风控。',
  rateWindowMs: '滑动限速窗口长度。',
  rateWindowMax: '一个限速窗口内最多请求次数。',
  healthCheckIntervalMs: '自动健康探测的运行间隔。',
  raceBudgetMs: '一次点歌跨音质档共享的总取链预算。',
  raceBudgetFloorMs: '最后一档至少保留的预算，防高音质吃满导致无声。',
  raceBatchSize: '竞速链每批并发探测的源数量。',
  raceBatchStaggerMs: '批次之间的错峰等待，降低瞬时并发。',
  raceMatchWaitMs: '已验证源在飞时，等待其结果的窗口。',
  coldStartTimeoutMs: '冷启动源单次取链的超时。',
  coldStartProbeTimeoutMs: '冷启动源健康探测的超时，冷态唤醒需要更久。',
  coldStartWarmTtlMs: '两次冷启动预热之间的间隔。',
  qualityShortCircuitSamples: '某源某档连续失败多少样本后跳过该档。',
  qualityShortCircuitProbeMs: '被短路后多久放行一次探路，防止永久跳过。',
  verifyTimeoutMs: '交付前取 1KB 字节验真的网络超时。',
  verifyMinOriginalSec: '原曲短于此值时不按比例判片段，避免误杀短歌。',
  verifyDurRatio: '真实时长不足原曲该比例时判为试听片段；0 表示关闭比例判定。',
  verifyDurGapSec: '且真实时长与原曲差值超过该秒数才判片段；0 表示关闭差值判定。',
  allFailShortTtlMs: '全链网络类失败后的短缓存，防连续无效重试。',
  playDeadReviveMs: '播放连续失败被摘除后，多久允许半开试探复活。',
  memoryMapMax: '按歌曲累积的记忆表最多保留多少条，防长跑内存膨胀。',
  verifyDelivery: '交付前取 1KB 字节判音频形态与时长；关闭后不验真直接交付。',
  truthfulQuality: '按实际交付音质回填标签，避免请求 flac 显示 FLAC 实际却是 128K。',
  qualityFloor: '高音质失败时是否保底降到 128K，避免点歌无声。',
  verifyOnCacheHit: '缓存命中的链接是否也重新验真，防缓存里的死链/片段绕过判据。',
  previewUrlPreFilter: '取链前先按 URL 关键词剔除明显的试听/预览链。',
  fragmentFallback: '所有源都只有片段时，是否交付片段并标注“试听版”。',
  qualityShortCircuit: '某源某档长期零成功时是否跳过该档，节省预算。',
  coldStartWarmEnabled: '是否在启动时预热冷启动源，降低首次取链失败率。',
}

// 布尔开关（音源 v8.11.7 起 config 通道可写）
const BOOL_CONFIG_KEYS = ['verifyDelivery', 'truthfulQuality', 'qualityFloor', 'verifyOnCacheHit', 'previewUrlPreFilter', 'fragmentFallback', 'qualityShortCircuit', 'coldStartWarmEnabled']
const BOOL_CONFIG_DEFAULT: Record<string, boolean> = {
  verifyDelivery: true,
  truthfulQuality: true,
  qualityFloor: true,
  verifyOnCacheHit: true,
  previewUrlPreFilter: false,
  fragmentFallback: true,
  qualityShortCircuit: true,
  coldStartWarmEnabled: true,
}

// 参数单位与预设配置（ms 类自动转换为更直观的单位）
const CONFIG_UNIT_CONFIG: Record<string, { unit: string, msPerUnit?: number, presets: number[], default: number }> = {
  cacheTtlMs: { unit: '小时', msPerUnit: 3600000, presets: [1, 6, 12, 24, 168], default: 6 },
  cacheTtlHighQualityMs: { unit: '分钟', msPerUnit: 60000, presets: [10, 30, 60, 120], default: 30 },
  failCacheNotFoundMs: { unit: '分钟', msPerUnit: 60000, presets: [1, 5, 60, 360], default: 60 },
  failCacheExpiredMs: { unit: '秒', msPerUnit: 1000, presets: [30, 60, 300], default: 60 },
  breakerThreshold: { unit: '次', presets: [2, 3, 5, 10], default: 3 },
  breakerCooldownMs: { unit: '分钟', msPerUnit: 60000, presets: [0.5, 1, 3, 10], default: 3 },
  rateLimitBackoffMs: { unit: '秒', msPerUnit: 1000, presets: [5, 10, 30, 60], default: 30 },
  maxConcurrency: { unit: '个', presets: [1, 2, 3, 5], default: 2 },
  rateWindowMs: { unit: '秒', msPerUnit: 1000, presets: [1, 3, 5], default: 3 },
  rateWindowMax: { unit: '次', presets: [3, 5, 10, 20], default: 5 },
  healthCheckIntervalMs: { unit: '分钟', msPerUnit: 60000, presets: [1, 5, 10, 30], default: 10 },
  raceBudgetMs: { unit: '秒', msPerUnit: 1000, presets: [5, 8, 12, 15], default: 12 },
  raceBudgetFloorMs: { unit: '秒', msPerUnit: 1000, presets: [1, 2, 3, 5], default: 3 },
  raceBatchSize: { unit: '个', presets: [1, 2, 3, 5], default: 3 },
  raceBatchStaggerMs: { unit: '毫秒', presets: [0, 100, 300, 500], default: 300 },
  raceMatchWaitMs: { unit: '秒', msPerUnit: 1000, presets: [0.3, 0.6, 1, 2], default: 0.6 },
  coldStartTimeoutMs: { unit: '秒', msPerUnit: 1000, presets: [5, 8, 15, 30], default: 8 },
  coldStartProbeTimeoutMs: { unit: '秒', msPerUnit: 1000, presets: [10, 20, 30, 60], default: 30 },
  coldStartWarmTtlMs: { unit: '分钟', msPerUnit: 60000, presets: [1, 5, 10, 30], default: 5 },
  qualityShortCircuitSamples: { unit: '次', presets: [2, 3, 5, 10], default: 3 },
  qualityShortCircuitProbeMs: { unit: '分钟', msPerUnit: 60000, presets: [30, 60, 180, 360], default: 60 },
  verifyTimeoutMs: { unit: '毫秒', presets: [1000, 2000, 3000, 5000], default: 3000 },
  verifyMinOriginalSec: { unit: '秒', presets: [30, 60, 90, 120], default: 90 },
  verifyDurRatio: { unit: '倍', presets: [0.4, 0.5, 0.6, 0.8], default: 0.6 },
  verifyDurGapSec: { unit: '秒', presets: [5, 10, 15, 30], default: 15 },
  allFailShortTtlMs: { unit: '分钟', msPerUnit: 60000, presets: [1, 5, 15], default: 5 },
  playDeadReviveMs: { unit: '分钟', msPerUnit: 60000, presets: [5, 10, 30, 60], default: 30 },
  memoryMapMax: { unit: '条', presets: [500, 1000, 2000, 5000], default: 2000 },
}

// 参数上下限校验（和音源侧 PARAM_LIMITS 一致）
const PARAM_LIMITS: Record<string, { min?: number, max?: number }> = {
  cacheTtlMs: { max: 7 * 24 * 3600 * 1000 },
  cacheTtlHighQualityMs: { max: 7 * 24 * 3600 * 1000 },
  failCacheNotFoundMs: { max: 24 * 3600 * 1000 },
  failCacheExpiredMs: { max: 3600 * 1000 },
  breakerThreshold: { max: 20 },
  breakerCooldownMs: { max: 30 * 60 * 1000 },
  rateLimitBackoffMs: { max: 5 * 60 * 1000 },
  maxConcurrency: { max: 5 },
  rateWindowMs: { max: 10 * 1000 },
  rateWindowMax: { max: 20 },
  healthCheckIntervalMs: { min: 60 * 1000 },
  raceBudgetMs: { max: 15 * 1000 },
  raceBudgetFloorMs: { max: 15 * 1000 },
  raceBatchSize: { max: 10 },
  raceBatchStaggerMs: { max: 2000 },
  raceMatchWaitMs: { max: 5 * 1000 },
  coldStartTimeoutMs: { max: 30 * 1000 },
  coldStartProbeTimeoutMs: { max: 60 * 1000 },
  coldStartWarmTtlMs: { max: 60 * 60 * 1000 },
  qualityShortCircuitSamples: { max: 20 },
  qualityShortCircuitProbeMs: { max: 24 * 3600 * 1000 },
  verifyTimeoutMs: { min: 500, max: 10 * 1000 },
  verifyMinOriginalSec: { max: 3600 },
  verifyDurRatio: { max: 1 },
  verifyDurGapSec: { max: 300 },
  allFailShortTtlMs: { max: 10 * 60 * 1000 },
  playDeadReviveMs: { max: 2 * 3600 * 1000 },
  memoryMapMax: { min: 1, max: 20000 },
}

// 音源 id → 展示名（只映射英文/混排名，中文名保持原样）
const SOURCE_NAME_ZH: Record<string, string> = {
  gdWy: 'GD Studio（网易）',
  helloworldKw: 'helloworld（酷我）',
  ikun: 'ikun（公益）',
  huibq: 'Huibq（酷我/网易）',
  juheKw: 'Juhe 聚合（酷我）',
  juheTx: 'Juhe 聚合（QQ）',
  juheWy: 'Juhe 聚合（网易）',
  juheKg: 'Juhe 聚合（酷狗）',
  juheMg: 'Juhe 聚合（咪咕）',
  changqingVip: '长青（酷我）',
  nianxinVip: '念心（酷我）',
  xinghaiBackup: '星海备',
  xinghaiBackend: '星海后端',
}

// ms 值 → 直观单位值
const msToDisplay = (key: string, msValue: number): number => {
  const cfg = CONFIG_UNIT_CONFIG[key]
  if (!cfg?.msPerUnit) return msValue
  return Math.round(msValue / cfg.msPerUnit * 100) / 100
}

// 直观单位值 → ms 值
const displayToMs = (key: string, displayValue: number): number => {
  const cfg = CONFIG_UNIT_CONFIG[key]
  if (!cfg?.msPerUnit) return displayValue
  return Math.round(displayValue * cfg.msPerUnit)
}

// 获取当前音源的健康查询器（任一声明对应 action 的源均可，聚合结果与源无关）
const getQuerier = (fn: 'getHealth' | 'toggle' | 'probe' | 'config' | 'trend'): ((...args: any[]) => { promise: Promise<any> }) | null => {
  const apis = (global as any).lx?.apis as Record<string, any> | undefined
  if (!apis) return null
  const sourceId = Object.keys(apis).find(id => typeof apis[id]?.[fn] === 'function')
  return sourceId ? apis[sourceId][fn] : null
}

// 无样本（未产生任何请求/探测）判定
const hasSample = (item: HealthItem) => (item.reqCount ?? 0) > 0 || (item.probeCount ?? 0) > 0

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [togglingId, setTogglingId] = useState('')
  const [probeInfo, setProbeInfo] = useState('')
  // v8.0：配置编辑相关 state
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configData, setConfigData] = useState<Record<string, any> | null>(null)
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({})
  // v8.11.7：布尔开关状态（音源 config 通道已开放写入）
  const [configBools, setConfigBools] = useState<Record<string, boolean>>({})
  // v8.0：趋势图相关 state
  const [trendData, setTrendData] = useState<Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }>>([])
  const [showTrendModal, setShowTrendModal] = useState(false)
  // 提前预警——健康分连续下降的源列表
  const [decliningSources, setDecliningSources] = useState<string[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHealth = useCallback(async(silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError('')
    try {
      const querier = getQuerier('getHealth')
      if (!querier) {
        if (!silent) {
          setError(t('health_no_source'))
          setSnapshot(null)
        }
        return
      }
      const { promise } = querier()
      const data = await promise
      setSnapshot(data as HealthSnapshot)
      // 成功拿到数据说明音源支持 health action，之前的 error（如"未检测到音源"）是误报，清空
      setError('')

      // 自动获取趋势数据，判断健康分连续下降（提前预警）
      try {
        const trendQuerier = getQuerier('trend')
        if (trendQuerier) {
          const trendPromise = trendQuerier().promise
          const trendResult = await trendPromise
          // 历史快照结构固定为 { timestamp, sources }，显式声明类型，避免下游 entry/s 变成隐式 any
          const history = ((trendResult as any)?.history || []) as Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }>
          setTrendData(history)

          // 判断逻辑：最近 3 次探测，健康分连续下降 ≥5 分
          if (history.length >= 3) {
            const recent = history.slice(-3)
            const declining: string[] = []
            // 收集所有出现过的源 id
            const allSourceIds = new Set<string>()
            recent.forEach(entry => {
              Object.keys(entry.sources).forEach(id => allSourceIds.add(id))
            })
            // 逐个源判断是否连续下降
            allSourceIds.forEach(sourceId => {
              // 检查该源是否还在当前 snapshot 里（已删除/手动关闭的源不预警）
              if (!(data as any)?.[sourceId]) return
              const scores = recent.map(entry => entry.sources[sourceId]?.score ?? null)
              // 要求 3 次都有分数（不是 null）
              if (scores.every(s => s !== null)) {
                const [s1, s2, s3] = scores as number[]
                // 连续两次下降（s1 > s2 > s3），且累计下降 ≥5 分
                if (s1 > s2 && s2 > s3 && (s1 - s3) >= 5) {
                  declining.push(sourceId)
                }
              }
            })
            setDecliningSources(declining)
          } else {
            setDecliningSources([])
          }
        }
      } catch (e) {
        // trend 获取失败不影响主流程，静默忽略
        console.log('trend auto load failed:', e)
      }
    } catch (e: any) {
      console.log(e)
      if (!silent) setError(String(e?.message || t('health_load_failed')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [t])

  // v4.0：面板停留自动刷新（30s 静默轮询），卸载清理
  useEffect(() => {
    void loadHealth()
    timerRef.current = setInterval(() => { void loadHealth(true) }, 30000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [loadHealth])

  // 手动探测：触发一轮健康探测（并发 ~6s）
  const runProbe = useCallback(async() => {
    setError('')
    const querier = getQuerier('probe')
    if (!querier) {
      setError(t('health_no_source'))
      return
    }
    setProbeInfo(t('health_probing'))
    try {
      const { promise } = querier()
      const res = await promise
      if (res?.running) {
        setProbeInfo(t('health_probe_running'))
      } else if (res) {
        const time = new Date(res.doneAt)
        const hh = String(time.getHours()).padStart(2, '0')
        const mm = String(time.getMinutes()).padStart(2, '0')
        setProbeInfo(`${t('health_probe_done_at')} ${hh}:${mm} · ${res.active?.length ?? 0}${t('health_probe_active')} · ${res.sleeping?.length ?? 0}${t('health_probe_sleeping')}`)
      }
    } catch (e: any) {
      setProbeInfo('')
      setError(String(e?.message || t('health_load_failed')))
      return
    }
    void loadHealth(true)
  }, [t, loadHealth])

  // v8.0：查看音源配置（调用 config action 读模式）
  const showConfig = useCallback(async() => {
    setError('')
    const querier = getQuerier('config')
    logger.info('Health', `[debug] getQuerier(config) = ${querier ? 'function' : 'null'}`)
    logger.info('Health', `[debug] apis keys = ${Object.keys((globalThis as any).lx?.apis || {}).join(',')}`)
    logger.info('Health', `[debug] apis.wy keys = ${Object.keys((globalThis as any).lx?.apis?.wy || {}).join(',')}`)
    if (!querier) {
      setError(t('health_no_source'))
      return
    }
    try {
      const { promise } = querier()
      const res = await promise
      setConfigData(res)
      // v8.0：ms值自动转成直观单位值显示（比如 21600000ms → 6小时）
      // v8.11.7：只把有单位配置的数字键放进输入框；布尔键进开关，卡密/对象键不渲染
      setConfigInputs(Object.fromEntries(
        Object.entries(res)
          .filter(([k]) => !!CONFIG_UNIT_CONFIG[k])
          .map(([k, v]) => [k, String(msToDisplay(k, Number(v)))])
      ))
      setConfigBools(Object.fromEntries(
        BOOL_CONFIG_KEYS.map(k => [k, typeof (res as any)?.[k] === 'boolean' ? (res as any)[k] : BOOL_CONFIG_DEFAULT[k]])
      ))
      setShowConfigModal(true)
    } catch (e: any) {
      setError(String(e?.message || t('health_load_failed')))
    }
  }, [t])

  // v8.0：保存配置（写模式 + 本地持久化）
  const saveConfig = useCallback(async() => {
    setError('')
    const querier = getQuerier('config')
    const updates: Record<string, number | boolean> = {}
    for (const [k, v] of Object.entries(configInputs)) {
      if (!CONFIG_UNIT_CONFIG[k]) continue
      const num = Number(v)
      // v8.0：直观单位值转回 ms 再保存
      const msValue = displayToMs(k, num)
      // 校验——有效数字 / 非负（验真比例与差值 0 合法）/ 白名单内 / 上下限
      const zeroAllowed = k === 'verifyDurRatio' || k === 'verifyDurGapSec'
      if (isNaN(num) || num < 0 || msValue < 0 || (!zeroAllowed && msValue === 0) || !(k in (configData || {}))) continue
      const limits = PARAM_LIMITS[k]
      if (limits) {
        if (limits.min !== undefined && msValue < limits.min) continue
        if (limits.max !== undefined && msValue > limits.max) continue
      }
      updates[k] = msValue
    }
    for (const k of BOOL_CONFIG_KEYS) {
      if (k in configBools) updates[k] = configBools[k]
    }
    try {
      if (Object.keys(updates).length === 0) {
        setShowConfigModal(false)
        setProbeInfo('没有修改任何参数')
        return
      }
      if (querier) {
        const { promise } = querier(updates)
        await promise
      }
      await saveData('lx_source_config', updates)
      setShowConfigModal(false)
      setProbeInfo(`配置已保存：${Object.keys(updates).length} 项已更新`)
    } catch (e: any) {
      setError(String(e?.message || '保存失败'))
    }
  }, [t, configInputs, configBools, configData])

  // v8.0：查看健康趋势（调用 trend action 读历史数据）
  const showTrend = useCallback(async() => {
    setError('')
    const querier = getQuerier('trend')
    if (!querier) {
      setError(t('health_no_source'))
      return
    }
    try {
      const { promise } = querier()
      const res = await promise
      setTrendData(res.history || [])
      setShowTrendModal(true)
    } catch (e: any) {
      setError(String(e?.message || t('health_load_failed')))
    }
  }, [t])

  // v4.0：行内开关——点击状态胶囊切换该源启用/停用（停用带 manualOff 锁定，探测不自动复活）
  const toggleSource = useCallback(async(item: HealthItem, id: string) => {
    if (togglingId) return
    setError('')
    const querier = getQuerier('toggle')
    if (!querier) {
      setError(t('health_no_source'))
      return
    }
    setTogglingId(id)
    try {
      const { promise } = querier(id, !item.enabled)
      await promise
      await loadHealth(true)
    } catch (e: any) {
      setError(String(e?.message || t('health_toggle_failed')))
    } finally {
      setTogglingId('')
    }
  }, [t, loadHealth, togglingId])

  // v-b47：五级分区排序——使用中(最近10分钟有真实请求) → 正常 → 待采样 → 休眠 → 已关，
  // 组内按健康分降序（同分保持定义顺序）；"异常"源(0%+负分)留在正常组内自然沉底
  const isUsing = (it: HealthItem) => !!it.lastUsedAt && (Date.now() - it.lastUsedAt) < 10 * 60 * 1000
  const groupRank = (it: HealthItem) => {
    if (!it.enabled) return it.sleeping ? 3 : 4
    if (!hasSample(it)) return 2
    return isUsing(it) ? 0 : 1
  }
  // v8.0：提取平台级降级聚合（_ 开头的特殊字段，不参与子源列表渲染）
  const PLATFORM_NAMES: Record<string, string> = { wy: '网易', kw: '酷我', tx: 'QQ', mg: '咪咕', kg: '酷狗' }
  const platformSummary = snapshot?._platformSummary as Record<string, { degraded: boolean; activeCount: number; deadCount: number }> | undefined
  const fallbackPlatform = snapshot?._fallbackPlatform as string | undefined
  const degradedPlatforms = platformSummary ? Object.entries(platformSummary).filter(([, v]) => v.degraded).map(([k]) => PLATFORM_NAMES[k] || k) : []

  const items = snapshot ? Object.entries(snapshot)
    .filter(([id]) => !id.startsWith('_'))  // 过滤平台聚合等特殊字段
    .map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => {
      const g = groupRank(a) - groupRank(b)
      return g !== 0 ? g : b.healthScore - a.healthScore
    }) : []

  // 聚合摘要：正常/熔断/半开/待采样/休眠/已关
  let summary: Record<'ok' | 'bad' | 'open' | 'half' | 'idle' | 'sleep' | 'off', number> = { ok: 0, bad: 0, open: 0, half: 0, idle: 0, sleep: 0, off: 0 }
  if (items.length) {
    summary = items.reduce((acc, it) => {
      const sampled = hasSample(it)
      if (!it.enabled) {
        if (it.sleeping) acc.sleep++
        else acc.off++
      } else if (!sampled) {
        acc.idle++
      } else if (it.state === 'closed') {
        // v-b45：状态语义修正——断路器闭合但成功率 0% + 健康分<0（如上游整体不可用的源）
        // 显示"异常"而非"正常"：闭合≠真实可用
        if (it.successRate === 0 && it.healthScore < 0) acc.bad++
        else acc.ok++
      } else if (it.state === 'open') {
        acc.open++
      } else {
        acc.half++
      }
      return acc
    }, summary)
  }

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps={'always'}>
    <Section title={t('setting_health')}>
      <SubTitle title={t('health_desc')}>
        <View style={styles.btnRow}>
          <Button onPress={() => void loadHealth()} disabled={loading}>{loading ? t('health_loading') : t('health_refresh')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => void runProbe()}>{t('health_probe')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => void showConfig()}>配置</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => void showTrend()}>趋势</Button>
        </View>
        {
          probeInfo ? (
            <View style={styles.desc}>
              <Text size={12} color={theme['c-font-label']}>{probeInfo}</Text>
            </View>
          ) : null
        }
        {
          error ? (
            <View style={styles.desc}>
              <Text size={13} color={theme['c-font-label']}>{error}</Text>
            </View>
          ) : null
        }
        {
          // v8.0：平台级降级提示条
          degradedPlatforms.length ? (
            <View style={[styles.summary, { backgroundColor: '#fffbe6' }]}>
              <Text size={12} color="#d48806">⚠ {degradedPlatforms.join('、')} 平台级降级</Text>
              {fallbackPlatform ? <Text size={11} color={theme['c-font-label']}>正在用 {PLATFORM_NAMES[fallbackPlatform] || fallbackPlatform} 平台兜底</Text> : null}
            </View>
          ) : null
        }
        {
          // 提前预警——健康分连续下降
          decliningSources.length ? (
            <View style={[styles.summary, { backgroundColor: '#fff2e8' }]}>
              <Text size={12} color="#fa541c">⚠ {decliningSources.map(id => (snapshot as any)?.[id]?.name || id).join('、')} 健康分连续下降</Text>
              <Text size={11} color={theme['c-font-label']}>最近 3 次探测持续变差，建议关注或手动切换源</Text>
            </View>
          ) : null
        }
        {
          items.length ? (
            <View style={[styles.summary, { backgroundColor: theme['c-primary-background-active'] }]}>
              <Text size={12} color={theme['c-font-label']}>{t('health_summary')}</Text>
              <View style={styles.summaryItems}>
                <Text size={12} color="#52c41a">● {summary.ok}{t('health_sum_ok')}</Text>
                <Text size={12} color="#ff4d4f">● {summary.bad}{t('health_sum_bad')}</Text>
                <Text size={12} color="#faad14">● {summary.open}{t('health_sum_open')}</Text>
                <Text size={12} color="#faad14">● {summary.half}{t('health_sum_half')}</Text>
                <Text size={12} color={theme['c-font-label']}>○ {summary.idle}{t('health_sum_idle')}</Text>
                <Text size={12} color="#8c8c8c">○ {summary.sleep}{t('health_sum_sleep')}</Text>
                <Text size={12} color={theme['c-font-label']}>○ {summary.off}{t('health_sum_off')}</Text>
              </View>
            </View>
          ) : null
        }
        {
          snapshot && items.length ? (
            <View style={styles.tableWrap}>
              <View style={[styles.row, styles.headRow, { backgroundColor: theme['c-primary-background-active'] }]}>
                <Text size={12} style={styles.colName}>{t('health_col_source')}</Text>
                <Text size={12} style={styles.colSmall}>{t('health_col_quality')}</Text>
                <Text size={12} style={styles.colSmall}>{t('health_col_success')}</Text>
                <Text size={12} style={styles.colSmall}>{t('health_col_time')}</Text>
                <Text size={12} style={styles.colSmall}>{t('health_col_state')}</Text>
                <Text size={12} style={styles.colSmall}>{t('health_col_score')}</Text>
              </View>
              {
                // v4.0：全部行直接渲染，表格随音源数量自动撑高（整页滚动，不再 maxHeight 截断）
                // v4.0：状态胶囊可点按开关源
                items.map((item) => {
                  const id = item.id || item.name
                  const sampled = hasSample(item)
                  const rateText = item.successRate == null ? '-' : `${(item.successRate * 100).toFixed(0)}%`
                  const timeText = item.avgTime == null ? '-' : `${Math.round(item.avgTime)}ms`
                  let stateText: string
                  let stateColor: string
                  if (!item.enabled) {
                    if (item.sleeping) { stateText = t('health_state_sleeping'); stateColor = '#8c8c8c' }
                    else { stateText = t('health_state_disabled'); stateColor = theme['c-font-label'] }
                  } else if (!sampled) {
                    stateText = t('health_state_idle'); stateColor = theme['c-font-label']
                  } else if (item.state === 'closed' && item.successRate === 0 && item.healthScore < 0) {
                    // v-b45：断路器闭合但成功率 0% + 健康分<0 → "异常"（上游不可用的源不再显示"正常"）
                    stateText = t('health_state_abnormal'); stateColor = '#ff4d4f'
                  } else if (item.playDead) {
                    // v7.0：播放连续失败被摘除
                    stateText = '已摘除'; stateColor = '#ff4d4f'
                  } else if (item.state !== 'open' && (item.rateLimitActive || item.rateLimited)) {
                    // 熔断(open)优先于限流标签：熔断更严重，不能被「限流中」降级显示
                    // v4.0：被限流（连续 429）；第五轮：退避期内 rateLimitActive 立即可亮，
                    // 不再等"连续 3 次"这个串行下几乎不可达的条件
                    stateText = item.rateLimitActive ? '限流中' : '被限流'; stateColor = '#faad14'
                  } else {
                    stateText = t(`health_state_${item.state}`); stateColor = STATE_COLOR[item.state]
                  }
                  // 健康分 10 分制（音源 v7.0 起快照 ×10）：一位小数；阈值 ≥3 绿 / ≥−5 默认 / <−5 红
                  const scoreText = !sampled ? '-' : item.healthScore.toFixed(1)
                  const scoreColor = !sampled ? theme['c-font-label']
                    : item.healthScore >= 3 ? '#52c41a' : item.healthScore >= -5 ? theme['c-font'] : '#ff4d4f'
                  const rateColor = !sampled || item.successRate == null ? theme['c-font-label']
                    : item.successRate >= 0.6 ? theme['c-font'] : '#ff4d4f'
                  return (
                    <View key={id} style={[styles.row, { borderBottomColor: theme['c-border-background'] }]}>
                      <Text numberOfLines={1} size={12} style={styles.colName} color={item.enabled ? theme['c-font'] : theme['c-font-label']}>{SOURCE_NAME_ZH[id] || item.name}</Text>
                      <Text size={12} style={styles.colSmall}>{item.maxQuality.toUpperCase()}</Text>
                      <Text size={12} style={styles.colSmall} color={rateColor}>{rateText}</Text>
                      <Text size={12} style={styles.colSmall} color={sampled ? theme['c-font'] : theme['c-font-label']}>{timeText}</Text>
                      <View style={styles.colSmall}>
                        <View
                          style={[styles.stateChip, { borderColor: stateColor, opacity: togglingId === id ? 0.5 : 1 }]}
                          onTouchEnd={() => { void toggleSource(item, id) }}
                        >
                          <Text size={10} color={stateColor}>{togglingId === id ? '…' : stateText}</Text>
                        </View>
                      </View>
                      <Text size={12} style={styles.colSmall} color={scoreColor}>{scoreText}</Text>
                    </View>
                  )
                })
              }
            </View>
          ) : null
        }
        {
          snapshot && items.length ? (
            <View style={styles.desc}>
              <Text size={12} color={theme['c-font-label']}>{t('health_footnote')}</Text>
            </View>
          ) : null
        }
        {
          snapshot && !items.length && !error ? (
            <View style={styles.desc}>
              <Text size={13} color={theme['c-font-label']}>{t('health_no_source')}</Text>
            </View>
          ) : null
        }
      </SubTitle>
    </Section>

    {/* v8.0：配置编辑弹窗 */}
    <Modal visible={showConfigModal} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text size={16} color={theme['c-font']} style={styles.modalTitle}>音源配置（运行参数）</Text>
          <ScrollView style={styles.modalScroll}>
            {configData && Object.keys(configData)
              .filter(key => !!CONFIG_UNIT_CONFIG[key])
              .map(key => {
                const unitCfg = CONFIG_UNIT_CONFIG[key]
                const unit = unitCfg.unit
                const presets = unitCfg.presets
                const currentVal = configInputs[key] ?? ''
                return (
                  <View key={key} style={styles.configBlock}>
                    <Text size={12} color={theme['c-font']} style={styles.configLabel}>{CONFIG_LABELS[key] || key}</Text>
                    {CONFIG_DESCS[key] ? <Text size={10} color={theme['c-font-label']} style={styles.configDesc}>{CONFIG_DESCS[key]}</Text> : null}
                    <View style={styles.configInputLine}>
                      <TextInput
                        style={[styles.configInput, { borderColor: theme['c-border-background'], color: theme['c-font'] }]}
                        value={currentVal}
                        onChangeText={(text) => setConfigInputs(prev => ({ ...prev, [key]: text }))}
                        keyboardType="numeric"
                      />
                      {unit ? <Text size={11} color={theme['c-font-label']} style={styles.configUnit}>{unit}</Text> : null}
                    </View>
                    {/* 预设按钮 */}
                    {presets.length > 0 && (
                      <View style={styles.presetRow}>
                        {presets.map(p => {
                          const isActive = currentVal === String(p)
                          return (
                            <Button
                              key={p}
                              style={styles.presetBtn}
                              onPress={() => setConfigInputs(prev => ({ ...prev, [key]: String(p) }))}
                            >
                              <Text size={11} color={isActive ? theme['c-primary'] : theme['c-font-label']}>{p}{unit}</Text>
                            </Button>
                          )
                        })}
                      </View>
                    )}
                  </View>
                )
              })}
            {configData ? (
              <View style={styles.configSection}>
                <Text size={12} color={theme['c-font']}>高级开关</Text>
                <Text size={10} color={theme['c-font-label']}>关闭验真或片段兜底会改变交付策略，非排障不建议改。</Text>
              </View>
            ) : null}
            {configData && BOOL_CONFIG_KEYS.map(key => (
              <View key={key} style={styles.configSwitchRow}>
                <View style={styles.configSwitchText}>
                  <Text size={12} color={theme['c-font']}>{CONFIG_LABELS[key] || key}</Text>
                  {CONFIG_DESCS[key] ? <Text size={10} color={theme['c-font-label']} style={styles.configDesc}>{CONFIG_DESCS[key]}</Text> : null}
                </View>
                <Switch
                  value={configBools[key] ?? BOOL_CONFIG_DEFAULT[key]}
                  onValueChange={(v) => setConfigBools(prev => ({ ...prev, [key]: v }))}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.modalBtnRow}>
            <Button
              onPress={() => {
                // 恢复默认值
                const defaults: Record<string, string> = {}
                for (const [key, cfg] of Object.entries(CONFIG_UNIT_CONFIG)) {
                  if (key in (configData || {})) {
                    defaults[key] = String(cfg.default)
                  }
                }
                setConfigInputs(prev => ({ ...prev, ...defaults }))
                setConfigBools(prev => ({ ...prev, ...BOOL_CONFIG_DEFAULT }))
              }}
            >
              恢复默认
            </Button>
            <View style={styles.btnGap} />
            <Button onPress={() => setShowConfigModal(false)}>取消</Button>
            <View style={styles.btnGap} />
            <Button onPress={() => void saveConfig()}>保存</Button>
          </View>
        </View>
      </View>
    </Modal>

    {/* v8.0：健康趋势弹窗 */}
    <Modal visible={showTrendModal} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text size={16} color={theme['c-font']} style={styles.modalTitle}>健康趋势（最近 {trendData.length} 次探测）</Text>
          {/* 图例说明 */}
          <View style={styles.trendLegend}>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#4caf50' }]} />
              <Text size={10} color={theme['c-font-label']}>健康(≥3分)</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#ff9800' }]} />
              <Text size={10} color={theme['c-font-label']}>一般(-5~3)</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#f44336' }]} />
              <Text size={10} color={theme['c-font-label']}>异常(低于-5分)</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#9e9e9e' }]} />
              <Text size={10} color={theme['c-font-label']}>无样本</Text>
            </View>
          </View>
          <ScrollView style={styles.modalScroll}>
            {trendData.length === 0 ? (
              <Text size={13} color={theme['c-font-label']}>暂无历史数据，完成一次探测后自动记录</Text>
            ) : (
              (() => {
                // 收集所有源 ID（跨所有历史快照）
                const allSourceIds = Array.from(new Set(
                  trendData.flatMap(entry => Object.keys(entry.sources))
                ))
                // v8.1：按最新健康分从低到高排序（异常排前面，一眼看到问题源）
                // 排序权重：异常(红) < 一般(黄) < 无样本(灰) < 健康(绿)
                const getSortWeight = (id: string) => {
                  const latestScore = trendData[trendData.length - 1]?.sources[id]?.score ?? null
                  if (latestScore === null) return 2 // 无样本排中间
                  if (latestScore < -5) return 0   // 异常排最前
                  if (latestScore < 3) return 1      // 一般排第二
                  return 3                           // 健康排最后
                }
                allSourceIds.sort((a, b) => getSortWeight(a) - getSortWeight(b))
                return allSourceIds.map(id => {
                  // 源名优先用实时快照的中文名（音源侧历史快照不含 name，仅 score/successRate）；
                  // 再回退历史快照 name（兼容旧数据），最后回退 id
                  const sourceName = snapshot?.[id]?.name || (trendData[0]?.sources[id] as { name?: string } | undefined)?.name || id
                  // 最新一次探测的分数
                  const latestScore = trendData[trendData.length - 1]?.sources[id]?.score ?? null
                  const latestColor = latestScore === null ? '#9e9e9e' : latestScore >= 3 ? '#4caf50' : latestScore >= -5 ? '#ff9800' : '#f44336'
                  return (
                  <View key={id} style={styles.trendSourceRow}>
                    <Text size={11} color={theme['c-font-label']} style={styles.trendSourceName} numberOfLines={1}>{sourceName}</Text>
                    <View style={styles.trendBlocks}>
                      {trendData.map((entry, idx) => {
                        const data = entry.sources[id]
                        const score = data?.score ?? null
                        // status page 经典方块：绿=正常、黄=降级、红=异常、灰=无数据
                        let color = '#e8e8e8' // 灰：无样本
                        if (score !== null && score >= 3) color = '#4caf50' // 绿：正常
                        else if (score !== null && score >= -5) color = '#ff9800' // 黄：降级
                        else if (score !== null && score < -5) color = '#f44336' // 红：异常
                        return (
                          <View
                            key={idx}
                            style={[styles.trendBlock, { backgroundColor: color }]}
                          />
                        )
                      })}
                    </View>
                    <Text size={11} color={latestColor} style={styles.trendScore}>{latestScore === null ? '-' : latestScore.toFixed(1)}</Text>
                  </View>
                  )
                })
              })()
            )}
          </ScrollView>
          <View style={styles.modalBtnRow}>
            <Button onPress={() => setShowTrendModal(false)}>关闭</Button>
          </View>
        </View>
      </View>
    </Modal>
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  desc: {
    marginTop: 10,
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  btnGap: {
    width: 12,
  },
  // v8.0：配置弹窗样式
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 20,
  },
  modalContent: {
    borderRadius: 10,
    padding: 16,
    maxHeight: '80%',
    width: '100%',
    backgroundColor: '#fff',
  },
  modalTitle: {
    marginBottom: 12,
    fontWeight: 'bold',
  },
  modalScroll: {
    marginBottom: 12,
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  // v8.11.7：配置块（名称 + 说明 + 输入行 + 预设）
  configBlock: {
    marginBottom: 14,
  },
  configDesc: {
    marginTop: 2,
    lineHeight: 15,
  },
  configInputLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  configSection: {
    marginTop: 6,
    marginBottom: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  configSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  configSwitchText: {
    flex: 1,
    marginRight: 10,
  },
  configLabel: {
    flex: 1,
    marginRight: 8,
  },
  configInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
  },
  // v8.0：配置输入行（输入框 + 单位）
  configInputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  configUnit: {
    marginLeft: 6,
    width: 36,
  },
  // v8.0：预设按钮行
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginLeft: 'auto',
    flex: 2,
  },
  presetBtn: {
    marginLeft: 0,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  // v8.0：趋势图样式（每源一行圆点序列）
  trendSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  trendSourceName: {
    width: 90,
    marginRight: 8,
  },
  trendDots: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  // 趋势弹窗图例（此前只引用未定义，图例实际没有排版）
  trendLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  trendLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // v8.0：方块时间线趋势图样式（status page 经典风格）
  trendBlocks: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 20,
  },
  trendBlock: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  trendScore: {
    width: 36,
    textAlign: 'right',
    marginLeft: 8,
    fontWeight: 'bold',
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 4,
  },
  summaryItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tableWrap: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headRow: {
    paddingVertical: 5,
    borderRadius: 4,
  },
  colName: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  colSmall: {
    width: 58,
    alignItems: 'center',
  },
  stateChip: {
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
})
