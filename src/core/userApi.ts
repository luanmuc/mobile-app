import { action, state } from '@/store/userApi'
import { addUserApi, getUserApiScript, updateUserApi, removeUserApi as removeUserApiFromStore, setUserApiAllowShowUpdateAlert as setUserApiAllowShowUpdateAlertFromStore } from '@/utils/data'
import { destroy, loadScript } from '@/utils/nativeModules/userApi'
import { log as writeLog } from '@/utils/log'
import { getData, removeData } from '@/plugins/storage'
import { BUILTIN_SOURCE_STORAGE_KEYS } from '@/core/init/userApi/builtinSource'
import { logger, toLogText } from '@/utils/logger'


export const setUserApi = async(apiId: string) => {
  global.lx.qualityList = {}
  setUserApiStatus(false, 'initing')

  const target = state.list.find(api => api.id === apiId)
  if (!target) throw new Error('api not found')
  const script = await getUserApiScript(target.id)
  loadScript({ ...target, script })
}

export const destroyUserApi = () => {
  destroy()
}


export const setUserApiStatus: typeof action['setStatus'] = (status, message) => {
  action.setStatus(status, message)
}

export const setUserApiList: typeof action['setUserApiList'] = (list) => {
  action.setUserApiList(list)
}

export const importUserApi = async(script: string) => {
  const info = await addUserApi(script)
  action.addUserApi(info)
  // 必须返回新音源信息：调用方（设置页"一键更新音源"）要读 info.id 来删除旧音源、切换到新音源
  return info
}

export const overwriteUserApi = async(id: string, script: string) => {
  const info = await updateUserApi(id, script)
  // 就地覆盖：列表里同一位置换成新元信息，id 与条数都不变。
  // 启动期 store 还没装载该源时不要用 map 结果覆盖整个列表（会清空其它源）。
  if (state.list.some(api => api.id === id)) {
    action.setUserApiList(state.list.map(api => (api.id === id ? info : api)))
  }
  return info
}

export const removeUserApi = async(ids: string[]) => {
  const list = await removeUserApiFromStore(ids)
  action.setUserApiList(list)

  // 删掉的正是内置源时清掉悬空标记：否则 id 会永远指向一个已不存在的源，
  // 将来用户自建同名源时会被当成内置源静默覆盖。
  try {
    const storedId = await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.sourceId)
    if (storedId && ids.includes(storedId)) await removeData(BUILTIN_SOURCE_STORAGE_KEYS.sourceId)
    const pendingId = await getData<string>(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)
    if (pendingId && ids.includes(pendingId)) await removeData(BUILTIN_SOURCE_STORAGE_KEYS.pendingSourceId)
  } catch (e) {
    logger.warn('UserApi', 'Failed to clear builtin source markers: ' + toLogText(e))
  }
}

export const setUserApiAllowShowUpdateAlert = async(id: string, enable: boolean) => {
  await setUserApiAllowShowUpdateAlertFromStore(id, enable)
  action.setUserApiAllowShowUpdateAlert(id, enable)
}

export const log = {
  r_info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.source(...params)
  },
  r_warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.source(...params)
  },
  r_error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.source(...params)
  },
  log(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.source(...params)
  },
  info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.source(...params)
  },
  warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.source(...params)
  },
  error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.source(...params)
  },
}
