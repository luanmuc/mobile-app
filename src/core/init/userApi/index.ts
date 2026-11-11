import { type InitParams, onScriptAction, sendAction, type ResponseParams, type UpdateInfoParams, type RequestParams } from '@/utils/nativeModules/userApi'
import { log, setUserApiList, setUserApiStatus } from '@/core/userApi'
import settingState from '@/store/setting/state'
import BackgroundTimer from 'react-native-background-timer'
import RNFS from 'react-native-fs'
import { fetchData } from './request'
import { getUserApiList, addUserApi, removeUserApi } from '@/utils/data'
import { getData, saveData } from '@/plugins/storage'
import { confirmDialog, openUrl, tipDialog } from '@/utils/tools'
import { logger } from '@/utils/logger'
import { storageDataPrefix } from '@/config/constant'
import { normalizeSourceInfo, unwrapSourceResult } from './sourceContract'


export default async(setting: LX.AppSetting) => {
  const userApiRequestMap = new Map<string, { resolve: (value: ResponseParams['result']) => void, reject: (error: Error) => void, timeout: number }>()
  const scriptRequestMap = new Map<string, { request: Promise<any>, abort: () => void }>()

  const cancelRequest = (requestKey: string, message: string) => {
    const target = scriptRequestMap.get(requestKey)
    if (!target) return
    scriptRequestMap.delete(requestKey)
    target.abort()
  }
  const sendScriptRequest = (requestKey: string, url: string, options: RequestParams['options']) => {
    let req = fetchData(url, options)
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
        }, 20_000),
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
                    promise: sendUserApiRequest({
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
                      }>(res.data)
                      return {
                        type: data?.type ?? type,
                        url: data.url,
                        subSource: data?.subSource ?? '',
                        subSourceName: data?.subSourceName ?? '',
                        sourcePlatform: data?.sourcePlatform ?? '',
                      }
                    }).catch(err => {
                      console.log(err.message)
                      throw err
                    }),
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
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'health',
                        info: {},
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
              default:
                break
            }
          }
          qualitys[source as LX.Source] = sourceQualitys
        }
        global.lx.qualityList = qualitys
        global.lx.apis = apis
        global.lx.fallbackOwners = fallbackOwners
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
        sendScriptRequest(event.data.requestKey, event.data.url, event.data.options)
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
  const builtinSourceKey = 'has_imported_builtin_source'
  const builtinVersionKey = 'imported_builtin_source_version'
  const builtinSourceIdKey = 'builtin_source_id'
  const BUILTIN_NAME = '豆包定制[聚合音源]'
  const hasImportedBuiltin = await getData<boolean>(builtinSourceKey)
  const importedVersion = (await getData<string>(builtinVersionKey)) ?? ''
  // 内置源 id 标记（新机制）：自动导入时记录，此后升级/清理只认这一个 id
  const storedBuiltinId = await getData<string>(builtinSourceIdKey)

  // 定位"真正的内置源"：优先按 id 标记；历史数据无标记时做一次性迁移——
  // 名字精确匹配内置名且唯一时视为内置源；多份同名（旧内置与用户手动导入并存）时
  // 无法区分，为保护用户数据【不做任何自动升级/清理】（用户手动导入的新源永不被删）
  let builtinApi: LX.UserApi.UserApiInfo | undefined
  let canManageBuiltin = false
  if (storedBuiltinId) {
    builtinApi = userApiList.find(api => api.id === storedBuiltinId)
    canManageBuiltin = !!builtinApi || !hasImportedBuiltin
  } else {
    const named = userApiList.filter(api => api.name === BUILTIN_NAME)
    if (named.length === 0) {
      // 全新安装：无内置源 → 允许首次导入
      canManageBuiltin = !hasImportedBuiltin
    } else if (named.length === 1) {
      builtinApi = named[0]
      canManageBuiltin = true
    }
    // named.length > 1：无法区分内置/手动 → 不冒险（canManageBuiltin 保持 false）
  }

  // 读取内置脚本并解析聚合源版本号（logInfo 里的 v1.0 形式；匹配失败则仅首次导入）
  let builtinVer = ''
  try {
    const probeScript = await RNFS.readFileAssets('builtin_source.js', 'utf8')
    const m = probeScript.match(/聚合音源\s*v(\d+(?:\.\d+)*)/)
    builtinVer = m ? m[1] : ''
  } catch (e) {
    console.warn('Failed to read builtin source version:', e)
  }

  // 触发升级：内置版本变化（App 更新带新源）；或全新安装首次导入
  const needImport = canManageBuiltin && ((builtinVer && builtinVer != importedVersion) || (!hasImportedBuiltin && !builtinApi))

  if (needImport) {
    try {
      // RN 的 fetch 基于 OkHttp，不支持 file:// 协议，读取内置 assets 必须用 react-native-fs
      const script = await RNFS.readFileAssets('builtin_source.js', 'utf8')
      if (script && script.length > 1000) {
        // 仅删除旧内置源（id 标记或迁移唯一确认的那一份）；用户手动导入的其他源不动
        if (builtinApi) {
          await removeUserApi([builtinApi.id]).catch((e) => { console.warn('Failed to remove old builtin source:', e) })
          const idx = userApiList.findIndex(api => api.id === builtinApi.id)
          if (idx >= 0) userApiList.splice(idx, 1)
        }
        const newApi = await addUserApi(script)
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
        // 记录内置源 id（升级/清理仅以此为准）与版本标记
        await saveData(builtinSourceIdKey, newApi.id)
        await saveData(builtinSourceKey, true)
        if (builtinVer) await saveData(builtinVersionKey, builtinVer)
        console.log('builtin source imported/updated:', newApi.name, builtinVer || '')
      }
    } catch (e) {
      console.warn('Failed to load builtin source:', e)
    }
  }
  setUserApiList(userApiList)
}
