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
// 胶囊宽度按底栏内容宽的比例给，占 3/5 强；窄屏 / 横屏靠 maxWidth 兜底
const CAPSULE_WIDTH = '64%'
const CAPSULE_HEIGHT = 44
// 三个槽位均分胶囊宽度，高度贴满 44 只留呼吸；不增加底栏总高
const CONTROL_SIZE = 44
const CONTROL_ICON = 26
const PLAY_ICON = 22
const PLAY_CIRCLE = 40

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
      <BarProgress isHome={isHome} />
      <View style={{ ...styles.capsule, backgroundColor: theme['c-primary-alpha-900'], borderColor: theme['c-primary-alpha-800'] }}>
        <ControlBtn size={CONTROL_SIZE} iconSize={CONTROL_ICON} playIconSize={PLAY_ICON} playCircleSize={PLAY_CIRCLE} playVariant='circle' fill />
      </View>
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
    // 进度条已移到封面行与胶囊之间，底部恢复 10dp 呼吸。
    paddingBottom: 10,
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
    // 进度条紧贴其上（BarProgress 自带 6dp marginTop），这里只留 4dp 呼吸
    marginTop: 4,
    marginBottom: 10,
    borderRadius: scaleSizeW(CAPSULE_HEIGHT / 2),
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    // 窄屏 / 横屏内容区比胶囊还窄时不允许溢出
    maxWidth: '100%',
    paddingHorizontal: 8,
  },
})
