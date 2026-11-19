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
 * - 文字模式（传 label）：与播放页「音源/音质」标签（PlayQualityTag）同一套视觉——
 *   1px 细边框 + 极淡主色底 + 主色粗体小字，不铺整块色底；外层 Touchable 仍撑满 42dp，热区不缩水。
 */
export default ({ icon, label, color, onPress }: {
  icon?: string
  label?: string
  color?: string
  onPress: () => void
}) => {
  const theme = useTheme()

  if (label) {
    return (
      <TouchableOpacity onPress={onPress} style={styles.button}>
        <View style={[styles.tag, { borderColor: theme['c-primary-alpha-300'], backgroundColor: theme['c-primary-alpha-900'] }]}>
          <Text size={12} color={color ?? theme['c-primary']} style={styles.tagText}>{label}</Text>
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
    minWidth: 42,
    flex: 0,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: {
    fontWeight: 'bold',
  },
})
