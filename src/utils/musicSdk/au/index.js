import { apis } from '../api-source'
import musicSearch from './musicSearch'
import hotSearch from './hotSearch'

// Audius 平台适配：搜索/热搜走 api.audius.co；取链走音源插件上报的 au handler（音源仓 v9.3.0+）。
// Audius 无榜单/歌单/评论接口 → 以下 stub 一律抛 NO_*，由调用方现有 catch/受控分支处理。
const noImpl = (code) => async() => { throw new Error(code) }
const noImplArgs = (code) => async(..._args) => { throw new Error(code) }
const getPic = async(songInfo) => (songInfo && songInfo.meta && songInfo.meta.picUrl) || null

const au = {
  musicSearch,
  hotSearch,
  songList: {
    sortList: [],
    getTags: noImpl('NO_SONGLIST'),
    search: noImplArgs('NO_SONGLIST'),
    getList: noImplArgs('NO_SONGLIST'),
    getListDetail: noImplArgs('NO_SONGLIST'),
  },
  leaderboard: { getBoards: noImpl('NO_LEADERBOARD'), getList: noImplArgs('NO_LEADERBOARD') },
  comment: { getHotComment: noImplArgs('NO_COMMENT'), getComment: noImplArgs('NO_COMMENT') },
  getMusicUrl(songInfo, type, traceId) {
    return apis('au').getMusicUrl(songInfo, type, traceId)
  },
  // R82 P1：调用方 `src/core/music/utils.ts:699/734` 取的是 `.promise`（httpFetch 形态），
  // 原来直接 return 裸 Promise → `undefined.then` 抛 TypeError（try 只包了赋值，异常外泄）。
  // 语义保持「Audius 无歌词接口 → 空歌词」：调用方 existTimeExp 判空后走换源找歌词。
  getLyric() {
    return {
      promise: Promise.resolve({ lyric: '', rawlrc: '' }),
      cancelHttp() {},
    }
  },
  getPic,
  getMusicDetailPageUrl(songInfo) {
    return `https://audius.co/tracks/${songInfo.id}`
  },
}

export default au
