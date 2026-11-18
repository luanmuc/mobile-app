import { TouchableOpacity, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { FADE_CHOICES_MS } from '@/core/player/volumeFadeCurve'
import styles from './style'

/**
 * 淡入淡出设置。
 * - 切歌淡入淡出：只在上一首/下一首时生效（播放/暂停不做，避免"停得慢半拍"）
 * - 睡眠定时渐弱：只在"到点会直接退出"时生效；"播完这曲再退"时不动音量
 * 两个开关默认都关：关掉时音量链路与改动前完全一致。
 */
export default () => {
  const theme = useTheme()
  const t = useI18n()
  const fadeOnTrackChange = useSettingValue('player.fadeOnTrackChange')
  const fadeOnSleepTimeout = useSettingValue('player.fadeOnSleepTimeout')
  const fadeDurationMs = useSettingValue('player.fadeDurationMs')
  const enabled = fadeOnTrackChange || fadeOnSleepTimeout

  return (
    <View style={styles.container}>
      <CheckBox
        check={fadeOnTrackChange}
        label={t('play_detail_setting_track_fade')}
        onChange={value => { updateSetting({ 'player.fadeOnTrackChange': value }) }}
      />
      <CheckBox
        check={fadeOnSleepTimeout}
        label={t('play_detail_setting_sleep_fade')}
        onChange={value => { updateSetting({ 'player.fadeOnSleepTimeout': value }) }}
        marginBottom={0}
      />
      <View style={[styles.content, { opacity: enabled ? 1 : 0.4 }]}>
        {
          FADE_CHOICES_MS.map(ms => (
            <TouchableOpacity
              key={ms}
              activeOpacity={0.7}
              disabled={!enabled}
              onPress={() => { updateSetting({ 'player.fadeDurationMs': ms }) }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                marginRight: 8,
                marginTop: 8,
                borderRadius: 4,
                backgroundColor: ms === fadeDurationMs ? theme['c-primary-alpha-200'] : 'transparent',
              }}
            >
              <Text
                size={12}
                color={ms === fadeDurationMs ? theme['c-primary'] : theme['c-font-label']}
              >{ms}ms</Text>
            </TouchableOpacity>
          ))
        }
      </View>
    </View>
  )
}
