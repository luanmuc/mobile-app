import { memo, useMemo } from 'react'
import { View } from 'react-native'
import { useKeyboard } from '@/utils/hooks'

import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import BarProgress from './components/BarProgress'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { scaleSizeW } from '@/utils/pixelRatio'

const PIC_SIZE = 50
const CAPSULE_WIDTH = 176
const CAPSULE_HEIGHT = 44
const CONTROL_SIZE = 38
const CONTROL_ICON = 19
const PLAY_ICON = 15

export default memo(({ isHome = false }: { isHome?: boolean }) => {
  // const { onLayout, ...layout } = useLayout()
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')

  const playerComponent = useMemo(() => (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      <View style={styles.topRow}>
        <Pic isHome={isHome} size={PIC_SIZE} />
        <View style={styles.infoColumn}>
          <Title isHome={isHome} />
          <PlayInfo isHome={isHome} />
        </View>
      </View>
      <View style={{ ...styles.capsule, backgroundColor: theme['c-primary-alpha-900'], borderColor: theme['c-primary-alpha-800'] }}>
        <ControlBtn size={CONTROL_SIZE} iconSize={CONTROL_ICON} playIconSize={PLAY_ICON} playVariant='circle' />
      </View>
      <BarProgress isHome={isHome} />
    </View>
  ), [theme, isHome])

  // console.log('render pb')

  return autoHidePlayBar && keyboardShown ? null : playerComponent
})


const styles = createStyle({
  container: {
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 12,
    // D3：底部那 10dp 由胶囊 marginBottom 提供，进度条热区正好落在这一层。
    // 这里必须为 0 —— 否则总高会变成 138 而不是 128，且胶囊与热区之间会空出 10dp。
    paddingBottom: 0,
    borderTopLeftRadius: scaleSizeW(12),
    borderTopRightRadius: scaleSizeW(12),
    elevation: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  infoColumn: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  capsule: {
    width: CAPSULE_WIDTH,
    height: CAPSULE_HEIGHT,
    alignSelf: 'center',
    marginTop: 14,
    // 与 BarProgress 的 10dp 热区合起来构成底部 10dp —— 两者恰好相接。
    marginBottom: 10,
    borderRadius: scaleSizeW(CAPSULE_HEIGHT / 2),
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
})
