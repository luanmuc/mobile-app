import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { createStyle, toast } from '@/utils/tools'
import { setApiSource } from '@/core/apiSource'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { useSettingValue } from '@/store/setting/hook'
import { useStatus, useUserApiList } from '@/store/userApi'
import Button from '../../components/Button'
import UserApiEditModal, { type UserApiEditModalType } from './UserApiEditModal'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { httpFetch } from '@/utils/request'
import { importUserApi, overwriteUserApi, removeUserApi } from '@/core/userApi'
import { getUserApiScript } from '@/utils/data'
import { getData, saveData, removeData } from '@/plugins/storage'
import { BUILTIN_SOURCE_NAME, BUILTIN_SOURCE_STORAGE_KEYS, compareSourceVersions, decidePendingBuiltinSwitch, parseSourceVersion, resolveBuiltinTarget, resolveSourceUpdateBaseline } from '@/core/init/userApi/builtinSource'

// 当前运行 App 的版本（CI 注入的 1.9.2-bN）：换包与否决定启动时是否以内置音源为准
const currentAppVersion = (process as unknown as { versions?: { app?: string } }).versions?.app ?? ''

const SOURCE_UPDATE_TIMEOUT = 15_000
// 切源后等 init 事件的上限（超时只代表"没等到"，不等于加载失败）
const SOURCE_SWITCH_INIT_TIMEOUT = 8000
const SOURCE_UPDATE_MAX_SIZE = 9_000_000
// K36：整体移除 V9.3 的在线更新体系（manifest + ed25519 三道闸）。
// 背景：这个「更新音源」按钮在 V9.3 之前只拉一个 lx-source.js（单请求），一直可用；
// V9.3 把它升级成「脚本 + manifest 双文件强一致 + 验签」，多出一个失败点，
// 而 manifest 在境内网络下拿不到可解析内容（限流/劫持/包装），导致按钮彻底不可用。
// 多镜像只是降低单点概率，不引入任何额外文件与校验链。
const SOURCE_UPDATE_URLS = [
  'https://cdn.jsdelivr.net/gh/luanmuc/backend-api@master/lx-source.js',
  'https://fastly.jsdelivr.net/gh/luanmuc/backend-api@master/lx-source.js',
  'https://gcore.jsdelivr.net/gh/luanmuc/backend-api@master/lx-source.js',
  'https://raw.githubusercontent.com/luanmuc/backend-api/master/lx-source.js',
]


const fetchWithTimeout = async(url: string, options: Record<string, unknown>, timeoutMessage: string): Promise<unknown> => {
  const request = httpFetch(url, options)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(timeoutMessage)) }, SOURCE_UPDATE_TIMEOUT)
    })
    return await Promise.race([request.promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    request.cancelHttp()
  }
}

const apiSourceList = apiSourceInfo.map(api => ({
  id: api.id,
  name: api.name,
  disabled: api.disabled,
}))

const formatLastCheck = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const useActive = (id: string) => {
  const activeLangId = useSettingValue('common.apiSource')
  const isActive = useMemo(() => activeLangId == id, [activeLangId, id])
  return isActive
}

const Item = ({ id, name, desc, statusLabel, change }: {
  id: string
  name: string
  desc?: string
  statusLabel?: string
  change: (id: string) => void
}) => {
  const isActive = useActive(id)
  const theme = useTheme()
  // const [toggleCheckBox, setToggleCheckBox] = useState(false)
  return (
    <CheckBox marginBottom={5} check={isActive} onChange={() => { change(id) }} need>
      <Text style={styles.sourceLabel}>
        {name}
        {
          desc ? <Text style={styles.sourceDesc} color={theme['c-500']} size={13}>  {desc}</Text> : null
        }
        {
          statusLabel ? <Text style={styles.sourceStatus} size={13}>  {statusLabel}</Text> : null
        }
      </Text>
    </CheckBox>
  )
}

export default memo(() => {
  const t = useI18n()
  const list = useMemo(() => apiSourceList.map(s => ({
    // @ts-expect-error
    name: t(`setting_basic_source_${s.id}`) || s.name,
    id: s.id,
  })), [t])
  const setApiSourceId = useCallback((id: string) => {
    setApiSource(id).catch(e => { console.log(e) })
  }, [])
  const userApiListRaw = useUserApiList()
  const apiStatus = useStatus()
  const apiSourceSetting = useSettingValue('common.apiSource')
  // 音源更新状态行：当前版本 + 上次检查时间。V9.3 的启动期自动更新已移除（与手动按钮重复且阻塞启动），
  // 这里只保留展示，不再有开关。
  const lastCheckAt = useSettingValue('common.sourceUpdateLastCheckAt')
  const [currentSourceVersion, setCurrentSourceVersion] = useState('')
  const theme = useTheme()
  // A05-009：markChecked 的回写走 useCallback（没有 cleanup 时机），用组件级卸载标志兜住。
  const isUnmountedRef = useRef(false)
  useEffect(() => {
    isUnmountedRef.current = false
    return () => { isUnmountedRef.current = true }
  }, [])
  useEffect(() => {
    if (!apiSourceSetting) { setCurrentSourceVersion(''); return }
    let alive = true
    getUserApiScript(apiSourceSetting)
      .then(script => { if (alive) setCurrentSourceVersion(parseSourceVersion(script || '')) })
      .catch(() => { /* 脚本读不到就不显示版本，不阻断面板 */ })
    return () => { alive = false }
  }, [apiSourceSetting])
  // 手动检查后刷新状态行：记录时间 + 重读当前版本（更新可能已覆盖脚本）
  const markChecked = useCallback(() => {
    updateSetting({ 'common.sourceUpdateLastCheckAt': Date.now() })
    if (apiSourceSetting) {
      getUserApiScript(apiSourceSetting)
        .then(script => {
          if (isUnmountedRef.current) return
          setCurrentSourceVersion(parseSourceVersion(script || ''))
        })
        .catch(() => { /* 与上面的版本读取同口径：读不到就不更新，不阻断面板 */ })
    }
  }, [apiSourceSetting])
  const userApiList = useMemo(() => {
    const getApiStatus = () => {
      let status
      if (apiStatus.status) status = t('setting_basic_source_status_success')
      else if (apiStatus.message == 'initing') status = t('setting_basic_source_status_initing')
      else status = t('setting_basic_source_status_failed')

      return status
    }
    return userApiListRaw.map(api => {
      const statusLabel = api.id == apiSourceSetting ? `[${getApiStatus()}]` : ''
      return {
        id: api.id,
        name: api.name,
        label: `${api.name}${statusLabel}`,
        desc: [/^\d/.test(api.version) ? `v${api.version}` : api.version].filter(Boolean).join(', '),
        statusLabel,
        // status: apiStatus.status,
        // message: apiStatus.message,
        // disabled: false,
      }
    })
  }, [userApiListRaw, apiStatus, apiSourceSetting, t])

  const modalRef = useRef<UserApiEditModalType>(null)
  const handleShow = () => {
    modalRef.current?.show()
  }

  // 更新音源：只拉 lx-source.js 一个文件（多镜像兜底），拉到后比对版本、弹窗确认、才导入。
  // V9.3 的「脚本+manifest 双文件 + 验签」已整体移除（K36），见文件头部说明。
  const [updating, setUpdating] = useState(false)
  const handleUpdateSource = useCallback(async() => {
    markChecked()
    if (updating) return
    setUpdating(true)
    toast(t('source_update_checking'))
    try {
      let remoteScript = ''
      const failures: string[] = []
      for (const url of SOURCE_UPDATE_URLS) {
        try {
          const response = await fetchWithTimeout(url, {}, t('source_update_timeout')) as { body?: unknown, statusCode?: unknown }
          if (typeof response.statusCode === 'number' && response.statusCode !== 200) throw new Error('SOURCE_UPDATE_HTTP_' + response.statusCode)
          // fetchData 对非 JSON 响应会保留字符串；拿到非字符串说明被网关换成了解析后的结构
          if (typeof response.body !== 'string') throw new Error('SOURCE_UPDATE_NOT_MANIFEST')
          if (response.body.length > SOURCE_UPDATE_MAX_SIZE) throw new Error(t('source_update_too_large'))
          if (response.body.length < 50_000 || !parseSourceVersion(response.body)) throw new Error(t('source_update_bad_script'))
          remoteScript = response.body
          break
        } catch (err) {
          failures.push(err instanceof Error ? err.message : '')
        }
      }
      if (!remoteScript) {
        const message = failures.length ? failures[failures.length - 1] : ''
        let failMessage = t('source_update_bad_script')
        if (message.startsWith('SOURCE_UPDATE_HTTP_')) failMessage = t('source_update_http_error').replace('{status}', message.slice('SOURCE_UPDATE_HTTP_'.length))
        else if (message === 'SOURCE_UPDATE_NOT_MANIFEST') failMessage = t('source_update_not_manifest')
        throw new Error(failMessage)
      }

      const remoteVersion = parseSourceVersion(remoteScript)
      if (!remoteVersion) throw new Error(t('source_update_bad_script'))

      // 版本基线必须锚定内置源，不能拿“当前选中的任意音源”做比较：
      // 用户手动选中的其它源版本更高/更低，都不应影响内置源的升级判断。
      // 先处理上次“导入成功但切源结果不确定”的 pending：迟到成功就提升，孤儿就清掉，
      // 避免用户不重启直接重试时再堆一份重复源。
      const pendingSourceId = (await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(() => null)) ?? ''
      if (pendingSourceId) {
        const pendingScript = apiSourceSetting === pendingSourceId
          ? await getUserApiScript(pendingSourceId).catch(() => '')
          : ''
        const pendingDecision = decidePendingBuiltinSwitch({
          pendingSourceId,
          sourceIds: userApiListRaw.map(api => api.id),
          activeSourceId: apiSourceSetting,
          pendingVersion: parseSourceVersion(pendingScript),
        })
        if (pendingDecision.action === 'promote-active') {
          const previousBuiltinId = await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.sourceId).catch(() => null)
          await saveData(BUILTIN_SOURCE_STORAGE_KEYS.hasImported, true).catch(() => {})
          await saveData(BUILTIN_SOURCE_STORAGE_KEYS.importedVersion, pendingDecision.promoteVersion).catch(() => {})
          await saveData(BUILTIN_SOURCE_STORAGE_KEYS.sourceId, pendingSourceId).catch(() => {})
          await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(() => {})
          if (previousBuiltinId && previousBuiltinId !== pendingSourceId) {
            await removeUserApi([previousBuiltinId]).catch(e => {
              console.warn('Failed to remove previous builtin source:', e)
            })
          }
        } else if (pendingDecision.action === 'block-import') {
          await removeUserApi([pendingSourceId]).catch(e => {
            console.warn('Failed to remove orphan pending source:', e)
          })
          await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(() => {})
        } else {
          await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(() => {})
        }
      }

      const [storedBuiltinId, importedBuiltinVersion] = await Promise.all([
        getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.sourceId).catch(() => null),
        getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.importedVersion).catch(() => null),
      ])
      // 覆盖目标先定：启用份优先（音源同时只能启用一个），未被启用的同名旧版不是更新对象。
      const target = resolveBuiltinTarget({
        storedId: storedBuiltinId ?? '',
        activeId: apiSourceSetting,
        list: userApiListRaw,
        builtinName: BUILTIN_SOURCE_NAME,
      })
      let targetScript = ''
      if (target.targetId) {
        try {
          targetScript = await getUserApiScript(target.targetId)
        } catch { /* 目标脚本读不到时退回版本/名称兜底 */ }
      }
      // 标记份与目标不是同一份时才去读它：只作为兜底，不能拿它的版本挡住目标升级
      let builtinScript = ''
      if (storedBuiltinId && storedBuiltinId !== target.targetId) {
        try {
          builtinScript = await getUserApiScript(storedBuiltinId)
        } catch { /* 内置源脚本读不到时走版本/名称兜底 */ }
      }
      const activeApi = userApiListRaw.find(api => api.id === apiSourceSetting)
      const baseline = resolveSourceUpdateBaseline({
        builtinScript,
        importedVersion: importedBuiltinVersion ?? '',
        targetScript,
        activeSourceName: activeApi?.name ?? '',
        activeScript: targetScript,
      })
      const localVersion = baseline.version
      const localLabel = localVersion || t('source_version_unknown')
      const comparison = localVersion ? compareSourceVersions(remoteVersion, localVersion) : null

      // 同版本 = 已是最新；远端更低 = 不降级
      if (comparison === 0) {
        toast(t('source_update_latest', { version: remoteVersion }), 'long')
        setUpdating(false)
        return
      }
      if (comparison != null && comparison < 0) {
        toast(t('source_update_remote_older', { local: localLabel, remote: remoteVersion }), 'long')
        setUpdating(false)
        return
      }

      // 弹窗显示版本信息，用户确认后才更新
      Alert.alert(
        t('source_update_new_version_title'),
        t('source_update_new_version_msg', { local: localLabel, remote: remoteVersion }),
        [
          {
            text: t('cancel'),
            style: 'cancel',
            onPress: () => { setUpdating(false) },
          },
          {
            text: t('source_update_confirm'),
            // RN Alert 不消费返回值，异步回调内部已完整 try/catch；此规则属误报
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onPress: async() => {
              try {
                // 目标已在弹窗前算好（与弹窗里显示的本地版本同源）。
                // 多份同名且启用的不是它们：不猜、不新增，让用户先清理重复源
                if (target.reason === 'ambiguous') throw new Error(t('source_update_ambiguous'))

                if (target.targetId) {
                  await overwriteUserApi(target.targetId, remoteScript)
                  // 覆盖的是正在用的脚本：同 id 重新加载。超时只表示没等到 init，脚本已换，提示重启。
                  let timedOut = false
                  let initTimer: ReturnType<typeof setTimeout> | undefined
                  const reloaded = await Promise.race([
                    setApiSource(target.targetId),
                    new Promise<boolean>(resolve => {
                      initTimer = setTimeout(() => { timedOut = true; resolve(false) }, SOURCE_SWITCH_INIT_TIMEOUT)
                    }),
                  ])
                  clearTimeout(initTimer)
                  if (!reloaded) throw new Error(t(timedOut ? 'source_update_reload_timeout' : 'source_update_reload_failed'))
                  await saveData(BUILTIN_SOURCE_STORAGE_KEYS.hasImported, true).catch(() => {})
                  await saveData(BUILTIN_SOURCE_STORAGE_KEYS.importedVersion, remoteVersion).catch(() => {})
                  await saveData(BUILTIN_SOURCE_STORAGE_KEYS.sourceId, target.targetId).catch(() => {})
                  // 在线更新成功也记下当前 App 版本：同包重启不算“换包”，不会回滚到包内旧版
                  await saveData(BUILTIN_SOURCE_STORAGE_KEYS.appVersion, currentAppVersion).catch(() => {})
                  await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(() => {})
                  toast(t('source_update_ok', { version: remoteVersion }), 'long')
                  return
                }

                // 2) 全新安装（库里没有任何同名音源）：新增内置源并切换，再记录内置身份
                const newApiInfo = await importUserApi(remoteScript)

                // 2) 切源前先落 pending 标记：
                //    切源结果不确定时，下次启动靠它对账，避免“新源已导入 + 版本标记仍旧”
                //    导致内置源再次导入、堆出重复源。
                await saveData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId, newApiInfo.id).catch(e => {
                  console.warn('Failed to persist pending builtin source id:', e)
                })

                // 3) 切到新源并等它真的加载出来，再考虑删旧的。
                //    旧音源的清理必须放在切源之后：切源失败时旧源还在，能回退。
                //    8s 是 init 事件的上限等待——超时按失败处理，不删旧源。
                // 8s 超时只代表「没等到 init」，**不等于加载失败**：
                // Promise.race 不会取消 setApiSource 里的加载，超时之后再 resolve(true) 照样可能发生。
                // 因此把「超时」与「明确失败」分开报：超时说「未就绪、旧源已保留、下次启动对账」，
                // 不去断言「加载失败」，也不删旧源。
                let timedOut = false
                let initTimer: ReturnType<typeof setTimeout> | undefined
                const switched = await Promise.race([
                  setApiSource(newApiInfo.id),
                  new Promise<boolean>(resolve => {
                    initTimer = setTimeout(() => { timedOut = true; resolve(false) }, SOURCE_SWITCH_INIT_TIMEOUT)
                  }),
                ])
                // 竞速结束后必须清定时器：另一路赢了之后它还会空转，留着会拖住事件循环。
                clearTimeout(initTimer)
                if (!switched) throw new Error(t(timedOut ? 'source_switch_timeout_keep_old' : 'source_switch_failed_keep_old'))

                // 4) 切源成功后记录当前内置源身份与版本。
                //    下次启动时 decideBuiltinSourceImport 会把 APK 内置源和这个版本比较，
                //    避免旧 APK 内置源把在线升级的新版本反向覆盖。
                //    storedBuiltinId 是切源前读到的旧 id，用于后面只清理旧内置源。
                await saveData(BUILTIN_SOURCE_STORAGE_KEYS.hasImported, true).catch(e => {
                  console.warn('Failed to persist builtin source imported flag:', e)
                })
                await saveData(BUILTIN_SOURCE_STORAGE_KEYS.importedVersion, remoteVersion).catch(e => {
                  console.warn('Failed to persist builtin source version:', e)
                })
                await saveData(BUILTIN_SOURCE_STORAGE_KEYS.sourceId, newApiInfo.id).catch(e => {
                  console.warn('Failed to persist builtin source id:', e)
                })
                await saveData(BUILTIN_SOURCE_STORAGE_KEYS.appVersion, currentAppVersion).catch(e => {
                  console.warn('Failed to persist builtin source app version:', e)
                })

                // 5) 只删除被 id 标记的旧内置源；不按名字批量删，避免误删用户手动导入的同名源。
                const oldIds = storedBuiltinId && storedBuiltinId !== newApiInfo.id
                  ? userApiListRaw.filter(api => api.id === storedBuiltinId).map(api => api.id)
                  : []
                if (oldIds.length) {
                  await removeUserApi(oldIds).catch(e => {
                    console.warn('Failed to remove old builtin source:', e)
                  })
                }

                // 6) 切源、版本、旧源清理都走完了才清 pending；
                //    中途崩溃时下次启动仍能靠 pending 恢复，不会重复导入。
                await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId).catch(e => {
                  console.warn('Failed to clear pending builtin source id:', e)
                })

                toast(t('source_update_ok', { version: remoteVersion }), 'long')
              } catch (err: any) {
                toast(t('source_update_fail', { message: err.message }), 'long')
              } finally {
                setUpdating(false)
              }
            },
          },
        ],
      )
    } catch (err: any) {
      toast(t('source_update_check_fail', { message: err.message }), 'long')
      setUpdating(false)
    }
  }, [t, updating, apiSourceSetting, userApiListRaw, markChecked])

  return (
    <SubTitle title={t('setting_basic_source')}>
      <View style={styles.list}>
        {
          list.map(({ id, name }) => <Item name={name} id={id} key={id} change={setApiSourceId} />)
        }
        {
          userApiList.map(({ id, name, desc, statusLabel }) => <Item name={name} desc={desc} statusLabel={statusLabel} id={id} key={id} change={setApiSourceId} />)
        }
      </View>
      {/* 音源更新状态行：当前版本 + 上次检查时间，与「更新音源」按钮同处 */}
      <View style={styles.updatePanel}>
        <Text size={13} color={theme['c-500']}>
          {t('source_update_panel_current', { version: currentSourceVersion || t('source_version_unknown') })}
          {' · '}
          {lastCheckAt ? t('source_update_panel_last_check', { time: formatLastCheck(lastCheckAt) }) : t('source_update_panel_never')}
        </Text>
      </View>
      <View style={styles.btn}>
        <Button onPress={handleShow}>{t('setting_basic_source_user_api_btn')}</Button>
        <View style={{ width: 10 }} />
        <Button onPress={handleUpdateSource} disabled={updating}>
          {updating ? t('source_update_btn_doing') : t('source_update_btn')}
        </Button>
      </View>
      <UserApiEditModal ref={modalRef} />
    </SubTitle>
  )
})

const styles = createStyle({
  list: {
    flexGrow: 0,
    flexShrink: 1,
    // flexDirection: 'row',
    // flexWrap: 'wrap',
  },
  btn: {
    marginTop: 10,
    flexDirection: 'row',
  },
  updatePanel: {
    marginTop: 12,
  },
  sourceLabel: {

  },
  sourceDesc: {

  },
  sourceStatus: {

  },
})
