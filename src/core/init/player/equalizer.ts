import { applyEqualizer } from '@/core/player/equalizer'

/**
 * 均衡器：设置变化时实时落盘到原生。
 * 起播时的那次应用在 core/player/player.ts 的 handlePlay 里（必须等播放器起来拿到 audioSessionId）。
 */
export default () => {
  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (keys.includes('player.equalizer.enable') || keys.includes('player.equalizer.bands')) {
      void applyEqualizer()
    }
  }
  global.state_event.on('configUpdated', handleConfigUpdated)
}
