import { GENRES, MAX_LIMIT, SONG_PAGE_LIMIT, fetchAudius, filterPlaylists, filterTracks, toPlaylistInfo } from './utils'

const playlistCache = new Map()
const MAX_PLAYLIST_CACHE = 20

const setPlaylistCache = (id, value) => {
  if (playlistCache.size >= MAX_PLAYLIST_CACHE && !playlistCache.has(id)) {
    const oldest = playlistCache.keys().next().value
    if (oldest != null) playlistCache.delete(oldest)
  }
  playlistCache.set(id, value)
}

// 歌单页只保留一个「推荐」排序：Audius 官网 Explore 并不是歌单榜单，
// playlists/trending 是它真实可用的原生推荐流，不伪造「本周/本月」榜单语义。
export default {
  limit_list: SONG_PAGE_LIMIT,
  limit_song: SONG_PAGE_LIMIT,
  sortList: [
    {
      name: '推荐',
      tid: 'recommend',
      id: 'week',
    },
  ],

  getTags() {
    const list = GENRES.map(({ name, value }) => ({
      parent_id: 'genre',
      parent_name: '风格',
      id: value,
      name,
      source: 'au',
    }))
    return Promise.resolve({
      tags: [{ name: '风格', list }],
      hotTag: list.slice(0, 8),
      source: 'au',
    })
  },

  getList(sortId, tagId, page) {
    const offset = (page - 1) * this.limit_list
    const path = tagId ? '/playlists/search' : '/playlists/trending'
    const time = ['week', 'month', 'year'].includes(sortId) ? sortId : 'week'
    const params = tagId
      ? { genre: tagId, sort_method: 'popular', limit: this.limit_list, offset }
      : { time, limit: this.limit_list, offset }

    return fetchAudius(path, params).then(data => {
      const list = filterPlaylists(data)
      // 该接口不返回 total；用「本页是否满载」判断是否还有下一页，下一页为空即自然收口。
      const total = offset + list.length + (Array.isArray(data) && data.length >= this.limit_list ? 1 : 0)
      return {
        list,
        total,
        page,
        limit: this.limit_list,
        source: 'au',
      }
    })
  },

  search(text, page, limit = 20) {
    const query = typeof text === 'string' ? text.trim() : ''
    if (!query) {
      return Promise.resolve({ list: [], total: 0, limit, source: 'au' })
    }
    if (limit > MAX_LIMIT) limit = MAX_LIMIT
    const offset = (page - 1) * limit
    return fetchAudius('/playlists/search', {
      query,
      sort_method: 'popular',
      limit,
      offset,
    }).then(data => {
      const list = filterPlaylists(data)
      const total = offset + list.length + (Array.isArray(data) && data.length >= limit ? 1 : 0)
      return {
        list,
        total,
        limit,
        source: 'au',
      }
    })
  },

  async getPlaylist(id) {
    const cached = playlistCache.get(id)
    if (cached) return cached

    const detailTask = fetchAudius(`/playlists/${encodeURIComponent(id)}`).catch(() => null)
    const tracksTask = fetchAudius(`/playlists/${encodeURIComponent(id)}/tracks`)
    const [detail, tracks] = await Promise.all([detailTask, tracksTask])
    const rawPlaylist = Array.isArray(detail) ? detail[0] : detail
    const result = {
      list: filterTracks(tracks),
      info: toPlaylistInfo(rawPlaylist),
    }
    setPlaylistCache(id, result)
    return result
  },

  getListDetail(id, page) {
    return this.getPlaylist(id).then(playlist => {
      const offset = (page - 1) * this.limit_song
      return {
        list: playlist.list.slice(offset, offset + this.limit_song),
        page,
        limit: this.limit_song,
        total: playlist.list.length,
        source: 'au',
        info: playlist.info,
      }
    })
  },
}
