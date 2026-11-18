import { useMemo, useState } from 'react'

import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'
import { EQ_BAND_COUNT, EQ_BANDS_DEFAULT, EQ_LEVEL_MAX, EQ_LEVEL_MIN, isFlatBands, parseBands, serializeBands } from '@/core/player/equalizerBands'
import { isEqualizerSupported, previewEqualizerBands } from '@/core/player/equalizer'
import ButtonPrimary from '@/components/common/ButtonPrimary'

// 毫贝 → dB（系统 Equalizer 以 100 mB 为 1 dB，范围通常 ±1500 mB = ±15 dB）
const toDb = (mB: number) => (mB / 100).toFixed(1)

// 5 段的近似中心频率，仅用于面板标注（真实 band 数与频率由系统决定，见 getInfo）
const BAND_LABELS = ['60Hz', '240Hz', '950Hz', '3.8kHz', '15kHz']

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const enabled = useSettingValue('player.equalizer.enable')
  const bandsCsv = useSettingValue('player.equalizer.bands')
  const [dragCsv, setDragCsv] = useState<string | null>(null)
  const bands = useMemo(() => parseBands(dragCsv ?? bandsCsv), [dragCsv, bandsCsv])
  const supported = isEqualizerSupported()

  const handleToggle = (checked: boolean) => {
    updateSetting({ 'player.equalizer.enable': checked })
  }

  const handleBandChange = (index: number, value: number) => {
    const next = bands.slice()
    next[index] = Math.round(value)
    const csv = serializeBands(next)
    setDragCsv(csv)
    // 拖动中实时试听（只在已绑定会话时有效，未起播时原生侧会静默返回 false）
    void previewEqualizerBands(csv)
  }

  const handleBandComplete = (index: number, value: number) => {
    const next = bands.slice()
    next[index] = Math.round(value)
    setDragCsv(null)
    updateSetting({ 'player.equalizer.bands': serializeBands(next) })
  }

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {}

  const handleReset = () => {
    if (isFlatBands(bandsCsv)) return
    setDragCsv(null)
    updateSetting({ 'player.equalizer.bands': EQ_BANDS_DEFAULT })
  }

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_equalizer')}</Text>
      {
        supported
          ? null
          : <Text style={styles.label} color={theme['c-font-label']}>{t('play_detail_setting_equalizer_unsupported')}</Text>
      }
      <CheckBox check={enabled} label={t('play_detail_setting_equalizer_enable')} onChange={handleToggle} />
      {
        enabled
          ? (
              <>
                {
                  Array.from({ length: EQ_BAND_COUNT }).map((_, index) => (
                    <View key={index} style={styles.content}>
                      <Text style={styles.label} color={theme['c-font-label']}>{BAND_LABELS[index]}</Text>
                      <Slider
                        minimumValue={EQ_LEVEL_MIN}
                        maximumValue={EQ_LEVEL_MAX}
                        onSlidingStart={handleSlidingStart}
                        onValueChange={value => { handleBandChange(index, value) }}
                        onSlidingComplete={value => { handleBandComplete(index, value) }}
                        step={50}
                        value={bands[index] ?? 0}
                      />
                      <Text style={styles.label} color={theme['c-font-label']}>{`${toDb(bands[index] ?? 0)}dB`}</Text>
                    </View>
                  ))
                }
                <ButtonPrimary onPress={handleReset}>{t('play_detail_setting_playback_rate_reset')}</ButtonPrimary>
              </>
            )
          : null
      }
    </View>
  )
}
