import { memo } from 'react'

import Button, { type BtnProps } from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

// style：允许调用方覆盖内边距/宽度（音源健康页要把 5 个按钮排成一行均分）
// textSize：按钮文案字号，默认 14，按钮变多时可调小避免换行
type ButtonProps = BtnProps & { textSize?: number }

export default memo(({ disabled, onPress, children, style, textSize = 14 }: ButtonProps) => {
  const theme = useTheme()

  return (
    <Button style={[styles.button, { backgroundColor: theme['c-button-background'] }, style]} onPress={onPress} disabled={disabled}>
      <Text size={textSize} color={theme['c-button-font']}>{children}</Text>
    </Button>
  )
})

const styles = createStyle({
  button: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 4,
    marginRight: 10,
  },
})
