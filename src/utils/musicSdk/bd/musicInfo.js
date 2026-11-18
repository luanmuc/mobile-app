import { httpFetch } from '../../request'

export default {
  cache: {},
  getMusicInfo(songmid) {
    if (this.cache[songmid]) {
      return { promise: Promise.resolve(this.cache[songmid]) }
    }
    const requestObj = httpFetch(`https://musicapi.qianqian.com/v1/restserver/ting?method=baidu.ting.song.getSongLink&format=json&from=bmpc&version=1.0.0&version_d=11.1.6.0&songid=${songmid}&type=1&res=1&s_protocol=1&aac=2&project=tpass`)
    requestObj.promise = requestObj.promise.then(({ body }) => {
      // console.log(body)
      if (body.error_code == 22000) {
        // A07-022：error_code 正常但 result 缺失（接口降级/风控页）时，body.result.songinfo 会 TypeError。
        const info = body.result && body.result.songinfo
        if (!info) return Promise.reject(new Error('获取音乐信息失败'))
        this.cache[songmid] = info
        return info
      }
      return Promise.reject(new Error('获取音乐信息失败'))
    })
    return requestObj
  },
}
