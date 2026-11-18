import { useEffect, useState } from 'react'
import BackgroundTimer from 'react-native-background-timer'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { normalizeFadeMs } from '@/core/player/volumeFadeCurve'
import { cancelVolumeFade, fadeOutForSleep } from '@/core/player/volumeFade'
import { setVolume } from '@/plugins/player'

type Hook = (time: number, isPlayedStop: boolean) => void

const timeoutTools = {
  bgTimeout: null as number | null,
  fadeTimeout: null as number | null,
  timeout: null as NodeJS.Timer | null,
  startTime: 0,
  time: -1,
  timeHooks: [] as Hook[],
  exit() {
    if (settingState.setting['player.timeoutExitPlayed'] && playerState.isPlay) {
      global.lx.isPlayedStop = true
      this.callHooks()
    } else {
      exitApp('Timeout Exit')
    }
  },
  getTime() {
    return Math.max(this.time - Math.round((performance.now() - this.startTime) / 1000), -1)
  },
  callHooks() {
    const time = this.getTime()
    for (const hook of this.timeHooks) {
      hook(time, global.lx.isPlayedStop)
    }
  },
  clearTimeout() {
    if (this.fadeTimeout) {
      BackgroundTimer.clearTimeout(this.fadeTimeout)
      this.fadeTimeout = null
      // 渐弱被打断（重新设定时/取消定时）：把音量恢复到设置值，否则会停在半路
      cancelVolumeFade()
      void setVolume(Number(settingState.setting['player.volume']) || 1)
    }
    if (!this.bgTimeout) return
    BackgroundTimer.clearTimeout(this.bgTimeout)
    // RN 运行时 setInterval 返回 number，类型标注为 NodeJS.Timer 仅用于兼容 @types/node
    clearInterval(this.timeout as unknown as number)
    this.bgTimeout = null
    this.timeout = null
    this.time = -1
    this.callHooks()
  },
  /** 渐弱时长；开关关闭或值非法时为 0（0 = 完全不动音量） */
  getFadeMs() {
    if (!settingState.setting['player.fadeOnSleepTimeout']) return 0
    return normalizeFadeMs(settingState.setting['player.fadeDurationMs'])
  },
  start(time: number) {
    this.clearTimeout()
    this.time = time
    this.startTime = performance.now()
    // 睡眠渐弱：到点前 fadeMs 开始降音量，到点时音量已归 0，听感是"渐弱后停"。
    // 只在"到点会直接退出"的分支触发：timeoutExitPlayed && 正在播 的语义是播完这曲再退，
    // 这时把音量压到 0 会让剩下的播放变成静音。
    const fadeMs = this.getFadeMs()
    if (fadeMs > 0 && time * 1000 > fadeMs) {
      this.fadeTimeout = BackgroundTimer.setTimeout(() => {
        this.fadeTimeout = null
        if (settingState.setting['player.timeoutExitPlayed'] && playerState.isPlay) return
        fadeOutForSleep(fadeMs, Number(settingState.setting['player.volume']) || 1)
      }, time * 1000 - fadeMs)
    }
    this.bgTimeout = BackgroundTimer.setTimeout(() => {
      this.clearTimeout()
      this.exit()
    }, time * 1000)
    this.timeout = setInterval(() => {
      this.callHooks()
    }, 1000)
  },
  addTimeHook(hook: Hook) {
    this.timeHooks.push(hook)
    hook(this.getTime(), global.lx.isPlayedStop)
  },
  removeTimeHook(hook: Hook) {
    this.timeHooks.splice(this.timeHooks.indexOf(hook), 1)
  },
}


export const startTimeoutExit = (time: number) => {
  timeoutTools.start(time)
}
export const stopTimeoutExit = () => {
  timeoutTools.clearTimeout()
}

export const getTimeoutExitTime = () => {
  return timeoutTools.time
}

export const useTimeoutExitTimeInfo = () => {
  const [info, setInfo] = useState({ time: 0, isPlayedStop: false })
  useEffect(() => {
    const hook: Hook = (time, isPlayedStop) => {
      setInfo({ time, isPlayedStop })
    }
    timeoutTools.addTimeHook(hook)
    return () => { timeoutTools.removeTimeHook(hook) }
  }, [setInfo])

  return info
}

export const onTimeUpdate = (handler: Hook) => {
  timeoutTools.addTimeHook(handler)

  return () => {
    timeoutTools.removeTimeHook(handler)
  }
}


export const cancelTimeoutExit = () => {
  global.lx.isPlayedStop = false
  timeoutTools.callHooks()
}
