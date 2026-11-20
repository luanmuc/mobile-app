import { TouchableOpacity, type ViewStyle } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

const BTN_SIZE = 28
const TOUCH_SIZE = 52
const DEFAULT_GROW = 1

const handlePlayPrev = () => {
  void playPrev()
}
const handlePlayNext = () => {
  void playNext()
}

export interface ControlBtnProps {
  /** 按钮高度（同时作为圆角基准，圆角 = 半高 → 完全圆头） */
  size?: number
  /** 播放键单独高度，通常比两侧略高以形成主次 */
  playSize?: number
  /** 上一首/下一首图标尺寸 */
  iconSize?: number
  /** 播放图标尺寸 */
  playIconSize?: number
  /** 上一首/下一首外观：plain 透明（原有）/ filled 品牌色实心 */
  variant?: 'plain' | 'filled'
  /** 播放键外观，默认沿用 variant */
  playVariant?: 'plain' | 'filled'
  /** 上一首/下一首的横向权重（flexGrow） */
  grow?: number
  /** 播放键横向权重 */
  playGrow?: number
}

// 实心按钮：不使用半透明叠色（会发灰），统一走接近实色的品牌色 + 白色图标，
// 再压一层 1dp 白色高光边和 elevation，做出实体按键的质感。
const filledButtonStyle = (size: number, grow: number, elevation: number): ViewStyle => ({
  ...styles.cotrolBtn,
  flexGrow: grow,
  flexShrink: 1,
  flexBasis: 0,
  height: scaleSizeH(size),
  borderRadius: scaleSizeW(size / 2),
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.28)',
  elevation,
})

const PlayPrevBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, variant = 'plain', grow = DEFAULT_GROW }: ControlBtnProps) => {
  const theme = useTheme()

  if (variant == 'plain') {
    return (
      <TouchableOpacity
        style={{ ...styles.cotrolBtn, width: scaleSizeW(size), height: scaleSizeH(size) }}
        activeOpacity={0.5}
        onPress={handlePlayPrev}
      >
        <Icon name='prevMusic' color={theme['c-button-font']} size={iconSize} />
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      // c-primary-alpha-100 是 0.90 不透明度的品牌绿，接近实色，压在淡绿胶囊上不会发灰
      style={{ ...filledButtonStyle(size, grow, 3), backgroundColor: theme['c-primary-alpha-100'] }}
      activeOpacity={0.6}
      onPress={handlePlayPrev}
    >
      <Icon name='prevMusic' color={theme['c-primary-light-1000']} size={iconSize} />
    </TouchableOpacity>
  )
}

const PlayNextBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, variant = 'plain', grow = DEFAULT_GROW }: ControlBtnProps) => {
  const theme = useTheme()

  if (variant == 'plain') {
    return (
      <TouchableOpacity
        style={{ ...styles.cotrolBtn, width: scaleSizeW(size), height: scaleSizeH(size) }}
        activeOpacity={0.5}
        onPress={handlePlayNext}
      >
        <Icon name='nextMusic' color={theme['c-button-font']} size={iconSize} />
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      style={{ ...filledButtonStyle(size, grow, 3), backgroundColor: theme['c-primary-alpha-100'] }}
      activeOpacity={0.6}
      onPress={handlePlayNext}
    >
      <Icon name='nextMusic' color={theme['c-primary-light-1000']} size={iconSize} />
    </TouchableOpacity>
  )
}

const TogglePlayBtn = ({
  size = TOUCH_SIZE,
  playSize,
  iconSize = BTN_SIZE,
  playIconSize,
  variant = 'plain',
  playVariant,
  grow = DEFAULT_GROW,
  playGrow,
}: ControlBtnProps) => {
  const isPlay = useIsPlay()
  const theme = useTheme()
  const finalVariant = playVariant ?? variant
  const finalGrow = playGrow ?? grow
  const finalIconSize = playIconSize ?? iconSize
  const finalSize = playSize ?? size

  if (finalVariant == 'plain') {
    return (
      <TouchableOpacity
        style={{ ...styles.cotrolBtn, width: scaleSizeW(finalSize), height: scaleSizeH(finalSize) }}
        activeOpacity={0.5}
        onPress={togglePlay}
      >
        <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-button-font']} size={finalIconSize} />
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      // 播放键用不透明品牌色 + 更高 elevation，比两侧更“实”，主操作一眼可见
      style={{ ...filledButtonStyle(finalSize, finalGrow, 5), backgroundColor: theme['c-primary'] }}
      activeOpacity={0.6}
      onPress={togglePlay}
    >
      <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-primary-light-1000']} size={finalIconSize} />
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
