import TrackPlayer, { State } from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'
import { defaultUrl } from '@/config'
// import { action as playerAction } from '@/store/modules/player'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { buildSourceLabel, getPlatformNameKey, resolvePlatformName, resolvePlayPlatform } from '@/core/music/sourceLabel'


const list: LX.Player.Track[] = []

const defaultUserAgent = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36'
const httpRxp = /^(https?:\/\/.+|\/.+)/

export const state = {
  isPlaying: false,
  prevDuration: -1,
}

const formatMusicInfo = (musicInfo: LX.Player.PlayMusic) => {
  return 'progress' in musicInfo ? {
    id: musicInfo.id,
    pic: musicInfo.metadata.musicInfo.meta.picUrl,
    name: musicInfo.metadata.musicInfo.name,
    singer: musicInfo.metadata.musicInfo.singer,
    album: musicInfo.metadata.musicInfo.meta.albumName,
  } : {
    id: musicInfo.id,
    pic: musicInfo.meta.picUrl,
    name: musicInfo.name,
    singer: musicInfo.singer,
    album: musicInfo.meta.albumName,
  }
}

const getCurrentFullLyric = (targetId: string | null) => {
  return (settingState.setting['player.isShowBluetoothFullLyric'] && targetId &&
      playerState.musicInfo.id == targetId && playerState.musicInfo.lrc)
    ? playerState.musicInfo.lrc
    : undefined
}

// 通知栏艺术家行附加信息：音质标签与实际音源名（原生侧拼成「周传雄 · 树音 · FLAC」）
// buildTracks 构造 track 与 updateMetaInfo 刷新元数据两处都要带，否则后者会把前者拼好的后缀覆盖掉
const getNotificationQualityTag = () => {
  const q = playerState.playQuality
  if (!q) return undefined
  if (q === 'flac') return 'FLAC'
  if (q === 'flac24bit') return 'FLAC24'
  if (q === 'hires') return 'Hi-Res'
  return q
}
// v8.12.0：跨平台兜底后通知栏也显示实际平台；旧音源无 platform 时保持旧子源名
const getNotificationSubSource = () => {
  const source = playerState.playSource
  if (!source) return undefined
  const platform = resolvePlayPlatform(source, null)
  const platformKey = getPlatformNameKey(platform)
  const platformName = resolvePlatformName(platform, platformKey ? global.i18n.t(platformKey) : '')
  const label = buildSourceLabel(platformName, source.name)
  return label || undefined
}

const buildTracks = (musicInfo: LX.Player.PlayMusic, url?: LX.Player.Track['url'], duration?: LX.Player.Track['duration']): LX.Player.Track[] => {
  const mInfo = formatMusicInfo(musicInfo)
  const track = [] as LX.Player.Track[]
  const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
  const album = mInfo.album || undefined
  const artwork = isShowNotificationImage && mInfo.pic && httpRxp.test(mInfo.pic) ? mInfo.pic : undefined
  const lyric = getCurrentFullLyric(mInfo.id)
  // 取 playerState 的当前播放音质/子源——取链成功时写回，构造 track 时读最新值
  const qualityTag = getNotificationQualityTag()
  const subSource = getNotificationSubSource()
  if (url) {
    track.push({
      id: `${mInfo.id}__//${Math.random()}__//${url}`,
      url,
      title: mInfo.name || 'Unknow',
      artist: mInfo.singer || 'Unknow',
      album,
      artwork,
      userAgent: defaultUserAgent,
      musicId: mInfo.id,
      lyric,
      quality: qualityTag,
      subSource,
      // original: { ...musicInfo },
      duration,
    })
  }
  track.push({
    id: `${mInfo.id}__//${Math.random()}__//default`,
    url: defaultUrl,
    title: mInfo.name || 'Unknow',
    artist: mInfo.singer || 'Unknow',
    album,
    artwork,
    musicId: mInfo.id,
    lyric,
    quality: qualityTag,
    subSource,
    // original: { ...musicInfo },
    duration: 0,
  })
  return track
  // console.log('buildTrack', musicInfo.name, url)
}
// const buildTrack = (musicInfo: LX.Player.PlayMusic, url: LX.Player.Track['url'], duration?: LX.Player.Track['duration']): LX.Player.Track => {
//   const mInfo = formatMusicInfo(musicInfo)
//   const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
//   const album = mInfo.album || undefined
//   const artwork = isShowNotificationImage && mInfo.pic && httpRxp.test(mInfo.pic) ? mInfo.pic : undefined
//   return url
//     ? {
//         id: `${mInfo.id}__//${Math.random()}__//${url}`,
//         url,
//         title: mInfo.name || 'Unknow',
//         artist: mInfo.singer || 'Unknow',
//         album,
//         artwork,
//         userAgent: defaultUserAgent,
//         musicId: `${mInfo.id}`,
//         original: { ...musicInfo },
//         duration,
//       }
//     : {
//         id: `${mInfo.id}__//${Math.random()}__//default`,
//         url: defaultUrl,
//         title: mInfo.name || 'Unknow',
//         artist: mInfo.singer || 'Unknow',
//         album,
//         artwork,
//         musicId: `${mInfo.id}`,
//         original: { ...musicInfo },
//         duration: 0,
//       }
// }

export const isTempTrack = (trackId: string) => /\/\/default$/.test(trackId)


export const getCurrentTrackId = async() => {
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  return list[currentTrackIndex]?.id
}
export const getCurrentTrack = async() => {
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  return list[currentTrackIndex]
}

export const updateMetaData = async(musicInfo: LX.Player.MusicInfo, isPlay: boolean, force = false) => {
  if (!force && isPlay == state.isPlaying) {
    const duration = await TrackPlayer.getDuration()
    if (state.prevDuration != duration) {
      state.prevDuration = duration
      const trackInfo = await getCurrentTrack()
      if (trackInfo && musicInfo) {
        delayUpdateMusicInfo(musicInfo)
      }
    }
  } else {
    const [duration, trackInfo] = await Promise.all([TrackPlayer.getDuration(), getCurrentTrack()])
    state.prevDuration = duration
    if (trackInfo && musicInfo) {
      delayUpdateMusicInfo(musicInfo)
    }
  }
}

export const initTrackInfo = async(musicInfo: LX.Player.PlayMusic, mInfo: LX.Player.MusicInfo) => {
  const tracks = buildTracks(musicInfo)
  await TrackPlayer.add(tracks).then(() => list.push(...tracks))
  // 空队列时不再取 tracks[0].id，避免构建失败时下标越界
  const firstTrackId = tracks[0]?.id
  if (firstTrackId == null) return
  const queue = await TrackPlayer.getQueue() as LX.Player.Track[]
  await TrackPlayer.skip(queue.findIndex(t => t.id == firstTrackId))
  delayUpdateMusicInfo(mInfo)
}


const handlePlayMusic = async(musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
// console.log(tracks, time)
  const tracks = buildTracks(musicInfo, url)
  const track = tracks[0]
  // await updateMusicInfo(track)
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  await TrackPlayer.add(tracks).then(() => list.push(...tracks))
  const queue = await TrackPlayer.getQueue() as LX.Player.Track[]
  await TrackPlayer.skip(queue.findIndex(t => t.id == track.id))

  if (currentTrackIndex == null) {
    if (!isTempTrack(track.id as string)) {
      if (time) await TrackPlayer.seekTo(time)
      if (global.lx.restorePlayInfo) {
        await TrackPlayer.pause()
        // let startupAutoPlay = settingState.setting['player.startupAutoPlay']
        global.lx.restorePlayInfo = null

      // TODO startupAutoPlay
      // if (startupAutoPlay) store.dispatch(playerAction.playMusic())
      } else {
        await TrackPlayer.play()
      }
    }
  } else {
    await TrackPlayer.pause()
    if (!isTempTrack(track.id as string)) {
      await TrackPlayer.seekTo(time)
      await TrackPlayer.play()
    }
  }

  if (queue.length > 2) {
    void TrackPlayer.remove(Array(queue.length - 2).fill(null).map((_, i) => i)).then(() => list.splice(0, list.length - 2))
  }
}
let playPromise = Promise.resolve()
let actionId = Math.random()
export const playMusic = (musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
  const id = actionId = Math.random()
  void playPromise.finally(() => {
    if (id != actionId) return
    playPromise = handlePlayMusic(musicInfo, url, time)
  })
}

// let musicId = null
// let duration = 0
let prevArtwork: string | undefined
const updateMetaInfo = async(mInfo: LX.Player.MusicInfo) => {
  const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
  // const mInfo = formatMusicInfo(musicInfo)
  // console.log('+++++updateMusicPic+++++', track.artwork, track.duration)

  // if (track.musicId == musicId) {
  //   if (global.playInfo.musicInfo.img != null) artwork = global.playInfo.musicInfo.img
  //   if (track.duration != null) duration = global.playInfo.duration
  // } else {
  //   musicId = track.musicId
  //   artwork = global.playInfo.musicInfo.img
  //   duration = global.playInfo.duration || 0
  // }
  // console.log('+++++updateMetaInfo+++++', mInfo.name)
  state.isPlaying = await TrackPlayer.getState() == State.Playing
  let artwork = isShowNotificationImage ? mInfo.pic ?? prevArtwork : undefined
  if (mInfo.pic) prevArtwork = mInfo.pic
  let title: string
  let artist: string
  if (playerState.lastLyric == null) {
    title = mInfo.name ?? 'Unknow'
    artist = mInfo.singer ?? 'Unknow'
  } else {
    title = playerState.lastLyric
    artist = `${mInfo.name}${mInfo.singer ? ` - ${mInfo.singer}` : ''}`
  }
  await TrackPlayer.updateNowPlayingMetadata({
    title,
    artist,
    album: mInfo.album ?? undefined,
    artwork,
    duration: state.prevDuration || 0,
    lyric: getCurrentFullLyric(mInfo.id),
    // 原生侧按这两项把艺术家行拼成「周传雄 · 树音 · FLAC」
    // 必须带上：本函数在歌词行变化时高频调用，漏传会把 add 时拼好的后缀覆盖成无后缀
    quality: getNotificationQualityTag(),
    subSource: getNotificationSubSource(),
  }, state.isPlaying)
}


// 解决快速切歌导致的通知栏歌曲信息与当前播放歌曲对不上的问题
const debounceUpdateMetaInfoTools = {
  updateMetaPromise: Promise.resolve(),
  musicInfo: null as LX.Player.MusicInfo | null,
  debounce(fn: (musicInfo: LX.Player.MusicInfo) => void | Promise<void>) {
    // let delayTimer = null
    let isDelayRun = false
    let timer: number | null = null
    let _musicInfo: LX.Player.MusicInfo | null = null
    return (musicInfo: LX.Player.MusicInfo) => {
      // console.log('debounceUpdateMetaInfoTools', musicInfo)
      if (timer) {
        BackgroundTimer.clearTimeout(timer)
        timer = null
      }
      // if (delayTimer) {
      //   BackgroundTimer.clearTimeout(delayTimer)
      //   delayTimer = null
      // }
      if (isDelayRun) {
        _musicInfo = musicInfo
        timer = BackgroundTimer.setTimeout(() => {
          timer = null
          let musicInfo = _musicInfo
          _musicInfo = null
          if (!musicInfo) return
          // isDelayRun = false
          void fn(musicInfo)
        }, 500)
      } else {
        isDelayRun = true
        void fn(musicInfo)
        BackgroundTimer.setTimeout(() => {
          // delayTimer = null
          isDelayRun = false
        }, 500)
      }
    }
  },
  init() {
    return this.debounce(async(musicInfo: LX.Player.MusicInfo) => {
      this.musicInfo = musicInfo
      return this.updateMetaPromise.then(() => {
        // console.log('run')
        if (this.musicInfo?.id === musicInfo.id) {
          this.updateMetaPromise = updateMetaInfo(musicInfo)
        }
      })
    })
  },
}

export const delayUpdateMusicInfo = debounceUpdateMetaInfoTools.init()

// export const delayUpdateMusicInfo = ((fn, delay = 800) => {
//   let delayTimer = null
//   let isDelayRun = false
//   let timer = null
//   let _track = null
//   return track => {
//     _track = track
//     if (timer) {
//       BackgroundTimer.clearTimeout(timer)
//       timer = null
//     }
//     if (isDelayRun) {
//       if (delayTimer) {
//         BackgroundTimer.clearTimeout(delayTimer)
//         delayTimer = null
//       }
//       timer = BackgroundTimer.setTimeout(() => {
//         timer = null
//         let track = _track
//         _track = null
//         isDelayRun = false
//         fn(track)
//       }, delay)
//     } else {
//       isDelayRun = true
//       fn(track)
//       delayTimer = BackgroundTimer.setTimeout(() => {
//         delayTimer = null
//         isDelayRun = false
//       }, 500)
//     }
//   }
// })(track => {
//   console.log('+++++delayUpdateMusicPic+++++', track.artwork)
//   updateMetaInfo(track)
// })
