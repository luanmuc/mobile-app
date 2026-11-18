import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle, getIsSupportedAutoTheme } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { getTheme } from '@/theme/themes'
import { applyTheme } from '@/core/theme'
import themeState from '@/store/theme/state'

const isSupportedAutoTheme = getIsSupportedAutoTheme()

export default memo(() => {
  const t = useI18n()
  const isAutoTheme = useSettingValue('common.isAutoTheme')
  const setIsAutoTheme = (isAutoTheme: boolean) => {
    updateSetting({ 'common.isAutoTheme': isAutoTheme })
    // A05-020：getTheme 未 catch —— 读取主题失败时 reject 变成 unhandled rejection，
    // 且自动主题不会应用。失败时保持当前主题。
    void getTheme().then(theme => {
      if (theme.id == themeState.theme.id) return
      applyTheme(theme)
    }).catch(() => {})
  }


  return (
    isSupportedAutoTheme
      ? (
          <View style={styles.content}>
            <CheckBoxItem check={isAutoTheme} label={t('setting_basic_theme_auto_theme')} onChange={setIsAutoTheme} />
          </View>
        )
      : null
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    // marginBottom: 5,
  },
})
