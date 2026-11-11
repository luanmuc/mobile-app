import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import Progress from '@/components/player/Progress'
import Status from './Status'
import { useProgress, usePlayQuality, usePlaySource, usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import PlayQualityTag from '@/components/PlayQualityTag'
import { useBufferProgress } from '@/plugins/player'
import { getPlayQualityLabel } from '@/core/music/utils'
import { buildSourceLabel, getPlatformNameKey, resolvePlatformName, resolvePlayPlatform } from '@/core/music/sourceLabel'

// const FONT_SIZE = 13

const PlayTimeCurrent = ({ timeStr }: { timeStr: string }) => {
  const theme = useTheme()
  // console.log(timeStr)
  return <Text color={theme['c-500']}>{timeStr}</Text>
}

const PlayTimeMax = memo(({ timeStr }: { timeStr: string }) => {
  const theme = useTheme()
  return <Text color={theme['c-500']}>{timeStr}</Text>
})

export default () => {
  const t = useI18n()
  // 分隔符「/」直接用主题色，这里必须声明 theme（子组件各自有声明，父组件漏了会渲染期 ReferenceError）
  const theme = useTheme()
  const { maxPlayTimeStr, nowPlayTimeStr, progress, maxPlayTime } = useProgress()
  const buffered = useBufferProgress()
  const playQuality = usePlayQuality()
  const qualityLabel = getPlayQualityLabel(playQuality)
  // v6.0：实际交付链接的子源（平台名 + 子源名；子源未知时仅平台名）
  const playSource = usePlaySource()
  const playMusicInfo = usePlayMusicInfo()
  const src = (playMusicInfo?.musicInfo as any)?.source
  // v8.12.0：跨平台兜底后显示实际交付平台（sourcePlatform），旧音源无该字段时回退主平台
  const actualPlatform = resolvePlayPlatform(playSource, src as string | undefined)
  const platformKey = getPlatformNameKey(actualPlatform)
  const platformName = resolvePlatformName(actualPlatform, platformKey ? t(platformKey) : '')
  const sourceLabel = buildSourceLabel(platformName, playSource?.name)
  // console.log('render playInfo')

  return (
    <View style={styles.container}>
      <View style={styles.status} >
        {
          qualityLabel
            ? <PlayQualityTag label={qualityLabel} prefix={t('quality_tag')} size={11} />
            : null
        }
        {
          sourceLabel
            ? <View style={styles.sourceGap}><PlayQualityTag label={sourceLabel} prefix={t('source_tag')} size={11} /></View>
            : null
        }
        <Status />
      </View>
      <View style={{ flexGrow: 0, flexShrink: 0, flexDirection: 'row' }} >
        <PlayTimeCurrent timeStr={nowPlayTimeStr} />
        <Text color={theme['c-500']}> / </Text>
        <PlayTimeMax timeStr={maxPlayTimeStr} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.progress]}><Progress progress={progress} duration={maxPlayTime} buffered={buffered} /></View>
    </View>
  )
}


const styles = createStyle({
  container: {
    // marginLeft: 15,
    marginVertical: 5,
    height: 26,
    // flex: 1,
    paddingVertical: 2,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progress: {
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'column',
    justifyContent: 'center',
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // alignItems: 'center',
    // backgroundColor: '#ccc',
  },
  status: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceGap: {
    marginLeft: 6,
  },
})
// const styles = createStyle({
//   container: {
//     flex: 1,
//     // height: 16,
//     // flexGrow: 0,
//     // flexShrink: 0,
//     // flexDirection: 'column',
//     // justifyContent: 'center',
//     // alignItems: 'center',
//     // marginBottom: -1,
//     // backgroundColor: '#ccc',
//     // overflow: 'hidden',
//     // height:
//     // position: 'absolute',
//     // width: '100%',
//     // top: 0,
//     paddingVertical: 2,
//     paddingHorizontal: 5,
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//   },
//   progress: {
//     paddingVertical: 2,
//     zIndex: 100,
//   },
//   status: {
//     flexGrow: 1,
//     flexShrink: 1,
//     paddingRight: 5,
//   },
// })
