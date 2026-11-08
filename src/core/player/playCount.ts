// 听歌统计（借鉴 MusicFree 听歌统计）：
// 累计开始播放次数、累计播放时长、今日播放次数、今日播放时长，持久化到本地
//
// 口径（2026-11-08 二次修正）：
// - 播放时长按**真实时间差**累加（不再每 30 秒固定 +30），暂停/恢复不会因相位错位多算
// - 未满 1 秒的余数跨暂停保留（carryMs），不再每次暂停都丢掉零头
// - 缓冲/加载期间不计时：插件层已把 Buffering 映射成 app_event.pause()（service.ts）
// - 今日次数/今日时长在 flush 内检查日期，跨天即使一直在播也会归零
// - 结算周期 10 秒 + 切后台立即结算，进程被杀最多丢 10 秒
// - 播放次数按**曲目变化**计一次，暂停后恢复同一首不再重复计数
import RNFS from 'react-native-fs'
import { AppState } from 'react-native'
import playerState from '@/store/player/state'

interface PlayCountData {
  playedCount: number // 累计开始播放次数
  playTime: number // 累计播放时长（秒）
  dayTime: number // 今日播放时长（秒）
  date: string // 记录日期（按天重置 dayCount / dayTime）
  dayCount: number // 今日播放次数
}

const FILE = `${RNFS.DocumentDirectoryPath}/playCount.json`

let data: PlayCountData = {
  playedCount: 0,
  playTime: 0,
  dayTime: 0,
  date: '',
  dayCount: 0,
}

let timer: ReturnType<typeof setInterval> | null = null
let appStateSub: { remove: () => void } | null = null
// 当前这一段播放的起点（毫秒）；null 表示当前不在计时
let playingSince: number | null = null
// 暂停时保留下来的不足 1 秒的余数（毫秒），恢复播放时接回去，避免每次都丢零头
let carryMs = 0
// 已经计过数的曲目 key（`source:id`），避免暂停恢复重复计数
let lastTrackKey: string | null = null
// 初始化完成前不累计，避免旧数据未载入时把几秒写进默认值后被覆盖
let inited = false

const save = () => {
  void RNFS.writeFile(FILE, JSON.stringify(data)).catch(() => {
    // 写入失败忽略，统计不影响主流程
  })
}

// 只接受有限的非负数字，防止损坏文件把数值污染成 NaN
const clampNum = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

const ensureDate = () => {
  const today = new Date().toDateString()
  if (data.date !== today) {
    data.date = today
    data.dayCount = 0
    data.dayTime = 0
    save()
  }
}

/**
 * 把当前这段播放的真实时长结算进 playTime / dayTime。
 * 结算后把 playingSince 前移，保证同一段时间不会被重复累加；
 * 不足 1 秒的余数留在 playingSince 里继续累积，不丢弃。
 */
const flush = () => {
  if (playingSince == null) return
  // 跨天归零放在这里：定时器每 10 秒一定经过此处，避免"整夜连续播放不切歌"时日期停在昨天
  ensureDate()
  const sec = Math.floor((Date.now() - playingSince) / 1000)
  if (sec <= 0) return
  data.playTime += sec
  data.dayTime += sec
  playingSince += sec * 1000
  save()
}

const getTrackKey = () => {
  const info = playerState.playMusicInfo.musicInfo
  return info == null ? null : `${info.source ?? ''}:${info.id}`
}

/**
 * 播放状态变化入口（playStatus.setIsPlay 每次真实变化时调用）。
 * @param playing 是否处于播放中
 */
export const syncPlayState = (playing: boolean) => {
  if (!inited) return
  if (playing) {
    ensureDate()
    // 曲目变化才计一次；同一首暂停后恢复不重复计
    const key = getTrackKey()
    if (key != null && key !== lastTrackKey) {
      lastTrackKey = key
      data.playedCount += 1
      data.dayCount += 1
      save()
    }
    if (playingSince == null) {
      // 恢复播放时把上次暂停留下的余数接回去
      playingSince = Date.now() - carryMs
      carryMs = 0
    } else flush()
  } else {
    flush()
    if (playingSince != null) {
      const rest = Date.now() - playingSince
      carryMs = rest > 0 && rest < 1000 ? rest : 0
    }
    playingSince = null
    save()
  }
}

export const initPlayCount = async() => {
  try {
    if (await RNFS.exists(FILE)) {
      const saved = JSON.parse(await RNFS.readFile(FILE)) as Partial<PlayCountData> | null
      if (saved != null && typeof saved === 'object') {
        data = {
          playedCount: clampNum(saved.playedCount),
          playTime: clampNum(saved.playTime),
          // 旧存档没有 dayTime，按 0 处理，不回溯补算
          dayTime: clampNum(saved.dayTime),
          dayCount: clampNum(saved.dayCount),
          date: typeof saved.date === 'string' ? saved.date : '',
        }
      }
    }
  } catch (e) {
    // 读取失败使用默认值
  }
  ensureDate()
  inited = true
  // 每 10 秒结算一次（按真实间隔累加，不是固定 +10）
  if (timer) return
  timer = setInterval(() => {
    if (playerState.isPlay) flush()
  }, 10000)
  // 切后台/锁屏前立即结算，缩小被系统杀进程时的丢失窗口
  appStateSub = AppState.addEventListener('change', nextState => {
    if (nextState !== 'active' && playerState.isPlay) flush()
  })
}

export const getPlayCount = (): Readonly<PlayCountData> => data
