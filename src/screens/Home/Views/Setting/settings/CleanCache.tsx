import { memo, useState, useEffect, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'
import { toast, confirmDialog } from '@/utils/tools'
import { getAppCacheSize, clearAppCache } from '@/utils/nativeModules/cache'
import { getCacheSize, clearCache } from '@/plugins/player/utils'
import { getMetaCache, clearMusicUrl, clearOtherSource, clearLyric, clearEditedLyric } from '@/utils/data'
import { clearLogs } from '@/utils/log'
import { sizeFormate } from '@/utils'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'

// 独立"清理缓存"页：一键清理全部缓存 + 各单项清理（资源/播放/链接/歌词/其他源/日志）
export default memo(() => {
  const t = useI18n()
  const [cleaning, setCleaning] = useState(false)
  const [cacheSize, setCacheSize] = useState<string | null>(null)
  const [metaInfo, setMetaInfo] = useState<{
    otherSourceKeys: string[]
    lyricKeys: string[]
  }>({ otherSourceKeys: [], lyricKeys: [] })

  const handleGetSize = useCallback(() => {
    void Promise.all([getAppCacheSize(), getCacheSize()]).then(([size, size2]) => {
      const count = size + size2
      setCacheSize(sizeFormate(count))
    })
    void getMetaCache().then(info => {
      setMetaInfo(info)
    })
  }, [])

  useEffect(() => {
    handleGetSize()
  }, [handleGetSize])

  const confirmClean = (action: () => Promise<unknown>) => {
    void confirmDialog({
      message: t('confirm_tip'),
      confirmButtonText: t('list_remove_tip_button'),
    }).then(confirm => {
      if (!confirm) return
      void action().then(() => {
        toast(t('setting_other_cache_clear_success_tip'))
      }).finally(() => {
        handleGetSize()
      })
    })
  }

  // 一键清理全部缓存
  const handleCleanAll = () => {
    if (cacheSize == null) return
    void confirmDialog({
      message: t('confirm_tip'),
      confirmButtonText: t('list_remove_tip_button'),
    }).then(confirm => {
      if (!confirm) return
      setCleaning(true)
      void Promise.all([
        clearAppCache(),
        clearCache(),
        clearMusicUrl(),
        clearOtherSource(),
        clearLyric(),
        clearEditedLyric(),
        clearLogs(),
      ]).then(() => {
        toast(t('setting_other_cache_clear_success_tip'))
      }).finally(() => {
        handleGetSize()
        setCleaning(false)
      })
    })
  }

  return (
    <Section title={t('setting_clean_cache')}>
      <SubTitle title={t('setting_clean_cache_all')}>
        <View style={styles.cacheSize}>
          <Text>{cacheSize == null ? t('setting_other_cache_getting') : t('setting_other_cache_size') + cacheSize}</Text>
        </View>
        <View style={styles.btnRow}>
          <Button disabled={cleaning} onPress={handleCleanAll}>{t('setting_other_cache_clear_btn')}</Button>
        </View>
      </SubTitle>

      <SubTitle title={t('setting__other_resource_cache')}>
        <View style={styles.btnRow}>
          <Button onPress={() => {
            confirmClean(async() => {
              await clearAppCache()
              await clearCache()
            })
          }}>{t('setting_other_cache_clear_btn')}</Button>
        </View>
      </SubTitle>

      <SubTitle title={t('setting_clean_cache_url')}>
        <View style={styles.btnRow}>
          <Button onPress={() => { confirmClean(clearMusicUrl) }}>{t('setting_other_cache_clear_btn')}</Button>
        </View>
      </SubTitle>

      <SubTitle title={t('setting_clean_cache_lyric')}>
        <View style={styles.btnRow}>
          <Button onPress={() => {
            confirmClean(async() => {
              await clearLyric()
              await clearEditedLyric()
            })
          }}>{t('setting_other_cache_clear_btn')}</Button>
        </View>
      </SubTitle>

      <SubTitle title={t('setting_clean_cache_other_source')}>
        <View style={styles.btnRow}>
          <Button onPress={() => { confirmClean(clearOtherSource) }}>{t('setting_other_cache_clear_btn')}</Button>
        </View>
        {
          metaInfo.otherSourceKeys.length || metaInfo.lyricKeys.length
            ? <Text size={12} style={styles.metaTip}>{`${metaInfo.otherSourceKeys.length} + ${metaInfo.lyricKeys.length}`}</Text>
            : null
        }
      </SubTitle>

    </Section>
  )
})

const styles = StyleSheet.create({
  cacheSize: {
    marginBottom: 5,
  },
  btnRow: {
    flexDirection: 'row',
  },
  metaTip: {
    marginTop: 5,
  },
})
