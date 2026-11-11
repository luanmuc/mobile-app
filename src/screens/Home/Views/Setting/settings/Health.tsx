import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { StyleSheet, View, ScrollView, TextInput, Modal, Switch, Pressable } from 'react-native'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { getData, saveData } from '@/plugins/storage'
import { logger } from '@/utils/logger'
import {
  BOOL_CONFIG_DEFAULT,
  BOOL_CONFIG_KEYS,
  CONFIG_UNIT_CONFIG,
  buildConfigUpdates,
  configDescKey,
  configLabelKey,
  msToDisplay,
} from '@/core/sourceConfig'
import { classifyHealthState, hasHealthSample, summarizeHealthItems } from '@/core/healthStatus'
import { buildEvidencePackage, buildHealthReport, type HealthReport } from '@/core/healthDiagnostics'
import { buildHealthDiagnosticsView } from '@/core/healthDiagnosticsView'
import { REPORT_EVENT_LIMIT, ensureHealthLogsDir, exportAndShareDiagnostics, readDiagnoseLogTail, readRecentHealthEvents } from '@/core/healthLog'
import { clipboardWriteText } from '@/utils/tools'

// 音源健康快照（音源 getHealthSnapshot 聚合查询；v4.0：无样本 successRate/avgTime 为 null + 样本计数；v4.0：sleeping 休眠字段）
interface HealthItem {
  [key: string]: unknown
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
// 状态 → 文案/颜色/摘要桶统一由 @/core/healthStatus 判定，这里不再维护第二套 if。

// 配置名/说明、源名、单位、弹窗文案全部走 i18n，中文硬编码不再保留。

// 获取当前音源的健康查询器（任一声明对应 action 的源均可，聚合结果与源无关）
const getQuerier = (fn: 'getHealth' | 'toggle' | 'probe' | 'config' | 'trend'): ((...args: any[]) => { promise: Promise<unknown> }) | null => {
  const apis = (global as any).lx?.apis as Record<string, any> | undefined
  if (!apis) return null
  const sourceId = Object.keys(apis).find(id => typeof apis[id]?.[fn] === 'function')
  return sourceId ? apis[sourceId][fn] : null
}

// 无样本（未产生任何请求/探测）判定
const hasSample = hasHealthSample

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const tt = (key: string) => t(key as Parameters<typeof t>[0])
  const ignored = (promise: Promise<unknown>) => { promise.catch(e => { logger.warn('Health', String(e)) }) }
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
  // v8.11.7：逐项校验错误（保存前全量校验，任一错误整次不提交）
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({})
  // v8.0：趋势图相关 state
  const [trendData, setTrendData] = useState<Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }>>([])
  const [showTrendModal, setShowTrendModal] = useState(false)
  // 2.4：本地诊断报告（最近异常 + 一键导出）
  const [diagnostics, setDiagnostics] = useState<HealthReport | null>(null)
  // 趋势预警只保留报告一套判定，页面不再维护第二套阈值
  const trendDeclineFindings = diagnostics?.findings.filter(f => f.id === 'trend_decline') ?? []
  // 诊断窗口默认折叠，点标题展开；避免首屏被一大段统计和线索占满
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshDiagnostics = useCallback(async(snap: HealthSnapshot | null, history: Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }>) => {
    try {
      await ensureHealthLogsDir()
      const events = await readRecentHealthEvents(REPORT_EVENT_LIMIT)
      const report = buildHealthReport({ events, snapshot: (snap ?? {}), trend: history, now: Date.now(), truncated: events.length >= REPORT_EVENT_LIMIT })
      setDiagnostics(report)
    } catch (e) {
      console.log('health diagnostics failed:', e)
    }
  }, [])

  const reportToText = useCallback((report: HealthReport) => [
    report.summary,
    ...report.findings.slice(0, 5).map(f => `- ${f.title}：${f.evidence}；建议：${f.suggestion}`),
  ].join('\n'), [])

  const copyDiagnosticsReport = useCallback(() => {
    if (!diagnostics) return
    clipboardWriteText(reportToText(diagnostics))
    setProbeInfo(t('health_copy_done'))
  }, [diagnostics, reportToText, t])

  const exportDiagnosticsPackage = useCallback(async() => {
    let report: HealthReport | null = null
    try {
      const events = await readRecentHealthEvents(REPORT_EVENT_LIMIT)
      const logTail = await readDiagnoseLogTail()
      report = buildHealthReport({ events, snapshot: snapshot ?? {}, trend: trendData, now: Date.now(), truncated: events.length >= REPORT_EVENT_LIMIT })
      const appVersion = (process as unknown as { versions?: { app?: string } }).versions?.app
      const sourceVersion = (await getData<string>('imported_builtin_source_version')) ?? undefined
      const pkg = buildEvidencePackage({ report, events, snapshot: snapshot ?? {}, trend: trendData, logTail, appVersion, sourceVersion })
      const path = await exportAndShareDiagnostics(pkg)
      if (path) {
        setProbeInfo(`${t('health_export_done')} ${path}`)
        return
      }
      setError(t('health_export_failed'))
    } catch (e: any) {
      setError(String(e?.message || t('health_export_failed')))
    }
    // 分享通道不可用（无文件管理器/分享取消/写盘失败）时，至少把摘要复制出来，
    // 避免用户点一次导出只得到一句“失败”而拿不到任何现场。
    if (report) {
      clipboardWriteText(reportToText(report))
      setProbeInfo(t('health_copy_done'))
    }
  }, [snapshot, trendData, t, reportToText])

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
      const data = await promise as HealthSnapshot
      setSnapshot(data)
      // 成功拿到数据说明音源支持 health action，之前的 error（如"未检测到音源"）是误报，清空
      setError('')

      // 自动获取趋势数据，判断健康分连续下降（提前预警）
      try {
        const trendQuerier = getQuerier('trend')
        if (trendQuerier) {
          const trendPromise = trendQuerier().promise
          const trendResult = await trendPromise as { history?: Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }> } | null
          // 历史快照结构固定为 { timestamp, sources }，显式声明类型，避免下游 entry/s 变成隐式 any
          const history = trendResult?.history ?? []
          setTrendData(history)
          void refreshDiagnostics(data, history)
        }
      } catch (e) {
        // trend 获取失败不影响主流程，静默忽略
        console.log('trend auto load failed:', e)
        void refreshDiagnostics(data, [])
      }
    } catch (e: any) {
      console.log(e)
      if (!silent) setError(String(e?.message || t('health_load_failed')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [t, refreshDiagnostics])

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
      const res = await promise as { running?: boolean, doneAt?: number | string, active?: unknown[], sleeping?: unknown[] } | null
      if (res?.running) {
        setProbeInfo(t('health_probe_running'))
      } else if (res) {
        const time = new Date(res.doneAt ?? Date.now())
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
    setConfigErrors({})
    const querier = getQuerier('config')
    logger.info('Health', `[debug] getQuerier(config) = ${querier ? 'function' : 'null'}`)
    const apis = globalThis.lx?.apis
    logger.info('Health', `[debug] apis keys = ${Object.keys(apis ?? {}).join(',')}`)
    logger.info('Health', `[debug] apis.wy keys = ${Object.keys(apis?.wy ?? {}).join(',')}`)
    if (!querier) {
      setError(t('health_no_source'))
      return
    }
    try {
      const { promise } = querier()
      const res = await promise as Record<string, unknown> | null
      setConfigData(res)
      // v8.0：ms值自动转成直观单位值显示（比如 21600000ms → 6小时）
      // v8.11.7：只把有单位配置的数字键放进输入框；布尔键进开关，卡密/对象键不渲染
      setConfigInputs(Object.fromEntries(
        Object.entries(res ?? {})
          .filter(([k]) => !!CONFIG_UNIT_CONFIG[k])
          .map(([k, v]) => [k, String(msToDisplay(k, Number(v)))]),
      ))
      setConfigBools(Object.fromEntries(
        BOOL_CONFIG_KEYS.map(k => [k, typeof res?.[k] === 'boolean' ? res[k] as boolean : BOOL_CONFIG_DEFAULT[k]]),
      ))
      setShowConfigModal(true)
    } catch (e: any) {
      setError(String(e?.message || t('health_load_failed')))
    }
  }, [t])

  // v8.11.7：保存配置（全量校验 → 有错整次不提交 → 写模式 + 本地持久化）
  const saveConfig = useCallback(async() => {
    setError('')
    setConfigErrors({})
    const querier = getQuerier('config')
    const { updates, errors } = buildConfigUpdates(configData, configInputs, configBools)
    const errorKeys = Object.keys(errors)
    if (errorKeys.length) {
      setConfigErrors(errors)
      setError(t('health_config_errors', { n: errorKeys.length }))
      return
    }
    try {
      if (Object.keys(updates).length === 0) {
        setShowConfigModal(false)
        setProbeInfo(t('health_config_no_change'))
        return
      }
      if (querier) {
        const { promise } = querier(updates)
        await promise
      }
      await saveData('lx_source_config', updates)
      setShowConfigModal(false)
      setProbeInfo(t('health_config_saved', { n: Object.keys(updates).length }))
    } catch (e: any) {
      setError(String(e?.message || t('health_config_save_failed')))
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
      const res = await promise as { history?: Array<{ timestamp: number, sources: Record<string, { score: number | null, successRate: number | null }> }> } | null
      setTrendData(res?.history ?? [])
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
  const sourceLabel = (id: string, fallback?: string) => {
    const name = tt(`health_source_${id}`)
    if (name !== '') return name
    if (fallback != null && fallback !== '') return fallback
    return id
  }
  const platformLabel = (id: string) => {
    const name = tt(`health_platform_${id}`)
    return name !== '' ? name : id
  }
  const configErrorText = (code: string) => {
    const map: Record<string, string> = {
      'not-in-source': 'not_in_source',
      empty: 'empty',
      'not-number': 'not_number',
      negative: 'negative',
      'zero-not-allowed': 'zero',
      'below-min': 'below_min',
      'above-max': 'above_max',
      'not-boolean': 'not_boolean',
      missing: 'missing',
      __form: 'not_in_source',
    }
    return tt(`health_config_err_${map[code] || 'not_in_source'}`)
  }
  const platformSummary = snapshot?._platformSummary as Record<string, { degraded: boolean, activeCount: number, deadCount: number }> | undefined
  const fallbackPlatform = snapshot?._fallbackPlatform as string | undefined
  const degradedPlatforms = platformSummary ? Object.entries(platformSummary).filter(([, v]) => v.degraded).map(([k]) => platformLabel(k)) : []

  const items = snapshot ? Object.entries(snapshot)
    .filter(([id]) => !id.startsWith('_')) // 过滤平台聚合等特殊字段
    .map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => {
      const g = groupRank(a) - groupRank(b)
      return g !== 0 ? g : b.healthScore - a.healthScore
    }) : []

  // 聚合摘要：与表格共用同一分类函数，9 桶（含已摘除/限流），合计=源数
  const summary = summarizeHealthItems(items)

  // 窗口展示逻辑收敛到纯函数视图模型，页面只负责文案与样式
  const diagView = diagnostics ? buildHealthDiagnosticsView(diagnostics) : null

  const renderFinding = (f: HealthReport['findings'][number], idx: number) => {
    const key = `${f.id}-${idx}`
    const expanded = expandedFinding === key
    return (
      <View key={key} style={{ marginTop: 6 }}>
        <Pressable onPress={() => { setExpandedFinding(expanded ? null : key) }}>
          <Text size={12} color={f.level === 'warn' ? '#fa541c' : theme['c-font']}>
            {f.title}{f.samples?.length ? (expanded ? ' ▾' : ' ▸') : ''}
          </Text>
        </Pressable>
        <Text size={11} color={theme['c-font-label']}>{f.evidence}</Text>
        <Text size={11} color={theme['c-font-label']}>{t('health_anomaly_suggestion')}：{f.suggestion}</Text>
        {
          expanded && f.samples?.length ? (
            <View style={{ marginTop: 4 }}>
              {f.samples.map((sample, i) => (
                <Text key={i} size={10} color={theme['c-font-label']} style={{ marginTop: 2 }}>
                  {new Date(sample.ts).toLocaleTimeString()} · {sample.source}{sample.code ? ` · ${sample.code}` : ''}{sample.latencyMs != null ? ` · ${sample.latencyMs}ms` : ''}{sample.traceId ? ` · ${sample.traceId}` : ''}
                </Text>
              ))}
            </View>
          ) : null
        }
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps={'always'}>
    <Section title={t('setting_health')}>
      <SubTitle title={t('health_desc')}>
        <View style={styles.btnRow}>
          <Button onPress={() => { ignored(loadHealth()) }} disabled={loading}>{loading ? t('health_loading') : t('health_refresh')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => { ignored(runProbe()) }}>{t('health_probe')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => { ignored(showConfig()) }}>{t('health_config_btn')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={() => { ignored(showTrend()) }}>{t('health_trend_btn')}</Button>
        </View>
        <View style={styles.btnRow}>
          <Button onPress={() => { ignored(exportDiagnosticsPackage()) }}>{t('health_export_diag')}</Button>
          <View style={styles.btnGap} />
          <Button onPress={copyDiagnosticsReport} disabled={!diagnostics}>{t('health_copy_report')}</Button>
          <View style={styles.btnGap} />
          <Text size={11} color={theme['c-font-label']} style={{ flex: 1 }}>{t('health_export_hint')}</Text>
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
              <Text size={12} color="#d48806">{t('health_platform_degraded', { platforms: degradedPlatforms.join(t('health_list_separator')) })}</Text>
              {fallbackPlatform ? <Text size={11} color={theme['c-font-label']}>{t('health_platform_fallback', { platform: platformLabel(fallbackPlatform) })}</Text> : null}
            </View>
          ) : null
        }
        {
          // 趋势预警单一来源：直接展示本地诊断报告里的 trend_decline finding
          trendDeclineFindings.length ? (
            <View style={[styles.summary, { backgroundColor: '#fff2e8' }]}>
              <Text size={12} color="#fa541c">{t('health_declining')} {trendDeclineFindings.map(f => f.title).join(t('health_list_separator'))}</Text>
              <Text size={11} color={theme['c-font-label']}>{t('health_decline_hint')}</Text>
            </View>
          ) : null
        }
        {
          diagView ? (
            <View style={[styles.diagnosticsBox, { borderColor: theme['c-border-background'] }]}>
              <Pressable onPress={() => { setDiagnosticsExpanded(v => !v) }} style={styles.diagHeader}>
                <View style={{ flex: 1 }}>
                  <Text size={12} style={{ fontWeight: 'bold' }}>{t('health_recent_anomaly')}</Text>
                  <Text size={11} color={theme['c-font-label']} style={{ marginTop: 2 }}>
                    {diagView.stats.total
                      ? `${diagView.collapsed.ok}/${diagView.collapsed.total} · ${diagView.collapsed.rateText} · ${diagView.collapsed.findingCount}${t('health_diag_items')}`
                      : diagView.cacheHits.hasAny
                        ? t('health_diag_cache_collapsed', { n: diagView.cacheHits.h24 })
                        : t('health_diag_none')}
                  </Text>
                  <Text size={10} color={diagView.coverage.full ? '#52c41a' : '#fa8c16'} style={{ marginTop: 2 }}>
                    {diagView.coverage.full
                      ? t('health_diag_coverage_full')
                      : t('health_diag_coverage_short', { span: diagView.coverage.span })}
                    {diagView.coverage.truncated ? ` · ${t('health_diag_truncated')}` : ''}
                  </Text>
                </View>
                <Text size={14} color={theme['c-font-label']}>{diagnosticsExpanded ? '▾' : '▸'}</Text>
              </Pressable>
              {
                diagnosticsExpanded ? (
                  <View>
                    <View style={[styles.diagStats, { marginTop: 4 }]}>
                      <View style={styles.diagStat}>
                        <Text size={10} color={theme['c-font-label']}>{t('health_diag_h24')}</Text>
                        <Text size={18}>{diagView.stats.total}</Text>
                      </View>
                      <View style={styles.diagStat}>
                        <Text size={10} color={theme['c-font-label']}>{t('health_diag_ok')}</Text>
                        <Text size={18} color="#52c41a">{diagView.stats.ok}</Text>
                      </View>
                      <View style={styles.diagStat}>
                        <Text size={10} color={theme['c-font-label']}>{t('health_diag_failed')}</Text>
                        <Text size={18} color="#ff4d4f">{diagView.stats.failed}</Text>
                      </View>
                      <View style={styles.diagStat}>
                        <Text size={10} color={theme['c-font-label']}>{t('health_diag_rate')}</Text>
                        <Text size={18} color={diagView.stats.rateWarn ? '#ff4d4f' : theme['c-font']}>
                          {diagView.stats.rateText}
                        </Text>
                      </View>
                    </View>
                    <Text size={11} color={theme['c-font-label']} style={{ marginTop: 6 }}>
                      {diagView.h1.empty
                        ? t('health_diag_h1_none')
                        : t('health_diag_h1', { n: diagView.h1.total, ok: diagView.h1.ok })}
                    </Text>
                    <Text size={11} color={theme['c-font-label']} style={{ marginTop: 2 }}>
                      {t('health_diag_cache_hits', { n: diagView.cacheHits.h24 })}
                    </Text>
                    <Text size={11} color={theme['c-font-label']} style={{ marginTop: 2 }}>
                      {diagView.weighting.hasUnweighted
                        ? t('health_diag_unweighted', { n: diagView.weighting.unweightedSuccesses })
                        : t('health_diag_weighted')}
                    </Text>
                    {
                      diagView.codes.length ? (
                        <View>
                          <Text size={11} style={styles.diagSection}>{t('health_diag_codes')}</Text>
                          {diagView.codes.map(renderFinding)}
                        </View>
                      ) : null
                    }
                    {
                      diagView.others.length ? (
                        <View>
                          <Text size={11} style={styles.diagSection}>{t('health_diag_other')}</Text>
                          {diagView.others.map(renderFinding)}
                        </View>
                      ) : null
                    }
                    {diagView.empty ? (
                      <Text size={11} color={theme['c-font-label']} style={{ marginTop: 8 }}>{t('health_diag_none')}</Text>
                    ) : null}
                  </View>
                ) : null
              }
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
                <Text size={12} color="#ff4d4f">● {summary.removed}{t('health_sum_removed')}</Text>
                <Text size={12} color="#faad14">● {summary.rate}{t('health_sum_rate')}</Text>
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
                  const status = classifyHealthState(item, sampled)
                  const stateText = tt(status.key)
                  const stateColor = status.tone === 'ok' ? '#52c41a'
                    : status.tone === 'warn' ? '#faad14'
                      : status.tone === 'bad' ? '#ff4d4f'
                        : theme['c-font-label']
                  // 健康分 10 分制（音源 v7.0 起快照 ×10）：一位小数；阈值 ≥3 绿 / ≥−5 默认 / <−5 红
                  const scoreText = !sampled ? '-' : item.healthScore.toFixed(1)
                  const scoreColor = !sampled ? theme['c-font-label']
                    : item.healthScore >= 3 ? '#52c41a' : item.healthScore >= -5 ? theme['c-font'] : '#ff4d4f'
                  const rateColor = !sampled || item.successRate == null ? theme['c-font-label']
                    : item.successRate >= 0.6 ? theme['c-font'] : '#ff4d4f'
                  return (
                    <View key={id} style={[styles.row, { borderBottomColor: theme['c-border-background'] }]}>
                      <Text numberOfLines={1} size={12} style={styles.colName} color={item.enabled ? theme['c-font'] : theme['c-font-label']}>{sourceLabel(id, item.name)}</Text>
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
          <Text size={16} color={theme['c-font']} style={styles.modalTitle}>{t('health_config_title')}</Text>
          {error ? <Text size={11} color="#ff4d4f">{error}</Text> : null}
          <ScrollView style={styles.modalScroll}>
            {configData && Object.keys(configData)
              .filter(key => !!CONFIG_UNIT_CONFIG[key])
              .map(key => {
                const unitCfg = CONFIG_UNIT_CONFIG[key]
                const unit = tt(unitCfg.unit)
                const presets = unitCfg.presets
                const currentVal = configInputs[key] ?? ''
                return (
                  <View key={key} style={styles.configBlock}>
                    <Text size={12} color={theme['c-font']} style={styles.configLabel}>{tt(configLabelKey(key)) || key}</Text>
                    {<Text size={10} color={theme['c-font-label']} style={styles.configDesc}>{tt(configDescKey(key))}</Text>}
                    <View style={styles.configInputLine}>
                      <TextInput
                        style={[styles.configInput, { borderColor: theme['c-border-background'], color: theme['c-font'] }]}
                        value={currentVal}
                        onChangeText={(text) => {
                          setConfigInputs(prev => ({ ...prev, [key]: text }))
                          setConfigErrors(prev => {
                            if (!prev[key]) return prev
                            const next = { ...prev }
                            delete next[key]
                            return next
                          })
                        }}
                        keyboardType="numeric"
                      />
                      {unit ? <Text size={11} color={theme['c-font-label']} style={styles.configUnit}>{unit}</Text> : null}
                    </View>
                    {configErrors[key] ? <Text size={10} color="#ff4d4f">{configErrorText(configErrors[key])}</Text> : null}
                    {/* 预设按钮 */}
                    {presets.length > 0 && (
                      <View style={styles.presetRow}>
                        {presets.map(p => {
                          const isActive = currentVal === String(p)
                          return (
                            <Button
                              key={p}
                              style={styles.presetBtn}
                              onPress={() => { setConfigInputs(prev => ({ ...prev, [key]: String(p) })) }}
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
                <Text size={12} color={theme['c-font']}>{t('health_advanced_toggle')}</Text>
                <Text size={10} color={theme['c-font-label']}>{t('health_advanced_warning')}</Text>
              </View>
            ) : null}
            {configData && BOOL_CONFIG_KEYS.map(key => (
              <View key={key} style={styles.configSwitchRow}>
                <View style={styles.configSwitchText}>
                  <Text size={12} color={theme['c-font']}>{tt(configLabelKey(key)) || key}</Text>
                  {<Text size={10} color={theme['c-font-label']} style={styles.configDesc}>{tt(configDescKey(key))}</Text>}
                  {configErrors[key] ? <Text size={10} color="#ff4d4f">{configErrorText(configErrors[key])}</Text> : null}
                </View>
                <Switch
                  value={configBools[key] ?? BOOL_CONFIG_DEFAULT[key]}
                  onValueChange={(v) => {
                    setConfigBools(prev => ({ ...prev, [key]: v }))
                    setConfigErrors(prev => {
                      if (!prev[key]) return prev
                      const next = { ...prev }
                      delete next[key]
                      return next
                    })
                  }}
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
                  if (key in (configData ?? {})) {
                    defaults[key] = String(cfg.default)
                  }
                }
                setConfigInputs(prev => ({ ...prev, ...defaults }))
                setConfigBools(prev => ({ ...prev, ...BOOL_CONFIG_DEFAULT }))
              }}
            >
              {t('health_restore_default')}
            </Button>
            <View style={styles.btnGap} />
            <Button onPress={() => { setShowConfigModal(false) }}>{t('health_cancel')}</Button>
            <View style={styles.btnGap} />
            <Button onPress={() => { ignored(saveConfig()) }}>{t('health_save')}</Button>
          </View>
        </View>
      </View>
    </Modal>

    {/* v8.0：健康趋势弹窗 */}
    <Modal visible={showTrendModal} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text size={16} color={theme['c-font']} style={styles.modalTitle}>{t('health_trend_title', { n: trendData.length })}</Text>
          {/* 图例说明 */}
          <View style={styles.trendLegend}>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#4caf50' }]} />
              <Text size={10} color={theme['c-font-label']}>{t('health_trend_healthy')}</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#ff9800' }]} />
              <Text size={10} color={theme['c-font-label']}>{t('health_trend_fair')}</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#f44336' }]} />
              <Text size={10} color={theme['c-font-label']}>{t('health_trend_bad')}</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDot, { backgroundColor: '#9e9e9e' }]} />
              <Text size={10} color={theme['c-font-label']}>{t('health_trend_none')}</Text>
            </View>
          </View>
          <ScrollView style={styles.modalScroll}>
            {trendData.length === 0 ? (
              <Text size={13} color={theme['c-font-label']}>{t('health_trend_empty')}</Text>
            ) : (
              (() => {
                // 收集所有源 ID（跨所有历史快照）
                const allSourceIds = Array.from(new Set(
                  trendData.flatMap(entry => Object.keys(entry.sources)),
                ))
                // v8.1：按最新健康分从低到高排序（异常排前面，一眼看到问题源）
                // 排序权重：异常(红) < 一般(黄) < 无样本(灰) < 健康(绿)
                const getSortWeight = (id: string) => {
                  const latestScore = trendData[trendData.length - 1]?.sources[id]?.score ?? null
                  if (latestScore === null) return 2 // 无样本排中间
                  if (latestScore < -5) return 0 // 异常排最前
                  if (latestScore < 3) return 1 // 一般排第二
                  return 3 // 健康排最后
                }
                allSourceIds.sort((a, b) => getSortWeight(a) - getSortWeight(b))
                return allSourceIds.map(id => {
                  // 源名优先用实时快照的中文名（音源侧历史快照不含 name，仅 score/successRate）；
                  // 再回退历史快照 name（兼容旧数据），最后回退 id
                  const sourceName = sourceLabel(id, snapshot?.[id]?.name ?? (trendData[0]?.sources[id] as { name?: string } | undefined)?.name)
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
            <Button onPress={() => { setShowTrendModal(false) }}>{t('health_close')}</Button>
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
  diagnosticsBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  diagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diagStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 10,
  },
  diagStat: {
    minWidth: 64,
  },
  diagSection: {
    marginTop: 10,
    marginBottom: 2,
    fontWeight: 'bold',
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
