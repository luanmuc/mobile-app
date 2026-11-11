import RNFS from 'react-native-fs'

// ===== 日志系统（b64 重构版）=====
// 公共目录结构：Download/lx-music/{music, logs}
//   music/   → 下载音乐（downloadManager）
//   logs/    → 日志（本文件 + logger.ts 的调试日志）
// 4 类日志各产生各的文件，写前检查大小超限自动清空（保留最新日志）
// 权限策略：无"所有文件访问"权限（Android 11+）或存储权限（Android 10-）时不写任何日志（不降级私有目录），
//           由「运行日志」页提示用户开启权限

// 双通道（b71，按原版洛雪零权限逻辑）：
//   公共目录优先（用户偏好，需"所有文件访问"权限）→ Download/lx-music/logs
//   公共不可用（未授权/ROM 判定不一致）→ 自动降级私有目录（应用沙箱，零权限，永不再提示去开启）
//   日志永远可写可看；「运行日志」页显示当前生效目录
const LOG_ROOT = RNFS.DownloadDirectoryPath + '/lx-music'
const LOGS_DIR = LOG_ROOT + '/logs'
const PRIVATE_LOG_ROOT = RNFS.TemporaryDirectoryPath + '/lx-music'
const PRIVATE_LOGS_DIR = PRIVATE_LOG_ROOT + '/logs'
// 当前生效目录（checkLogPermission 后确定；null=未初始化）
let activeLogsDir: string | null = null

// 2.4：诊断模块需要拿到“当前真正生效”的日志目录（公共或私有降级），只读复用，不新建目录
export const getActiveLogsDir = (): string => activeLogsDir ?? PRIVATE_LOGS_DIR

// 日志文件定义：分类 → 文件名 / 上限
const LOG_FILES = {
  error: { name: 'error.log', max: 1024 * 1024 }, // 全局错误 1MB
  source: { name: 'source.log', max: 1024 * 1024 }, // 音源日志 1MB
  diagnose: { name: 'diagnose.log', max: 512 * 1024 }, // 运行诊断 512KB
  debug: { name: 'lx_debug_log.txt', max: 512 * 1024 }, // 调试日志 512KB
} as const
export type LogCategory = keyof typeof LOG_FILES

// 权限状态缓存：init 与「运行日志」页打开时刷新；写入用缓存值（避免高频 native 调用）
let hasPermission: boolean | null = null
// 启动缓冲：init 前产生的日志先暂存，权限可用时一次性写入（不丢早期日志）
const tempLog: Array<{ category: LogCategory, time: string, text: string }> = []
// 真实写测试：在公共日志目录创建测试文件，能写成功即视为有权限（唯一可靠标准）
// 注意 1：RNFS.mkdir 不递归——父目录 lx-music 不存在（未下载过歌/目录被清理）时须逐级创建，否则误判无权限
// 注意 2：只以"能创建"为准——删除测试文件失败（unlink 在部分 ROM 上可能延迟/受限）不影响权限结论
const testWritePermission = async(): Promise<boolean> => {
  try {
    if (!await RNFS.exists(LOG_ROOT)) await RNFS.mkdir(LOG_ROOT)
    if (!await RNFS.exists(LOGS_DIR)) await RNFS.mkdir(LOGS_DIR)
    const testPath = LOGS_DIR + '/.perm_test'
    await RNFS.writeFile(testPath, '')
    try {
      await RNFS.unlink(testPath)
    } catch {}
    return true
  } catch {
    return false
  }
}
// 私有目录保底创建（应用沙箱永远可写，无需任何权限）
const ensurePrivateDir = async(): Promise<string> => {
  try {
    if (!await RNFS.exists(PRIVATE_LOG_ROOT)) await RNFS.mkdir(PRIVATE_LOG_ROOT)
    if (!await RNFS.exists(PRIVATE_LOGS_DIR)) await RNFS.mkdir(PRIVATE_LOGS_DIR)
  } catch {}
  return PRIVATE_LOGS_DIR
}

const TEXT_LOG_SUFFIX = ['.log', '.txt', '.jsonl']
const isTextLogFile = (name: string): boolean => TEXT_LOG_SUFFIX.some(ext => name.endsWith(ext))
const migrationLock = { active: false }

const copyThenRemove = async(src: string, dest: string): Promise<void> => {
  try {
    await RNFS.moveFile(src, dest)
  } catch {
    await RNFS.copyFile(src, dest)
    await RNFS.unlink(src)
  }
}

// 公共目录恢复可用时，把无权限期间写在私有目录的日志全部迁回公共目录。
// 文本日志/JSONL 追加合并；JSON 等非文本文件遇到同名不覆盖，改名保留。
export const migratePrivateLogsToPublic = async(): Promise<number> => {
  if (migrationLock.active) return 0
  migrationLock.active = true
  try {
    if (!await RNFS.exists(PRIVATE_LOGS_DIR)) return 0
    const entries = await RNFS.readDir(PRIVATE_LOGS_DIR)
    let moved = 0
    for (const item of entries) {
      const name = item?.name
      if (!name || name.startsWith('.')) continue
      if (typeof item.isFile === 'function' && !item.isFile()) continue
      const src = PRIVATE_LOGS_DIR + '/' + name
      const dest = LOGS_DIR + '/' + name
      try {
        if (!await RNFS.exists(dest)) {
          await copyThenRemove(src, dest)
          moved++
          continue
        }
        if (isTextLogFile(name)) {
          await RNFS.appendFile(dest, await RNFS.readFile(src, 'utf8'), 'utf8')
          await RNFS.unlink(src)
          moved++
          continue
        }
        await copyThenRemove(src, dest + '.migrated-' + Date.now())
        moved++
      } catch {}
    }
    return moved
  } catch {
    return 0
  } finally {
    migrationLock.active = false
  }
}

export const checkLogPermission = async(): Promise<boolean> => {
  // b71 双通道：真实写测试公共目录——成功→公共；失败→私有降级（原版零权限逻辑，永不再提示）
  try {
    hasPermission = await testWritePermission()
  } catch {
    hasPermission = false
  }
  // 确定生效目录
  if (hasPermission) {
    activeLogsDir = LOGS_DIR
    await migratePrivateLogsToPublic()
  } else {
    activeLogsDir = await ensurePrivateDir()
  }
  // 权限变为可用时冲刷启动缓冲（不丢早期日志）
  if (tempLog.length) {
    const items = tempLog.splice(0)
    for (const item of items) {
      await writeLog(item.category, `${item.time} ${item.text}`)
    }
  }
  return hasPermission
}
// 只读缓存（高频写入用，避免每次 native 调用）；null 表示尚未检查过
export const isLogPermissionGranted = () => hasPermission
const ensureLogsDir = async() => {
  try {
    // RNFS.mkdir 不递归，逐级创建
    if (!await RNFS.exists(LOG_ROOT)) await RNFS.mkdir(LOG_ROOT)
    if (!await RNFS.exists(LOGS_DIR)) await RNFS.mkdir(LOGS_DIR)
  } catch {}
  return LOGS_DIR
}

export const ensureAllLogFiles = async(dir: string): Promise<void> => {
  for (const { name } of Object.values(LOG_FILES)) {
    try {
      const path = dir + '/' + name
      if (!await RNFS.exists(path)) await RNFS.writeFile(path, '', 'utf8')
    } catch {}
  }
}

const writeLog = async(category: LogCategory, msg: string) => {
  // b71 双通道：公共不可用时自动写私有目录（原版零权限逻辑，日志永不丢弃）
  // hasPermission 为 null（init 未完成）时先入启动缓冲，init 后冲刷——热路径零阻塞
  if (hasPermission == null) return
  // 兜底冲刷启动缓冲（防止 checkLogPermission 未经过的路径）
  if (tempLog.length) {
    const items = tempLog.splice(0)
    for (const item of items) {
      await writeLog(item.category, `${item.time} ${item.text}`)
    }
  }
  const { name, max } = LOG_FILES[category]
  const dir = hasPermission ? await ensureLogsDir() : await ensurePrivateDir()
  // 任一分类开始写日志时，把同一目录下其余固定日志文件补齐，避免“只有一类文件存在”
  await ensureAllLogFiles(dir)
  const path = dir + '/' + name
  try {
    // 写前检查大小，超限先清空再写（归零重新积累，保留最新日志）
    try {
      const stat = await RNFS.stat(path)
      if (stat.size > max) await RNFS.writeFile(path, '', 'utf8')
    } catch {} // 文件不存在则忽略
    await RNFS.appendFile(path, '\n----lx log----\n' + msg, 'utf8')
  } catch (e) {
    // 日志写入失败不影响主流程
  }
}

export const init = async() => {
  try {
    await checkLogPermission()
    // 公共可用→确保公共目录；否则确保私有目录（双通道，永不无日志）
    if (hasPermission) {
      if (!await RNFS.exists(LOG_ROOT)) await RNFS.mkdir(LOG_ROOT)
      if (!await RNFS.exists(LOGS_DIR)) await RNFS.mkdir(LOGS_DIR)
    } else {
      await ensurePrivateDir()
    }
  } catch (e) {}
}

export const getLogsDir = () => activeLogsDir ?? LOGS_DIR
// 是否使用公共目录（UI 显示用）
export const isUsingPublicDir = () => hasPermission === true

// 4 类日志的中文标签（供查看日志分段展示）
export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  error: '全局错误',
  source: '音源日志',
  diagnose: '运行诊断',
  debug: '调试日志',
}

// 读取日志：category 缺省读全部（分段展示）；指定则只读该类
export const getLogs = async(category?: LogCategory): Promise<string> => {
  if (hasPermission == null) await checkLogPermission()
  const categories: LogCategory[] = category ? [category] : (['error', 'source', 'diagnose', 'debug'] as LogCategory[])
  const parts: string[] = []
  const dir = activeLogsDir ?? (hasPermission ? LOGS_DIR : await ensurePrivateDir())
  for (const cat of categories) {
    const path = dir + '/' + LOG_FILES[cat].name
    try {
      if (await RNFS.exists(path)) {
        const text = await RNFS.readFile(path, 'utf8')
        if (text.trim()) {
          parts.push('==== ' + LOG_CATEGORY_LABELS[cat] + ' ====\n' + text.trim())
        }
      }
    } catch {}
  }
  return parts.join('\n\n')
}

// 清空日志：category 缺省清全部；指定则只清该类
export const clearLogs = async(category?: LogCategory) => {
  if (hasPermission == null) await checkLogPermission()
  const categories: LogCategory[] = category ? [category] : (['error', 'source', 'diagnose', 'debug'] as LogCategory[])
  const dir = activeLogsDir ?? (hasPermission ? LOGS_DIR : await ensurePrivateDir())
  for (const cat of categories) {
    try {
      const path = dir + '/' + LOG_FILES[cat].name
      if (await RNFS.exists(path)) await RNFS.writeFile(path, '', 'utf8')
    } catch {}
  }
}

const getTime = () => new Date().toLocaleString()

// 日志分类接口（各来源各写各的文件）：
//   log.error    → error.log    全局错误（errorHandle 异常捕获）
//   log.source   → source.log   音源日志（userApi 聚合音源）
//   log.diagnose → diagnose.log 运行诊断（播放音源标签链路等）
// 调试日志（debug）由 utils/logger.ts 走同一公共目录 lx_debug_log.txt
export const log = {
  error(...msgs: unknown[]) {
    const msg = msgs.map(m => typeof m == 'string' ? m : m instanceof Error ? m.stack ?? m.message : JSON.stringify(m)).join(' ')
    if (msg.startsWith('%c')) return
    if (tempLog.length) tempLog.push({ category: 'error', time: getTime(), text: msg })
    else void writeLog('error', `${getTime()} ERROR ${msg}`).catch(() => {})
  },
  source(...msgs: unknown[]) {
    const msg = msgs.map(m => typeof m == 'string' ? m : m instanceof Error ? m.stack ?? m.message : JSON.stringify(m)).join(' ')
    if (msg.startsWith('%c')) return
    if (tempLog.length) tempLog.push({ category: 'source', time: getTime(), text: msg })
    else void writeLog('source', `${getTime()} LOG ${msg}`).catch(() => {})
  },
  diagnose(...msgs: unknown[]) {
    const msg = msgs.map(m => typeof m == 'string' ? m : m instanceof Error ? m.stack ?? m.message : JSON.stringify(m)).join(' ')
    if (msg.startsWith('%c')) return
    if (tempLog.length) tempLog.push({ category: 'diagnose', time: getTime(), text: msg })
    else void writeLog('diagnose', `${getTime()} LOG ${msg}`).catch(() => {})
  },
  // 兼容原 log.info/log.warn（各处排障日志）→ 归类到运行诊断
  info(...msgs: unknown[]) {
    log.diagnose(...msgs)
  },
  warn(...msgs: unknown[]) {
    log.diagnose(...msgs)
  },
}
