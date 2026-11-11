// import { store } from '@/store'
// import { getDownloadFilePath } from '@renderer/utils/music'

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'
import { existsFile } from '@/utils/fs'

export const getMusicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {}, onSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
  onSource?: (source: { id: string, name: string, platform?: string } | null) => void
}): Promise<string> => {
  // 已下载完成的歌曲直接播放本地文件，不消耗流量
  if (!isRefresh && musicInfo.isComplate && musicInfo.metadata.filePath) {
    try {
      if (await existsFile(musicInfo.metadata.filePath)) {
        return `file://${musicInfo.metadata.filePath}`
      }
    } catch (e) {
      // 文件校验失败时回退在线播放
    }
  }

  return getOnlineMusicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource, allowToggleSource, onSource })
}

export const getPicUrl = async({ musicInfo, isRefresh, listId, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    // const path = await getDownloadFilePath(musicInfo, appSetting['download.savePath'])
    // if (path) {
    //   const pic = await global.lx.worker.main.getMusicFilePic(path)
    //   if (pic) return pic
    // }

    const onlineMusicInfo = musicInfo.metadata.musicInfo
    if (onlineMusicInfo.meta.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource }).then((url) => {
    // TODO: when listId required save url (update downloadInfo)

    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo.metadata.musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  return getOnlineLyricInfo({
    musicInfo: musicInfo.metadata.musicInfo,
    isRefresh,
    onToggleSource,
  }).catch(async() => {
    // 尝试读取文件内歌词
    // const path = await getDownloadFilePath(musicInfo, appSetting['download.savePath'])
    // if (path) {
    //   const rawlrcInfo = await window.lx.worker.main.getMusicFileLyric(path)
    //   if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)
    // }

    throw new Error('failed')
  })
}
