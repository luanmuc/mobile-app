import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { FULL_QUALITYS_LIST } from '@/core/music/utils'
import { useI18n } from '@/lang'

export const QUALITY_NAMES: Record<string, string> = {
  flac24bit: 'quality_flac24bit',
  flac: 'quality_flac',
  '320k': 'quality_320k',
  '128k': 'quality_128k',
  '192k': 'quality_192k',
  ape: 'quality_ape',
  wav: 'quality_wav',
}

export interface QualitySelectType {
  show: (musicInfo: LX.Music.MusicInfoOnline) => void
}
interface Props {
  onConfirm: (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => void
}

export default forwardRef<QualitySelectType, Props>(({ onConfirm }, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const [visible, setVisible] = useState(false)
  const popupRef = useRef<PopupType>(null)
  const musicInfoRef = useRef<LX.Music.MusicInfoOnline | null>(null)
  const [quality, setQuality] = useState<LX.Quality>('flac24bit')

  useImperativeHandle(ref, () => ({
    show(musicInfo) {
      musicInfoRef.current = musicInfo
      // 获取当前歌曲实际支持的音质列表
      const supportedQualitys = (musicInfo.meta?._qualitys || {}) as Record<string, boolean>
      // 按高到低排列，只保留实际支持的（含 192k/ape/wav 等完整音质）
      const available = FULL_QUALITYS_LIST.filter(q => supportedQualitys[q])
      // 默认选最高的可用音质
      setQuality(available[0] || '128k')
      setVisible(true)
      requestAnimationFrame(() => {
        popupRef.current?.setVisible(true)
      })
    },
  }))

  const handleConfirm = () => {
    if (!musicInfoRef.current) return
    onConfirm(musicInfoRef.current, quality)
    popupRef.current?.setVisible(false)
    setVisible(false)
  }

  const handleHide = () => {
    setVisible(false)
  }

  return (
    visible
      ? (
          <Popup
            ref={popupRef}
            title={t('dl_quality_select_title')}
            onHide={handleHide}
            bgHide
            closeBtn
          >
            <View style={styles.content}>
              <Text size={13} color={theme['c-font-label']} style={styles.tip}>{t('dl_quality_select_tip')}</Text>
              {
                // 只显示当前歌曲实际支持的音质（完整音质列表）
                (() => {
                  const musicInfo = musicInfoRef.current
                  if (!musicInfo) return null
                  const supported = (musicInfo.meta?._qualitys || {}) as Record<string, boolean>
                  const availableList = FULL_QUALITYS_LIST.filter(q => supported[q])
                  return availableList.map((q) => {
                    const isActive = quality == q
                    const nameKey = QUALITY_NAMES[q]
                    return (
                      <TouchableOpacity
                        key={q}
                        style={styles.item}
                        onPress={() => { setQuality(q) }}
                      >
                        <Text
                          size={14}
                          style={styles.itemText}
                          color={isActive ? theme['c-primary'] : theme['c-font']}
                        >{nameKey ? t(nameKey as Parameters<typeof t>[0]) : q}</Text>
                        {
                          isActive
                            ? <Text size={14} color={theme['c-primary']}>✓</Text>
                            : null
                        }
                      </TouchableOpacity>
                    )
                  })
                })()
              }
              <View style={styles.footer}>
                <Button
                  style={styles.footerBtn}
                  onPress={() => {
                    popupRef.current?.setVisible(false)
                    setVisible(false)
                  }}
                >
                  <Text color={theme['c-font-label']} size={14}>{t('dl_quality_cancel')}</Text>
                </Button>
                <Button style={styles.footerBtn} onPress={handleConfirm}>
                  <Text color={theme['c-primary-font']} size={14}>{t('dl_quality_start')}</Text>
                </Button>
              </View>
            </View>
          </Popup>
        )
      : null
  )
})

const styles = createStyle({
  content: {
    minWidth: 260,
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 10,
    paddingBottom: 15,
  },
  tip: {
    marginBottom: 8,
    lineHeight: 18,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 9,
    paddingBottom: 9,
    paddingLeft: 10,
    paddingRight: 10,
  },
  itemText: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  footerBtn: {
    marginLeft: 10,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 7,
    paddingBottom: 7,
  },
})
