import RNFS from 'react-native-fs'
import settingState from '@/store/setting/state'
import { isLogPermissionGranted } from '@/utils/log'

const LOG_FILE_NAME = 'lx_debug_log.txt'
const MAX_LOG_SIZE = 512 * 1024 // 512KB，超过自动清空

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

// b71：调试日志双通道——公共目录（有"所有文件访问"权限）优先；公共不可用→私有目录（原版零权限逻辑，永不丢弃）
const getLogPath = () => `${RNFS.DownloadDirectoryPath}/lx-music/logs/${LOG_FILE_NAME}`
const getPrivateLogPath = () => `${RNFS.TemporaryDirectoryPath}/lx-music/logs/${LOG_FILE_NAME}`

const isEnabled = () => settingState.setting['common.enableDebugLog']

const formatTime = () => {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

const writeLog = async(level: LogLevel, tag: string, message: string, force = false) => {
  // 音源标签诊断（tag=PlaySource）强制写：不依赖"调试日志"开关，装包即可用日志定位
  if (!force && !isEnabled()) return
  try {
    // b71：公共目录可用→写公共；否则降级私有（只用缓存判定，不在写入路径触发写测试/RNFS IO）
    const granted = isLogPermissionGranted()
    const line = `[${formatTime()}] [${level}] [${tag}] ${message}\n`
    const path = granted === true ? getLogPath() : getPrivateLogPath()
    const dir = granted === true ? `${RNFS.DownloadDirectoryPath}/lx-music/logs` : `${RNFS.TemporaryDirectoryPath}/lx-music/logs`

    // 确保日志目录存在（RNFS.mkdir 不递归，逐级创建）
    try {
      const base = dir.replace(/\/logs$/, '')
      if (!await RNFS.exists(base)) {
        await RNFS.mkdir(base)
      }
      if (!await RNFS.exists(dir)) {
        await RNFS.mkdir(dir)
      }
    } catch (e) {
      // A07-015：目录创建失败原来是空 catch，接着照常 appendFile，外层再吞一次 ——
      // 结果是日志静默不落盘、调用方完全无感知（调试时最容易怀疑「是不是没走到」）。
      // logger 是底层模块（不能 import log.ts，会循环依赖），这里用 console 留一条痕迹。
      const code = (e as { code?: string } | null)?.code
      // eslint-disable-next-line no-console -- 唯一合法出口：logger 是最底层模块，转调自己会无限递归
      console.warn('logger: 日志目录创建失败，后续写入可能静默失败', code ?? typeof e)
    }

    // 检查文件大小，超过则清空
    try {
      const stat = await RNFS.stat(path)
      if (stat.size > MAX_LOG_SIZE) {
        await RNFS.writeFile(path, '', 'utf8')
      }
    } catch {} // 文件不存在则忽略

    await RNFS.appendFile(path, line, 'utf8')
  } catch (e) {
    // 日志写入失败不影响主流程
  }
}

export const logger = {
  info: (tag: string, message: string) => {
    void writeLog('INFO', tag, message, tag === 'PlaySource')
  },
  warn: (tag: string, message: string) => {
    void writeLog('WARN', tag, message)
  },
  error: (tag: string, message: string) => {
    void writeLog('ERROR', tag, message, tag === 'PlaySource')
  },
  debug: (tag: string, message: string) => {
    void writeLog('DEBUG', tag, message)
  },

  // 歌曲解析专用日志
  musicResolve: (source: string, musicId: string, name: string, singer: string, url: string | null, quality: string, error?: string) => {
    if (error) {
      void writeLog('ERROR', 'MusicResolve', `[${source}] ${name} - ${singer} (id=${musicId}, quality=${quality}) 解析失败: ${error}`)
    } else {
      void writeLog('INFO', 'MusicResolve', `[${source}] ${name} - ${singer} (id=${musicId}, quality=${quality}) 解析成功: ${url ? url.substring(0, 80) + '...' : '无URL'}`)
    }
  },

  // 播放器事件日志
  player: (action: string, musicName?: string, extra?: string) => {
    const msg = musicName ? `${musicName}${extra ? ' | ' + extra : ''}` : (extra ?? '')
    void writeLog('INFO', 'Player', `${action}${msg ? ': ' + msg : ''}`)
  },

}

// R74：logger 的四个方法都只收 string，而现有代码里大量 console.log 打的是对象
// （sanitizeError 返回 unknown、deeplink params、musicInfo 等）。直接 String(obj) 会变
// [object Object] 丢光信息，所以统一在这里做一次安全序列化：字符串原样、Error 取
// name+message+code、对象 JSON 化，循环引用或 stringify 抛错时退化成 String()。
export const toLogText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code
    return `${value.name}: ${value.message}${code != null ? ` (code=${String(code)})` : ''}`
  }
  if (value == null) return String(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
