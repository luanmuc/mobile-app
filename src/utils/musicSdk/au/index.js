import { apis } from '../api-source'
import musicSearch from './musicSearch'
import hotSearch from './hotSearch'
import songList from './songList'
import leaderboard from './leaderboard'

// Audius 平台适配：搜索/热搜/歌单/榜单走 api.audius.co；取链走音源插件上报的 au handler（音源仓 v9.3.0+）。
// 榜单只铺官网真实存在的 Tracks / Underground / Winners，按 18 条中文榜单收口；评论仍无接口。
const noImplArgs = (code) => async(..._args) => { throw new Error(code) }
const getPic = async(songInfo) => (songInfo && songInfo.meta && songInfo.meta.picUrl) || null

const au = {
  musicSearch,
  hotSearch,
  songList,
  leaderboard,
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
