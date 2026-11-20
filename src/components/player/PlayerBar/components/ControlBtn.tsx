import { TouchableOpacity, View, type ViewStyle } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

const BTN_SIZE = 28
const TOUCH_SIZE = 52
const PLAY_CIRCLE = 40

const handlePlayPrev = () => {
  void playPrev()
}
const handlePlayNext = () => {
  void playNext()
}

export interface ControlBtnProps {
  /** 槽位固定边长；fill=true 时只作为高度基准 */
  size?: number
  /** 上一首/下一首图标尺寸，默认 28 */
  iconSize?: number
  /** 播放图标尺寸，默认沿用 iconSize */
  playIconSize?: number
  /** 播放键实心圆直径（circle 模式），默认 40 */
  playCircleSize?: number
  /** 播放键外观：plain 透明（原有）/ circle 主题色实心圆（D3 胶囊） */
  playVariant?: 'plain' | 'circle'
  /** 三个槽位均分父容器宽度（flex:1），用于把胶囊内部铺满 */
  fill?: boolean
}

// fill 模式：宽度由父容器均分，只锁高度；固定模式：宽高都按 size
const slotStyle = (size: number, fill?: boolean): ViewStyle => {
  if (fill) {
    return { ...styles.cotrolBtn, flexGrow: 1, flexShrink: 1, flexBasis: 0, height: scaleSizeH(size) }
  }
  return { ...styles.cotrolBtn, width: scaleSizeW(size), height: scaleSizeH(size) }
}

const PlayPrevBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, fill }: ControlBtnProps) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={slotStyle(size, fill)}
      activeOpacity={0.5}
      onPress={handlePlayPrev}
    >
      <Icon name='prevMusic' color={theme['c-button-font']} size={iconSize} />
    </TouchableOpacity>
  )
}

const PlayNextBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, fill }: ControlBtnProps) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={slotStyle(size, fill)}
      activeOpacity={0.5}
      onPress={handlePlayNext}
    >
      <Icon name='nextMusic' color={theme['c-button-font']} size={iconSize} />
    </TouchableOpacity>
  )
}

const TogglePlayBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, playIconSize, playCircleSize = PLAY_CIRCLE, playVariant = 'plain', fill }: ControlBtnProps) => {
  const isPlay = useIsPlay()
  const theme = useTheme()
  const isCircle = playVariant == 'circle'
  const finalIconSize = playIconSize ?? iconSize
  const circle = scaleSizeW(playCircleSize)

  return (
    <TouchableOpacity
      style={isCircle ? slotStyle(size, fill) : { ...slotStyle(size, fill), borderRadius: scaleSizeW(size / 2), backgroundColor: undefined }}
      activeOpacity={0.5}
      onPress={togglePlay}
    >
      {
        isCircle
          // 槽位可以很宽，但实心圆只占固定直径，保证三个按钮视觉权重一致
          ? (
              <View style={{
                width: circle,
                height: circle,
                borderRadius: circle / 2,
                backgroundColor: theme['c-primary'],
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-primary-light-1000']} size={finalIconSize} />
              </View>
            )
          : <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-button-font']} size={finalIconSize} />
      }
    </TouchableOpacity>
  )
}

export default (props: ControlBtnProps = {}) => {
  return (
    <>
      <PlayPrevBtn {...props} />
      <TogglePlayBtn {...props} />
      <PlayNextBtn {...props} />
    </>
  )
}


const styles = createStyle({
  cotrolBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
})
