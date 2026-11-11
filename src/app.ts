import '@/utils/errorHandle'
import { init as initLog } from '@/utils/log'
import { bootLog, getBootLog } from '@/utils/bootLog'
import '@/config/globalData'
import { getFontSize } from '@/utils/data'
import { exitApp } from './utils/nativeModules/utils'
import { windowSizeTools } from './utils/windowSizeTools'
import { listenLaunchEvent } from './navigation/regLaunchedEvent'
import { tipDialog, requestStoragePermission } from './utils/tools'
import { Platform, PermissionsAndroid, Alert } from 'react-native'

console.log('starting app...')
listenLaunchEvent()

void Promise.all([getFontSize(), windowSizeTools.init()]).then(async([fontSize]) => {
  global.lx.fontSize = fontSize
  bootLog('Font size setting loaded.')

  let isInited = false
  let handlePushedHomeScreen: () => void | Promise<void>

  const tryGetBootLog = () => {
    try {
      return getBootLog()
    } catch (err) {
      return 'Get boot log failed.'
    }
  }

  const handleInit = async() => {
    if (isInited) return
    void initLog()
    const { default: init } = await import('@/core/init')
    try {
      handlePushedHomeScreen = await init()
    } catch (err: any) {
      void tipDialog({
        title: '初始化失败 (Init Failed)',
        message: `Boot Log:\n${tryGetBootLog()}\n\n${(err.stack ?? err.message) as string}`,
        btnText: 'Exit',
        bgClose: false,
      }).then(() => {
        exitApp()
      })
      return
    }
    isInited ||= true
  }
  const { init: initNavigation, navigations } = await import('@/navigation')

  initNavigation(async() => {
    await handleInit()
    if (!isInited) return

    await navigations.pushHomeScreen().then(() => {
      void handlePushedHomeScreen()
      // 首次启动智能请求权限（延迟3秒，一个一个弹，不轰炸用户）
      setTimeout(async() => {
        try {
          // 第一步：Android 12及以下，处理存储权限
          if (Platform.OS === 'android' && Number(Platform.Version) < 33) {
            // Android 11-12 是特殊版本，需要全文件访问权限，等用户第一次下载的时候再提示
            if (Number(Platform.Version) < 30) {
              // Android 10及以下：普通存储权限，直接弹窗
              const hasStorage = await PermissionsAndroid.check(
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
              )
              if (!hasStorage) {
                // 先弹说明
                const wantRequest = await new Promise<boolean>((resolve) => {
                  Alert.alert(
                    '存储权限请求',
                    '允许存储权限后，可以下载歌曲到手机，管理本地音乐。是否现在开启？',
                    [
                      { text: '暂不', onPress: () => { resolve(false) } },
                      { text: '去开启', onPress: () => { resolve(true) } },
                    ],
                  )
                })
                if (wantRequest) {
                  await requestStoragePermission()
                }
              }
            }
            // Android 11-12 跳过，等下载时再提示
          }

          // 第二步：Android 13+，请求音乐文件访问权限（普通弹窗，不用跳设置）
          if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
            const hasAudioPermission = await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
            )
            if (!hasAudioPermission) {
              const wantRequest = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  '音乐文件访问权限',
                  '允许访问音乐文件后，可以下载歌曲、管理本地音乐。是否现在开启？',
                  [
                    { text: '暂不', onPress: () => { resolve(false) } },
                    { text: '去开启', onPress: () => { resolve(true) } },
                  ],
                )
              })
              if (wantRequest) {
                await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO)
              }
            }
          }
        } catch (e) {
          // 权限请求失败不影响使用
        }
      }, 3000)
    }).catch((err: any) => {
      void tipDialog({
        title: 'Error',
        message: err.message,
        btnText: 'Exit',
        bgClose: false,
      }).then(() => {
        exitApp()
      })
    })
  })
}).catch((err) => {
  void tipDialog({
    title: '初始化失败 (Init Failed)',
    message: `Boot Log:\n\n${(err.stack ?? err.message) as string}`,
    btnText: 'Exit',
    bgClose: false,
  }).then(() => {
    exitApp()
  })
})
