import { version } from '../../package.json'
import { buildNumber } from './buildNumber'
import { createAppEventHub } from '@/event/appEvent'
import { createListEventHub } from '@/event/listEvent'
import { createDislikeEventHub } from '@/event/dislikeEvent'
import { createStateEventHub } from '@/event/stateEvent'
// 显示真实构建版本：如 1.9.2-b13（CI 注入 buildNumber，本地开发为空则显示 1.9.2）
const versionLabel = buildNumber ? `${String(version)}-${String(buildNumber)}` : String(version)
if (process.versions == null) {
  // @ts-expect-error
  process.versions = { app: versionLabel }
} else process.versions.app = versionLabel

// global.i18n = null

// let screenW = Dimensions.get('window').width
// let screenH = Dimensions.get('window').height
// if (screenW > screenH) {
//   const temp = screenW
//   screenW = screenH
//   screenH = temp
// }


global.lx = {
  fontSize: 1,
  playerStatus: {
    isInitialized: false,
    isRegisteredService: false,
    isIniting: false,
  },

  restorePlayInfo: null,
  // allList: null,
  // globalObj: null,
  // listScrollPosition: {},
  // listSort: {},

  isScreenKeepAwake: false,

  // 是否播放完后退出应用
  isPlayedStop: false,

  // prevListPlayIndex: -1,

  // syncKeyInfo: {},

  // isEnableSyncLog: false, // 同步功能已停用（syncSetting 已注释），开关随日志系统重构移除
  isEnableUserApiLog: true, // 音源日志默认开启（b64：日志系统加固，默认全开便于排障）

  playerTrackId: '',

  gettingUrlId: '',

  qualityList: {},
  apis: {},
  fallbackOwners: {},
  apiInitPromise: [Promise.resolve(false), true, () => {}],

  jumpMyListPosition: false,

  settingActiveId: 'basic',

  homePagerIdle: true,

  // syncKeyInfo: initValue as LX.Sync.KeyInfo,

  // windowInfo: {
  //   screenW,
  //   screenH,
  //   fontScale: PixelRatio.getFontScale(),
  //   pixelRatio: PixelRatio.get(),
  //   screenPxW: PixelRatio.getPixelSizeForLayoutSize(screenW),
  //   screenPxH: PixelRatio.getPixelSizeForLayoutSize(screenH),
  // },
}

global.app_event = createAppEventHub()
global.list_event = createListEventHub()
global.dislike_event = createDislikeEventHub()
global.state_event = createStateEventHub()
