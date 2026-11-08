import { syncPlayState } from '@/core/player/playCount'
import playerActions from '@/store/player/action'
import playerState from '@/store/player/state'


export const setIsPlay = (val: boolean) => {
  if (playerState.isPlay == val) return
  playerActions.setIsPlay(val)
  // 听歌统计：所有播放状态变化都从这里出去，在这里结算最不容易漏
  syncPlayState(val)
}


export const setStatusText = (val: string) => {
  if (playerState.statusText == val) return
  playerActions.setStatusText(val)
}
