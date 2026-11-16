import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Alert, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { createStyle, toast } from '@/utils/tools'
import { setApiSource } from '@/core/apiSource'
import { useI18n } from '@/lang'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { useSettingValue } from '@/store/setting/hook'
import { useStatus, useUserApiList } from '@/store/userApi'
import Button from '../../components/Button'
import UserApiEditModal, { type UserApiEditModalType } from './UserApiEditModal'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { httpFetch } from '@/utils/request'
import { importUserApi, removeUserApi } from '@/core/userApi'
import { getUserApiScript } from '@/utils/data'
import { getData, saveData, removeData } from '@/plugins/storage'
import { BUILTIN_SOURCE_NAME, BUILTIN_SOURCE_STORAGE_KEYS, compareSourceVersions, decidePendingBuiltinSwitch, parseSourceVersion, resolveSourceUpdateBaseline } from '@/core/init/userApi/builtinSource'

const SOURCE_UPDATE_TIMEOUT = 15_000
// 切源后等 init 事件的上限（超时只代表"没等到"，不等于加载失败）
const SOURCE_SWITCH_INIT_TIMEOUT = 8000
const SOURCE_UPDATE_MAX_SIZE = 9_000_000
const SOURCE_UPDATE_SOURCES = [
  // GitHub Contents API 优先：每次取 master 当前内容，避开 jsDelivr 的 @master 边缘缓存。
  {
    url: 'https://api.github.com/repos/luanmuc/backend-api/contents/lx-source.js?ref=master',
    options: { headers: { Accept: 'application/vnd.github.raw' } },
  },
  // 匿名 API 触发限额或网络失败时回退 jsDelivr；仍由 @version 做最终校验。
  {
    url: 'https://cdn.jsdelivr.net/gh/luanmuc/backend-api@master/lx-source.js',
    options: {},
  },
] as const

const fetchSourceScript = async(url: string, options: Record<string, unknown>, timeoutMessage: string) => {
  const request = httpFetch(url, options)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(timeoutMessage)) }, SOURCE_UPDATE_TIMEOUT)
    })
    const response = await Promise.race([request.promise, timeout]) as { body?: unknown }
    return typeof response.body === 'string' ? response.body : ''
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

  // 更新音源：GitHub Contents API 优先，jsDelivr 兜底；版本只认 `@version`。
  // 流程：拉取 → 比对版本 → 弹窗显示版本信息 → 用户确认后才导入
  const [updating, setUpdating] = useState(false)
  const handleUpdateSource = useCallback(async() => {
    if (updating) return
    setUpdating(true)
    toast(t('source_update_checking'))
    try {
      let remoteScript = ''
      let lastError: unknown
      for (const source of SOURCE_UPDATE_SOURCES) {
        try {
          const script = await fetchSourceScript(source.url, source.options, t('source_update_timeout'))
          if (script.length > SOURCE_UPDATE_MAX_SIZE) throw new Error(t('source_update_too_large'))
          if (script.length < 50_000 || !parseSourceVersion(script)) throw new Error(t('source_update_bad_script'))
          remoteScript = script
          break
        } catch (err) {
          lastError = err
        }
      }
      if (!remoteScript) {
        const message = lastError instanceof Error ? lastError.message : t('source_update_bad_script')
        throw new Error(message)
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
      let builtinScript = ''
      if (storedBuiltinId) {
        try {
          builtinScript = await getUserApiScript(storedBuiltinId)
        } catch { /* 内置源脚本读不到时走版本/名称兜底 */ }
      }
      const activeApi = userApiListRaw.find(api => api.id === apiSourceSetting)
      let activeBuiltinScript = ''
      if (!builtinScript && activeApi?.name === BUILTIN_SOURCE_NAME) {
        try {
          activeBuiltinScript = await getUserApiScript(apiSourceSetting)
        } catch { /* 迁移期兜底失败就当未知 */ }
      }
      const baseline = resolveSourceUpdateBaseline({
        builtinScript,
        importedVersion: importedBuiltinVersion ?? '',
        activeSourceName: activeApi?.name ?? '',
        activeScript: activeBuiltinScript,
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
                // 1) 先导新的（失败则什么都没动）
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
  }, [t, updating, apiSourceSetting, userApiListRaw])

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
  sourceLabel: {

  },
  sourceDesc: {

  },
  sourceStatus: {

  },
})
