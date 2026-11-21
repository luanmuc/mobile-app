import TrackPlayer from 'react-native-track-player'
import { updateOptions, setVolume, setPlaybackRate, setPlaybackPitch, migratePlayerCache } from './utils'
import { logger } from '@/utils/logger'

// const listenEvent = () => {
//   TrackPlayer.addEventListener('playback-error', err => {
//     console.log('playback-error', err)
//   })
//   TrackPlayer.addEventListener('playback-state', info => {
//     console.log('playback-state', info)
//   })
//   TrackPlayer.addEventListener('playback-track-changed', info => {
//     console.log('playback-track-changed', info)
//   })
//   TrackPlayer.addEventListener('playback-queue-ended', info => {
//     console.log('playback-queue-ended', info)
//   })
// }

const initial = async({ volume, playRate, playPitch, cacheSize, isHandleAudioFocus, autoResumeAfterInterrupt, duckOnTransientDuck, isEnableAudioOffload }: {
  volume: number
  playRate: number
  playPitch: number
  cacheSize: number
  isHandleAudioFocus: boolean
  autoResumeAfterInterrupt: boolean
  duckOnTransientDuck: boolean
  isEnableAudioOffload: boolean
}) => {
  if (global.lx.playerStatus.isIniting || global.lx.playerStatus.isInitialized) return
  global.lx.playerStatus.isIniting = true
  logger.info('Player', 'Cache Size ' + String(cacheSize * 1024))
  try {
    await migratePlayerCache()
    await TrackPlayer.setupPlayer({
      maxCacheSize: cacheSize * 1024,
      maxBuffer: 1000,
      waitForBuffer: true,
      handleAudioFocus: isHandleAudioFocus,
      // 两个子行为开关：焦点处理开启时才有意义
      autoResumeAfterInterrupt: isHandleAudioFocus ? autoResumeAfterInterrupt : false,
      duckOnTransientDuck: isHandleAudioFocus ? duckOnTransientDuck : false,
      audioOffload: isEnableAudioOffload,
      autoUpdateMetadata: false,
    })
    global.lx.playerStatus.isInitialized = true
  } catch (err) {
    // 初始化途中抛异常必须复位，否则 isIniting 永久为 true，
    // 后续每次点播放都会在 initial 里被直接 return，表现为「点播放永远卡在缓存中」
    global.lx.playerStatus.isInitialized = false
    throw err
  } finally {
    global.lx.playerStatus.isIniting = false
  }
  await updateOptions()
  await setVolume(volume)
  await setPlaybackRate(playRate)
  await setPlaybackPitch(playPitch)
  // listenEvent()
}


const isInitialized = () => global.lx.playerStatus.isInitialized


export {
  initial,
  isInitialized,
  setVolume,
  setPlaybackRate,
  setPlaybackPitch,
  updateOptions,
}

export {
  getAudioSessionId,
  setResource,
  setPause,
  setPlay,
  setCurrentTime,
  getDuration,
  setStop,
  resetPlay,
  getPosition,
  updateMetaData,
  onStateChange,
  isEmpty,
  useBufferProgress,
  initTrackInfo,
} from './utils'
