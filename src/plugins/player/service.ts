/* eslint-disable @typescript-eslint/no-misused-promises */
import TrackPlayer, { State as TPState, Event as TPEvent } from 'react-native-track-player'
// import { store } from '@/store'
// import { action as playerAction, STATUS } from '@/store/modules/player'
import { isTempId, isEmpty } from './utils'
// A03-P1-1：歌词时间轴需要跟随焦点中断 —— core/lyric 实际导出的是 handlePlay/pause（历史注释里的 play 不存在）
import { handlePlay as lrcPlay, pause as lrcPause } from '@/core/lyric'
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

/**
 * v9.1：播放失败必须清掉这首歌的 URL 缓存。
 *
 * 为什么必须做：App 的 URL 缓存（`@/utils/data` getMusicUrl）只读持久化、**没有 TTL**，
 * 而播放器报错路径此前只打点、不清缓存 → 「命中死链 → 播放失败 → 缓存还在 → 再点还是它」的
 * 无限循环（真机上表现为同一首歌反复「该请求已知失败(缓存中)」）。
 * 清掉后下次点歌自然走重新取链；取链侧已有可用性判据（playbackGuard），不会再把坏链写进去。
 *
 * 清的是该歌**全档位**缓存（不指定 quality）：播放失败无法确定是档位错配还是链接失效，
 * 而档位错配时只清当前档会漏掉真正坏的那一档。
 * 2s 内同一首歌只清一次：PlaybackError 可能连发多条，避免重复写盘。
 */
let lastUrlCachePurge = { id: '', ts: 0 }
const purgeUrlCacheOnPlaybackError = async(musicInfo: LX.Player.PlayMusicInfo['musicInfo'] | null | undefined) => {
  try {
    const id = musicInfo?.id
    if (!id) return
    const now = Date.now()
    if (lastUrlCachePurge.id === id && now - lastUrlCachePurge.ts < 2000) return
    lastUrlCachePurge = { id, ts: now }
    // 惰性 require：与日志模块同理，避免播放器服务初始化期就拉起重模块
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clearMusicUrlByMusic } = require('@/utils/data')
    await clearMusicUrlByMusic(musicInfo)
  } catch {}
}

// v8.14：真实播放回传。源侧 playDead 只认这个入口，不再把取链失败当播放失败。
const reportPlayback = (ok: boolean, code?: string) => {
  try {
    const ps = playerState.playSource
    if (!ps?.id) return
    // 试听片段不是完整交付，不能作为一次播放成功回传健康分（否则会错误解除 playDead）。
    if (ok && ps.fragment === true) return
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

  // A03-P1-1：监听整段曾被注释掉 —— 播放态本身由 native 的 AudioFocusPolicy 状态机全权处理
  // （MusicManager.java:136-177 dispatch→focusPolicy.handle→execute，MusicManager.java:462/504 emit remote-duck），
  // JS 侧**不能**再改播放状态，否则会和 native 双写冲突（这也是旧实现被注释的原因）。
  // 但歌词时间轴必须跟着停/走：否则来电打断后歌词会继续往前跑（用户可感的同步错误）。
  // 所以这里只做歌词同步，tmp/ducking（只压低音量不暂停）时不动歌词。
  TrackPlayer.addEventListener(TPEvent.RemoteDuck, async({ paused }) => {
    try {
      if (paused) {
        lrcPause()
      } else {
        const position = await TrackPlayer.getPosition()
        lrcPlay(position * 1000)
      }
    } catch {}
  })

  TrackPlayer.addEventListener(TPEvent.PlaybackError, async(err: any) => {
    // v9.1：脱敏——err.message 常带整条带签名的直链（惰性 require 同日志模块，避免顶层拉重模块）
    let safeErr: any = err
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { sanitizeError } = require('@/core/music/playbackGuard')
      safeErr = sanitizeError(err)
    } catch {}
    console.log('playback-error', safeErr)
    // v9.1：失败即清缓存（死链不再被无限复用），见 purgeUrlCacheOnPlaybackError 注释
    void purgeUrlCacheOnPlaybackError(playerState.playMusicInfo?.musicInfo)
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
