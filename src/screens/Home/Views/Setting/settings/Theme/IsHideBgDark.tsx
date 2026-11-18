import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { getTheme } from '@/theme/themes'
import { applyTheme } from '@/core/theme'
import settingState from '@/store/setting/state'

export default memo(() => {
  const t = useI18n()
  const isHideBgDark = useSettingValue('theme.hideBgDark')
  const setIsAutoTheme = (isHideBgDark: boolean) => {
    updateSetting({ 'theme.hideBgDark': isHideBgDark })
    // A05-020：同 IsAutoTheme，getTheme 缺 catch 会产生 unhandled rejection。
    void getTheme().then(theme => {
      if (!theme.isDark && !settingState.setting['common.isAutoTheme']) return
      applyTheme(theme)
    }).catch(() => {})
  }


  return (
    <View style={styles.content}>
      <CheckBoxItem check={isHideBgDark} label={t('setting_basic_theme_hide_bg_dark')} onChange={setIsAutoTheme} />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    // marginBottom: 15,
  },
})
