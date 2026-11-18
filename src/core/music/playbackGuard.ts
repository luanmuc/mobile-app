/**
 * 播放链路的两道 App 侧判据（v9.1）
 *
 * 背景（实测）：App 的 URL 缓存（`src/utils/data.ts` 的 `getMusicUrl`）只读持久化、**没有 TTL**，
 * 命中处 `online.ts:70` / `utils.ts:419` 都是 `if (cachedUrl && !isRefresh)` 直接用；
 * 源仓侧跨平台缓存 TTL 10 分钟，命中前也不验。结果是死链可能被长期复用，
 * 真机表现是「卡在加载/下载 0% 然后超时」，日志里只看得到笼统失败。
 *
 * 这里只做**形态级**判定，不发任何网络请求：
 * - App 侧不该为一次缓存命中再打一次上游（那是源仓 `isAudioPlayable` 的职责，它有 Range 探测）
 * - 形态判据足以拦掉最常见的坏结果：空串、非 http、HTML 文档、JSON 正文
 */

const HTTP_URL_RE = /^https?:\/\//i

// 明显不是音频的形态：HTML/JSON 正文开头，或带网页/接口类后缀
const SUSPECT_SHAPE_RE = /^(\s*[<{[]|https?:\/\/[^\s]*\.(?:html?|json|txt|js|css)(?:[?#]|$))/i

/**
 * 候选 URL 是否"看起来能播"。true = 放行；false = 上游应视为不可用（缓存该被清掉 / 继续换源）。
 */
export const isPlayableCandidate = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  if (!HTTP_URL_RE.test(trimmed)) return false
  return !SUSPECT_SHAPE_RE.test(trimmed)
}

export type UnusableUrlReason = '' | 'EMPTY_URL' | 'NON_HTTP_URL' | 'NON_AUDIO_URL'

/**
 * 不可用原因（供健康统计/诊断面板分类用）。返回 '' 表示可用。
 * 四类落点：无可用源(NO_AVAILABLE_SOURCE，由调用方)、源返回空(EMPTY_URL)、
 * 源返回非音频(NON_AUDIO_URL/NON_HTTP_URL)、超时(NETWORK_TIMEOUT，沿用源仓错误码)。
 */
export const classifyUnusableUrl = (url: unknown): UnusableUrlReason => {
  if (typeof url !== 'string' || !url.trim()) return 'EMPTY_URL'
  const trimmed = url.trim()
  if (!HTTP_URL_RE.test(trimmed)) return 'NON_HTTP_URL'
  if (SUSPECT_SHAPE_RE.test(trimmed)) return 'NON_AUDIO_URL'
  return ''
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>)\]]+/gi
const URL_HOST_RE = /^https?:\/\/[^\s/?#]+/i

/**
 * 把一条 URL 截成 `scheme://host/…`：保留 host 便于定位是哪个源，丢掉 path/query
 * （源返回体常把带签名的整条地址塞进 error message，整条打印等于把签名写进日志）。
 */
export const sanitizeUrlForLog = (url: string): string => {
  const host = URL_HOST_RE.exec(url)
  return host ? `${host[0]}/…` : 'URL(已隐藏)'
}

const redactText = (text: string): string => (typeof text === 'string' ? text.replace(URL_IN_TEXT_RE, (m) => sanitizeUrlForLog(m)) : text)

/**
 * 日志脱敏：错误对象里的所有 URL 截成 host + …，**保留 code**（大量按 code 分支的逻辑依赖它）。
 * 返回普通对象而不是 Error 实例：避免把原 stack 一起打出去（栈里也可能带 URL）。
 */
export const sanitizeError = (err: unknown): unknown => {
  if (err == null) return err
  if (typeof err === 'string') return redactText(err)
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code
    return {
      name: err.name,
      message: redactText(err.message),
      ...(code != null ? { code } : {}),
    }
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      out[key] = typeof value === 'string' ? redactText(value) : value
    }
    return out
  }
  return err
}
