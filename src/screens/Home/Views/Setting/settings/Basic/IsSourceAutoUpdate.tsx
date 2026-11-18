import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

/**
 * v9.4：内置音源在线自动更新开关（默认关）。
 *
 * 默认关不是保守，是必要性：开启后 App 每次启动都会向 Release 拉包并验签，
 * 这会消耗流量、也会让启动依赖一次网络往返。用户明确打开才算他要这个能力。
 */
export default memo(() => {
  const t = useI18n()
  const isSourceAutoUpdate = useSettingValue('common.sourceAutoUpdate')
  const setSourceAutoUpdate = (value: boolean) => {
    updateSetting({ 'common.sourceAutoUpdate': value })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={isSourceAutoUpdate} label={t('setting_source_auto_update')} onChange={setSourceAutoUpdate} />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
