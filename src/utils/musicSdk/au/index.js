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
  getLyric() {
    return Promise.resolve({ lyric: '', rawlrc: '' })
  },
  getPic,
  getMusicDetailPageUrl(songInfo) {
    return `https://audius.co/tracks/${songInfo.id}`
  },
}

export default au
