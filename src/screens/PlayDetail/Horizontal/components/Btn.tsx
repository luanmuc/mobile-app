import { TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'

import { HEADER_HEIGHT } from '@/config/constant'
export const BTN_WIDTH = scaleSizeW(HEADER_HEIGHT)
export const BTN_ICON_SIZE = 20

/**
 * 横屏 Header 按钮。
 * - 图标模式（默认）：固定方格图标按钮。
 * - 文字模式（传 label）：淡主色药丸底 + 汉字，与竖屏保持一致，热区不小于 BTN_WIDTH。
 */
export default ({ icon, label, size, color, bgColor, onPress, onLongPress }: {
  icon?: string
  label?: string
  size?: number
  color?: string
  bgColor?: string
  onPress: () => void
  onLongPress?: () => void
}) => {
  const theme = useTheme()

  if (label) {
    return (
      <TouchableOpacity style={{ ...styles.cotrolBtn, height: BTN_WIDTH }} activeOpacity={0.5} onPress={onPress} onLongPress={onLongPress}>
        <View style={[styles.pill, { backgroundColor: bgColor ?? theme['c-primary-alpha-200'] }]}>
          <Text size={13} color={color ?? theme['c-primary']} style={styles.pillText}>{label}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity style={{ ...styles.cotrolBtn, width: BTN_WIDTH, height: BTN_WIDTH }} activeOpacity={0.5} onPress={onPress} onLongPress={onLongPress}>
      {icon ? <Icon name={icon} color={color ?? theme['c-550']} size={size ?? BTN_ICON_SIZE} /> : null}
    </TouchableOpacity>
  )
}

const styles = createStyle({
  cotrolBtn: {
    // marginLeft: 5,
    justifyContent: 'center',
    alignItems: 'center',

    // backgroundColor: '#ccc',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
  pill: {
    height: 30,
    minWidth: 46,
    borderRadius: 15,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: {
    fontWeight: '500',
  },
})
