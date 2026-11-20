import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

const BTN_SIZE = 28
const TOUCH_SIZE = 52

const handlePlayPrev = () => {
  void playPrev()
}
const handlePlayNext = () => {
  void playNext()
}

export interface ControlBtnProps {
  /** 单个按钮的触摸槽位边长，默认 52（与原有底栏一致） */
  size?: number
  /** 上一首/下一首/播放图标尺寸，默认 28 */
  iconSize?: number
  /** 播放键单独图标尺寸（圆形胶囊按钮通常更小），默认沿用 iconSize */
  playIconSize?: number
  /** 播放键外观：plain 透明（原有）/ circle 主题色实心圆（D3 胶囊） */
  playVariant?: 'plain' | 'circle'
}

const PlayPrevBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE }: ControlBtnProps) => {
  const theme = useTheme()

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

const PlayNextBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE }: ControlBtnProps) => {
  const theme = useTheme()

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

const TogglePlayBtn = ({ size = TOUCH_SIZE, iconSize = BTN_SIZE, playIconSize, playVariant = 'plain' }: ControlBtnProps) => {
  const isPlay = useIsPlay()
  const theme = useTheme()
  const isCircle = playVariant == 'circle'
  const finalIconSize = playIconSize ?? iconSize

  return (
    <TouchableOpacity
      style={{
        ...styles.cotrolBtn,
        width: scaleSizeW(size),
        height: scaleSizeH(size),
        borderRadius: scaleSizeW(size / 2),
        backgroundColor: isCircle ? theme['c-primary'] : undefined,
      }}
      activeOpacity={0.5}
      onPress={togglePlay}
    >
      <Icon name={isPlay ? 'pause' : 'play'} color={isCircle ? theme['c-primary-light-1000'] : theme['c-button-font']} size={finalIconSize} />
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
