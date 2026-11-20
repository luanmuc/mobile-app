import { useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import Progress, { ProgressPlain } from '@/components/player/Progress'
import { useProgress } from '@/store/player/hook'
import { useBufferProgress } from '@/plugins/player'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { COMPONENT_IDS } from '@/config/constant'
import { usePageVisible } from '@/store/common/hook'

const BAR_HEIGHT = 3
const HIT_HEIGHT = 10

export default ({ isHome }: { isHome: boolean }) => {
  const [autoUpdate, setAutoUpdate] = useState(true)
  // 进度与时长由这里订阅；PlayInfo 仍保留一次 useProgress 供时间字符串使用
  const { progress, maxPlayTime } = useProgress(autoUpdate)
  const buffered = useBufferProgress()
  const allowProgressBarSeek = useSettingValue('common.allowProgressBarSeek')
  const theme = useTheme()

  usePageVisible([COMPONENT_IDS.home], useCallback((visible) => {
    if (isHome) setAutoUpdate(visible)
  }, [isHome]))

  const commonProps = {
    progress,
    duration: maxPlayTime,
    buffered,
    compact: true,
    barHeight: BAR_HEIGHT,
    hitHeight: HIT_HEIGHT,
    // 轨道必须显性上色：Progress 默认无底色，3dp 细条没有轨道会像悬浮的绿线
    trackColor: theme['c-primary-light-300-alpha-800'],
    // 已播放不用 c-primary-alpha-900（0.10 太淡），用主题实色
    playedColor: theme['c-primary'],
  }

  return (
    <View style={styles.wrap}>
      {
        allowProgressBarSeek
          ? <Progress {...commonProps} />
          : <ProgressPlain {...commonProps} />
      }
    </View>
  )
}


// 热区高度用 px 直写：10dp 是触摸目标，不该随屏幕缩放
const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HIT_HEIGHT,
    zIndex: 3,
  },
})
