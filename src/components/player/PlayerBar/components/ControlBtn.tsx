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
  /** 按钮高度（同时作为圆角基准：高 36 + 圆角 18 = 完全圆头的宽按钮） */
  size?: number
  /** 上一首/下一首图标尺寸 */
  iconSize?: number
  /** 播放图标尺寸 */
  playIconSize?: number
  /** 上一首/下一首外观：plain 透明（原有）/ ghost 淡色底宽按钮 / solid 主题色实心 */
  variant?: 'plain' | 'ghost' | 'solid'
  /** 播放键外观，默认沿用 variant */
  playVariant?: 'plain' | 'ghost' | 'solid'
  /** 上一首/下一首的横向权重（flexGrow） */
  grow?: number
  /** 播放键横向权重，通常略大于两侧以突出主操作 */
  playGrow?: number
}

// 实体宽按钮：宽度靠 flexGrow 均分并撑满，高度固定，圆角取半高 → 胶囊形
const wideButtonStyle = (size: number, grow: number): ViewStyle => ({
  ...styles.cotrolBtn,
  flexGrow: grow,
  flexShrink: 1,
  flexBasis: 0,
  height: scaleSizeH(size),
  borderRadius: scaleSizeW(size / 2),
  // 每个按钮自带一点抬起感，与胶囊整体悬浮阴影形成层次
  elevation: 2,
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
      style={{ ...wideButtonStyle(size, grow), backgroundColor: variant == 'solid' ? theme['c-primary'] : theme['c-primary-alpha-800'] }}
      activeOpacity={0.6}
      onPress={handlePlayPrev}
    >
      <Icon name='prevMusic' color={variant == 'solid' ? theme['c-primary-light-1000'] : theme['c-button-font']} size={iconSize} />
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
      style={{ ...wideButtonStyle(size, grow), backgroundColor: variant == 'solid' ? theme['c-primary'] : theme['c-primary-alpha-800'] }}
      activeOpacity={0.6}
      onPress={handlePlayNext}
    >
      <Icon name='nextMusic' color={variant == 'solid' ? theme['c-primary-light-1000'] : theme['c-button-font']} size={iconSize} />
    </TouchableOpacity>
  )
}

const TogglePlayBtn = ({
  size = TOUCH_SIZE,
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

  if (finalVariant == 'plain') {
    return (
      <TouchableOpacity
        style={{ ...styles.cotrolBtn, width: scaleSizeW(size), height: scaleSizeH(size) }}
        activeOpacity={0.5}
        onPress={togglePlay}
      >
        <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-button-font']} size={finalIconSize} />
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      style={{ ...wideButtonStyle(size, finalGrow), backgroundColor: finalVariant == 'solid' ? theme['c-primary'] : theme['c-primary-alpha-800'] }}
      activeOpacity={0.6}
      onPress={togglePlay}
    >
      <Icon name={isPlay ? 'pause' : 'play'} color={finalVariant == 'solid' ? theme['c-primary-light-1000'] : theme['c-button-font']} size={finalIconSize} />
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
