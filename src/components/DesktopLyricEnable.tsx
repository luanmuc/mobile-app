import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'

import { toast } from '@/utils/tools'

import { useI18n } from '@/lang'
import { checkDesktopLyricOverlayPermission, hideDesktopLyric, openDesktopLyricOverlayPermissionActivity, showDesktopLyric } from '@/core/desktopLyric'
import { updateSetting } from '@/core/common'
import { logger } from '@/utils/logger'

export interface DesktopLyricEnableType {
  setEnabled: (enabled: boolean) => void
}

export default forwardRef<DesktopLyricEnableType, {}>((props, ref) => {
  const t = useI18n()
  const [visible, setVisible] = useState(false)
  // const setIsShowDesktopLyric = useDispatch('common', 'setIsShowDesktopLyric')
  const confirmAlertRef = useRef<ConfirmAlertType>(null)

  useImperativeHandle(ref, () => ({
    setEnabled(enabled) {
      void handleChangeEnableDesktopLyric(enabled)
    },
  }))

  const handleShowModal = () => {
    if (visible) confirmAlertRef.current?.setVisible(true)
    else {
      setVisible(true)
      requestAnimationFrame(() => {
        confirmAlertRef.current?.setVisible(true)
      })
    }
  }
  const handleChangeEnableDesktopLyric = async(isEnable: boolean) => {
    if (isEnable) {
      try {
        await checkDesktopLyricOverlayPermission()
        await showDesktopLyric()
      } catch (err) {
        // A05-012：原为 console.log(err)，调试残留且裸打错误对象（脱敏门禁不允许）。改走 logger。
        logger.warn('桌面歌词开启失败', (err as { code?: string } | null)?.code ?? typeof err)
        handleShowModal()
        // A09-005：开启失败（无悬浮窗权限 / native 拒绝）时不能把 enable 落成 true ——
        // 设置会显示"已开启"但桌面歌词实际没显示。这里直接返回，保持原值（false）。
        return
      }
    } else await hideDesktopLyric()
    updateSetting({ 'desktopLyric.enable': isEnable })
  }

  const handleTipsCancel = () => {
    updateSetting({ 'desktopLyric.enable': false })
    toast(t('disagree_tip'), 'long')
  }
  const handleTipsConfirm = () => {
    confirmAlertRef.current?.setVisible(false)
    void openDesktopLyricOverlayPermissionActivity()
  }

  return (
    visible
      ? (
          <ConfirmAlert
            ref={confirmAlertRef}
            onCancel={handleTipsCancel}
            onConfirm={handleTipsConfirm}
            bgHide={false}
            closeBtn={false}
            cancelText={t('disagree')}
            confirmText={t('agree_go')}
            text={t('setting_lyric_desktop_permission_tip')} />
        )
      : null
  )
})
