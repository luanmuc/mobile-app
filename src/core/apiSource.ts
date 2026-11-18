// import { setUserApi as setUserApiAction } from '@renderer/utils/ipc'
import musicSdk from '@/utils/musicSdk'
// import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { updateSetting } from './common'
import settingState from '@/store/setting/state'
import { destroyUserApi, setUserApi } from './userApi'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'


/**
 * 切换音源。
 * 返回本次切换的加载结果（Promise<boolean>）。
 * 说明：函数体本身同步地把 setting/apiInitPromise 摆好，真正的脚本加载在
 * apiInitPromise[0] 上 resolve——成功走 userApi/index.ts 的 init 事件，
 * 失败走 setUserApi 的 catch。调用方若要"等切好再做事"，必须 await 返回值。
 */
// A01-017：失败回退递归没有深度上限 —— 回退目标按「第一个未禁用源」选，而 setting 里的
// 值并未更新，条件恒成立时会在同一源上无限递归。加深度上限。
export const setApiSource = async(apiId: string, retryDepth = 0): Promise<boolean> => {
  if (global.lx.apiInitPromise[1]) {
    global.lx.apiInitPromise[0] = new Promise(resolve => {
      global.lx.apiInitPromise[1] = false
      global.lx.apiInitPromise[2] = (result: boolean) => {
        global.lx.apiInitPromise[1] = true
        resolve(result)
      }
    })
  }
  if (/^user_api/.test(apiId)) {
    setUserApi(apiId).catch(err => {
      if (!global.lx.apiInitPromise[1]) global.lx.apiInitPromise[2](false)
      console.log(err)
      let api = apiSourceInfo.find(api => !api.disabled)
      if (!api) return
      // A01-017：最多回退 3 层，避免同一失败源被反复重试造成无限递归。
      if (api.id != settingState.setting['common.apiSource'] && retryDepth < 3) void setApiSource(api.id, retryDepth + 1)
    })
  } else {
    // @ts-expect-error
    global.lx.qualityList = musicSdk.supportQuality[apiId] ?? {}
    destroyUserApi()
    if (!global.lx.apiInitPromise[1]) global.lx.apiInitPromise[2](true)
    // apiSource.value = apiId
    // void setUserApiAction(apiId)
  }

  if (apiId != settingState.setting['common.apiSource']) {
    updateSetting({ 'common.apiSource': apiId })
    requestAnimationFrame(() => {
      global.state_event.apiSourceUpdated(apiId)
    })
  }

  return global.lx.apiInitPromise[0]
}

