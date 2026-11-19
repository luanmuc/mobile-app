import Event from './Event'

import { saveUserList, removeListMusics, saveListMusics } from '@/utils/data'
import {
  userLists,
  userListCreate,
  userListsUpdate,
  userListsRemove,
  userListsUpdatePosition,
  listDataOverwrite,
  listMusicOverwrite,
  listMusicAdd,
  listMusicMove,
  listMusicRemove,
  listMusicUpdateInfo,
  listMusicUpdatePosition,
  listMusicClear,
  allMusicList,
} from '@/utils/listManage'
import { LIST_IDS } from '@/config/constant'
import { setActiveList, setUserList } from '@/core/list'
import listState from '@/store/list/state'

const updateUserList = async(userLists: LX.List.UserListInfo[]) => {
  await saveUserList(userLists)
  setUserList(userLists)
}

const checkListExist = (changedIds: string[]) => {
  const index = changedIds.indexOf(listState.activeListId)
  if (index < 0 || listState.allList.some(l => l.id == listState.activeListId)) return
  setActiveList(LIST_IDS.DEFAULT)
}

export const checkUpdateList = async(changedIds: string[]) => {
  if (!changedIds.length) return
  await saveListMusics(changedIds.map(id => ({ id, musics: allMusicList.get(id) as LX.List.ListMusics })))
  global.app_event.myListMusicUpdate(changedIds)
}

/**
 * K30：`list_data_overwrite` 的补偿回滚。
 * 覆盖全量列表要分三段落库（saveUserList → removeListMusics → saveListMusics），
 * 任一段失败都会让内存与磁盘错位；最坏组合是「元信息已写入、旧列表歌曲已删、新歌曲没写」，
 * 重启后用户看到的是一个空歌单（数据真丢）。这里按导入前的快照重建内存与磁盘。
 * 步骤顺序：先同步恢复内存（即使磁盘写回失败，本次进程内状态也是对的），再清理多余 key，最后重写磁盘。
 */
const rollbackListOverwrite = async(
  snapshot: { userLists: LX.List.UserListInfo[], musics: Map<string, LX.List.ListMusics> },
  attemptedIds: string[],
) => {
  userLists.splice(0, userLists.length, ...snapshot.userLists)
  allMusicList.clear()
  for (const [id, musics] of snapshot.musics) allMusicList.set(id, musics)
  // 导入时新建、快照里不存在的列表 key 要一起清掉，否则恢复后会残留一份空歌单
  const extraIds = attemptedIds.filter(id => !snapshot.musics.has(id))
  if (extraIds.length) await removeListMusics(extraIds).catch(() => { /* 清残留失败不阻断主回滚 */ })
  await updateUserList(userLists)
  await saveListMusics([...snapshot.musics].map(([id, musics]) => ({ id, musics })))
}


// {
//   // sync: {
//   //   send_action_list: 'send_action_list',
//   //   handle_action_list: 'handle_action_list',
//   //   send_sync_list: 'send_sync_list',
//   //   handle_sync_list: 'handle_sync_list',
//   // },
// }

// 兼容v2.3.0之前版本插入数字类型的ID导致其意外在末尾追加 .0 的问题，确保所有ID都是字符串类型
const fixListIdType = (lists: LX.List.UserListInfo[] | LX.List.UserListInfoFull[]) => {
  for (const list of lists) {
    if (typeof list.sourceListId == 'number') {
      list.sourceListId = String(list.sourceListId)
      if (typeof list.id == 'number') {
        list.id = String(list.id)
      }
    }
  }
}


export class ListEvent extends Event {
  /**
   * 现有歌曲列表更改时触发的事件
   * @param ids
   */
  // list_music_changed(ids: string[]) {
  //   this.emit('list_music_changed', ids)
  // }

  /**
   * 覆盖整个列表数据
   * @param listData 列表数据
   * @param isRemote 是否属于远程操作
   */
  async list_data_overwrite(listData: MakeOptional<LX.List.ListDataFull, 'tempList'>, isRemote: boolean = false) {
    fixListIdType(listData.userList)
    // K30：动内存之前先留整份快照。下面三段落库任一失败都会让内存/磁盘错位，
    // 最坏是「元信息已写、旧歌已删、新歌没写」→ 重启后歌单变空；失败时按快照整体重建。
    const snapshot = {
      userLists: userLists.map(l => ({ ...l })),
      musics: new Map([...allMusicList].map(([id, musics]) => [id, musics.slice()])),
    }
    const oldIds = userLists.map(l => l.id)
    const attemptedIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...listData.userList.map(l => l.id)]
    if (listData.tempList) attemptedIds.push(LIST_IDS.TEMP)

    try {
      const changedIds = listDataOverwrite(listData)
      await updateUserList(userLists)
      // await checkUpdateList(changedIds)
      const removedList = oldIds.filter(id => !allMusicList.has(id))
      if (removedList.length) await removeListMusics(removedList)
      const allListIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...userLists.map(l => l.id)]
      if (changedIds.includes(LIST_IDS.TEMP)) allListIds.push(LIST_IDS.TEMP)
      await saveListMusics([...allListIds.map(id => ({ id, musics: allMusicList.get(id) as LX.List.ListMusics }))])

      global.app_event.myListMusicUpdate(changedIds)
      this.emit('list_data_overwrite', listData, isRemote)
      checkListExist(changedIds)
    } catch (err) {
      try {
        await rollbackListOverwrite(snapshot, attemptedIds)
      } catch (rollbackErr) {
        // 回滚自身失败时只记日志，不掩盖原始错误：内存已在 rollback 开头同步恢复
        console.error('[K30] list_data_overwrite 回滚失败:', rollbackErr)
      }
      throw err
    }
  }

  /**
   * 批量创建列表
   * @param position 列表位置
   * @param lists 列表信息
   * @param isRemote 是否属于远程操作
   */
  async list_create(position: number, lists: LX.List.UserListInfo[], isRemote: boolean = false) {
    // const changedIds: string[] = []
    fixListIdType(lists)
    for (const list of lists) {
      userListCreate({ ...list, position, locationUpdateTime: list.locationUpdateTime ?? null })
      // changedIds.push(list.id)
    }
    await updateUserList(userLists)
    this.emit('list_create', position, lists, isRemote)
  }

  /**
   * 批量删除列表及列表内歌曲
   * @param ids 列表ids
   * @param isRemote 是否属于远程操作
   */
  async list_remove(ids: string[], isRemote: boolean = false) {
    const changedIds = userListsRemove(ids)
    await updateUserList(userLists)
    await removeListMusics(ids)
    this.emit('list_remove', ids, isRemote)
    global.app_event.myListMusicUpdate(changedIds)

    checkListExist(changedIds)
  }

  /**
   * 批量更新列表信息
   * @param lists 列表信息
   * @param isRemote 是否属于远程操作
   */
  async list_update(lists: LX.List.UserListInfo[], isRemote: boolean = false) {
    userListsUpdate(lists)
    await updateUserList(userLists)
    this.emit('list_update', lists, isRemote)
  }

  /**
   * 批量更新列表位置
   * @param position 列表位置
   * @param ids 列表ids
   * @param isRemote 是否属于远程操作
   */
  async list_update_position(position: number, ids: string[], isRemote: boolean = false) {
    userListsUpdatePosition(position, ids)
    await updateUserList(userLists)
    this.emit('list_update_position', position, ids, isRemote)
  }

  /**
   * 覆盖列表内歌曲
   * @param listId 列表id
   * @param musicInfos 音乐信息
   * @param isRemote 是否属于远程操作
   */
  async list_music_overwrite(listId: string, musicInfos: LX.Music.MusicInfo[], isRemote: boolean = false) {
    const changedIds = await listMusicOverwrite(listId, musicInfos)
    await checkUpdateList(changedIds)
    this.emit('list_music_overwrite', listId, musicInfos, isRemote)
  }

  /**
   * 批量添加歌曲到列表
   * @param listId 列表id
   * @param musicInfos 添加的歌曲信息
   * @param addMusicLocationType 添加在到列表的位置
   * @param isRemote 是否属于远程操作
   */
  async list_music_add(listId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) {
    const changedIds = await listMusicAdd(listId, musicInfos, addMusicLocationType)
    await checkUpdateList(changedIds)
    this.emit('list_music_add', listId, musicInfos, addMusicLocationType, isRemote)
  }

  /**
   * 批量移动歌曲
   * @param fromId 源列表id
   * @param toId 目标列表id
   * @param musicInfos 移动的歌曲信息
   * @param addMusicLocationType 添加在到列表的位置
   * @param isRemote 是否属于远程操作
   */
  async list_music_move(fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) {
    const changedIds = await listMusicMove(fromId, toId, musicInfos, addMusicLocationType)
    await checkUpdateList(changedIds)
    this.emit('list_music_move', fromId, toId, musicInfos, addMusicLocationType, isRemote)
  }

  /**
   * 批量移除歌曲
   * @param listId
   * @param listId 列表Id
   * @param ids 要删除歌曲的id
   * @param isRemote 是否属于远程操作
   */
  async list_music_remove(listId: string, ids: string[], isRemote: boolean = false) {
    const changedIds = await listMusicRemove(listId, ids)
    // console.log(changedIds)
    await checkUpdateList(changedIds)
    this.emit('list_music_remove', listId, ids, isRemote)
  }

  /**
   * 批量更新歌曲信息
   * @param musicInfos 歌曲&列表信息
   * @param isRemote 是否属于远程操作
   */
  async list_music_update(musicInfos: LX.List.ListActionMusicUpdate, isRemote: boolean = false) {
    const changedIds = await listMusicUpdateInfo(musicInfos)
    await checkUpdateList(changedIds)
    this.emit('list_music_update', musicInfos, isRemote)
  }

  /**
   * 清空列表内的歌曲
   * @param ids 列表Id
   * @param isRemote 是否属于远程操作
   */
  async list_music_clear(ids: string[], isRemote: boolean = false) {
    const changedIds = await listMusicClear(ids)
    await checkUpdateList(changedIds)
    this.emit('list_music_clear', ids, isRemote)
  }

  /**
   * 批量更新歌曲位置
   * @param listId 列表ID
   * @param position 新位置
   * @param ids 歌曲id
   * @param isRemote 是否属于远程操作
   */
  async list_music_update_position(listId: string, position: number, ids: string[], isRemote: boolean = false) {
    const changedIds = await listMusicUpdatePosition(listId, position, ids)
    await checkUpdateList(changedIds)
    this.emit('list_music_update_position', listId, position, ids, isRemote)
  }
}


type EventMethods = Omit<EventType, keyof Event>


declare class EventType extends ListEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

export type ListEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>
export const createListEventHub = (): ListEventTypes => {
  return new ListEvent()
}

