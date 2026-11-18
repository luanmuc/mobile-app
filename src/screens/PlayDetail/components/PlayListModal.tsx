import { forwardRef, useMemo } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'

import Modal, { type ModalType } from '@/components/common/Modal'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { getList } from '@/core/player/playInfo'
import { playList } from '@/core/player/player'
import playerState from '@/store/player/state'
import listState from '@/store/list/state'
import { LIST_IDS } from '@/config/constant'
import { useI18n } from '@/lang'

// 播放列表弹窗：显示当前播放列表，点击某项即可切换播放（替代原评论按钮）
export type PlayListModalType = ModalType

const styles = createStyle({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 12,
    paddingTop: 12,
    maxHeight: '75%',
    overflow: 'hidden',
    borderWidth: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 10,
  },
  item: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
  },
})

export default forwardRef<ModalType, {}>((props, ref) => {
  const theme = useTheme()
  const t = useI18n()

  const listId = playerState.playInfo.playerListId
  // A06-006：原 useMemo 只依赖 listId + playIndex，而「增删歌曲 / 拖拽排序」只改
  // listState.allMusicList 里的数组、既不动 listId 也不动 playIndex —— 弹窗打开后列表内容
  // 会一直停在打开那一刻，删除的歌曲还在、排序也不更新。
  // getList 只是读 Map，代价极低，这里直接每次渲染取最新，彻底消除滞后。
  const list = (getList(listId) || []) as LX.Music.MusicInfo[]
  const currentId = playerState.playMusicInfo.musicInfo?.id

  const listName = useMemo(() => {
    switch (listId) {
      case LIST_IDS.DEFAULT: return listState.defaultList.name
      case LIST_IDS.LOVE: return listState.loveList.name
      case LIST_IDS.TEMP: return listState.tempList.name
      case LIST_IDS.DOWNLOAD: return t('nav_download')
      default: {
        const userList = listState.userList.find(l => l.id == listId)
        return userList?.name ?? t('play_list_empty')
      }
    }
  }, [listId, t])

  return (
    <Modal ref={ref} bgColor="rgba(0,0,0,0.45)" statusBarPadding={false}>
      <View style={styles.container}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'], borderColor: theme['c-border-background'] }}>
          <View style={styles.header}>
            <Text size={16} color={theme['c-font']}>{listName}</Text>
            <Text size={12} color={theme['c-font-label']}>{t('play_list_song_count', { num: list.length })}</Text>
          </View>
          <FlatList
            data={list}
            keyExtractor={(_, index) => index.toString()}
            renderItem={({ item, index }) => {
              const isCurrent = item.id == currentId
              return (
                <TouchableOpacity
                  style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}
                  activeOpacity={0.6}
                  onPress={() => {
                    if (listId) void playList(listId, index)
                    ;(ref as React.MutableRefObject<ModalType>).current?.setVisible(false)
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text size={13} color={isCurrent ? theme['c-primary'] : theme['c-font']} numberOfLines={1} style={{ flex: 1 }}>
                      {isCurrent ? '▶ ' : ''}{index + 1}. {item.name}
                    </Text>
                    {isCurrent ? <Text size={11} color={theme['c-primary']}>{t('playing')}</Text> : null}
                  </View>
                  <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={{ marginTop: 2 }}>{item.singer}</Text>
                </TouchableOpacity>
              )
            }}
          />
        </View>
      </View>
    </Modal>
  )
})
