import musicSdk, { findMusic } from '@/utils/musicSdk'
import {
  // getOtherSource as getOtherSourceFromStore,
  // saveOtherSource as saveOtherSourceFromStore,
  getMusicUrl as getStoreMusicUrl,
  getPlayerLyric as getStoreLyric,
  getStoreMusicSource,
} from '@/utils/data'
import { langS2T, toNewMusicInfo, toOldMusicInfo } from '@/utils'
import { assertApiSupport } from '@/utils/tools'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'
import { requestMsg } from '@/utils/message'
import BackgroundTimer from 'react-native-background-timer'
import { apis } from '@/utils/musicSdk/api-source'


const getOtherSourcePromises = new Map()
export const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/
const otherSourceCache = new Map<LX.Music.MusicInfo | LX.Download.ListItem, LX.Music.MusicInfoOnline[]>()

export const getOtherSource = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<LX.Music.MusicInfoOnline[]> => {
  // if (!isRefresh) {
  //   const cachedInfo = await getOtherSourceFromStore(musicInfo.id)
  //   if (cachedInfo.length) return cachedInfo
  // }
  if (otherSourceCache.has(musicInfo)) return otherSourceCache.get(musicInfo)!
  let key: string
  let searchMusicInfo: {
    name: string
    singer: string
    source: string
    albumName: string
    interval: string
  }
  if ('progress' in musicInfo) {
    key = `local_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.metadata.musicInfo.name,
      singer: musicInfo.metadata.musicInfo.singer,
      source: musicInfo.metadata.musicInfo.source,
      albumName: musicInfo.metadata.musicInfo.meta.albumName,
      interval: musicInfo.metadata.musicInfo.interval ?? '',
    }
  } else {
    key = `${musicInfo.source}_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      albumName: musicInfo.meta.albumName,
      interval: musicInfo.interval ?? '',
    }
  }
  if (getOtherSourcePromises.has(key)) return getOtherSourcePromises.get(key)

  const promise = new Promise<LX.Music.MusicInfoOnline[]>((resolve, reject) => {
    let timeout: null | number = BackgroundTimer.setTimeout(() => {
      timeout = null
      reject(new Error('find music timeout'))
    }, 12_000)
    findMusic(searchMusicInfo).then((otherSource) => {
      if (otherSourceCache.size > 10) otherSourceCache.clear()
      const source = otherSource.map(toNewMusicInfo) as LX.Music.MusicInfoOnline[]
      otherSourceCache.set(musicInfo, source)
      resolve(source)
    }).catch(reject).finally(() => {
      if (timeout) BackgroundTimer.clearTimeout(timeout)
    })
  }).then((otherSource) => {
    // if (otherSource.length) void saveOtherSourceFromStore(musicInfo.id, otherSource)
    return otherSource
  }).finally(() => {
    if (getOtherSourcePromises.has(key)) getOtherSourcePromises.delete(key)
  })
  getOtherSourcePromises.set(key, promise)
  return promise
}


export const buildLyricInfo = async(lyricInfo: MakeOptional<LX.Player.LyricInfo, 'rawlrcInfo'>): Promise<LX.Player.LyricInfo> => {
  if (!settingState.setting['player.isS2t']) {
    // @ts-expect-error
    if (lyricInfo.rawlrcInfo) return lyricInfo
    return { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
  }

  if (settingState.setting['player.isS2t']) {
    const tasks = [
      lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''),
      lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''),
      lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''),
      lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''),
    ]
    if (lyricInfo.rawlrcInfo) {
      tasks.push(lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''))
      tasks.push(lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''))
    }
    return Promise.all(tasks).then(([lyric, tlyric, rlyric, lxlyric, lyric_raw, tlyric_raw, rlyric_raw, lxlyric_raw]) => {
      const rawlrcInfo = lyric_raw ? {
        lyric: lyric_raw,
        tlyric: tlyric_raw,
        rlyric: rlyric_raw,
        lxlyric: lxlyric_raw,
      } : {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
      }
      return {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
        rawlrcInfo,
      }
    })
  }

  // @ts-expect-error
  return lyricInfo.rawlrcInfo ? lyricInfo : { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
}

export const getCachedLyricInfo = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Player.LyricInfo | null> => {
  let lrcInfo = await getStoreLyric(musicInfo)
  // lrcInfo = {}
  if (existTimeExp.test(lrcInfo.lyric) && lrcInfo.tlyric != null) {
    // if (musicInfo.lrc.startsWith('\ufeff[id:$00000000]')) {
    //   let str = musicInfo.lrc.replace('\ufeff[id:$00000000]\n', '')
    //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
    // } else if (musicInfo.lrc.startsWith('[id:$00000000]')) {
    //   let str = musicInfo.lrc.replace('[id:$00000000]\n', '')
    //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
    // }

    // if (lrcInfo.lxlyric == null) {
    //   switch (musicInfo.source) {
    //     case 'kg':
    //     case 'kw':
    //     case 'mg':
    //       break
    //     default:
    //       return lrcInfo
    //   }
    // } else
    if (lrcInfo.rlyric == null) {
      if (!['wy', 'kg'].includes(musicInfo.source)) return lrcInfo
    } else return lrcInfo
  }
  return null
}

export const getOnlineOtherSourceMusicUrlByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  url: string
  quality: LX.Quality
  isFromCache: boolean
}> => {
  // b70 诊断：音源初始化检查打点（若卡在此步说明 apiInitPromise 未 resolve；15s 兜底超时）
  const initPromise = global.lx.apiInitPromise[0]
  log.diagnose(`[播放诊断] 检查音源初始化: apiInitPromise类型=${initPromise instanceof Promise ? 'Promise' : String(initPromise)}`)
  if (initPromise instanceof Promise) {
    const initResult = await Promise.race([initPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('音源初始化超时(15s)')), 15_000))])
    if (!initResult) throw new Error('source init failed')
    log.diagnose(`[播放诊断] 音源初始化完成: 结果=${!!initResult}`)
  } else if (!initPromise) {
    throw new Error('source init failed')
  }

  const quality = '128k'

  const cachedUrl = await getStoreMusicUrl(musicInfo, quality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getMusicUrl(toOldMusicInfo(musicInfo), null).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then(({ url }: { url: string }) => {
    return { url, quality, isFromCache: false }
  })
}

export const getOnlineOtherSourceLyricByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  lyricInfo: LX.Music.LyricInfo
  isFromCache: boolean
}> => {
  // b70 诊断：音源初始化检查打点（若卡在此步说明 apiInitPromise 未 resolve；15s 兜底超时）
  const initPromise = global.lx.apiInitPromise[0]
  log.diagnose(`[播放诊断] 检查音源初始化: apiInitPromise类型=${initPromise instanceof Promise ? 'Promise' : String(initPromise)}`)
  if (initPromise instanceof Promise) {
    const initResult = await Promise.race([initPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('音源初始化超时(15s)')), 15_000))])
    if (!initResult) throw new Error('source init failed')
    log.diagnose(`[播放诊断] 音源初始化完成: 结果=${!!initResult}`)
  } else if (!initPromise) {
    throw new Error('source init failed')
  }

  const lyricInfo = await getCachedLyricInfo(musicInfo)
  if (lyricInfo && !isRefresh) return { lyricInfo, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getLyric(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return { lyricInfo, isFromCache: false }
  })
}

export const getOnlineOtherSourcePicByLocal = async(musicInfo: LX.Music.MusicInfoLocal): Promise<{
  url: string
}> => {
  // b70 诊断：音源初始化检查打点（若卡在此步说明 apiInitPromise 未 resolve；15s 兜底超时）
  const initPromise = global.lx.apiInitPromise[0]
  log.diagnose(`[播放诊断] 检查音源初始化: apiInitPromise类型=${initPromise instanceof Promise ? 'Promise' : String(initPromise)}`)
  if (initPromise instanceof Promise) {
    const initResult = await Promise.race([initPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('音源初始化超时(15s)')), 15_000))])
    if (!initResult) throw new Error('source init failed')
    log.diagnose(`[播放诊断] 音源初始化完成: 结果=${!!initResult}`)
  } else if (!initPromise) {
    throw new Error('source init failed')
  }

  let reqPromise
  try {
    reqPromise = apis('local').getPic(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((url: string) => {
    return { url }
  })
}

export const TRY_QUALITYS_LIST = ['flac24bit', 'flac', '320k'] as const
type TryQualityType = typeof TRY_QUALITYS_LIST[number]

/**
 * 完整音质列表（高 → 低），用于下载音质选择与下载音质回退
 */
export const FULL_QUALITYS_LIST = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const
type FullQualityType = typeof FULL_QUALITYS_LIST[number]

export const getPlayQuality = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality => {
  let type: LX.Quality = '128k'
  if (TRY_QUALITYS_LIST.includes(highQuality as TryQualityType)) {
    let list = global.lx.qualityList[musicInfo.source]

    let t = TRY_QUALITYS_LIST
      .slice(TRY_QUALITYS_LIST.indexOf(highQuality as TryQualityType))
      .find(q => musicInfo.meta?._qualitys?.[q] && list?.includes(q))

    if (t) type = t
  }
  return type
}

/**
 * 下载音质回退：在完整音质列表中按 高→低 找到歌曲实际支持的音质
 */
export const getDownloadQuality = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality => {
  let type: LX.Quality = '128k'
  if (FULL_QUALITYS_LIST.includes(highQuality as FullQualityType)) {
    const list = global.lx.qualityList[musicInfo.source]
    const t = FULL_QUALITYS_LIST
      .slice(FULL_QUALITYS_LIST.indexOf(highQuality as FullQualityType))
      .find(q => musicInfo.meta?._qualitys?.[q] && list?.includes(q))
    if (t) type = t
  }
  return type
}

export const getOnlineOtherSourceMusicUrl = async({ musicInfos, quality, onToggleSource, isRefresh, retryedSource = [], traceId }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  quality?: LX.Quality
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
  traceId?: string
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
  subSource: string
  subSourceName: string
  sourcePlatform: string
}> => {
  // b70 诊断：音源初始化检查打点（若卡在此步说明 apiInitPromise 未 resolve；15s 兜底超时）
  const initPromise = global.lx.apiInitPromise[0]
  log.diagnose(`[播放诊断] 检查音源初始化: apiInitPromise类型=${initPromise instanceof Promise ? 'Promise' : String(initPromise)}`)
  if (initPromise instanceof Promise) {
    const initResult = await Promise.race([initPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('音源初始化超时(15s)')), 15_000))])
    if (!initResult) throw new Error('source init failed')
    log.diagnose(`[播放诊断] 音源初始化完成: 结果=${!!initResult}`)
  } else if (!initPromise) {
    throw new Error('source init failed')
  }

  let musicInfo: LX.Music.MusicInfoOnline | null = null
  let itemQuality: LX.Quality | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    if (!assertApiSupport(musicInfo.source)) continue
    itemQuality = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
    if (!musicInfo.meta?._qualitys?.[itemQuality]) continue

    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo || !itemQuality) throw new Error(global.i18n.t('toggle_source_failed'))

  const cachedUrl = await getStoreMusicUrl(musicInfo, itemQuality)
  if (cachedUrl && !isRefresh) {
    // 与主请求路径一致：缓存命中读子源键（v6.0 起双写），老缓存无子源时降级空
    const cachedSource = await getStoreMusicSource(musicInfo, itemQuality)
    return { url: cachedUrl, musicInfo, quality: itemQuality, isFromCache: true, subSource: cachedSource?.id ?? '', subSourceName: cachedSource?.name ?? '', sourcePlatform: cachedSource?.platform ?? '' }
  }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), itemQuality, traceId).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then(({ url, type, subSource = '', subSourceName = '', sourcePlatform = '' }: { url: string, type: LX.Quality, subSource?: string, subSourceName?: string, sourcePlatform?: string }) => {
    return { musicInfo, url, quality: type, isFromCache: false, subSource, subSourceName, sourcePlatform }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    if (err.message == requestMsg.tooManyRequests) throw err
    console.log(err)
    return getOnlineOtherSourceMusicUrl({ musicInfos, quality, onToggleSource, isRefresh, retryedSource, traceId })
  })
}

/**
 * 获取在线音乐URL
 */
export const handleGetOnlineMusicUrl = async({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource, traceId }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource: boolean
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  traceId?: string
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
  subSource: string
  subSourceName: string
  sourcePlatform: string
}> => {
  // b70 诊断：音源初始化检查打点（若卡在此步说明 apiInitPromise 未 resolve；15s 兜底超时）
  const initPromise = global.lx.apiInitPromise[0]
  log.diagnose(`[播放诊断] 检查音源初始化: apiInitPromise类型=${initPromise instanceof Promise ? 'Promise' : String(initPromise)}`)
  if (initPromise instanceof Promise) {
    const initResult = await Promise.race([initPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('音源初始化超时(15s)')), 15_000))])
    if (!initResult) throw new Error('source init failed')
    log.diagnose(`[播放诊断] 音源初始化完成: 结果=${!!initResult}`)
  } else if (!initPromise) {
    throw new Error('source init failed')
  }
  // console.log(musicInfo.source)
  const targetQuality = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), targetQuality, traceId).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then(({ url, type, subSource = '', subSourceName = '', sourcePlatform = '' }: { url: string, type: LX.Quality, subSource?: string, subSourceName?: string, sourcePlatform?: string }) => {
    return { musicInfo, url, quality: type, isFromCache: false, subSource, subSourceName, sourcePlatform }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource || err.message == requestMsg.tooManyRequests) throw err
    onToggleSource()
    // 换源候选处理：先复用 10 分钟候选缓存；候选全部请求失败时，
    // 若是刷新场景则强制重搜一次兜底，避免旧候选全死时"换不了源"直接卡死
    const tryCandidates = async(forceSearch: boolean): Promise<{
      url: string
      musicInfo: LX.Music.MusicInfoOnline
      quality: LX.Quality
      isFromCache: boolean
    } | null> => {
      const otherSource = await getOtherSource(musicInfo, forceSearch)
      if (!otherSource.length) return null
      return getOnlineOtherSourceMusicUrl({
        musicInfos: [...otherSource],
        onToggleSource,
        quality,
        isRefresh,
        retryedSource: [musicInfo.source],
        traceId,
      })
    }
    let toggledResult = null
    try {
      toggledResult = await tryCandidates(false)
    } catch (toggleErr) {
      console.log('toggle source candidates failed:', toggleErr)
    }
    if (!toggledResult && isRefresh) {
      try {
        toggledResult = await tryCandidates(true)
      } catch (e) {
        console.log('force re-search other source failed:', e)
      }
    }
    if (toggledResult) return toggledResult
    throw err
  })
}


export const getOnlineOtherSourcePicUrl = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(global.i18n.t('toggle_source_failed'))

  if (musicInfo.meta.picUrl && !isRefresh) return { musicInfo, url: musicInfo.meta.picUrl, isFromCache: true }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourcePicUrl({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌曲封面
 */
export const handleGetOnlinePicUrl = async({ musicInfo, isRefresh, onToggleSource, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      // console.log('find otherSource', otherSource.length)
      if (otherSource.length) {
        return getOnlineOtherSourcePicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourceLyricInfo = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(global.i18n.t('toggle_source_failed'))

  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return { musicInfo, lyricInfo, isFromCache: true }
  }

  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo))).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then(async(lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      lyricInfo,
      musicInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourceLyricInfo({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌词信息
 */
export const handleGetOnlineLyricInfo = async({ musicInfo, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  musicInfo: LX.Music.MusicInfoOnline
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo))).promise
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then(async(lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      musicInfo,
      lyricInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err

    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      // console.log('find otherSource', otherSource.length)
      if (otherSource.length) {
        return getOnlineOtherSourceLyricInfo({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}

/**
 * 当前播放音质的短标签映射（真实解析结果展示用）
 * - 播放时由音乐源 SDK 解析 URL 后返回的实际音质（type），
 *   与请求音质可能不同（如请求 flac 降级后实际为 128k）
 * - 用于底部播放栏 / 播放页展示"当前播放的真实音质"
 */
export const PLAY_QUALITY_LABELS: Record<string, string> = {
  flac24bit: 'FLAC24',
  flac: 'FLAC',
  wav: 'WAV',
  ape: 'APE',
  '320k': '320K',
  '192k': '192K',
  '128k': '128K',
}

/** 将音质值转为展示标签；空值/未知值返回空字符串（调用方据此隐藏） */
export const getPlayQualityLabel = (quality: string): string => {
  if (!quality) return ''
  return PLAY_QUALITY_LABELS[quality] ?? quality.toUpperCase()
}

// ============================================================
// 音源失败原因友好化（v4.0：播放失败提示中文摘要）
// 音源聚合失败 message 格式（v3.0+）：`CODE: 所有源均失败 [[q] 源: 原因 | ...]`
// 或 `CODE: 单源原因`；内置源错误为 requestMsg 中文文案（原样截断返回）
// ============================================================
// 音源侧 ERROR_CODES 共 12 个（v8.11.1）。此前这里只映射了 6 个，且其中两个码名
// 与音源对不上：音源抛 NETWORK_TIMEOUT / RATE_LIMIT，这里写的是 TIMEOUT / TOO_MANY_REQUESTS，
// 于是 `FAIL_CODE_ZH[code] || code` 直接兜底显示英文码给用户。
// 两个旧码名保留（其他源/历史路径在用），音源 12 个码全部补齐。
const FAIL_CODE_ZH: Record<string, string> = {
  NOT_FOUND: '歌曲不可用',
  NETWORK_ERROR: '网络错误',
  NETWORK_TIMEOUT: '请求超时',
  TIMEOUT: '请求超时', // 历史码名，保留兼容
  PARAM_ERROR: '请求参数错误',
  CONFIG_ERROR: '音源配置错误',
  RATE_LIMIT: '请求过于频繁，请稍后再试',
  TOO_MANY_REQUESTS: '请求过于频繁，请稍后再试', // 历史码名，保留兼容
  SERVER_ERROR: '音源服务异常',
  MISMATCH: '歌曲信息不匹配',
  LINK_EXPIRED: '音源链接已失效',
  PREVIEW_FRAGMENT: '仅提供试听片段',
  NOT_AUDIO: '返回的不是有效音频',
  STREAM_PLAYLIST: '返回的是播放列表，播放器不支持',
  UNKNOWN: '未知错误',
}

export const formatPlayError = (err: any): string => {
  const fallback = global.i18n.t('player__error')
  const msg = String(err?.message ?? '')
  if (!msg) return fallback
  const m = msg.match(/^([A-Z_]+):\s*(.*)$/)
  const trim = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n)}…` : s)
  if (!m) return msg.length > 40 ? `${msg.slice(0, 40)}…` : msg
  const [, code, rest] = m
  const zh = FAIL_CODE_ZH[code] || code
  // 聚合失败：取前两个明细摘要（去掉 [音质] 前缀）
  if (rest.startsWith('所有源均失败')) {
    const detailMatch = rest.match(/\[(.*)\]/)
    const details = detailMatch
      ? detailMatch[1].split(' | ').filter(Boolean).slice(0, 2).map(d => d.replace(/^\[[^\]]+\]\s*/, ''))
      : []
    if (details.length) return `${zh}：${trim(details.join('；'))}`
    return `${zh}：所有源均失败`
  }
  return `${zh}：${trim(rest.replace(/，跳过$/, '').replace(/\(可能需VIP\)/, ''))}`
}
