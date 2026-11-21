import { SYNC_CLOSE_CODE } from '@/plugins/sync/constants'
import { registerDislikeActionEvent } from '../../../dislikeEvent'
import { logger, toLogText } from '@/utils/logger'

let unregisterLocalListAction: (() => void) | null

export const registerEvent = (socket: LX.Sync.Socket) => {
  // socket = _socket
  // socket.onClose(() => {
  //   unregisterLocalListAction?.()
  //   unregisterLocalListAction = null
  // })
  unregisterEvent()
  unregisterLocalListAction = registerDislikeActionEvent((action) => {
    if (!socket.moduleReadys?.dislike) return
    void socket.remoteQueueDislike.onDislikeSyncAction(action).catch(err => {
      // TODO send status
      socket.moduleReadys.dislike = false
      socket.close(SYNC_CLOSE_CODE.failed)
      logger.warn('Sync', toLogText(err))
    })
  })
}

export const unregisterEvent = () => {
  unregisterLocalListAction?.()
  unregisterLocalListAction = null
}
