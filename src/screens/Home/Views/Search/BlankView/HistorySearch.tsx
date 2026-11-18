import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { type InitState } from '@/store/hotSearch/state'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { clearHistoryList, getSearchHistory, removeHistoryWord } from '@/core/search/search'
import { Icon } from '@/components/common/Icon'


export type List = NonNullable<InitState['sourceList'][keyof InitState['sourceList']]>

const ListItem = ({ keyword, onSearch, onRemove }: {
  keyword: string
  onSearch: (keyword: string) => void
  onRemove: (keyword: string) => void
}) => {
  const theme = useTheme()
  return (
    <Button
      style={{ ...styles.button, backgroundColor: theme['c-button-background'] }}
      onPress={() => { onSearch(keyword) }}
      onLongPress={() => { onRemove(keyword) }}
    >
      <Text color={theme['c-button-font']} size={13}>{keyword}</Text>
    </Button>
  )
}


interface HistorySearchProps {
  onSearch: (keyword: string) => void
}
export interface HistorySearchType {
  show: () => void
}

export default forwardRef<HistorySearchType, HistorySearchProps>((props, ref) => {
  const [list, setList] = useState<List>([])
  const isUnmountedRef = useRef(false)
  const t = useI18n()
  const theme = useTheme()

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  useImperativeHandle(ref, () => ({
    show() {
      // A04-009：getSearchHistory 未 catch —— 读取失败时 reject 变 unhandled rejection，
      // 历史列表停在空态且无任何提示。
      void getSearchHistory().then((list) => {
        if (isUnmountedRef.current) return
        setList(list)
      }).catch(() => {})
    },
  }), [])

  const handleClear = () => {
    clearHistoryList()
    setList([])
  }

  // A04-010：原实现把存储副作用写在 setState updater 内，且 indexOf 未命中时
  // splice(-1, 1) 会误删最后一个词条；updater 在 StrictMode 下还可能被调用两次。
  // 现在改为按当前 list 定位、命中才删，副作用移出 updater。
  const handleRemove = useCallback((keyword: string) => {
    const index = list.indexOf(keyword)
    if (index === -1) return
    const next = [...list]
    next.splice(index, 1)
    setList(next)
    removeHistoryWord(index)
  }, [list])

  return (
    list.length
      ? (
          <View>
            <View style={styles.titleContent}>
              <Text size={16}>{t('search_history_search')}</Text>
              <TouchableOpacity onPress={handleClear} style={styles.titleBtn}>
                <Icon name="eraser" color={theme['c-300']} size={14} />
              </TouchableOpacity>
            </View>
            <View style={styles.list}>
              {
                list.map(keyword => <ListItem keyword={keyword} key={keyword} onSearch={props.onSearch} onRemove={handleRemove} />)
              }
            </View>
          </View>
        )
      : null
  )
})


const styles = createStyle({
  titleContent: {
    paddingTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    // paddingLeft: 15,
    // paddingBottom: 5,
  },
  titleBtn: {
    marginLeft: 10,
    padding: 5,
  },
  list: {
    // paddingLeft: 15,
    // paddingRight: 15,
    flexDirection: 'row',
    flexWrap: 'wrap',
    // paddingBottom: 15,
  },
  button: {
    textAlign: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 4,
    marginRight: 10,
    marginTop: 8,
  },
})
