import { httpGet } from '@/utils/request'
import { version as baseVersion } from '../../package.json'

// ============================================================
// 官方上游版本检测（定制版专属）
// 底座版本 = package.json version（跟随上游迭代自动更新）
// 官方最新版本 = lyswhut/lx-music-mobile 的 releases/latest + jsdelivr 读官方 package.json 多源并行取最高
// 设计：官方仓库发布 release 时 package.json version 与 tag 同步递增，双源互备、国内可达
// ============================================================

const officialAddress = [
  // 权威：GitHub API releases/latest（tag_name 形如 "v1.9.2"）
  'https://api.github.com/repos/lyswhut/lx-music-mobile/releases/latest',
  // jsdelivr 读官方仓库根 package.json（国内必达，version 字段与 release 同步）
  'https://cdn.jsdelivr.net/gh/lyswhut/lx-music-mobile@master/package.json',
  'https://fastly.jsdelivr.net/gh/lyswhut/lx-music-mobile@master/package.json',
  'https://gcore.jsdelivr.net/gh/lyswhut/lx-music-mobile@master/package.json',
]

const request = async(url: string) => {
  return new Promise<string>((resolve, reject) => {
    httpGet(url, {
      timeout: 5000,
    }, (err: Error | null, resp: any, body: any) => {
      if (err != null || resp?.statusCode != 200) {
        reject(err ?? new Error(String(resp?.statusCode ?? 'failed')))
      } else {
        resolve(typeof body === 'string' ? body : JSON.stringify(body))
      }
    })
  })
}

// 解析单一来源的官方版本号；解析失败返回 null
const parseOfficialVersion = (body: string): string | null => {
  try {
    const json = JSON.parse(body)
    const raw = json?.tag_name ?? json?.version
    if (typeof raw !== 'string' || !raw) return null
    return String(raw).replace(/^v/i, '').trim()
  } catch (err) {
    return null
  }
}

// 标准语义化版本比较（官方版本无 b 构建序号）：a>b → 1，a<b → -1，相等 → 0
export const compareOfficialVersion = (a: string, b: string): -1 | 0 | 1 => {
  const pa = String(a).split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// 并行请求所有源，取版本号最高的结果（避免镜像同步延迟拿到旧版本）；全部失败抛错
export const getOfficialVersionInfo = async(): Promise<string> => {
  const tasks = officialAddress.map(async(url: string) => {
    try {
      const body = await request(url)
      const v = parseOfficialVersion(body)
      if (v == null) throw new Error('parse failed')
      console.log('official version source ok:', url, v)
      return v
    } catch (err) {
      console.log('official version source failed:', url, (err as Error)?.message || err)
      return null
    }
  })
  const results = (await Promise.all(tasks)).filter((v): v is string => v != null)
  if (!results.length) throw new Error('getOfficialVersionInfo failed')
  return results.reduce((best, cur) => (compareOfficialVersion(cur, best) > 0 ? cur : best))
}

// 底座版本号（fork 点跟随 package.json，上游迭代合入时自动更新）
export const getBaseVersion = (): string => baseVersion
