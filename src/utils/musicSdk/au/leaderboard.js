import { GENRES, MAX_LIMIT, fetchAudius, filterTracks } from './utils'

const slug = value => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const TRACK_BOARDS = [
  { code: 'week_all', name: '本周热歌榜', kind: 'tracks', time: 'week' },
  { code: 'month_all', name: '本月热歌榜', kind: 'tracks', time: 'month' },
  { code: 'allTime_all', name: '历史热歌榜', kind: 'tracks', time: 'allTime' },
]

const FIXED_BOARDS = [
  { code: 'underground', name: '地下榜', kind: 'underground' },
  { code: 'winners', name: '优胜单曲榜', kind: 'winners', path: '/tracks/trending/winners' },
  { code: 'winners_underground', name: '地下优胜榜', kind: 'winners', path: '/tracks/trending/underground/winners' },
]

// 官网 Tracks 的 3 个时间 × 12 个常用风格；其余 39 个风格不铺，避免榜单侧栏膨胀到 159 条。
const GENRE_BOARDS = GENRES.map(({ name, value }) => ({
  code: `week_${slug(value)}`,
  name: `${name}榜`,
  kind: 'genre',
  time: 'week',
  genre: value,
}))

const boardDefs = [...TRACK_BOARDS, ...FIXED_BOARDS, ...GENRE_BOARDS]

const boardList = boardDefs.map(board => ({
  id: `au__${board.code}`,
  name: board.name,
  bangid: board.code,
  source: 'au',
}))

const boardMap = new Map(boardDefs.map(board => [board.code, board]))

export default {
  limit: MAX_LIMIT,
  list: boardList,

  getBoards() {
    return Promise.resolve({
      list: boardList,
      source: 'au',
    })
  },

  getList(bangid, page) {
    const board = boardMap.get(bangid)
    if (!board) return Promise.reject(new Error('UNKNOWN_BOARD'))

    let path
    let params
    let limit = MAX_LIMIT
    switch (board.kind) {
      case 'winners':
        path = board.path
        params = {}
        limit = 10
        break
      case 'underground':
        path = '/tracks/trending/underground'
        params = { limit }
        break
      case 'genre':
        path = '/tracks/trending'
        params = { time: board.time, genre: board.genre, limit }
        break
      default:
        path = '/tracks/trending'
        params = { time: board.time, limit }
    }

    return fetchAudius(path, params).then(data => {
      const list = filterTracks(data)
      return {
        total: list.length,
        list,
        limit,
        page,
        source: 'au',
      }
    })
  },
}
