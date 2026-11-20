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
// 胶囊宽度按底栏内容宽的比例给，窄屏 / 横屏靠 maxWidth 兜底
const CAPSULE_WIDTH = '64%'
const CAPSULE_HEIGHT = 44
// 胶囊 44 高、内边距 4 → 两侧按钮 36；播放键单独 40，凸出 2dp 形成主次
const CONTROL_SIZE = 36
const PLAY_SIZE = 40
const CONTROL_ICON = 24
const PLAY_ICON = 26

export default memo(({ isHome = false }: { isHome?: boolean }) => {
  // const { onLayout, ...layout } = useLayout()
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')

  const playerComponent = useMemo(() => (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'], borderColor: theme['c-primary-alpha-700'] }}>
      <View style={styles.topRow}>
        <Pic isHome={isHome} size={PIC_SIZE} />
        <View style={styles.infoColumn}>
          <Title isHome={isHome} />
          <PlayInfo isHome={isHome} />
        </View>
      </View>
      <BarProgress isHome={isHome} />
      <View style={{ ...styles.capsule, backgroundColor: theme['c-primary-alpha-900'], borderColor: theme['c-primary-alpha-800'] }}>
        <ControlBtn size={CONTROL_SIZE} playSize={PLAY_SIZE} iconSize={CONTROL_ICON} playIconSize={PLAY_ICON} variant='filled' playVariant='filled' grow={1} playGrow={1.15} />
      </View>
    </View>
  ), [theme, isHome])

  // console.log('render pb')

  return autoHidePlayBar && keyboardShown ? null : playerComponent
})


const styles = createStyle({
  container: {
    // 整个播放栏做成悬浮卡片：四周留白 + 四角圆角 + 强阴影，脱离列表背景
    alignSelf: 'stretch',
    marginHorizontal: 10,
    marginBottom: 8,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    // 圆角加大到 28，轮廓更圆润；加 1dp 绿边，和三个按钮的高光边同一套视觉语言
    borderRadius: scaleSizeW(28),
    borderWidth: 1,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
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
    // 四周 4dp（44 高 → 按钮 36 高）、按钮之间 6dp
    padding: 4,
    gap: 6,
    // 窄屏 / 横屏内容区比胶囊还窄时不允许溢出
    maxWidth: '100%',
    // 悬浮感：Android 靠 elevation，iOS 靠阴影
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
})
