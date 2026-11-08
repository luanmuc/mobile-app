import { memo, useEffect, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS, LIST_IDS } from '@/config/constant'
import type { InitState } from '@/store/common/state'
// import { navigations } from '@/navigation'
// import commonState from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import { setActiveList } from '@/core/list'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { getPlayCount } from '@/core/player/playCount'
import { useTimeoutExitTimeInfo } from '@/core/player/timeoutExit'
import TimeoutExitEditModal, { type TimeoutExitEditModalType, useTimeInfo } from '@/components/TimeoutExitEditModal'

// 播放时长格式化：秒 → "M:SS" 或 "H:MM:SS"
const formatPlayTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

const styles = createStyle({
  container: {
    flex: 1,
    // alignItems: 'center',
    // justifyContent: 'center',
    // padding: 10,
  },
  header: {
    paddingTop: 40,
    paddingBottom: 30,
    flexDirection: 'column',
    alignItems: 'center',
  },
  statsMain: {
    textAlign: 'center',
  },
  statsSub: {
    textAlign: 'center',
    marginTop: 6,
    opacity: 0.75,
  },
  menus: {
    flex: 1,
  },
  list: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  menuItem: {
    flexDirection: 'row',
    paddingTop: 13,
    paddingBottom: 13,
    paddingLeft: 25,
    paddingRight: 25,
    alignItems: 'center',
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  iconContent: {
    width: 24,
    alignItems: 'center',
  },
  text: {
    paddingLeft: 20,
    // fontWeight: '500',
  },
})

const Header = () => {
  const t = useI18n()
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const [playCount, setPlayCount] = useState(getPlayCount())
  useEffect(() => {
    // 每 30 秒刷新一次听歌统计
    const timer = setInterval(() => setPlayCount(getPlayCount()), 30000)
    return () => clearInterval(timer)
  }, [])
  return (
    <View style={{ paddingTop: statusBarHeight, backgroundColor: theme['c-primary-light-700-alpha-500'] }}>
      <View style={styles.header}>
        <Text style={styles.statsMain} size={20} color={theme['c-primary-dark-100-alpha-300']}>
          {t('drawer_stats_total', { num: playCount.playedCount })}
        </Text>
        <Text style={styles.statsSub} size={12} color={theme['c-primary-dark-100-alpha-300']}>
          {t('drawer_stats_today', { today: playCount.dayCount, time: formatPlayTime(playCount.dayTime) })}
        </Text>
      </View>
    </View>
  )
}

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

const MenuItem = ({ id, icon, onPress }: {
  id: IdType
  icon: string
  onPress: (id: IdType) => void
}) => {
  const t = useI18n()
  const activeId = useNavActiveId()
  const theme = useTheme()

  return activeId == id
    ? <View style={styles.menuItem}>
        <View style={styles.iconContent}>
          <Icon name={icon} size={20} color={theme['c-primary-font-active']} />
        </View>
        <Text style={styles.text} color={theme['c-primary-font']}>{t(id)}</Text>
      </View>
    : <TouchableOpacity style={styles.menuItem} onPress={() => { onPress(id) }}>
        <View style={styles.iconContent}>
          <Icon name={icon} size={20} color={theme['c-font-label']} />
        </View>
        <Text style={styles.text}>{t(id)}</Text>
      </TouchableOpacity>
}

// 定时关闭菜单项：显示剩余时间（每秒更新），点击弹出设置
const TimeoutExitMenuItem = () => {
  const t = useI18n()
  const theme = useTheme()
  const modalRef = useRef<TimeoutExitEditModalType>(null)
  const timeInfo = useTimeInfo()
  const { time, isPlayedStop } = useTimeoutExitTimeInfo()

  const active = time >= 0
  const remainText = active
    ? (() => {
        const h = Math.floor(time / 3600)
        const m = Math.floor((time % 3600) / 60)
        const s = Math.floor(time % 60)
        const mm = String(m).padStart(2, '0')
        const ss = String(s).padStart(2, '0')
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
      })()
    : ''

  return (
    <>
      <TouchableOpacity style={styles.menuItem} onPress={() => {
        global.app_event.changeMenuVisible(false)
        modalRef.current?.show()
      }}>
        <View style={styles.iconContent}>
          <Icon name="music_time" size={20} color={active ? theme['c-primary-font-active'] : theme['c-font-label']} />
        </View>
        <Text style={styles.text} color={active ? theme['c-primary-font'] : undefined}>
          {active ? t('timeout_exit_sidebar_remaining', { time: remainText })
            : isPlayedStop ? t('timeout_exit_sidebar_waiting')
            : t('nav_timeout_exit')}
        </Text>
      </TouchableOpacity>
      <TimeoutExitEditModal ref={modalRef} timeInfo={timeInfo} />
    </>
  )
}

export default memo(() => {
  const theme = useTheme()
  // console.log('render drawer nav')
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')

  const handlePress = (id: IdType) => {
    switch (id) {
      case 'nav_exit':
        exitApp('Exit Btn')
        return
      case 'back_home':
        backHome()
        return
      case 'nav_love':
        // 定制：侧边栏「收藏」直接打开我的收藏列表
        setActiveList(LIST_IDS.LOVE)
        break
    }

    global.app_event.changeMenuVisible(false)
    setNavActiveId(id)
  }


  return (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      <Header />
      <ScrollView style={styles.menus}>
        <View style={styles.list}>
          {NAV_MENUS.slice(0, 6).map(menu => <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} />)}
          <TimeoutExitMenuItem />
          {NAV_MENUS.slice(6).map(menu => <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} />)}
        </View>
      </ScrollView>

      {
        showBackBtn ? <MenuItem id="back_home" icon="home" onPress={handlePress} /> : null
      }
      {
        showExitBtn ? <MenuItem id="nav_exit" icon="exit2" onPress={handlePress} /> : null
      }
    </View>
  )
})

