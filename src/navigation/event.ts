import { type EmitterSubscription } from 'react-native'
import { Navigation } from 'react-native-navigation'


export const onModalDismissed = (id: string, handler: () => void) => {
  let modalDismissedListener: EmitterSubscription | null = Navigation.events().registerModalDismissedListener(({ componentId, modalsDismissed }) => {
    if (componentId != id || !modalDismissedListener) return
    handler()
    modalDismissedListener.remove()
    modalDismissedListener = null
  })
  return () => {
    if (!modalDismissedListener) return
    modalDismissedListener.remove()
    modalDismissedListener = null
  }
}

/**
 * A10-001：监听**任意** overlay 关闭，把被关闭的 componentId 传给 handler。
 * 用于「先打开 overlay、之后才知道它真实 componentId」的场景：
 * showSyncModeModal() 是异步 push，componentId 要等 SyncModeModal 挂载后 useEffect 回填，
 * 打开那一刻同步读到的是刚被清空的 ''，拿它注册 onModalDismissed 永远匹配不上（Promise 永挂）。
 */
export const onAnyModalDismissed = (handler: (componentId: string) => void) => {
  let modalDismissedListener: EmitterSubscription | null = Navigation.events().registerModalDismissedListener(({ componentId }) => {
    if (!modalDismissedListener) return
    handler(componentId)
  })
  return () => {
    if (!modalDismissedListener) return
    modalDismissedListener.remove()
    modalDismissedListener = null
  }
}
