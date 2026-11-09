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
    setApiSource(id)
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

  // 更新音源：从 GitHub raw 拉取 master 最新 lx-source.js（绕过 jsDelivr CDN 缓存）
  // 流程：拉取 → 比对版本 → 弹窗显示版本信息 → 用户确认后才导入
  const [updating, setUpdating] = useState(false)
  const handleUpdateSource = useCallback(async() => {
    if (updating) return
    setUpdating(true)
    toast(t('source_update_checking'))
    try {
      // 用 jsDelivr CDN 拉（有 CDN 加速），版本更新时先 purge CDN 缓存
      const url = 'https://cdn.jsdelivr.net/gh/luanmuc/backend-api@master/lx-source.js'
      // 15 秒超时控制
      const fetchPromise = httpFetch(url).promise.then(resp => resp.body) as unknown as string
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(t('source_update_timeout'))), 15000)
      )
      const remoteScript = await Promise.race([fetchPromise, timeoutPromise]) as string
      if (remoteScript.length > 9_000_000) {
        toast(t('source_update_too_large'), 'long')
        setUpdating(false)
        return
      }

      // 提取远端版本号
      const remoteVerMatch = remoteScript.match(/@version\s+(\S+)/)
      const remoteVersion = remoteVerMatch ? remoteVerMatch[1] : t('source_version_unknown')

      // 提取本地当前音源版本号
      let localVersion: string = t('source_version_unknown')
      try {
        const localScript = await getUserApiScript(apiSourceSetting)
        const localVerMatch = localScript.match(/@version\s+(\S+)/)
        if (localVerMatch) localVersion = localVerMatch[1]
      } catch { /* 读不到就当未知 */ }

      // 版本一样 = 已是最新
      if (remoteVersion === localVersion) {
        toast(t('source_update_latest', { version: remoteVersion }), 'long')
        setUpdating(false)
        return
      }

      // 弹窗显示版本信息，用户确认后才更新
      Alert.alert(
        t('source_update_new_version_title'),
        t('source_update_new_version_msg', { local: localVersion, remote: remoteVersion }),
        [
          {
            text: t('cancel'),
            style: 'cancel',
            onPress: () => setUpdating(false),
          },
          {
            text: t('source_update_confirm'),
            onPress: async() => {
              try {
                // 1) 先导新的（失败则什么都没动）
                const newApiInfo = await importUserApi(remoteScript)

                // 2) 切到新源并等它真的加载出来，再考虑删旧的。
                //    旧音源的清理必须放在切源之后：切源失败时旧源还在，能回退。
                //    8s 是 init 事件的上限等待——超时按失败处理（宁可留重复源，也不删光）
                const switched = await Promise.race([
                  setApiSource(newApiInfo.id),
                  new Promise<boolean>(resolve => { setTimeout(() => { resolve(false) }, 8000) }),
                ])
                if (!switched) throw new Error('新音源未能加载，已保留旧音源')

                // 3) 切源成功后再删"豆包定制"旧音源（不删刚导入的那个）
                const oldIds = userApiListRaw
                  .filter(api => api.name.includes('豆包定制') && api.id !== newApiInfo.id)
                  .map(api => api.id)
                if (oldIds.length) {
                  await removeUserApi(oldIds)
                }

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
