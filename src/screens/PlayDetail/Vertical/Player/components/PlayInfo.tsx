import { memo } from 'react'
import { View } from 'react-native'

import Progress from '@/components/player/ProgressBar'
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
    <>
      {
        (qualityLabel || sourceLabel)
          ? <View style={styles.quality}>
              {
                qualityLabel
                  ? <PlayQualityTag label={qualityLabel} prefix={t('quality_tag')} size={12} />
                  : null
              }
              {
                sourceLabel
                  ? <View style={styles.sourceGap}><PlayQualityTag label={sourceLabel} prefix={t('source_tag')} size={12} /></View>
                  : null
              }
            </View>
          : null
      }
      <View style={styles.progress}><Progress progress={progress} duration={maxPlayTime} buffered={buffered} /></View>
      <View style={styles.info}>
        <PlayTimeCurrent timeStr={nowPlayTimeStr} />
        <View style={styles.status} >
          <Status />
        </View>
        <PlayTimeMax timeStr={maxPlayTimeStr} />
      </View>
    </>
  )
}


const styles = createStyle({
  progress: {
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'column',
    justifyContent: 'center',
  },
  quality: {
    flexGrow: 0,
    flexShrink: 0,
    paddingBottom: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceGap: {
    marginLeft: 6,
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
    paddingLeft: 10,
    paddingRight: 10,
  },
})
