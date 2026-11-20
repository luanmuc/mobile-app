import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, PanResponder, type ViewStyle } from 'react-native'
import { useDrag } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
// import { scaleSizeW } from '@/utils/pixelRatio'
// import { AppColors } from '@/theme'


const DefaultBar = memo(({ color }: { color?: string }) => {
  // const theme = useTheme()

  return <View style={{
    ...styles.progressBar,
    backgroundColor: color,
    position: 'absolute',
    width: '100%',
    left: 0,
    top: 0,
  }}></View>
})

const BufferedBar = memo(({ progress, color }: { progress: number, color?: string }) => {
  // console.log(bufferedProgress)
  const theme = useTheme()
  return <View style={{ ...styles.progressBar, backgroundColor: color ?? theme['c-primary-light-600-alpha-900'], position: 'absolute', width: `${progress * 100}%`, left: 0, top: 0 }}></View>
})

const PreassBar = memo(({ onDragState, setDragProgress, onSetProgress }: {
  onDragState: (drag: boolean) => void
  setDragProgress: (progress: number) => void
  onSetProgress: (progress: number) => void
}) => {
  const {
    onLayout,
    onDragStart,
    onDragEnd,
    onDrag,
  } = useDrag(onSetProgress, onDragState, setDragProgress)
  // const handlePress = useCallback((event: GestureResponderEvent) => {
  //   onPress(event.nativeEvent.locationX)
  // }, [onPress])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt, gestureState) => true,
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => true,

      // onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        onDrag(gestureState.dx)
      },
      onPanResponderGrant: (evt, gestureState) => {
        // console.log(evt.nativeEvent.locationX, gestureState)
        onDragStart(gestureState.dx, evt.nativeEvent.locationX)
      },
      onPanResponderRelease: () => {
        onDragEnd()
      },
      // A09-002：手势被系统/父容器接管（Terminate）时原来没有处理 —— 拖动态卡在 isDraging=true，
      // 进度不提交、UI 一直显示"拖动中"。补上与 Release 一致的回调。
      onPanResponderTerminate: () => {
        onDragEnd()
      },
    }),
  ).current

  return <View onLayout={onLayout} style={styles.pressBar} {...panResponder.panHandlers} />
})


export interface ProgressProps {
  progress: number
  duration: number
  buffered: number
  paddingTop?: number
  /** 紧凑模式：底栏细进度条专用，忽略 paddingTop，用 hitHeight 撑出触摸热区 */
  compact?: boolean
  /** 可视条高度（compact 模式），默认 3 */
  barHeight?: number
  /** 触摸热区高度（compact 模式），默认 10 */
  hitHeight?: number
  /** 可视条圆角（compact 模式），默认取 barHeight 的一半 */
  barRadius?: number
  /** 未播放轨道颜色，不传保持原「无底色」 */
  trackColor?: string
  /** 已播放颜色，默认主题 c-primary-alpha-900 */
  playedColor?: string
}

// compact 模式不能复用 styles.progress：那里是 flex:1，展开后 flexBasis:0%，
// 只覆盖 flexGrow/flexShrink 会让高度塌陷成 0，必须把 flexBasis 一起改回 auto。
const getLayout = (compact?: boolean, paddingTop?: number, barHeight = 3, hitHeight = 10, barRadius?: number): { rootStyle: ViewStyle, barAreaStyle: ViewStyle } => {
  if (compact) {
    return {
      rootStyle: {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: 'auto',
        height: hitHeight,
        justifyContent: 'flex-end',
        zIndex: 1,
      },
      barAreaStyle: {
        height: barHeight,
        width: '100%',
        borderRadius: barRadius ?? barHeight / 2,
        overflow: 'hidden',
      },
    }
  }
  return {
    rootStyle: { ...styles.progress, paddingTop },
    barAreaStyle: { flex: 1 },
  }
}

export const ProgressPlain = ({
  progress,
  duration,
  buffered,
  paddingTop,
  compact,
  barHeight,
  hitHeight,
  barRadius,
  trackColor,
  playedColor,
}: ProgressProps) => {
  // const { progress } = usePlayTimeBuffer()
  const theme = useTheme()
  // console.log(progress)
  const progressStr: `${number}%` = `${progress * 100}%`

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  const { rootStyle, barAreaStyle } = getLayout(compact, paddingTop, barHeight, hitHeight, barRadius)

  return (
    <View style={rootStyle}>
      <View style={barAreaStyle}>
        <DefaultBar color={trackColor} />
        <BufferedBar progress={buffered} />
        <View style={{ ...styles.progressBar, backgroundColor: playedColor ?? theme['c-primary-alpha-900'], width: progressStr, position: 'absolute', left: 0, top: 0 }} />
      </View>
      <View style={styles.pressBar} />
    </View>
  )
}

const Progress = ({
  progress,
  duration,
  buffered,
  paddingTop,
  compact,
  barHeight,
  hitHeight,
  barRadius,
  trackColor,
  playedColor,
}: ProgressProps) => {
  // const { progress } = usePlayTimeBuffer()
  const theme = useTheme()
  const [draging, setDraging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  // console.log(progress)
  const progressStr: `${number}%` = `${progress * 100}%`

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  const onSetProgress = useCallback((progress: number) => {
    global.app_event.setProgress(progress * durationRef.current)
  }, [])
  const { rootStyle, barAreaStyle } = getLayout(compact, paddingTop, barHeight, hitHeight, barRadius)

  return (
    <View style={rootStyle}>
      <View style={barAreaStyle}>
        <DefaultBar color={trackColor} />
        <BufferedBar progress={buffered} />
        {
          draging
            ? (
                <>
                  <View style={{ ...styles.progressBar, backgroundColor: theme['c-primary-light-200-alpha-900'], width: progressStr, position: 'absolute', left: 0, top: 0 }} />
                  <View style={{ ...styles.progressBar, backgroundColor: theme['c-primary-light-100-alpha-800'], width: `${dragProgress * 100}%`, position: 'absolute', left: 0, top: 0 }} />
                </>
              ) : (
                <View style={{ ...styles.progressBar, backgroundColor: playedColor ?? theme['c-primary-alpha-900'], width: progressStr, position: 'absolute', left: 0, top: 0 }} />
              )
        }
      </View>
      <PreassBar onDragState={setDraging} setDragProgress={setDragProgress} onSetProgress={onSetProgress} />
      {/* <View style={{ ...styles.progressBar, height: '100%', width: progressStr }}><Pressable style={styles.progressDot}></Pressable></View> */}
    </View>
  )
}


// const progressContentPadding = 9
// const progressHeight = 3
const styles = createStyle({
  progress: {
    flex: 1,
    // backgroundColor: 'rgba(0,0,0,0.2)',
    zIndex: 1,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  pressBar: {
    position: 'absolute',
    // backgroundColor: 'rgba(0,0,0,0.5)',
    left: 0,
    top: 0,
    // height: progressContentPadding * 2 + progressHeight,
    height: '100%',
    width: '100%',
  },
})

export default Progress
