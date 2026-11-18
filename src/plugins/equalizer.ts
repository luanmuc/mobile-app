import { NativeModules, Platform } from 'react-native'

/**
 * 系统均衡器桥。
 *
 * 只在 Android 有实现（android.media.audiofx.Equalizer）；
 * iOS / 桌面端没有对应模块，所有调用方先过 isSupported()。
 */

export interface EqualizerInfo {
  bands: number
  levelMin: number
  levelMax: number
  centers: number[]
}

interface EqualizerNativeModule {
  bind: (sessionId: number) => Promise<boolean>
  getInfo: () => Promise<EqualizerInfo | null>
  applyBands: (levelsCsv: string) => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<boolean>
  release: () => Promise<boolean>
}

const native = Platform.OS == 'android'
  ? (NativeModules.EqualizerModule as EqualizerNativeModule | undefined)
  : undefined

export const isSupported = (): boolean => native != undefined

export const bind = async(sessionId: number): Promise<boolean> => {
  if (!native || sessionId <= 0) return false
  try {
    return await native.bind(sessionId)
  } catch {
    return false
  }
}

export const getInfo = async(): Promise<EqualizerInfo | null> => {
  if (!native) return null
  try {
    return await native.getInfo()
  } catch {
    return null
  }
}

export const applyBands = async(levelsCsv: string): Promise<boolean> => {
  if (!native) return false
  try {
    return await native.applyBands(levelsCsv)
  } catch {
    return false
  }
}

export const setEnabled = async(enabled: boolean): Promise<boolean> => {
  if (!native) return false
  try {
    return await native.setEnabled(enabled)
  } catch {
    return false
  }
}

export const release = async(): Promise<void> => {
  if (!native) return
  try {
    await native.release()
  } catch {
    // 释放失败不影响播放，忽略
  }
}
