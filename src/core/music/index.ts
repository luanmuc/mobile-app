// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
  onQuality,
  onSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
  onQuality?: (quality: LX.Quality) => void
  onSource?: (source: { id: string, name: string, platform?: string } | null) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource, onSource })
  } else if (musicInfo.source == 'local') {
    // 本地曲目不产生子源回调：setMusicUrl 每次取链前已 setPlaySource(null)，
    // 这里不传 onSource（local.ts 签名也没有该参数），避免用 as any 掩盖契约差异
    return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else {
    // v-b73：必须透传 onSource——player.ts 的 onSource（setPlaySource）经此路由到 online.ts，
    // 若丢失则在线播放永远收不到子源回调 → 播放页音源标签只显示平台名（历史多轮修复未达此层）
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource, onQuality, onSource })
  }
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
