import { TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT } from '@/config/constant'

export const HEADER_HEIGHT = scaleSizeH(_HEADER_HEIGHT)

/**
 * Header 按钮。
 * - 图标模式（默认）：与上游一致，42dp 方格 + 18px 图标。
 * - 文字模式（传 label）：淡主色药丸底 + 汉字，解决纯图标「看不出是什么、也不像按钮」的问题。
 *   外层 Touchable 仍撑满 Header 高度，热区不小于 42dp。
 */
export default ({ icon, label, color, bgColor, onPress }: {
  icon?: string
  label?: string
  color?: string
  bgColor?: string
  onPress: () => void
}) => {
  const theme = useTheme()

  if (label) {
    return (
      <TouchableOpacity onPress={onPress} style={styles.button}>
        <View style={[styles.pill, { backgroundColor: bgColor ?? theme['c-primary-alpha-200'] }]}>
          <Text size={13} color={color ?? theme['c-primary']} style={styles.pillText}>{label}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity onPress={onPress} style={{ ...styles.button, width: HEADER_HEIGHT }}>
      {icon ? <Icon name={icon} color={color} size={18} /> : null}
    </TouchableOpacity>
  )
}

const styles = createStyle({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    flex: 0,
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
