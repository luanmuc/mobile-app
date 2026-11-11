import {
  saveLyric,
  saveMusicUrl,
  saveMusicSource,
  getMusicUrl as getStoreMusicUrl,
  getStoreMusicSource,
} from '@/utils/data'
import { updateListMusics } from '@/core/list'
import settingState from '@/store/setting/state'

import {
  buildLyricInfo,
  getPlayQuality,
  handleGetOnlineLyricInfo,
  handleGetOnlineMusicUrl,
  handleGetOnlinePicUrl,
  getCachedLyricInfo,
} from './utils'
import { log } from '@/utils/log'
import { createHealthTraceId, recordPlayResult } from '@/core/healthLog'

/* export const setMusicUrl = ({ musicInfo, type, url }: {
  musicInfo: LX.Music.MusicInfo
  type: LX.Quality
  url: string
}) => {
  saveMusicUrl(musicInfo, type, url)
}

export const setPic = (datas: {
  listId: string
  musicInfo: LX.Music.MusicInfo
  url: string
}) => {
  datas.musicInfo.img = datas.url
  updateMusicInfo({
    listId: datas.listId,
    id: datas.musicInfo.songmid,
    data: { img: datas.url },
    musicInfo: datas.musicInfo,
  })
}
 */


export const getMusicUrl = async({ musicInfo, quality, isRefresh, allowToggleSource = true, onToggleSource = () => {}, onQuality = () => {}, onSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  onQuality?: (quality: LX.Quality) => void
  onSource?: (source: { id: string, name: string, platform?: string } | null) => void
}): Promise<string> => {
  // if (!musicInfo._types[type]) {
  //   // 兼容旧版酷我源搜索列表过滤128k音质的bug
  //   if (!(musicInfo.source == 'kw' && type == '128k')) throw new Error('该歌曲没有可播放的音频')

  //   // return Promise.reject(new Error('该歌曲没有可播放的音频'))
  // }
  const targetQuality = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
  const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
  if (cachedUrl && !isRefresh) {
    onQuality(targetQuality)
    // v6.0：缓存命中读子源键（在线请求成功后双写，缓存播放也能显示「平台 · 子源名」）
    // v6.0：必须 await 读子源后再回调——若用 void 异步回调，player.ts 的 finally 会在播放成功
    // 后清空 gettingUrlId，异步回调晚到即被 onSource 防串歌校验拦截 → setPlaySource 永不执行 →
    // 播放页只显示平台名（已用时序模拟 100% 复现）。await 后 onSource 在 getMusicUrl resolve 前
    // 同步执行（gettingUrlId 仍为当前歌），校验放行。
    const cachedSource = await getStoreMusicSource(musicInfo, targetQuality)
    onSource(cachedSource ?? null)
    return cachedUrl
  }

  // b70 诊断：获取链接全链路打点（写运行诊断日志，fire-and-forget 不阻塞）
  const startTs = Date.now()
  // 2.4：一次播放一个 traceId；换源候选复用同一个，串起源侧多次取链事件
  const traceId = createHealthTraceId()
  log.diagnose(`[播放诊断] 获取链接开始: 歌=${musicInfo.name} 源=${musicInfo.source} 音质=${targetQuality} 刷新=${isRefresh} trace=${traceId}`)
  // b70 诊断：兜底超时——防止任何链路异常导致 promise 永不 settle（无限 00:00），25s 强制失败并打点
  const urlPromise = handleGetOnlineMusicUrl({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource, traceId }).then(({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache, subSource, subSourceName, sourcePlatform }) => {
    const source = subSource ? { id: subSource, name: subSourceName || subSource, platform: sourcePlatform || '' } : null
    if (targetMusicInfo.id != musicInfo.id && !isFromCache) {
      void saveMusicUrl(targetMusicInfo, targetQuality, url)
      if (source) void saveMusicSource(targetMusicInfo, targetQuality, source)
    }
    void saveMusicUrl(musicInfo, targetQuality, url)
    if (source) void saveMusicSource(musicInfo, targetQuality, source)
    onQuality(targetQuality)
    onSource(source)
    void recordPlayResult({
      traceId,
      platform: sourcePlatform || targetMusicInfo.source || musicInfo.source,
      quality: targetQuality,
      ok: true,
      latencyMs: Date.now() - startTs,
      sourceId: subSource,
    })
    log.diagnose(`[播放诊断] 链接获取成功: 歌=${musicInfo.name} 耗时=${Date.now() - startTs}ms 缓存=${isFromCache} 子源=${subSourceName || subSource || '无'} trace=${traceId}`)
    return url
  })
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => { reject(new Error(`URL获取超时(25s): 歌=${musicInfo.name} 源=${musicInfo.source}`)) }, 25_000)
  })
  return Promise.race([urlPromise, timeoutPromise]).catch(err => {
    const codeMatch = String(err?.message || '').match(/^([A-Z_]+):/)
    void recordPlayResult({
      traceId,
      platform: musicInfo.source,
      quality: targetQuality,
      ok: false,
      code: codeMatch ? codeMatch[1] : 'PLAY_FAIL',
      latencyMs: Date.now() - startTs,
    })
    log.diagnose(`[播放诊断] 链接获取失败: 歌=${musicInfo.name} 错误=${err?.message} trace=${traceId}`)
    throw err
  })
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // picRequest = null
    if (listId) {
      musicInfo.meta.picUrl = url
      void updateListMusics([{ id: listId, musicInfo }])
    }
    // savePic({ musicInfo, url, listId })
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    if (targetMusicInfo.id == musicInfo.id) void saveLyric(musicInfo, lyricInfo)
    else void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
