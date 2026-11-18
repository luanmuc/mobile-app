import { useState } from 'react'

import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'
import { setPlaybackPitch } from '@/plugins/player'
import { normalizePitch, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from '@/core/player/pitch'
import ButtonPrimary from '@/components/common/ButtonPrimary'
import settingState from '@/store/setting/state'

// 滑块用整数百分比（50~200），与播放速率面板的手感一致；实际写进原生的是 0.5~2.0
const MIN_VALUE = PITCH_MIN * 100
const MAX_VALUE = PITCH_MAX * 100

export default () => {
  const theme = useTheme()
  const playbackPitch = Math.trunc(normalizePitch(useSettingValue('player.playbackPitch')) * 100)
  const [sliderSize, setSliderSize] = useState(playbackPitch)
  const [isSliding, setSliding] = useState(false)
  const t = useI18n()

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    value = Math.trunc(value)
    setSliderSize(value)
    // 拖动过程中实时试听：内核只改 pitch，speed 保持不变
    void setPlaybackPitch(value / 100)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    value = Math.trunc(value)
    if (playbackPitch == value) return
    updateSetting({ 'player.playbackPitch': value / 100 })
  }
  const handleReset = () => {
    if (settingState.setting['player.playbackPitch'] == PITCH_DEFAULT) return
    setSliderSize(PITCH_DEFAULT * 100)
    void setPlaybackPitch(PITCH_DEFAULT)
    updateSetting({ 'player.playbackPitch': PITCH_DEFAULT })
  }

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_playback_pitch')}</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{`${((isSliding ? sliderSize : playbackPitch) / 100).toFixed(2)}x`}</Text>
        <Slider
          minimumValue={MIN_VALUE}
          maximumValue={MAX_VALUE}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={playbackPitch}
        />
      </View>
      <ButtonPrimary onPress={handleReset}>{t('play_detail_setting_playback_rate_reset')}</ButtonPrimary>
    </View>
  )
}
