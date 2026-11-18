import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '@/utils/log'

const partKeyPrefix = '@___PART___'
const partKeyArrPrefix = '@___PART_A___'
const partKeyPrefixRxp = /^@___PART___/
const partKeyArrPrefixRxp = /^@___PART_A___/
const keySplit = ','
const limit = 500000

const buildData = (key: string, value: any, datas: Array<[string, string]>) => {
  let valueStr = JSON.stringify(value)
  if (valueStr.length <= limit) {
    datas.push([key, valueStr])
    return
  }

  const partKeys = []
  for (let i = 0, len = Math.floor(valueStr.length / limit); i <= len; i++) {
    let partKey = `${partKeyArrPrefix}${key}${i}`
    partKeys.push(partKey)
    datas.push([partKey, valueStr.substring(i * limit, (i + 1) * limit)])
  }
  datas.push([key, partKeyArrPrefix + JSON.stringify(partKeys)])
}

// 1.4.0 之前的数据分片存储方式，存在key的内容与分隔符冲突的问题
// 1.4.0 开始改用数组存储，不再使用分隔符的方式
const handleGetDataOld = async<T>(partKeys: string): Promise<T> => {
  const keys = partKeys.replace(partKeyPrefixRxp, '').split(keySplit)

  return AsyncStorage.multiGet(keys).then(datas => {
    return JSON.parse(datas.map(data => data[1]).join(''))
  })
}

const handleGetData = async<T>(partKeys: string): Promise<T> => {
  if (partKeys.startsWith(partKeyPrefix)) return handleGetDataOld<T>(partKeys)

  const keys = JSON.parse(partKeys.replace(partKeyArrPrefixRxp, '')) as string[]
  return AsyncStorage.multiGet(keys).then(datas => {
    return JSON.parse(datas.map(data => data[1]).join(''))
  })
}

export const saveData = async(key: string, value: any) => {
  const datas: Array<[string, string]> = []
  buildData(key, value, datas)

  try {
    // A03-P2-8：原来是「先 removeData(key) 再 multiSet」——两步之间崩溃/断电就同时丢了
    // 旧分片和索引，等于数据直接消失。改为「先只读旧索引、再整体写新、最后清理旧残留」：
    //   · 写入前不删除任何键 → 崩溃窗口内旧数据仍然完整可读；
    //   · 新数据（含新索引）一次性 multiSet → 读取侧要么看到旧版要么看到新版；
    //   · 最后只删「旧索引里有、新数据里没有」的分片（分片数变少时的空间回收）。
    const newKeys = datas.map(([k]) => k)
    let staleKeys: string[] = []
    try {
      const oldIndex = await AsyncStorage.getItem(key)
      if (oldIndex && partKeyPrefixRxp.test(oldIndex)) {
        const oldParts = oldIndex.replace(partKeyPrefixRxp, '').split(keySplit)
        staleKeys = oldParts.filter(k => !newKeys.includes(k))
      }
    } catch (e: any) {
      // 读旧索引失败不影响本次写入（旧分片最多留成孤儿，读取侧以新索引为准）
      log.error('storage error[saveData]: 读旧索引失败', key, e.message)
    }

    await AsyncStorage.multiSet(datas)

    if (staleKeys.length) {
      try {
        await AsyncStorage.multiRemove(staleKeys)
      } catch (e: any) {
        log.error('storage error[saveData]: 清理旧分片失败', key, e.message)
      }
    }
  } catch (e: any) {
    // saving error
    log.error('storage error[saveData]:', key, e.message)
    throw e
  }
}

export const getData = async<T = unknown>(key: string): Promise<T | null> => {
  let value: string | null
  try {
    value = await AsyncStorage.getItem(key)
  } catch (e: any) {
    // error reading value
    log.error('storage error[getData]:', key, e.message)
    // 读失败按空值处理：单个 key 读不出来不应该让整个启动流程崩掉
    return null
  }
  if (!value) return null
  try {
    if (partKeyPrefixRxp.test(value) || partKeyArrPrefixRxp.test(value)) {
      return await handleGetData<T>(value)
    }
    return JSON.parse(value)
  } catch (e: any) {
    // 数据损坏：按空值处理并清掉这份坏数据，下次读取即为默认值（等价于重置该项）
    log.error('storage error[getData]: 数据损坏，已按空值处理并清除', key, e.message)
    void removeData(key).catch(() => {})
    return null
  }
}

export const removeData = async(key: string) => {
  let value: string | null
  try {
    value = await AsyncStorage.getItem(key)
  } catch (e: any) {
    // error reading value
    log.error('storage error[removeData]:', key, e.message)
    throw e
  }
  if (value) {
    if (partKeyPrefixRxp.test(value)) {
      let partKeys = value.replace(partKeyPrefixRxp, '').split(keySplit)
      partKeys.push(key)
      try {
        await AsyncStorage.multiRemove(partKeys)
      } catch (e: any) {
        // remove error
        log.error('storage error[removeData]:', key, e.message)
        throw e
      }
      return
    } else if (partKeyArrPrefixRxp.test(value)) {
      // 索引数据损坏时只删主 key，不让解析失败中断整个删除流程
      let partKeys: string[] = []
      try {
        partKeys = JSON.parse(value.replace(partKeyArrPrefixRxp, '')) as string[]
      } catch (e: any) {
        log.error('storage error[removeData]: 索引数据损坏，跳过子项清理', key, e.message)
      }
      partKeys.push(key)
      try {
        await AsyncStorage.multiRemove(partKeys)
      } catch (e: any) {
        // remove error
        log.error('storage error[removeData]:', key, e.message)
        throw e
      }
      return
    }
  }

  try {
    await AsyncStorage.removeItem(key)
  } catch (e: any) {
    // remove error
    log.error('storage error[removeData]:', key, e.message)
    throw e
  }
}

export const getAllKeys = async() => {
  let keys
  try {
    keys = await AsyncStorage.getAllKeys()
  } catch (e: any) {
    // read key error
    log.error('storage error[getAllKeys]:', e.message)
    throw e
  }

  return keys
}


export const getDataMultiple = async<T extends readonly string[]>(keys: T) => {
  type RawData = { [K in keyof T]: [T[K], string | null] }
  let datas: RawData
  try {
    datas = await AsyncStorage.multiGet(keys) as RawData
  } catch (e: any) {
    // read error
    log.error('storage error[getDataMultiple]:', e.message)
    throw e
  }
  const promises: Array<Promise<unknown | null>> = []
  for (const [key, value] of datas) {
    if (!value) {
      promises.push(Promise.resolve(null))
      continue
    }
    if (partKeyPrefixRxp.test(value) || partKeyArrPrefixRxp.test(value)) {
      // 单项数据损坏只影响这一项，按空值处理并清掉坏数据
      promises.push(handleGetData(value).catch((e: any) => {
        log.error('storage error[getDataMultiple]: 数据损坏，已按空值处理', key, e.message)
        void removeData(key).catch(() => {})
        return null
      }))
    } else {
      try {
        promises.push(Promise.resolve(JSON.parse(value)))
      } catch (e: any) {
        log.error('storage error[getDataMultiple]: 数据损坏，已按空值处理', key, e.message)
        void removeData(key).catch(() => {})
        promises.push(Promise.resolve(null))
      }
    }
  }
  return Promise.all(promises).then(values => {
    return datas.map(([key], index) => ([key, values[index]])) as { [K in keyof T]: [T[K], unknown] }
  })
}

export const saveDataMultiple = async(datas: Array<[string, any]>) => {
  const allData: Array<[string, string]> = []
  for (const [key, value] of datas) {
    buildData(key, value, allData)
  }
  try {
    await removeDataMultiple(datas.map(k => k[0]))
    await AsyncStorage.multiSet(allData)
  } catch (e: any) {
    // save error
    log.error('storage error[saveDataMultiple]:', e.message)
    throw e
  }
}


export const removeDataMultiple = async(keys: string[]) => {
  if (!keys.length) return
  const datas = await AsyncStorage.multiGet(keys)
  let allKeys = []
  for (const [key, value] of datas) {
    allKeys.push(key)
    if (value) {
      if (partKeyPrefixRxp.test(value)) {
        allKeys.push(...value.replace(partKeyPrefixRxp, '').split(keySplit))
      } else if (partKeyArrPrefixRxp.test(value)) {
        try {
          allKeys.push(...JSON.parse(value.replace(partKeyArrPrefixRxp, '')) as string[])
        } catch (e: any) {
          log.error('storage error[removeDataMultiple]: 索引数据损坏，跳过子项清理', key, e.message)
        }
      }
    }
  }
  try {
    await AsyncStorage.multiRemove(allKeys)
  } catch (e: any) {
    // remove error
    log.error('storage error[removeDataMultiple]:', e.message)
    throw e
  }
}

export const clearAll = async() => {
  try {
    await AsyncStorage.clear()
  } catch (e: any) {
    // clear error
    log.error('storage error[clearAll]:', e.message)
    throw e
  }
}

export { useAsyncStorage } from '@react-native-async-storage/async-storage'
