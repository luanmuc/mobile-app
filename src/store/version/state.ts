import { version } from '../../../package.json'

export interface ProgressInfo {
  total: number
  current: number
}

export interface VersionInfo {
  version: string
  desc: string
  history?: LX.VersionInfo[]
}

// 官方上游版本信息（定制版专属）
export interface OfficialVersionInfo {
  base: string // 底座版本（fork 点 = package.json version）
  latest: string | null // 官方最新版本（lyswhut/lx-music-mobile）
  isLatest: boolean // 底座是否已是最新
  isError: boolean // 获取官方版本失败
  checking: boolean // 检测中（防并发）
  showModal: boolean // 官方更新弹窗可见性
}

export interface InitState {
  showModal: boolean
  versionInfo: {
    version: string
    newVersion: VersionInfo | null
    showModal: boolean
    isUnknown: boolean
    isLatest: boolean
    reCheck: boolean
    status: LX.UpdateStatus
  }
  ignoreVersion: string | null
  progress: ProgressInfo
  official: OfficialVersionInfo
}

const state: InitState = {
  showModal: false,
  versionInfo: {
    version,
    newVersion: null,
    showModal: false,
    reCheck: false,
    isUnknown: false,
    isLatest: false,
    status: 'checking',
  },
  ignoreVersion: null,
  progress: {
    total: 0,
    current: 0,
  },
  official: {
    base: version,
    latest: null,
    isLatest: true,
    isError: false,
    checking: false,
    showModal: false,
  },
}


export default state
