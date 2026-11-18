import { createList, setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getListDetail, getListDetailAll } from '@/core/songlist'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import syncSourceList from '@/core/syncSourceList'
import { confirmDialog, toMD5, toast } from '@/utils/tools'
import { type Source } from '@/store/songlist/state'

const getListId = (id: string, source: LX.OnlineSource) => `${source}__${id}`

export const handlePlay = async(id: string, source: Source, list?: LX.Music.MusicInfoOnline[], index = 0) => {
  // A06-005：原来整条 await 链（getListDetail / setTempList / getListDetailAll）没有任何 catch，
  // 外层 ActionBar 又是 `void handlePlay(...)` → 拉取或写库失败时用户点了没反应、错误只进未处理 rejection。
  try {
    const listId = getListId(id, source)
    let isPlayingList = false
    // console.log(list)
    if (!list?.length) list = (await getListDetail(id, source, 1)).list
    if (list?.length) {
      await setTempList(listId, [...list])
      void playList(LIST_IDS.TEMP, index).catch(() => {
        toast(global.i18n.t('songlist_action_failed'))
      })
      isPlayingList = true
    }
    const fullList = await getListDetailAll(source, id)
    if (!fullList.length) return
    if (isPlayingList) {
      if (listState.tempListMeta.id == listId) {
        await setTempList(listId, [...fullList])
      }
    } else {
      await setTempList(listId, [...fullList])
      void playList(LIST_IDS.TEMP, index).catch(() => {
        toast(global.i18n.t('songlist_action_failed'))
      })
    }
  } catch {
    toast(global.i18n.t('songlist_action_failed'))
  }
}

export const handleCollect = async(id: string, source: Source, name: string) => {
  // A06-005：同上，补齐错误兜底。
  try {
    const listId = getListId(id, source)

    // A06-004：判定用复合键 `${source}__${id}`，落库也必须写复合键（原来写裸 id），否则再次进入
    // 详情页永远找不到已收藏列表 → 「重复收藏」分支不生效，每次都会新建重复列表。
    // 兼容旧数据：历史落库的是裸 id，这里一并匹配，避免老收藏变成「看不见的重复」。
    const targetList = listState.userList.find(l => l.sourceListId == listId || l.sourceListId == id)
    if (targetList) {
      const confirm = await confirmDialog({
        message: global.i18n.t('duplicate_list_tip', { name: targetList.name }),
        cancelButtonText: global.i18n.t('list_import_part_button_cancel'),
        confirmButtonText: global.i18n.t('confirm_button_text'),
      })
      if (!confirm) return
      // A02-001：确认同步后若源接口/网络失败，原来 `void syncSourceList()` 不接 catch →
      // 用户以为已同步、错误只进未处理 rejection。补成功/失败提示（对齐 Mylist 的既有范式）。
      void syncSourceList(targetList).then(() => {
        toast(global.i18n.t('list_update_success', { name: targetList.name }))
      }).catch(() => {
        toast(global.i18n.t('list_update_error', { name: targetList.name }))
      })
      return
    }

    const list = await getListDetailAll(source, id)
    await createList({
      name,
      id: `${source}_${toMD5(listId)}`,
      list,
      source,
      sourceListId: listId,
    })
    toast(global.i18n.t('collect_success'))
  } catch {
    toast(global.i18n.t('songlist_action_failed'))
  }
}
