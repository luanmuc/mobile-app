import { httpGet } from '@/utils/request'
import { author, name } from '../../package.json'
import { downloadFile, downloadDirectoryPath, readDir, stat, stopDownload, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'

const abis = [
  'arm64-v8a',
  'armeabi-v7a',
  'x86_64',
  'x86',
  'universal',
]

const address = [
  [`https://raw.githubusercontent.com/${author.name}/${name}/master/publish/version.json`, 'direct'],
  // npm 包通道：npmmirror（阿里云）国内必达，放在 GitHub 系源之后立即尝试
  ['https://registry.npmmirror.com/luanmuc-lx-music-version-info/latest', 'npm'],
  // npm 官方源
  ['https://registry.npmjs.org/luanmuc-lx-music-version-info/latest', 'npm'],
  // jsdelivr 语法需 @分支（@master），否则 master 会被当作文件路径返回 404
  [`https://cdn.jsdelivr.net/gh/${author.name}/${name}@master/publish/version.json`, 'direct'],
  [`https://fastly.jsdelivr.net/gh/${author.name}/${name}@master/publish/version.json`, 'direct'],
  [`https://gcore.jsdelivr.net/gh/${author.name}/${name}@master/publish/version.json`, 'direct'],
]


const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 5000,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        // 快速失败切换源：每源最多重试 1 次，避免长时间卡在"检查更新中"
        ++retryNum >= 1
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getDirectInfo = async(url) => {
  return request(url).then(info => {
    if (info.version == null) throw new Error('failed')
    return info
  })
}

const getNpmPkgInfo = async(url) => {
  return request(url).then(json => {
    if (!json.versionInfo) throw new Error('failed')
    const info = JSON.parse(json.versionInfo)
    if (info.version == null) throw new Error('failed')
    return info
  })
}

// 版本比较（支持构建序号 bN）：主版本逐段比较，相同则比较 b 序号
const compareVersion = (a, b) => {
  const parse = (s) => {
    const [main, build] = String(s).split('-')
    const nums = (main || '').split('.').map(n => Number.parseInt(n, 10) || 0)
    const buildNum = build ? (Number.parseInt(build.replace(/[^0-9]/g, ''), 10) || 0) : 0
    return { nums, buildNum }
  }
  const c = parse(a)
  const t = parse(b)
  const len = Math.max(c.nums.length, t.nums.length)
  for (let i = 0; i < len; i++) {
    const cn = c.nums[i] || 0
    const tn = t.nums[i] || 0
    if (cn > tn) return 1
    if (cn < tn) return -1
  }
  return c.buildNum - t.buildNum
}

// 并行请求所有源，取版本号最高的结果（避免镜像同步延迟时拿到旧版本）
// 全部失败才抛错，交由上层 30s 总超时兜底
export const getVersionInfo = async() => {
  const tasks = address.map(async([url, source]) => {
    try {
      return source === 'npm' ? await getNpmPkgInfo(url) : await getDirectInfo(url)
    } catch (err) {
      console.log('version source failed:', url, err?.message || err)
      return null
    }
  })
  const results = (await Promise.all(tasks)).filter(Boolean)
  if (!results.length) throw new Error('getVersionInfo failed')
  return results.reduce((best, cur) => (compareVersion(cur.version, best.version) > 0 ? cur : best))
}

const getTargetAbi = async() => {
  const supportedAbis = await getSupportedAbis()
  for (const abi of abis) {
    if (supportedAbis.includes(abi)) return abi
  }
  return abis[abis.length - 1]
}
let downloadJobId = null
const noop = (total, download) => {}
let apkSavePath

// APK 下载地址列表：GitHub 直连 + 加速镜像，按顺序尝试，失败自动切换下一个
const getApkUrlList = (version, abi) => {
  const base = `https://github.com/${author.name}/${name}/releases/download/v${version}/${name}-v${version}-${abi}.apk`
  return [
    base,
    `https://gh-proxy.com/${base}`,
    `https://ghfast.top/${base}`,
  ]
}

// 清理公共下载目录里的旧安装包（保留本次要下载的文件，防止安装包越攒越多）
const cleanupOldApk = async(dir, keepFileName) => {
  try {
    const files = await readDir(dir)
    for (const f of files) {
      if (f.isFile && /^mobile-app-.*\.apk$/i.test(f.name) && f.name != keepFileName) {
        await unlink(f.path).catch(() => {})
      }
    }
  } catch (err) {
    console.log('cleanupOldApk failed:', err)
  }
}

export const downloadNewVersion = async(version, onDownload = noop) => {
  const abi = await getTargetAbi()
  const urlList = getApkUrlList(version, abi)
  const apkFileName = `mobile-app-v${version}.apk`
  // 优先保存到系统公共下载目录（用户可见）；失败自动回退应用缓存目录
  const savePaths = [
    `${downloadDirectoryPath}/${apkFileName}`,
    `${temporaryDirectoryPath}/${apkFileName}`,
  ]
  // 下载前清理公共目录与缓存目录的旧包
  cleanupOldApk(downloadDirectoryPath, apkFileName).catch(() => {})
  cleanupOldApk(temporaryDirectoryPath, apkFileName).catch(() => {})
  let lastErr = null

  for (const savePath of savePaths) {
    for (const url of urlList) {
      if (downloadJobId) stopDownload(downloadJobId)
      const { jobId, promise } = downloadFile(url, savePath, {
        progressInterval: 500,
        connectionTimeout: 20000,
        readTimeout: 30000,
        begin({ statusCode, contentLength }) {
          onDownload(contentLength, 0)
          // switch (statusCode) {
          //   case 200:
          //   case 206:
          //     break
          //   default:
          //     onDownload(null, contentLength, 0)
          //     break
          // }
        },
        progress({ contentLength, bytesWritten }) {
          onDownload(contentLength, bytesWritten)
        },
      })
      downloadJobId = jobId
      try {
        await promise
        // eslint-disable-next-line require-atomic-updates -- 模块级当前下载任务句柄，后续 await 不依赖该值
        downloadJobId = null
        // 完整性校验：下载内容过小视为失败（防 404 页/断连残片被直接安装导致"解析包错误"）
        const fileStat = await stat(savePath)
        if (fileStat.size < 5 * 1024 * 1024) throw new Error(`apk file too small: ${fileStat.size}`)
        apkSavePath = savePath
        return updateApp()
      } catch (err) {
        console.log('downloadNewVersion failed:', savePath, url, err)
        lastErr = err
      }
    }
  }
  // eslint-disable-next-line require-atomic-updates -- 循环结束后统一复位模块级句柄
  downloadJobId = null
  throw lastErr || new Error('apk download failed')
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
