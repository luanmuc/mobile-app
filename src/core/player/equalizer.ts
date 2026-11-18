import settingState from '@/store/setting/state'
import { applyBands, bind, isSupported, release, setEnabled } from '@/plugins/equalizer'
import { getAudioSessionId } from '@/plugins/player'
import { normalizeBandsCsv } from './equalizerBands'

/**
 * 均衡器控制器（单例）。
 *
 * 关键约束（真机上踩过就会懂的）：
 * 1. **必须先起播再绑定**：ExoPlayer 未起播时 audioSessionId 是 0，用 0 建 Equalizer 会抛异常。
 * 2. **sessionId 变了要重建**：换输出设备 / 重建播放器会换会话，旧 Equalizer 挂在死会话上不生效。
 * 3. **只开不绑是无效的**：enable=true 但没绑会话时静默跳过，等下一次 applyEqualizer（下一次起播）。
 * 4. 关闭开关时只 setEnabled(false)，**不 release** —— 重新打开能立刻生效，省一次会话绑定。
 */

let boundSessionId = 0
// 串行化闸：applyEqualizer 里有 await（getAudioSessionId / bind / applyBands），
// 两次并发调用会各自读到旧的 boundSessionId 并重复 bind。这里用闸把并发改成「后者直接跳过」，
// 跳过是安全的——先到的那次已经按同一份设置应用过了。
const gate = { applying: false }

export const isEqualizerSupported = (): boolean => isSupported()

/** 换会话/退出时释放（只在该模块不可用时调用，正常切歌不需要） */
export const releaseEqualizer = async(): Promise<void> => {
  boundSessionId = 0
  await release()
}

/**
 * 按当前设置把均衡器落到播放器上。
 * 返回是否真正生效（false = 不可用 / 未起播 / 开关关闭 / 绑定失败）。
 */
export const applyEqualizer = async(): Promise<boolean> => {
  if (!isSupported()) return false
  if (gate.applying) return false
  gate.applying = true
  try {
    return await applyEqualizerInternal()
  } finally {
    gate.applying = false
  }
}

const applyEqualizerInternal = async(): Promise<boolean> => {
  if (!settingState.setting['player.equalizer.enable']) {
    // 关闭态：确保系统 effect 不再染色（不 release，保留会话）
    if (boundSessionId != 0) await setEnabled(false)
    return false
  }
  const sessionId = await getAudioSessionId()
  if (sessionId <= 0) return false
  if (sessionId != boundSessionId) {
    const ok = await bind(sessionId)
    if (!ok) return false
    // applying 闸保证同一时刻只有一次 apply 在跑，这里的赋值不存在并发覆盖；
    // 规则 require-atomic-updates 无法感知这把闸，故显式豁免并留下理由。
    // eslint-disable-next-line require-atomic-updates
    boundSessionId = sessionId
  }
  const applied = await applyBands(normalizeBandsCsv(settingState.setting['player.equalizer.bands']))
  if (!applied) return false
  await setEnabled(true)
  return true
}

/** 设置面板拖动时实时试听（不写设置，只推电平） */
export const previewEqualizerBands = async(csv: string): Promise<boolean> => {
  if (!isSupported() || boundSessionId == 0) return false
  return applyBands(normalizeBandsCsv(csv))
}
