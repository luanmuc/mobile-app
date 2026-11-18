import { getSongListSetting, saveSongListSetting } from '@/utils/data'
import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

// import List from './List/List'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import songlistState, { type InitState, type SortInfo } from '@/store/songlist/state'
import List, { type ListType } from './List'


interface SonglistInfo {
  source: InitState['sources'][number]
  sortId: SortInfo['id']
  tagId: string
}

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const listRef = useRef<ListType>(null)
  const songlistInfo = useRef<SonglistInfo>({ source: 'kw', sortId: '5', tagId: '' })

  useEffect(() => {
    void getSongListSetting().then(info => {
      songlistInfo.current.source = info.source
      songlistInfo.current.sortId = info.sortId
      songlistInfo.current.tagId = info.tagId
      headerBarRef.current?.setSource(info.source, info.sortId, info.tagName, info.tagId)
      listRef.current?.loadList(info.source, info.sortId, info.tagId)
    })
  }, [])

  const handleSortChange: HeaderBarProps['onSortChange'] = (id) => {
    songlistInfo.current.sortId = id
    void saveSongListSetting({ sortId: id })
    listRef.current?.loadList(songlistInfo.current.source, id, songlistInfo.current.tagId)
  }

  const handleTagChange: HeaderBarProps['onTagChange'] = (name, id) => {
    songlistInfo.current.tagId = id
    void saveSongListSetting({ tagName: name, tagId: id })
    listRef.current?.loadList(songlistInfo.current.source, songlistInfo.current.sortId, id)
  }

  const handleSourceChange: HeaderBarProps['onSourceChange'] = (source) => {
    // A05-007：原来先把 source/tagId 写进 songlistInfo 再判 firstSort，缺失时直接 return ——
    // 头部与列表还停在旧源，ref 状态和 songlistInfo.current 已经不一致（"头部是 B、列表是 A"）。
    // 改为先取排序项，缺失就整体不动，保持旧源状态自洽。
    // sortList 里该源可能为空，用可选链兜住后再判空，避免 [0] 越界
    const firstSort = songlistState.sortList[source]?.[0]
    if (!firstSort) return
    songlistInfo.current.source = source
    songlistInfo.current.tagId = ''
    songlistInfo.current.sortId = firstSort.id
    void saveSongListSetting({ sortId: songlistInfo.current.sortId, source, tagId: '', tagName: '' })
    headerBarRef.current?.setSource(source, songlistInfo.current.sortId, '', songlistInfo.current.tagId)
    listRef.current?.loadList(source, songlistInfo.current.sortId, songlistInfo.current.tagId)
  }

  return (
    <View style={styles.container}>
      <HeaderBar
        ref={headerBarRef}
        onSortChange={handleSortChange}
        onTagChange={handleTagChange}
        onSourceChange={handleSourceChange}
      />
      <List ref={listRef} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
})

