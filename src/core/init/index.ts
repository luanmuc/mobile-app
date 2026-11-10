import { initSetting, showPactModal } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'
import { checkUpdate } from '@/core/version'
import { checkOfficialUpdate } from '@/core/officialVersion'
import { logger } from '@/utils/logger'
import { migrateDownloadDir } from '@/core/downloadManager'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      // 启动自动检查更新：有新版本时弹窗提示（与原版一致）
      void checkUpdate()
      // 定制版：检查官方上游是否有新版本（官方有新版本时弹窗提醒一次）
      void checkOfficialUpdate()
      void initDeeplink()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  logger.info('App', '应用启动')
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  // v8.11.7：启动注入音源配置（从本地存储读配置，注入到 __lxSourceConfig，音源加载时自动应用）
  // 白名单/默认值/0 值规则统一由 sourceConfig 维护，避免与健康面板出现两套键表
  try {
    const { getData } = await import('@/plugins/storage')
    const { filterConfigForInjection } = await import('@/core/sourceConfig')
    const savedConfig = await getData<Record<string, unknown>>('lx_source_config')
    if (savedConfig && Object.keys(savedConfig).length) {
      const filtered = filterConfigForInjection(savedConfig)
      if (Object.keys(filtered).length) {
        ;(globalThis as any).__lxSourceConfig = {
          ...(globalThis as any).__lxSourceConfig,
          ...filtered,
        }
        logger.info('App', `音源配置已注入：${Object.keys(filtered).length} 项`)
      }
    }
  } catch (e) {
    logger.warn('App', `音源配置注入失败：${(e as Error)?.message ?? e}`)
  }

  await initUserApi(setting)
  bootLog('User Api inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  // b64：老下载目录迁移（Download/lx-music 根下 → music/ 子目录），异步后台执行不阻塞启动
  void migrateDownloadDir()
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
