import { dismissOverlay, onAnyModalDismissed, showSyncModeModal } from '@/navigation'
import syncState from '@/store/sync/state'
import syncActions from '@/store/sync/action'

type RemoveListener = (() => void) | null
let removeEvent: RemoveListener

export const setSyncStatus = (status: LX.Sync.Status) => {
  syncActions.setStatus(status)
}

export const setSyncMessage = (message: LX.Sync.Status['message']) => {
  syncActions.setMessage(message)
}

export const setSyncModeComponentId = (id: string) => {
  syncActions.setSyncModeComponentId(id)
}

const closeSyncModeModal = () => {
  if (syncState.syncModeComponentId) {
    void dismissOverlay(syncState.syncModeComponentId)
    syncActions.setSyncModeComponentId('')
  }
}
export const selectSyncMode = async<T extends keyof LX.Sync.ModeTypes>(serverName: string, type: T) => new Promise<LX.Sync.ModeTypes[T]>((resolve, reject) => {
  removeSyncModeEvent()
  syncActions.setServerInfo(serverName, type)
  showSyncModeModal()

  const removeListeners = () => {
    removeListener!()
    removeListener = null
    removeEvent = null
    global.app_event.off('selectSyncMode', handleSelectMode)
  }

  const handleSelectMode = ({ mode }: LX.Sync.ModeType) => {
    removeListeners()
    closeSyncModeModal()
    resolve(mode as LX.Sync.ModeTypes[T])
  }

  removeEvent = () => {
    removeListeners()
    reject(new Error('cancel'))
  }

  global.app_event.on('selectSyncMode', handleSelectMode)

  // A10-001：原实现用「打开前读到的 componentId」注册 onModalDismissed —— 但 showSyncModeModal()
  // 是异步 push，真实 componentId 要等 SyncModeModal 挂载后由 useEffect 回填；此处同步读到的是
  // 刚被 closeSyncModeModal 清空的 ''，于是监听永远匹配不上真实 id，用户点关闭/取消时 Promise 永挂。
  // 改为监听任意 overlay 关闭，再比对「被关的是不是本次打开的 sync 弹窗」。
  let removeListener: RemoveListener = onAnyModalDismissed((dismissedId) => {
    if (dismissedId !== syncState.syncModeComponentId) return
    syncActions.setSyncModeComponentId('')
    removeEvent?.()
  })
})

export const removeSyncModeEvent = () => {
  if (!removeEvent) return
  removeEvent()
  removeEvent = null
  closeSyncModeModal()
}
