import { memo, useState, useCallback, useEffect } from 'react'
import { TouchableOpacity, View, ScrollView } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import type { SettingScreenIds } from '../Main'
import GroupBasic from '../settings/Basic'
import GroupPlayer from '../settings/Player'
import GroupLyricDesktop from '../settings/LyricDesktop'
import GroupSearch from '../settings/Search'
import GroupList from '../settings/List'
import GroupCleanCache from '../settings/CleanCache'
import GroupLog from '../settings/Log'
import GroupAbout from '../settings/About'
import Version from '../settings/Version'
import { getPlayCount } from '@/core/player/playCount'

const formatPlayTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${m} 分钟`
}

const PlayCountBlock = memo(() => {
  const [playCount, setPlayCount] = useState(getPlayCount())
  useEffect(() => {
    // 组件可见期间定时刷新统计（与 core 结算周期 playCount.ts 的 10 秒对齐）
    const timer = setInterval(() => {
      setPlayCount(getPlayCount())
    }, 10000)
    return () => { clearInterval(timer) }
  }, [])

  return (
    <View style={styles.playCountBlock}>
      <Text size={13} color={'#999'}>
        听歌统计：累计播放 {playCount.playedCount} 次 · 今日 {playCount.dayCount} 次 · 累计播放时长约 {formatPlayTime(playCount.playTime)}
      </Text>
    </View>
  )
})

// 竖屏（手机）设置页：二级结构 + 首页直接展开区
// 第一层：分组列表（点击进入二级页），自定义音源 / 软件更新直接在首页展开
// 第二层：分组详情页（返回条在右上角）
const GROUP_LIST: SettingScreenIds[] = ['basic', 'player', 'lyric_desktop', 'search', 'list', 'clean_cache', 'log', 'about']

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const [activeId, setActiveId] = useState<SettingScreenIds | null>(null)

  // 分组详情页时，系统返回键优先返回分组列表
  useBackHandler(useCallback(() => {
    if (activeId != null) {
      setActiveId(null)
      return true
    }
    return false
  }, [activeId]))

  if (activeId == null) {
    // 首页：分组列表 + 自定义音源/软件更新直接展开
    return (
      <ScrollView style={styles.page} keyboardShouldPersistTaps={'always'}>
        {GROUP_LIST.map((item, index) => (
          <TouchableOpacity
            key={item}
            style={{ ...styles.listItem, borderBottomColor: theme['c-border-background'] }}
            onPress={() => { setActiveId(item) }}
            activeOpacity={0.6}
          >
            <Text size={15} color={theme['c-font']}>{t(`setting_${item}`)}</Text>
            <Icon style={styles.listItemIcon} color={theme['c-font-label']} name="chevron-right" size={14} />
            {index == GROUP_LIST.length - 1 ? null : null}
          </TouchableOpacity>
        ))}
        <View style={styles.expandBlock}>
          <Version />
          <PlayCountBlock />
        </View>
      </ScrollView>
    )
  }

  // 第二层：分组内容 + 返回条（右上角）
  return (
    <ScrollView style={styles.page} keyboardShouldPersistTaps={'always'}>
      <View style={styles.backBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { setActiveId(null) }} activeOpacity={0.6}>
          <Icon style={styles.backIcon} color={theme['c-primary']} name="chevron-left" size={16} />
          <Text size={14} color={theme['c-primary']}>{t('back')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.detailContent}>
        <SettingGroup id={activeId} />
      </View>
    </ScrollView>
  )
})

const SettingGroup = memo(({ id }: { id: SettingScreenIds }) => {
  switch (id) {
    case 'player': return <GroupPlayer />
    case 'lyric_desktop': return <GroupLyricDesktop />
    case 'search': return <GroupSearch />
    case 'list': return <GroupList />
    case 'clean_cache': return <GroupCleanCache />
    case 'log': return <GroupLog />
    case 'about': return <GroupAbout />
    case 'basic':
    default: return <GroupBasic />
  }
})

const styles = createStyle({
  page: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 18,
    height: 52,
    borderBottomWidth: 0.5,
  },
  listItemIcon: {
    marginLeft: 4,
  },
  expandBlock: {
    marginTop: 12,
    marginBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
  },
  playCountBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#eee',
  },
  backBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end', // 返回条靠右（右上角）
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
  },
  backIcon: {
    marginRight: 2,
  },
  detailContent: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 4,
    paddingBottom: 15,
  },
})
