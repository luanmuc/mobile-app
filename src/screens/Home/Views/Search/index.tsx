import { useRef, useEffect } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'

// import music from '@/utils/musicSdk'
// import InsetShadow from 'react-native-inset-shadow'
// import TipList from './components/TipList'
// import MusicList from './components/MusicList'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import searchState, { type SearchType } from '@/store/search/state'
import { getSearchSetting, saveSearchSetting } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import TipList, { type TipListType } from './TipList'
import List, { type ListType } from './List'
import { addHistoryWord } from '@/core/search/search'


interface SearchInfo {
  searchType: 'music' | 'songlist'
}

const SEARCH_SOURCE = 'all' as const

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const searchTipListRef = useRef<TipListType>(null)
  const listRef = useRef<ListType>(null)
  const layoutHeightRef = useRef<number>(0)
  const searchInfo = useRef<SearchInfo>({ searchType: 'music' })
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    void getSearchSetting().then(info => {
      searchInfo.current.searchType = info.type
      headerBarRef.current?.setText(searchState.searchText)
      listRef.current?.loadList(searchState.searchText, SEARCH_SOURCE, info.type)
    })

    const handleTypeChange = (type: SearchType) => {
      searchInfo.current.searchType = type
      void saveSearchSetting({ type })
      listRef.current?.loadList(searchState.searchText, SEARCH_SOURCE, type)
    }
    global.app_event.on('searchTypeChanged', handleTypeChange)

    return () => {
      global.app_event.off('searchTypeChanged', handleTypeChange)
    }
  }, [])


  const handleLayout = (e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height
  }

  const handleTipSearch: HeaderBarProps['onTipSearch'] = (text) => {
    // A04-014：上游原样把这个 setTimeout 的句柄直接丢弃，handleHideTipList 只清
    // handleShowTipList 存下的那个 —— 输入后 500ms 内提交/失焦时，延时回调仍会执行
    // 并打开联想列表。纳入同一个 timeoutRef 统一管理。
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      searchTipListRef.current?.search(text, layoutHeightRef.current)
    }, 500)
  }
  const handleHideTipList = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    searchTipListRef.current?.hide()
  }
  const handleSearch: HeaderBarProps['onSearch'] = (text) => {
    handleHideTipList()
    searchTipListRef.current?.search(text, layoutHeightRef.current)
    headerBarRef.current?.setText(text)
    headerBarRef.current?.blur()
    void addHistoryWord(text)
    listRef.current?.loadList(text, SEARCH_SOURCE, searchInfo.current.searchType)
  }
  const handleShowTipList: HeaderBarProps['onShowTipList'] = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      searchTipListRef.current?.show(layoutHeightRef.current)
    }, 500)
  }

  return (
    <View style={styles.container}>
      <HeaderBar
        ref={headerBarRef}
        onTipSearch={handleTipSearch}
        onSearch={handleSearch}
        onHideTipList={handleHideTipList}
        onShowTipList={handleShowTipList}
      />
      <View style={styles.content} onLayout={handleLayout}>
        <TipList ref={searchTipListRef} onSearch={handleSearch} />
        <List ref={listRef} onSearch={handleSearch} />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
  content: {
    flex: 1,
  },
})
