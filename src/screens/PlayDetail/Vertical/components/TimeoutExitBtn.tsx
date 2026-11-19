import { memo, useRef } from 'react'
import TimeoutExitEditModal, { type TimeoutExitEditModalType, useTimeInfo } from '@/components/TimeoutExitEditModal'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Btn from './Btn'


export default memo(() => {
  const theme = useTheme()
  const modalRef = useRef<TimeoutExitEditModalType>(null)

  const timeInfo = useTimeInfo()
  const t = useI18n()

  const handleShow = () => {
    modalRef.current?.show()
  }

  return (
    <>
      <Btn
        label={t('play_detail_header_timer')}
        color={timeInfo.active ? theme['c-primary-font-active'] : undefined}
        bgColor={timeInfo.active ? theme['c-primary-alpha-300'] : undefined}
        onPress={handleShow}
      />
      <TimeoutExitEditModal ref={modalRef} timeInfo={timeInfo} />
    </>
  )
})
