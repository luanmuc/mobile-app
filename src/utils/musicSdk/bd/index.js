import leaderboard from './leaderboard'
import { apis } from '../api-source'
import musicInfo from './musicInfo'
import songList from './songList'
import { httpFetch } from '../../request'
import musicSearch from './musicSearch'
import hotSearch from './hotSearch'

const bd = {
  leaderboard,
  songList,
  musicSearch,
  hotSearch,
  getMusicUrl(songInfo, type) {
    return apis('bd').getMusicUrl(songInfo, type)
  },
  getPic(songInfo) {
    const requestObj = this.getMusicInfo(songInfo)
    // A07-022：上游解析不出 songinfo 时 info 为 undefined，读 .pic_premium 会 TypeError。
    return requestObj.promise.then(info => {
      if (!info) throw new Error('获取封面地址失败')
      return info.pic_premium
    })
  },
  getLyric(songInfo) {
    const requestObj = this.getMusicInfo(songInfo)
    // A07-022：同理，info 或 lrclink 缺失时不能直接拿去 httpFetch。
    requestObj.promise = requestObj.promise.then(info => {
      if (!info || !info.lrclink) return Promise.reject(new Error('获取歌词地址失败'))
      return httpFetch(info.lrclink).promise.then(resp => ({ lyric: resp.body, tlyric: '' }))
    })
    return requestObj
  },
  // getLyric(songInfo) {
  //   return apis('bd').getLyric(songInfo)
  // },
  // getPic(songInfo) {
  //   return apis('bd').getPic(songInfo)
  // },
  getMusicInfo(songInfo) {
    return musicInfo.getMusicInfo(songInfo.songmid)
  },
  getMusicDetailPageUrl(songInfo) {
    return `http://music.taihe.com/song/${songInfo.songmid}`
  },
}

export default bd
