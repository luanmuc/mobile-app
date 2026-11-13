/* eslint-disable @typescript-eslint/no-misused-promises */
import TrackPlayer, { State as TPState, Event as TPEvent } from 'react-native-track-player'
// import { store } from '@/store'
// import { action as playerAction, STATUS } from '@/store/modules/player'
import { isTempId, isEmpty } from './utils'
// import { play as lrcPlay, pause as lrcPause } from '@/core/lyric'
import { exitApp, updateSetting } from '@/core/common'
import { getCurrentTrackId } from './playList'
import { pause, play, playNext, playPrev } from '@/core/player/player'
import { hideDesktopLyric, showDesktopLyric, checkDesktopLyricOverlayPermission } from '@/core/desktopLyric'
import settingState from '@/store/setting/state'
import { MUSIC_TOGGLE_MODE_LIST, MUSIC_TOGGLE_MODE } from '@/config/constant'
import { syncNotificationRepeatMode } from '@/core/player/repeatMode'
import { toast } from '@/utils/tools'
import playerState from '@/store/player/state'

let isInitialized = false
// v8.14：同曲同源同结果只回传一次。Playing 会在缓冲/跳转后重复触发，
// 不去重会把同一首歌的成功样本重复放大，污染成功率与健康分。
let lastPlaybackReportKey = ''

// v8.14：真实播放回传。源侧 playDead 只认这个入口，不再把取链失败当播放失败。
const reportPlayback = (ok: boolean, code?: string) => {
  try {
    const ps = playerState.playSource
    if (!ps?.id) return
    const platform = ps.platform
    if (!platform) return
    const key = `${String(global.lx.playerTrackId || '')}|${ps.id}|${platform}|${String(playerState.playQuality || '128k')}|${ok ? 'ok' : 'fail'}|${code ?? ''}`
    if (key === lastPlaybackReportKey) return
    lastPlaybackReportKey = key
    const api = (global.lx.apis as any)?.[platform]?.reportPlayback
    if (!api) return
    const res = api(ps.id, { ok, quality: playerState.playQuality || '128k', code })
    void res?.promise?.catch?.(() => {})
  } catch {}
}


// let retryTrack: LX.Player.Track | null = null
// let retryGetUrlId: string | null = null
// let retryGetUrlNum = 0
// let errorTime = 0
// let prevDuration = 0
// let isPlaying = false

// 销毁播放器并退出
const handleExitApp = async(reason: string) => {
  global.lx.isPlayedStop = false
  exitApp(reason)
}

// 切换桌面歌词显示状态（通知栏按钮调用，与播放页按钮行为一致）
const toggleDesktopLyric = async() => {
  const enable = settingState.setting['desktopLyric.enable']
  if (enable) {
    updateSetting({ 'desktopLyric.enable': false })
    await hideDesktopLyric()
  } else {
    try {
      await checkDesktopLyricOverlayPermission()
      await showDesktopLyric()
      updateSetting({ 'desktopLyric.enable': true })
    } catch {
      // 悬浮窗权限未授予：回滚设置并提示（后台无法弹权限引导，提示用户手动开启）
      updateSetting({ 'desktopLyric.enable': false })
      try { toast(global.i18n.t('toast_desktop_lyric_permission_failed')) } catch { /* 后台场景 toast 可能不可用 */ }
    }
  }
}


const registerPlaybackService = async() => {
  if (isInitialized) return

  console.log('reg services...')
  TrackPlayer.addEventListener(TPEvent.RemotePlay, () => {
    // console.log('remote-play')
    play()
  })

  TrackPlayer.addEventListener(TPEvent.RemotePause, () => {
    // console.log('remote-pause')
    void pause()
  })

  TrackPlayer.addEventListener(TPEvent.RemoteNext, () => {
    // console.log('remote-next')
    void playNext()
  })

  TrackPlayer.addEventListener(TPEvent.RemotePrevious, () => {
    // console.log('remote-previous')
    void playPrev()
  })

  TrackPlayer.addEventListener(TPEvent.RemoteStop, () => {
    // console.log('remote-stop')
    void handleExitApp('Remote Stop')
  })

  // 通知栏"桌面歌词"开关按钮：点一下开，再点一下关（track-player fork 自定义事件）
  TrackPlayer.addEventListener(TPEvent.RemoteToggleDesktopLyric, () => {
    void toggleDesktopLyric()
  })

  // 通知栏"播放模式"按钮：点一下切到下一个模式，并回写原生图标
  // 只走四个真实模式，跳过 none（禁用）——快捷按钮不适合藏一个"播完就停"的状态
  TrackPlayer.addEventListener('remote-cycle-repeat' as unknown as TPEvent, () => {
    const modes = MUSIC_TOGGLE_MODE_LIST.filter(m => m != MUSIC_TOGGLE_MODE.none)
    let index = modes.indexOf(settingState.setting['player.togglePlayMethod'] as typeof modes[number])
    if (++index >= modes.length) index = 0
    const mode = modes[index]
    updateSetting({ 'player.togglePlayMethod': mode })
    syncNotificationRepeatMode(mode)
  })

  // TrackPlayer.addEventListener(TPEvent.RemoteDuck, async({ permanent, paused, ducking }) => {
  //   console.log('remote-duck')
  //   if (paused) {
  //     store.dispatch(playerAction.setStatus({ status: STATUS.pause, text: '已暂停' }))
  //     lrcPause()
  //   } else {
  //     store.dispatch(playerAction.setStatus({ status: STATUS.playing, text: '播放中...' }))
  //     TrackPlayer.getPosition().then(position => {
  //       lrcPlay(position * 1000)
  //     })
  //   }
  // })

  TrackPlayer.addEventListener(TPEvent.PlaybackError, async(err: any) => {
    console.log('playback-error', err)
    // b70 诊断：播放器错误打点（含错误内容——静默失败时可定位）
    try {
      // 惰性 require：避免播放器服务初始化阶段与日志模块形成循环依赖
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { log } = require('@/utils/log')
      log.diagnose(`[播放诊断] 播放器错误: ${JSON.stringify(err?.message ?? err)?.slice(0, 300)}`)
    } catch {}
    reportPlayback(false, 'PLAYBACK_ERROR')
    global.app_event.error()
    global.app_event.playerError()
  })

  TrackPlayer.addEventListener(TPEvent.RemoteSeek, async({ position }) => {
    global.app_event.setProgress(position as number)
  })

  TrackPlayer.addEventListener(TPEvent.PlaybackState, async info => {
    if (global.lx.gettingUrlId || isTempId()) return
    // let currentIsPlaying = false

    switch (info.state) {
      case TPState.None:
        // console.log('state', 'State.NONE')
        break
      case TPState.Ready:
      case TPState.Stopped:
      case TPState.Paused:
        global.app_event.playerPause()
        global.app_event.pause()
        break
      case TPState.Playing:
        reportPlayback(true)
        global.app_event.playerPlaying()
        global.app_event.play()
        break
      case TPState.Buffering:
        global.app_event.pause()
        global.app_event.playerWaiting()
        break
      case TPState.Connecting:
        global.app_event.playerLoadstart()
        break
      default:
        // console.log('playback-state', info)
        break
    }
    if (global.lx.isPlayedStop) return handleExitApp('Timeout Exit')

    // console.log('currentIsPlaying', currentIsPlaying, global.lx.playInfo.isPlaying)
    // void updateMetaData(global.lx.store_playMusicInfo.musicInfo, currentIsPlaying)
  })
  TrackPlayer.addEventListener(TPEvent.PlaybackTrackChanged, async info => {
    // console.log('PlaybackTrackChanged====>', info)
    global.lx.playerTrackId = await getCurrentTrackId()
    if (info.track == null) return
    if (global.lx.isPlayedStop) return handleExitApp('Timeout Exit')

    // console.log('global.lx.playerTrackId====>', global.lx.playerTrackId)
    if (isEmpty()) {
      // console.log('====TEMP PAUSE====')
      await TrackPlayer.pause()
      global.app_event.playerPause()
      global.app_event.pause()
      global.app_event.playerEnded()
      global.app_event.playerEmptied()
      // if (retryTrack) {
      //   if (retryTrack.musicId == retryGetUrlId) {
      //     if (++retryGetUrlNum > 1) {
      //       store.dispatch(playerAction.playNext(true))
      //       retryGetUrlId = null
      //       retryTrack = null
      //       return
      //     }
      //   } else {
      //     retryGetUrlId = retryTrack.musicId
      //     retryGetUrlNum = 0
      //   }
      //   store.dispatch(playerAction.refreshMusicUrl(global.lx.playInfo.currentPlayMusicInfo, errorTime))
      // } else {
      //   store.dispatch(playerAction.playNext(true))
      // }
    }
  //   // if (!info.nextTrack) return
  //   // if (info.track) {
  //   //   const track = info.track.substring(0, info.track.lastIndexOf('__//'))
  //   //   const nextTrack = info.track.substring(0, info.nextTrack.lastIndexOf('__//'))
  //   //   console.log(nextTrack, track)
  //   //   if (nextTrack == track) return
  //   // }
  //   // const track = await TrackPlayer.getTrack(info.nextTrack)
  //   // if (!track) return
  //   // let newTrack
  //   // if (track.url == defaultUrl) {
  //   //   TrackPlayer.pause().then(async() => {
  //   //     isRefreshUrl = true
  //   //     retryGetUrlId = track.id
  //   //     retryGetUrlNum = 0
  //   //     try {
  //   //       newTrack = await updateTrackUrl(track)
  //   //       console.log('++++newTrack++++', newTrack)
  //   //     } catch (error) {
  //   //       console.log('error', error)
  //   //       if (error.message != '跳过播放') TrackPlayer.skipToNext()
  //   //       isRefreshUrl = false
  //   //       retryGetUrlId = null
  //   //       return
  //   //     }
  //   //     retryGetUrlId = null
  //   //     isRefreshUrl = false
  //   //     console.log(await TrackPlayer.getQueue(), null, 2)
  //   //     await TrackPlayer.play()
  //   //   })
  //   // }
  //   // store.dispatch(playerAction.playNext())
  })
  // TrackPlayer.addEventListener('playback-queue-ended', async info => {
  //   // console.log('playback-queue-ended', info)
  //   store.dispatch(playerAction.playNext())
  //   // if (!info.nextTrack) return
  //   // const track = await TrackPlayer.getTrack(info.nextTrack)
  //   // if (!track) return
  //   // // if (track.url == defaultUrl) {
  //   // //   TrackPlayer.pause()
  //   // //   getMusicUrl(track.original).then(url => {
  //   // //     TrackPlayer.updateMetadataForTrack(info.nextTrack, {
  //   // //       url,
  //   // //     })
  //   // //     TrackPlayer.play()
  //   // //   })
  //   // // }
  //   // if (!track.artwork) {
  //   //   getMusicPic(track.original).then(url => {
  //   //     console.log(url)
  //   //     TrackPlayer.updateMetadataForTrack(info.nextTrack, {
  //   //       artwork: url,
  //   //     })
  //   //   })
  //   // }
  // })
  // TrackPlayer.addEventListener('playback-destroy', async() => {
  //   console.log('playback-destroy')
  //   store.dispatch(playerAction.destroy())
  // })
  isInitialized = true
}


export default () => {
  if (global.lx.playerStatus.isRegisteredService) return
  console.log('handle registerPlaybackService...')
  TrackPlayer.registerPlaybackService(() => registerPlaybackService)
  global.lx.playerStatus.isRegisteredService = true
}
