import { httpFetch } from '../../request'
import { formatPlayCount, formatPlayTime } from '../../index'

export const AUDIUS_API = 'https://api.audius.co/v1'
export const APP_NAME = 'LxSource'
export const MAX_LIMIT = 100
export const SONG_PAGE_LIMIT = 30

// 只取 App 侧榜单/歌单实际会用到的 12 个风格；其余风格接口仍可用，但不铺进 UI。
export const GENRES = [
  { name: '电子', value: 'Electronic' },
  { name: '嘻哈', value: 'Hip-Hop/Rap' },
  { name: '流行', value: 'Pop' },
  { name: '摇滚', value: 'Rock' },
  { name: '另类', value: 'Alternative' },
  { name: 'R&B/灵魂', value: 'R&B/Soul' },
  { name: 'Lo-Fi', value: 'Lo-Fi' },
  { name: 'House', value: 'House' },
  { name: 'Techno', value: 'Techno' },
  { name: 'Drum & Bass', value: 'Drum & Bass' },
  { name: 'Dubstep', value: 'Dubstep' },
  { name: 'Trap', value: 'Trap' },
]

const getArtwork = artwork => {
  if (!artwork) return null
  return artwork['480x480'] || artwork._480x480 ||
    artwork['150x150'] || artwork._150x150 ||
    artwork['1000x1000'] || artwork._1000x1000 || null
}

const buildUrl = (path, params) => {
  const query = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&')
  return `${AUDIUS_API}${path}${query ? `?${query}` : ''}`
}

// Audius REST API 基本免 key；统一带 app_name，失败重试 3 次（与各平台现有重试口径一致）。
export const fetchAudius = (path, params = {}, retryNum = 0) => {
  const request = httpFetch(buildUrl(path, { app_name: APP_NAME, ...params }), {
    method: 'get',
    headers: { 'User-Agent': 'LX-Music-Mobile' },
  })
  return request.promise.then(({ statusCode, body }) => {
    if (statusCode !== 200) throw new Error(`Audius HTTP ${statusCode}`)
    if (!body || (body.error && !body.data)) throw new Error('Audius response error')
    return body.data
  }).catch(error => {
    if (retryNum >= 2) throw error
    return fetchAudius(path, params, retryNum + 1)
  })
}

export const filterTrack = track => {
  if (!track || !track.id) return null
  // 不可流式的曲点了必然 404（音源侧也会拒），榜单/歌单直接不展示
  if (track.is_streamable !== true) return null
  return {
    songmid: track.id,
    name: track.title || '',
    singer: (track.user && track.user.name) || '',
    source: 'au',
    albumId: '',
    albumName: '',
    interval: formatPlayTime(Number(track.duration) || 0),
    lrc: null,
    img: getArtwork(track.artwork),
    otherSource: null,
    types: [{ type: '128k', size: null }, { type: '320k', size: null }],
    _types: { '128k': { size: null }, '320k': { size: null } },
    typeUrl: {},
  }
}

export const filterTracks = rawList => {
  const list = []
  const ids = new Set()
  for (const track of Array.isArray(rawList) ? rawList : []) {
    if (!track || !track.id || ids.has(track.id)) continue
    const item = filterTrack(track)
    if (!item) continue
    ids.add(track.id)
    list.push(item)
  }
  return list
}

export const filterPlaylist = playlist => {
  if (!playlist || !playlist.id || !playlist.playlist_name) return null
  if (playlist.is_album === true || playlist.is_delete === true || playlist.is_private === true || playlist.is_stream_gated === true) return null
  return {
    play_count: formatPlayCount(Number(playlist.total_play_count) || 0),
    id: playlist.id,
    author: (playlist.user && playlist.user.name) || '',
    name: playlist.playlist_name,
    total: Number(playlist.track_count) || 0,
    img: getArtwork(playlist.artwork),
    desc: playlist.description || '',
    source: 'au',
  }
}

export const filterPlaylists = rawList => {
  const list = []
  const ids = new Set()
  for (const playlist of Array.isArray(rawList) ? rawList : []) {
    if (!playlist || !playlist.id || ids.has(playlist.id)) continue
    const item = filterPlaylist(playlist)
    if (!item) continue
    ids.add(playlist.id)
    list.push(item)
  }
  return list
}

export const toPlaylistInfo = playlist => ({
  name: playlist ? playlist.playlist_name || '' : '',
  img: playlist ? getArtwork(playlist.artwork) : null,
  desc: playlist ? playlist.description || '' : '',
  author: playlist ? (playlist.user && playlist.user.name) || '' : '',
  play_count: playlist ? formatPlayCount(Number(playlist.total_play_count) || 0) : '0',
})
