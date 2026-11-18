import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Songlist, { type SonglistProps, type SonglistType } from './components/Songlist'
import { clearList, getList, setList, setListInfo } from '@/core/songlist'
import songlistState from '@/store/songlist/state'
import { type Source } from '@/store/songlist/state'


export interface ListType {
  loadList: (source: Source, sortId: string, tagId: string) => void
}

export default forwardRef<ListType, {}>((props, ref) => {
  const listRef = useRef<SonglistType>(null)
  const isUnmountedRef = useRef(false)
  // A05-005：请求代际号 —— getList 慢于后续一次切源/切排序/切标签时，旧响应后到会把新列表覆盖掉。
  const reqSeq = useRef(0)
  useImperativeHandle(ref, () => ({
    async loadList(source, sortId, tagId) {
      const listInfo = songlistState.listInfo
      listRef.current?.setList([])
      if (listInfo.tagId == tagId && listInfo.sortId == sortId && listInfo.source == source && listInfo.list.length) {
        requestAnimationFrame(() => {
          listRef.current?.setList(listInfo.list)
        })
      } else {
        listRef.current?.setStatus('loading')
        setListInfo(source, tagId, sortId)
        const page = 1
        const seq = ++reqSeq.current
        return getList(source, tagId, sortId, page).then((info) => {
          const result = setList(info, tagId, sortId, page)
          if (isUnmountedRef.current || seq !== reqSeq.current) return
          requestAnimationFrame(() => {
            listRef.current?.setList(result.list)
            listRef.current?.setStatus(songlistState.listInfo.maxPage <= page ? 'end' : 'idle')
          })
        }).catch(() => {
          if (isUnmountedRef.current || seq !== reqSeq.current) return
          if (songlistState.listInfo.list.length && page == 1) clearList()
          listRef.current?.setStatus('error')
        })
      }
    },
  }), [])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])


  const handleRefresh: SonglistProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    const seqR = ++reqSeq.current
    getList(songlistState.listInfo.source, songlistState.listInfo.tagId, songlistState.listInfo.sortId, page, true).then((info) => {
      const result = setList(info, songlistState.listInfo.tagId, songlistState.listInfo.sortId, page)
      if (isUnmountedRef.current || seqR !== reqSeq.current) return
      listRef.current?.setList(result.list)
      listRef.current?.setStatus(songlistState.listInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (songlistState.listInfo.list.length && page == 1) clearList()
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: SonglistProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const page = songlistState.listInfo.list.length ? songlistState.listInfo.page + 1 : 1
    const seqM = ++reqSeq.current
    getList(songlistState.listInfo.source, songlistState.listInfo.tagId, songlistState.listInfo.sortId, page).then((info) => {
      const result = setList(info, songlistState.listInfo.tagId, songlistState.listInfo.sortId, page)
      if (isUnmountedRef.current || seqM !== reqSeq.current) return
      listRef.current?.setList(result.list)
      listRef.current?.setStatus(songlistState.listInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (songlistState.listInfo.list.length && page == 1) clearList()
      listRef.current?.setStatus('error')
    })
  }

  return <Songlist
    ref={listRef}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
   />
})

