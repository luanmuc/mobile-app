import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import SourceSelector, {
  type SourceSelectorType as _SourceSelectorType,
  // type SourceSelectorProps as _SourceSelectorProps,
} from '@/components/SourceSelector'
import BoardsList, { type BoardsListType, type BoardsListProps } from '../BoardsList'
import { BorderWidths } from '@/theme'
import { createStyle, toast } from '@/utils/tools'
import { handleCollect, handlePlay } from '../listAction'
import boardState, { type InitState } from '@/store/leaderboard/state'
import { useTheme } from '@/store/theme/hook'
import { getBoardsList } from '@/core/leaderboard'

type Sources = Readonly<InitState['sources']>
// type SourceSelectorProps = _SourceSelectorProps<Sources>
type SourceSelectorType = _SourceSelectorType<Sources>

export interface LeftBarProps {
  onChangeList: (source: LX.OnlineSource, id: string) => void
}

export interface LeftBarType {
  setBound: (source: LX.OnlineSource, id: string) => void
}

export default forwardRef<LeftBarType, LeftBarProps>(({ onChangeList }, ref) => {
  const theme = useTheme()
  const sourceSelectorRef = useRef<SourceSelectorType>(null)
  const boardsListRef = useRef<BoardsListType>(null)
  const boundInfo = useRef<{ source: LX.OnlineSource, id: string | null }>({ source: 'kw', id: null })
  // A04-002：请求代际号 —— 快速切源时先发出的旧请求可能后返回，会把新源已选中的列表覆盖成旧源数据。
  const reqSeq = useRef(0)
  useImperativeHandle(ref, () => ({
    setBound(source, listId) {
      boundInfo.current = { source, id: listId }
      sourceSelectorRef.current?.setSourceList(boardState.sources, source)
      // A04-001：原 `void getBoardsList()` 不接 catch —— 网络异常/源不可用时榜单永远空白，
      // 用户分不清「加载失败」还是「该源没有榜单」，也没有重试入口。
      const seq = ++reqSeq.current
      void getBoardsList(source).then(list => {
        if (seq !== reqSeq.current) return
        boardsListRef.current?.setList(list, listId)
      }).catch(() => {
        toast(global.i18n.t('leaderboard_load_error'))
      })
    },
  }), [])


  const onSourceChange = (source: LX.OnlineSource) => {
    boundInfo.current.source = source
    const seq = ++reqSeq.current
    void getBoardsList(source).then(list => {
      if (seq !== reqSeq.current) return
      // 接口返回空列表时直接跳过，避免 list[0] 下标越界
      if (!list.length) return
      const id = list[0].id
      requestAnimationFrame(() => {
        if (seq !== reqSeq.current) return
        boardsListRef.current?.setList(list, id)
        requestAnimationFrame(() => {
          if (seq !== reqSeq.current) return
          onChangeList(source, id)
        })
      })
    }).catch(() => {
      // A04-001：切换榜单源失败时同样要反馈，否则切到无榜单/异常源是一片空白
      toast(global.i18n.t('leaderboard_load_error'))
    })
  }
  const onBoundChange: BoardsListProps['onBoundChange'] = (id) => {
    boundInfo.current.id = id
    onChangeList(boundInfo.current.source, id)
  }
  const onPlay: BoardsListProps['onPlay'] = (id) => {
    boundInfo.current.id = id
    void handlePlay(id, boardState.listDetailInfo.list)
  }
  const onCollect: BoardsListProps['onCollect'] = (id, name) => {
    boundInfo.current.id = id
    void handleCollect(id, name, boundInfo.current.source)
  }

  return (
    <View style={{ ...styles.container, borderRightColor: theme['c-list-header-border-bottom'] }}>
      <View style={styles.selector}>
        <SourceSelector ref={sourceSelectorRef} onSourceChange={onSourceChange} />
      </View>
      <BoardsList
        ref={boardsListRef}
        onBoundChange={onBoundChange}
        onPlay={onPlay}
        onCollect={onCollect}
      />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'column',
    width: '26%',
    maxWidth: 180,
    minWidth: 110,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: BorderWidths.normal,
  },
  selector: {
    height: 38,
  },
})

