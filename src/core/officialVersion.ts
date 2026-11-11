import { Alert } from 'react-native'

import { compareOfficialVersion, getBaseVersion, getOfficialVersionInfo } from '@/utils/officialVersion'
import { getOfficialVersionShown, saveOfficialVersionShown } from '@/utils/data'
import officialVersionActions from '@/store/version/action'
import officialVersionState from '@/store/version/state'

// 官方上游版本检测（定制版专属）
// 1. 获取官方（lyswhut/lx-music-mobile）最新版本，写入 store（供设置页展示）；
// 2. 若官方最新 > 底座版本，弹窗提醒一次（同一官方版本只提醒一次，官方再出新版本才再提醒）。
// 弹窗使用 RN 内置 Alert（不注册导航组件、无循环依赖，杜绝启动注册期风险）。
// showModalIfNew: 检测到新版本时是否弹窗（启动时传 true；设置页静默刷新传 false，只更新展示）
export const checkOfficialUpdate = async(showModalIfNew = true) => {
  if (officialVersionState.official.checking) return
  officialVersionActions.setOfficialInfo({ checking: true, isError: false })
  const base = getBaseVersion()
  let latest: string | null = null
  try {
    latest = await getOfficialVersionInfo()
  } catch (err) {
    console.log('checkOfficialUpdate failed:', err)
  }
  const isLatest = latest == null || compareOfficialVersion(latest, base) <= 0
  officialVersionActions.setOfficialInfo({
    base,
    latest,
    isLatest,
    isError: latest == null,
    checking: false,
  })
  if (showModalIfNew && latest != null && !isLatest) {
    const shown = await getOfficialVersionShown()
    if (shown !== latest) {
      saveOfficialVersionShown(latest)
      officialVersionActions.setOfficialInfo({ showModal: true })
      Alert.alert(
        global.i18n.t('official_modal_title'),
        global.i18n.t('official_modal_desc', { latest, base }),
        [
          {
            text: global.i18n.t('official_btn_ok'),
            onPress: () => { officialVersionActions.setOfficialInfo({ showModal: false }) },
            style: 'default',
          },
        ],
        { cancelable: true, onDismiss: () => { officialVersionActions.setOfficialInfo({ showModal: false }) } },
      )
    }
  }
}
