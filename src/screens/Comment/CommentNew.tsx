import { useEffect, useRef } from 'react'
import { filterList, getNewComment } from './utils'
import music from '@/utils/musicSdk'
import List, { type ListType } from './components/List'
const limit = 15

export default ({ musicInfo, onUpdateTotal }: {
  musicInfo: LX.Music.MusicInfoOnline
  onUpdateTotal: (total: number) => void
}) => {
  // const [isLoading, setIsLoading] = useState(false)
  const listRef = useRef<ListType>(null)
  const listInfo = useRef({ page: 1, total: 0, maxPage: 1, isEnd: false, isLoading: false, isLoadError: false })
  // A06-007：评论页代际号，保证快速切歌时旧请求的回调不会写进新页面
  const seqRef = useRef(0)
  const handleGetComment = async(musicInfo: LX.Music.MusicInfoOnline, page: number) => {
    // setIsLoading(true)
    listInfo.current.isLoading = true
    return getNewComment(musicInfo, page, limit).then(commentInfo => {
      listInfo.current.page = page
      listInfo.current.isLoading = false
      // setIsLoading(false)
      if (listInfo.current.isLoadError) {
        listInfo.current.isLoadError = false
      }
      return commentInfo
    }).catch(async err => {
      console.log(err)
      if (err.message != '取消请求') {
        listInfo.current.isLoading = false
        // setIsLoading(false)
        listInfo.current.isLoadError = true
      }
      throw err
    })
  }
  const updateStatus = () => {
    if (listInfo.current.isLoadError) {
      listRef.current?.setStatus('error')
    } else if (listInfo.current.isEnd) {
      listRef.current?.setStatus('end')
    } else if (!listInfo.current.isLoading) {
      listRef.current?.setStatus('idle')
    }
  }
  const handleListLoadMore = () => {
    // A06-017：上游原样残留的调试日志（Hot 版对应位置没有），直接删除。
    if (listInfo.current.isLoading || listInfo.current.isEnd) return
    const list = listRef.current?.getList() ?? []
    const page = list.length ? listInfo.current.page + 1 : 1
    listRef.current?.setStatus('loading')
    void handleGetComment(musicInfo, page).then(({ comments }) => {
      let isEnd = page >= listInfo.current.maxPage
      if (listInfo.current.isEnd != isEnd) listInfo.current.isEnd = isEnd
      listRef.current?.setList(filterList([...listRef.current.getList(), ...comments]))
    }).finally(updateStatus)
  }

  const handleListRefresh = () => {
    listRef.current?.setStatus('refreshing')
    void handleGetComment(musicInfo, 1).then(({ comments, maxPage, total }) => {
      listInfo.current.total = total
      listInfo.current.maxPage = maxPage
      onUpdateTotal(total)
      let isEnd = maxPage === 1
      if (listInfo.current.isEnd != isEnd) listInfo.current.isEnd = isEnd
      listRef.current?.setList(filterList(comments))
    }).finally(updateStatus)
  }

  const handleShowComment = (musicInfo: LX.Music.MusicInfoOnline) => {
    // A06-019：musicSdk 是静态聚合对象，bd 源已注释、自定义源也不在其中，
    // music[source] 可能为 undefined，直接取 .comment 会抛 TypeError
    if (!musicInfo.id || !music[musicInfo.source]?.comment) return
    listInfo.current.page = 1
    listInfo.current.total = 0
    listInfo.current.maxPage = 1
    listInfo.current.isEnd = false
    listInfo.current.isLoading = false
    listInfo.current.isLoadError = false
    listRef.current?.setList([])
    listRef.current?.setStatus('loading')
    // A06-007：代际号 —— 快速切歌/切评论页时，旧请求的 300ms 回调不得再写进新页面的列表。
    const seq = ++seqRef.current
    void handleGetComment(musicInfo, 1).then(({ comments, maxPage, total }) => {
      if (seq !== seqRef.current) return
      listInfo.current.total = total
      listInfo.current.maxPage = maxPage
      onUpdateTotal(total)
      let isEnd = maxPage === 1
      if (listInfo.current.isEnd != isEnd) listInfo.current.isEnd = isEnd
      setTimeout(() => {
        if (seq !== seqRef.current) return
        listRef.current?.setList(filterList(comments))
        setTimeout(() => {
          if (seq !== seqRef.current) return
          updateStatus()
        }, 300)
      }, 300)
    }).catch(() => {
      // A06-001：原实现没有 catch —— handleGetComment 内部 rethrow 后无人接收，
      // 状态就永久停在 loading（不到 error 态、也没有重试入口）。与 loadMore/refresh 对齐。
      if (seq !== seqRef.current) return
      listRef.current?.setStatus('error')
    })
  }

  useEffect(() => {
    handleShowComment(musicInfo)
    // A06-007：卸载时让所有在途回调失效，避免已卸载组件的 setStatus 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { seqRef.current++ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicInfo.id])


  return (
    <List
      ref={listRef}
      onLoadMore={handleListLoadMore}
      onRefresh={handleListRefresh}
    />
  )
}
