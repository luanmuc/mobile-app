import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'
import playerState from '@/store/player/state'
import { updateRemoteLyric } from '@/core/init/player/lyric'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isShowNotificationLyric = useSettingValue('player.isShowNotificationLyric')
  const setShowNotificationLyric = (isShowNotificationLyric: boolean) => {
    updateSetting({ 'player.isShowNotificationLyric': isShowNotificationLyric })
    // 立即刷新通知栏标题：开启时用当前歌词，关闭时恢复歌名
    void updateRemoteLyric(isShowNotificationLyric ? playerState.lastLyric : undefined)
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={isShowNotificationLyric} onChange={setShowNotificationLyric} label={t('setting_play_show_notification_lyric')} helpDesc={t('setting_play_show_notification_lyric_tip')} />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
