import { type InitParams, onScriptAction, sendAction, type ResponseParams, type UpdateInfoParams, type RequestParams } from '@/utils/nativeModules/userApi'
import { log, overwriteUserApi, setUserApiList, setUserApiStatus } from '@/core/userApi'
import settingState from '@/store/setting/state'
import BackgroundTimer from 'react-native-background-timer'
import RNFS from 'react-native-fs'
import { fetchData } from './request'
import { getUserApiList, addUserApi, removeUserApi, getUserApiScript } from '@/utils/data'
import { getData, saveData, removeData } from '@/plugins/storage'
import { restoreSourceHealth, saveSourceHealth, type HealthStorage, type SourceHealthApi } from '@/core/sourceHealthPersistence'
import { confirmDialog, openUrl, tipDialog } from '@/utils/tools'
import { logger } from '@/utils/logger'
import { storageDataPrefix } from '@/config/constant'
import { normalizeSourceInfo, unwrapSourceResult } from './sourceContract'
import { BUILTIN_SOURCE_NAME, BUILTIN_SOURCE_STORAGE_KEYS, decideBuiltinSourceImport, decidePendingBuiltinSwitch, parseSourceVersion, resolveBuiltinTarget } from './builtinSource'
import { recordProbeEvents } from '@/core/healthLog'


export default async(setting: LX.AppSetting) => {
  const healthStorage: HealthStorage = { getData, saveData, removeData }
  const healthRestoreMap = new Map<string, ReturnType<typeof restoreSourceHealth>>()
  const userApiRequestMap = new Map<string, { resolve: (value: ResponseParams['result']) => void, reject: (error: Error) => void, timeout: number }>()
  const scriptRequestMap = new Map<string, { request: Promise<any>, abort: () => void }>()

  const cancelRequest = (requestKey: string, message: string) => {
    const target = scriptRequestMap.get(requestKey)
    if (!target) return
    scriptRequestMap.delete(requestKey)
    target.abort()
  }
  const sendScriptRequest = (requestKey: string, url: string, options: RequestParams['options'], sourceId?: string) => {
    // P2：只有脚本在 inited 显式声明 mediaEnvelope=2 才启用信封；旧源继续走 Buffer，避免协议回退。
    const mediaEnvelope = !!sourceId && !!global.lx.mediaEnvelopes[sourceId]
    let req = fetchData(url, { ...options, mediaEnvelope })
    req.request.then(response => {
      // console.log(response)
      sendAction('response', {
        error: null,
        requestKey,
        response,
      })
    }).catch(err => {
      sendAction('response', {
        error: err.message,
        requestKey,
        response: null,
      })
    }).finally(() => {
      scriptRequestMap.delete(requestKey)
    })
    scriptRequestMap.set(requestKey, req)
  }
  const sendUserApiRequest = async(data: LX.UserApi.UserApiRequestParams) => {
    const handleApiUpdate = () => {
      const target = userApiRequestMap.get(data.requestKey)
      if (!target) return
      userApiRequestMap.delete(data.requestKey)
      BackgroundTimer.clearTimeout(target.timeout)
      target.reject(new Error('request failed'))
    }
    const requestPromise = new Promise<ResponseParams['result']>((resolve, reject) => {
      userApiRequestMap.set(data.requestKey, {
        resolve,
        reject,
        timeout: BackgroundTimer.setTimeout(() => {
          const target = userApiRequestMap.get(data.requestKey)
          if (!target) return
          userApiRequestMap.delete(data.requestKey)
          target.reject(new Error('request timeout'))
        }, 23_000),
      })
      sendAction('request', data)
    }).finally(() => {
      global.state_event.off('apiSourceUpdated', handleApiUpdate)
    })
    global.state_event.on('apiSourceUpdated', handleApiUpdate)
    return requestPromise
  }
  const handleUserApiResponse = ({ status, result, requestKey, errorMessage }: ResponseParams) => {
    const target = userApiRequestMap.get(requestKey)
    if (!target) return
    userApiRequestMap.delete(requestKey)
    BackgroundTimer.clearTimeout(target.timeout)
    if (status) target.resolve(result)
    else target.reject(new Error(errorMessage ?? 'failed'))
  }
  const handleStateChange = ({ status, errorMessage, info }: InitParams) => {
    // console.log(status, message, info)
    setUserApiStatus(status, errorMessage)
    if (!info || info.id !== settingState.setting['common.apiSource']) return
    if (status) {
      logger.info('userApi', `[debug] 音源初始化成功，info.id = ${info.id}, info.name = ${info.name}`)
      // 诊断包溯源：记录“当前实际加载”的源版本，不能再用内置源版本冒充。
      // 失败不阻断初始化；旧数据/旧版源没有 version 时保留上一次值。
      if (typeof info.version === 'string' && info.version) {
        void saveData('active_source_version', info.version).catch(() => {})
      }
      if (info.sources) {
        let apis: any = {}
        let qualitys: LX.QualityList = {}
        const fallbackOwners: Partial<Record<LX.Source, LX.UserApi.UserApiFallbackOwner>> = {}
        for (const [source, { actions, type, qualitys: sourceQualitys, fallbackOwner }] of Object.entries(normalizeSourceInfo(info.sources))) {
          if (type != 'music') continue
          apis[source as LX.Source] = {}
          fallbackOwners[source as LX.Source] = fallbackOwner
          logger.info('userApi', `[debug] ${source} actions = ${actions.join(',')}`)
          for (const action of actions) {
            switch (action) {
              case 'musicUrl':
                apis[source].getMusicUrl = (songInfo: LX.Music.MusicInfo, type: LX.Quality, traceId?: string) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: (healthRestoreMap.get(source) ?? Promise.resolve()).then(async() => sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'musicUrl',
                        info: {
                          type,
                          musicInfo: songInfo,
                          traceId,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // 音源返回实际交付音质（res.data.type，v1.0+）；旧音源无该字段时回退请求音质
                      // v6.0：透传实际子源（subSource id + subSourceName 中文名），旧音源无字段时为空字符串
                      // v8.12.0：透传实际交付平台（sourcePlatform），跨平台兜底后标签显示真实平台
                      // P0：兼容旧 raw 与 v2 {ok,data} envelope
                      const data = unwrapSourceResult<{
                        url: string
                        type?: LX.Quality
                        subSource?: string
                        subSourceName?: string
                        sourcePlatform?: string
                        fragment?: boolean
                        qualityConfidence?: 'exact' | 'estimated' | 'unknown'
                        qualityCeilingApplied?: boolean
                      }>(res.data)
                      return {
                        type: data?.type ?? type,
                        url: data.url,
                        subSource: data?.subSource ?? '',
                        subSourceName: data?.subSourceName ?? '',
                        sourcePlatform: data?.sourcePlatform ?? '',
                        fragment: data?.fragment === true,
                        qualityConfidence: data?.qualityConfidence,
                        qualityCeilingApplied: data?.qualityCeilingApplied === true,
                      }
                    }).catch(err => {
                      console.log(err.message)
                      throw err
                    })),
                  }
                }
                break
              case 'lyric':
                apis[source].getLyric = (songInfo: LX.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'lyric',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return unwrapSourceResult(res.data)
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'pic':
                apis[source].getPic = (songInfo: LX.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'pic',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return unwrapSourceResult(res.data)
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'health':
                // v4.0：健康快照（音源 getHealthSnapshot 聚合查询，与具体源无关；任一源可调）
                apis[source].getHealth = () => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: (healthRestoreMap.get(source) ?? Promise.resolve()).then(async() => sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'health',
                        info: {},
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    })).then(res => {
                      // console.log(res)
                      return unwrapSourceResult(res.data)
                    }).then(snapshot => {
                      void saveSourceHealth(apis as Record<string, SourceHealthApi>, source, healthStorage)
                      // v8.14：把源侧探测/健康迁移事件并入本地诊断时间线（只读、去重、不上传）。
                      try {
                        const ev = apis[source].healthEvents
                        if (ev) void ev({ limit: 50 }).promise.then(async(res: { events?: unknown[] }) => await recordProbeEvents(Array.isArray(res?.events) ? res.events : [])).catch(() => {})
                      } catch {}
                      return snapshot
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'toggle':
                // v4.0：源级开关（手动启用/停用某子源；停用带 manualOff 锁定，探测不自动复活）
                apis[source].toggle = (id: string, enabled: boolean) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'toggle',
                        info: { id, enabled },
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'probe':
                // v4.0：手动触发一轮健康探测（并发 ~6s；探测中返回 running:true 不排队）
                apis[source].probe = () => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'probe',
                        info: {},
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'probeSource':
                // v8.14：单源探测。默认只读（apply=false），不改变健康状态；显式 apply=true 才落账。
                apis[source].probeSource = (id: string, options?: { apply?: boolean }) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'probeSource',
                        info: { id, apply: options?.apply === true },
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'reportPlayback':
                // v8.14：真实播放回传（playDead 的唯一真实播放入口）。App 播放成功/失败时调用。
                apis[source].reportPlayback = (id: string, info?: { ok?: boolean, quality?: string, latencyMs?: number, code?: string }) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'reportPlayback',
                        info: { sourceId: id, ...(info ?? {}) },
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'config':
                // v8.0：配置热更新（读模式不传 info 返回当前配置；写模式传 info 更新内存值）
                logger.info('userApi', `[debug] case config 执行了，source: ${source}`)
                apis[source].config = (updates?: Record<string, number>) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'config',
                        info: updates ?? {},
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'trend':
                // v8.0：健康趋势（返回历史健康快照数组；上限由音源侧 HEALTH_HISTORY_MAX 决定，v8.10 已 60→144，以返回的 maxPoints 为准）
                apis[source].trend = () => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'trend',
                        info: {},
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'healthEvents':
                // 2.4：只读事件环形缓冲（本地诊断；不提供写能力；不记歌名/URL/账号/设备）
                apis[source].healthEvents = (query?: { traceId?: string, limit?: number }) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'healthEvents',
                        info: query ?? {},
                      },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'exportHealthState':
                apis[source].exportHealth = () => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() { /* 只读导出无独立取消 */ },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: { source, action: 'exportHealthState', info: {} },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => Promise.reject(err)),
                  }
                }
                break
              case 'restoreHealthState':
                apis[source].restoreHealth = (state: unknown) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() { /* 恢复为启动期一次性动作 */ },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: { source, action: 'restoreHealthState', info: state },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => ({ ok: false, reason: String(err?.message || err) })),
                  }
                }
                break
              case 'forceQualityProbe':
                // 音质政策 P1：用户强制重试高质，绕过唯一源短路探路窗口（只放行一轮，不动 breaker/健康账本）。
                apis[source].forceQualityProbe = (id: string, quality?: string) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() { /* 同步旁路无独立取消 */ },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: { source, action: 'forceQualityProbe', info: { id, quality } },
                    }).then(res => unwrapSourceResult(res.data)).catch(async err => ({ ok: false, reason: String(err?.message || err) })),
                  }
                }
                break
              default:
                break
            }
          }
          qualitys[source as LX.Source] = sourceQualitys
        }
        // 同一脚本注册的 5 个平台 API 共享一份健康态：只恢复一次，再把这个 promise
        // 挂到每个平台上，保证各平台的 getMusicUrl 都等同一个恢复完成；避免 5 次重复桥调用和中间态。
        const restoreIds = Object.keys(apis as Record<string, unknown>).map(String)
        let restore: Promise<unknown> = Promise.resolve()
        if (restoreIds.length) {
          restore = restoreSourceHealth(apis as Record<string, SourceHealthApi>, restoreIds[0], String(info.version || ''), healthStorage)
        }
        for (const sourceId of restoreIds) healthRestoreMap.set(sourceId, restore as ReturnType<typeof restoreSourceHealth>)
        void restore
        global.lx.qualityList = qualitys
        global.lx.apis = apis
        global.lx.fallbackOwners = fallbackOwners
        global.lx.mediaEnvelopes[info.id] = info.mediaEnvelope === 2
        global.state_event.apiSourceUpdated(settingState.setting['common.apiSource'])
      }
    } else {
      if (errorMessage) {
        void tipDialog({
          message: `${global.i18n.t('user_api__init_failed_alert', { name: info.name })}\n${errorMessage}`,
          // selection: true,
          btnText: global.i18n.t('ok'),
        })
      }
    }
    if (!global.lx.apiInitPromise[1]) global.lx.apiInitPromise[2](status)
  }
  const showUpdateAlert = ({ name, log, updateUrl }: UpdateInfoParams) => {
    if (updateUrl) {
      void confirmDialog({
        message: `${global.i18n.t('user_api_update_alert', { name })}\n${log}`,
        // selection: true,
        // showCancel: true,
        confirmButtonText: global.i18n.t('user_api_update_alert_open_url'),
        cancelButtonText: global.i18n.t('close'),
      }).then(confirm => {
        if (!confirm) return
        setTimeout(() => {
          void openUrl(updateUrl)
        }, 300)
      })
    } else {
      void tipDialog({
        message: `${global.i18n.t('user_api_update_alert', { name })}\n${log}`,
        // selection: true,
        btnText: global.i18n.t('ok'),
      })
    }
  }

  onScriptAction((event) => {
    // console.log('script actuon: ', event)
    switch (event.action) {
      case 'init':
        if ((event as unknown as { errorMessage?: string }).errorMessage) event.data.errorMessage = (event as unknown as { errorMessage: string }).errorMessage
        handleStateChange(event.data)
        break
      case 'response':
        handleUserApiResponse(event.data)
        break
      case 'request':
        sendScriptRequest(event.data.requestKey, event.data.url, event.data.options, event.data.sourceId)
        break
      case 'cancelRequest':
        cancelRequest(event.data, 'request canceled')
        break
      case 'showUpdateAlert':
        showUpdateAlert(event.data)
        break
      case 'log':
        switch ((event as unknown as { type: keyof typeof log }).type) {
          case 'log':
          case 'info':
            log.info((event as unknown as { log: string }).log)
            break
          case 'error':
            log.error((event as unknown as { log: string }).log)
            break
          case 'warn':
            log.warn((event as unknown as { log: string }).log)
            break
          default:
            break
        }
        break
      default:
        break
    }
  })

  // 自动导入内置音源：首次导入 + 内置版本更新时自动升级（v-fix：内置源按专属 id 管理，
  // 升级/清理仅操作 id 标记的内置源——此前按名字(含"豆包定制")识别会把用户手动导入的同名音源
  // 误判为内置源并批量删除，导致"手动导入的新源重启后被删"）
  const userApiList = await getUserApiList()
  const builtinSourceKey = BUILTIN_SOURCE_STORAGE_KEYS.hasImported
  const builtinVersionKey = BUILTIN_SOURCE_STORAGE_KEYS.importedVersion
  const builtinSourceIdKey = BUILTIN_SOURCE_STORAGE_KEYS.sourceId
  const BUILTIN_NAME = BUILTIN_SOURCE_NAME
  let hasImportedBuiltin = !!(await getData<boolean>(builtinSourceKey))
  let importedVersion = (await getData<string>(builtinVersionKey)) ?? ''
  // 内置源 id 标记（新机制）：自动导入时记录，此后升级/清理只认这一个 id
  let storedBuiltinId = await getData<string>(builtinSourceIdKey)
  // 当前 App 版本（CI 注入的 1.9.2-bN）：换包即以内置音源为准，升级/降级都覆盖
  const currentAppVersion = (process as unknown as { versions?: { app?: string } }).versions?.app ?? ''
  const storedAppVersion = (await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.appVersion)) ?? ''

  // 在线升级“导入成功但切源结果不确定”的启动对账：
  // - 待切换源已是当前选中源：视为迟到成功，提升为内置源并补版本；
  // - 待切换源还在但未选中：保留孤儿源，阻止本次启动再次导入；
  // - 待切换源已被用户删除：清掉 pending，恢复正常升级流程。
  const pendingSourceId = (await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)) ?? ''
  if (pendingSourceId) {
    const activeSourceId = (setting['common.apiSource'] as string | undefined) ?? ''
    let pendingVersion = ''
    if (activeSourceId === pendingSourceId) {
      try {
        pendingVersion = parseSourceVersion(await getUserApiScript(pendingSourceId))
      } catch (e) {
        console.warn('Failed to read pending builtin source version:', e)
      }
    }
    const pendingDecision = decidePendingBuiltinSwitch({
      pendingSourceId,
      sourceIds: userApiList.map(api => api.id),
      activeSourceId,
      pendingVersion,
    })
    if (pendingDecision.action === 'promote-active') {
      const previousBuiltinId = storedBuiltinId
      storedBuiltinId = pendingSourceId
      importedVersion = pendingDecision.promoteVersion
      hasImportedBuiltin = true
      await saveData(builtinSourceIdKey, pendingSourceId)
      await saveData(builtinSourceKey, true)
      await saveData(builtinVersionKey, pendingDecision.promoteVersion)
      await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)
      // 迟到的切源已成功，旧内置源不再是当前选中源，可以安全清理。
      if (previousBuiltinId && previousBuiltinId !== pendingSourceId) {
        const idx = userApiList.findIndex(api => api.id === previousBuiltinId)
        if (idx >= 0) {
          await removeUserApi([previousBuiltinId]).catch((e) => {
            console.warn('Failed to remove previous builtin source:', e)
          })
          userApiList.splice(idx, 1)
        }
      }
      console.log('pending builtin source promoted:', pendingSourceId, pendingDecision.promoteVersion)
    } else if (pendingDecision.action === 'clear-stale') {
      await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)
      console.log('pending builtin source cleared:', pendingSourceId)
    } else if (pendingDecision.action === 'block-import') {
      // 覆盖式更新不会多出副本，这里只记录，不再阻断本次覆盖
      console.log('pending builtin source still unselected, ignored:', pendingSourceId)
    }
  }

  // 定位"真正要覆盖的那一份内置源"：优先按 id 标记；无标记时同名唯一即认它；
  // 多份同名（旧内置与用户手动导入并存）时，只认“正在启用的那份”——音源同时只能启用一个，
  // 未启用的同名旧版属于用户手动导入，不动。启用的不是它们就放弃（绝不猜、绝不新增副本）。
  const builtinTarget = resolveBuiltinTarget({
    storedId: storedBuiltinId ?? '',
    activeId: (setting['common.apiSource'] as string | undefined) ?? '',
    list: userApiList.map(api => ({ id: api.id, name: api.name })),
    builtinName: BUILTIN_NAME,
  })
  const builtinApi = builtinTarget.targetId
    ? userApiList.find(api => api.id === builtinTarget.targetId)
    : undefined

  // 版本只认 `@version` 首 token；`聚合音源 vX` 旧标记已废弃，避免与设置页/在线升级分叉。
  let builtinVer = ''
  try {
    const probeScript = await RNFS.readFileAssets('builtin_source.js', 'utf8')
    builtinVer = parseSourceVersion(probeScript)
  } catch (e) {
    console.warn('Failed to read builtin source version:', e)
  }

  // 触发升级：首次安装；或内置版本严格高于已导入版本。禁止旧内置源覆盖在线升级。
  const importDecision = decideBuiltinSourceImport({
    hasBuiltinSource: !!builtinApi,
    hasImported: hasImportedBuiltin,
    builtinVersion: builtinVer,
    importedVersion,
    appVersion: currentAppVersion,
    importedAppVersion: storedAppVersion,
  })
  console.log('builtin source decision:', importDecision.reason, importDecision.builtinVersion || '-', importDecision.importedVersion || '-')

  if (importDecision.shouldImport) {
    try {
      // RN 的 fetch 基于 OkHttp，不支持 file:// 协议，读取内置 assets 必须用 react-native-fs
      const script = await RNFS.readFileAssets('builtin_source.js', 'utf8')
      if (script && script.length > 1000) {
        // 已定位到目标：就地覆盖同一 id（不新增、不删除、不换 id），用户只会看到版本变了
        let newApi: LX.UserApi.UserApiInfo
        if (builtinApi) {
          newApi = await overwriteUserApi(builtinApi.id, script)
          const idx = userApiList.findIndex(api => api.id === builtinApi.id)
          if (idx >= 0) userApiList.splice(idx, 1, newApi)
          console.log('builtin source overwritten in place:', newApi.id)
        } else {
          // 全新安装：库里没有任何同名源，才新增一份
          newApi = await addUserApi(script)
        }
        if (!userApiList.some(api => api.id === newApi.id)) {
          userApiList.push(newApi)
          // 仅当当前正使用旧内置源（或未选音源）时切换到新内置源；
          // 用户手动选择的其它音源保持不变，不被升级覆盖
          const curSource = setting['common.apiSource'] as string | undefined
          const usingOldBuiltin = !curSource || builtinApi?.id === curSource
          if (usingOldBuiltin) {
            setting['common.apiSource'] = newApi.id
            // 持久化 apiSource，避免仅内存生效导致重启后选中状态丢失
            try {
              const stored = await getData<Partial<LX.AppSetting>>(storageDataPrefix.setting)
              if (stored) {
                stored['common.apiSource'] = newApi.id
                await saveData(storageDataPrefix.setting, stored)
              }
            } catch (e) {
              console.warn('Failed to persist apiSource:', e)
            }
          }
        }
        // 记录内置源 id（升级/清理仅以此为准）与版本标记。
        // 首次读 assets 只用于决策；若它失败而这次导入读取成功，用第二次脚本回填版本，
        // 避免 importedVersion 为空导致后续每次启动都重复导入。
        const verifiedBuiltinVersion = builtinVer || parseSourceVersion(script)
        await saveData(builtinSourceIdKey, newApi.id)
        await saveData(builtinSourceKey, true)
        if (verifiedBuiltinVersion) await saveData(builtinVersionKey, verifiedBuiltinVersion)
        // 记下“这次同步发生在哪个 App 版本”，下次同包重启才不会又当成换包
        if (currentAppVersion) await saveData(BUILTIN_SOURCE_STORAGE_KEYS.appVersion, currentAppVersion)
        console.log('builtin source imported/updated:', newApi.name, verifiedBuiltinVersion || '')
      }
    } catch (e) {
      console.warn('Failed to load builtin source:', e)
    }
  }
  setUserApiList(userApiList)
}
