import { httpFetch } from '../../request'

const AUDIUS_API = 'https://api.audius.co/v1'
const APP_NAME = 'LxSource'

// Audius 无「热词」概念，用 trending 曲名当热搜词（点击即按曲名搜索）
export default {
  _requestObj: null,
  async getList(retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))
    if (this._requestObj) this._requestObj.cancelHttp()
    const _requestObj = httpFetch(`${AUDIUS_API}/tracks/trending?app_name=${APP_NAME}&limit=20`, {
      method: 'get',
      headers: { 'User-Agent': 'LX-Music-Mobile' },
    })
    const { body, statusCode } = await _requestObj.promise
    if (statusCode != 200) throw new Error('获取 Audius 热门失败')
    const data = (body && body.data) || []
    const list = []
    const seen = new Set()
    for (const t of data) {
      const word = t && t.title
      if (!word || seen.has(word)) continue
      seen.add(word)
      list.push(word)
    }
    return { source: 'au', list }
  },
}
