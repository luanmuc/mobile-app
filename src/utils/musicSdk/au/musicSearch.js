import { httpFetch } from '../../request'
import { formatPlayTime } from '../../index'

const AUDIUS_API = 'https://api.audius.co/v1'
const APP_NAME = 'LxSource'
const MAX_PAGE_LIMIT = 100

// Audius 搜索：GET /v1/tracks/search?query=&app_name=&limit=&offset=
// 返回 { data: [...] }，无 total 字段；分页靠 offset，下一页是否有数据用「本页是否满载」判断。
export default {
  limit: 20,
  total: 0,
  page: 0,
  allPage: 1,
  musicSearch(str, page = 1, limit) {
    const offset = (page - 1) * limit
    return httpFetch(`${AUDIUS_API}/tracks/search?query=${encodeURIComponent(str)}&app_name=${APP_NAME}&limit=${limit}&offset=${offset}`, {
      method: 'get',
      headers: { 'User-Agent': 'LX-Music-Mobile' },
    }).promise.then(({ body }) => body)
  },
  filterData(rawData) {
    const list = []
    const ids = new Set()
    for (const t of Array.isArray(rawData) ? rawData : []) {
      if (!t || !t.id || ids.has(t.id)) continue
      // 不可流式的曲（is_streamable=false）点了必然 404（音源侧也会拒），搜索列表直接不展示
      if (t.is_streamable !== true) continue
      ids.add(t.id)
      const picUrl = (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'] || t.artwork['1000x1000'])) || null
      list.push({
        id: t.id,
        name: t.title,
        singer: (t.user && t.user.name) || '',
        source: 'au',
        interval: formatPlayTime(t.duration || 0),
        meta: {
          songId: t.id,
          albumName: '',
          albumId: '',
          picUrl,
          qualitys: [{ type: '128k', size: null }, { type: '320k', size: null }],
          _qualitys: { '128k': { size: null }, '320k': { size: null } },
        },
      })
    }
    return list
  },
  search(str, page = 1, limit, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit
    if (limit > MAX_PAGE_LIMIT) limit = MAX_PAGE_LIMIT
    return this.musicSearch(str, page, limit).then(result => {
      const data = (result && result.data) || []
      const list = this.filterData(data)
      this.total = list.length < limit ? (page - 1) * limit + list.length : page * limit + 1
      this.page = page
      this.allPage = list.length < limit ? page : page + 1
      return { list, allPage: this.allPage, limit, total: this.total, source: 'au' }
    })
  },
}
