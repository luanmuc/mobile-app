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
 * - 文字模式（传 label）：与播放页「音源/音质」标签（PlayQualityTag）同一套视觉——
 *   1px 细边框 + 极淡主色底 + 主色粗体小字，不铺整块色底；热区不小于 BTN_WIDTH。
 */
export default ({ icon, label, size, color, onPress, onLongPress }: {
  icon?: string
  label?: string
  size?: number
  color?: string
  onPress: () => void
  onLongPress?: () => void
}) => {
  const theme = useTheme()

  if (label) {
    return (
      <TouchableOpacity style={{ ...styles.cotrolBtn, height: BTN_WIDTH, minWidth: BTN_WIDTH }} activeOpacity={0.5} onPress={onPress} onLongPress={onLongPress}>
        <View style={[styles.tag, { borderColor: theme['c-primary-alpha-300'], backgroundColor: theme['c-primary-alpha-900'] }]}>
          <Text size={12} color={color ?? theme['c-primary']} style={styles.tagText}>{label}</Text>
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
