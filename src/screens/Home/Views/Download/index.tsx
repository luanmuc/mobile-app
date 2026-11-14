import { useMemo, useRef } from 'react'
import { FlatList, ScrollView, TouchableOpacity, View, type ListRenderItemInfo } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useDownloadList } from '@/store/download/hook'
import {
  clearCompleted,
  moveTask,
  openDownloadedFile,
  pauseAllDownload,
  pauseDownload,
  playDownload,
  removeDownload,
  resumeAllDownload,
  resumeDownload,
  retryDownload,
  shareDownloadedFile,
} from '@/core/downloadManager'
import { QUALITY_NAMES } from '@/components/OnlineList/QualitySelect'
import DownloadSettings from './Settings'
import { useI18n } from '@/lang'

const formatSize = (bytes: number) => {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

type TFn = ReturnType<typeof useI18n>
const failReasonText = (code: LX.Download.DownloadErrorReason | undefined, t: TFn): string => {
  switch (code) {
    case 'network': return t('dl_fail_network')
    case 'cellular': return t('dl_fail_cellular')
    case 'noSource': return t('dl_fail_noSource')
    case 'noWrite': return t('dl_fail_noWrite')
    case 'noSpace': return t('dl_fail_noSpace')
    case 'unknown': return t('dl_fail_unknown')
    default: return ''
  }
}

const getStatusInfo = (item: LX.Download.ListItem, t: TFn): { text: string, isProgress: boolean } => {
  if (item.status === 'error') {
    // 失败原因由 errorCode 翻译，error 里只保留原始信息（HTTP 码/异常文本）
    const reason = failReasonText(item.errorCode, t)
    // 已知原因只显示本地化标签；只有未知原因才附原始报错，避免英文界面冒出中文异常文本。
    // 冒号/括号交给三语模板，英文用半角、中文用全角，不在代码里拼标点。
    const detail = item.errorCode === 'unknown' && item.error ? item.error : ''
    const status = t('dl_status_error')
    const text = detail
      ? t('dl_error_status_detail', { status, reason, detail })
      : reason
        ? t('dl_error_status', { status, reason })
        : status
    return { text, isProgress: false }
  }
  // 原生层写入的状态键优先（获取信息中 / 非WiFi已暂停 / 等待重试），避免展示存储里的中文
  if (item.statusKey) {
    const key = item.statusKey as Parameters<TFn>[0]
    const values = item.statusParams as Parameters<TFn>[1]
    return { text: values ? t(key, values) : t(key), isProgress: item.status === 'run' }
  }
  switch (item.status) {
    case 'waiting': return { text: t('dl_status_waiting'), isProgress: false }
    case 'run': return { text: t('dl_status_running'), isProgress: true }
    case 'pause': return { text: t('dl_status_paused'), isProgress: false }
    case 'completed': return { text: t('dl_status_completed'), isProgress: false }
    default: return { text: t('dl_status_error'), isProgress: false }
  }
}

type SectionType = 'active' | 'completed'

interface SectionData {
  title: string
  data: LX.Download.ListItem[]
  type: SectionType
}

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const list = useDownloadList()
  const listRef = useRef<FlatList>(null)

  const { activeList, completedList, activeCount, completedCount, runningCount, failedCount } = useMemo(() => {
    const active = list.filter(t => !t.isComplate)
    const completed = list.filter(t => t.isComplate)
    return {
      activeList: active,
      completedList: completed,
      activeCount: active.length,
      completedCount: completed.length,
      runningCount: active.filter(t => t.status === 'run').length,
      failedCount: active.filter(t => t.status === 'error').length,
    }
  }, [list])

  const hasActiveDownloading = activeList.some(t => t.status === 'run' || t.status === 'waiting')

  // 批量下载时的队列汇总：单首下载不出现，避免打扰
  const queueSummary = useMemo(() => {
    const parts = [t('dl_queue_summary', { done: completedCount, total: list.length })]
    if (runningCount > 0) parts.push(t('dl_queue_running', { count: runningCount }))
    if (failedCount > 0) parts.push(t('dl_queue_failed', { count: failedCount }))
    return parts.join(' · ')
  }, [completedCount, list.length, runningCount, failedCount, t])
  const hasPaused = activeList.some(t => t.status === 'pause')

  const handlePlay = (item: LX.Download.ListItem) => {
    const index = completedList.findIndex(t => t.id === item.id)
    if (index < 0) return
    void playDownload(index)
  }

  const renderItem = ({ item }: ListRenderItemInfo<LX.Download.ListItem>) => {
    const statusInfo = getStatusInfo(item, t)
    const isCompleted = item.isComplate
    const isActive = !isCompleted

    return (
      <View style={{ ...styles.item, backgroundColor: theme['c-content-background'] }}>
        <View style={styles.itemMain}>
          <View style={styles.itemInfo}>
            <Text numberOfLines={1} style={styles.itemName} size={14}>{item.metadata.musicInfo.name}</Text>
            <Text numberOfLines={1} style={styles.itemSinger} size={12} color={theme['c-font-label']}>{item.metadata.musicInfo.singer || t('dl_unknown_singer')}</Text>
          </View>
          <View style={styles.itemActions}>
            {
              isCompleted
                ? (
                    <>
                      <Button style={styles.itemBtn} onPress={() => { handlePlay(item) }}>
                        <Text color={theme['c-primary-font']} size={12}>{t('dl_action_play')}</Text>
                      </Button>
                      <Button style={styles.itemBtn} onPress={() => { void shareDownloadedFile(item.id) }}>
                        <Text color={theme['c-font-label']} size={12}>{t('dl_action_share')}</Text>
                      </Button>
                      <Button style={styles.itemBtn} onPress={() => { void openDownloadedFile(item.id) }}>
                        <Text color={theme['c-font-label']} size={12}>{t('dl_action_open')}</Text>
                      </Button>
                      <Button style={styles.itemBtn} onPress={() => { void removeDownload(item.id) }}>
                        <Text color={theme['c-font-label']} size={12}>{t('dl_action_delete')}</Text>
                      </Button>
                    </>
                  )
                : item.status === 'error'
                  ? (
                      <>
                        <Button style={styles.itemBtn} onPress={() => { void retryDownload(item.id) }}>
                          <Text color={theme['c-primary-font']} size={12}>{t('dl_action_retry')}</Text>
                        </Button>
                        <Button style={styles.itemBtn} onPress={() => { void removeDownload(item.id) }}>
                          <Text color={theme['c-font-label']} size={12}>{t('dl_action_delete')}</Text>
                        </Button>
                      </>
                    )
                  : item.status === 'pause'
                    ? (
                        <>
                          <Button style={styles.itemBtn} onPress={() => { void resumeDownload(item.id) }}>
                            <Text color={theme['c-primary-font']} size={12}>{t('dl_action_resume')}</Text>
                          </Button>
                          <Button style={styles.itemBtn} onPress={() => { void removeDownload(item.id) }}>
                            <Text color={theme['c-font-label']} size={12}>{t('dl_action_delete')}</Text>
                          </Button>
                        </>
                      )
                    : (
                        <>
                          <Button style={styles.itemBtn} onPress={() => { void pauseDownload(item.id) }}>
                            <Text color={theme['c-font-label']} size={12}>{t('dl_action_pause')}</Text>
                          </Button>
                          <Button style={styles.itemBtn} onPress={() => { void removeDownload(item.id) }}>
                            <Text color={theme['c-font-label']} size={12}>{t('dl_action_cancel')}</Text>
                          </Button>
                        </>
                      )
              }
          </View>
        </View>

        {/* 进度条 */}
        {
          statusInfo.isProgress || item.status === 'waiting' || item.status === 'run'
            ? (
                <View style={styles.progressArea}>
                  {
                    item.total > 0
                      ? (
                          <View style={styles.progressRow}>
                            <View style={styles.progressBar}>
                              <View style={{ ...styles.progressInner, backgroundColor: theme['c-primary'], width: `${Math.min(100, Math.round(item.progress * 100))}%` }} />
                            </View>
                            <Text style={styles.progressPercent} size={12} color={theme['c-font-label']}>
                              {`${Math.min(100, Math.round(item.progress * 100))}%`}
                            </Text>
                          </View>
                        )
                      // 服务端没给 Content-Length 时 total 为 0，画空条会显示成"卡在 0%"，这里只报已下载量
                      : null
                  }
                  {
                    item.speed || item.downloaded > 0
                      ? (
                          <Text numberOfLines={1} style={styles.progressText} size={11} color={theme['c-font-label']}>
                            {item.total > 0
                              ? `${item.speed ? `${item.speed} · ` : ''}${formatSize(item.downloaded)}/${formatSize(item.total)}`
                              : `${item.speed ? `${item.speed} · ` : ''}${t('dl_downloaded', { size: formatSize(item.downloaded) })}`}
                          </Text>
                        )
                      : null
                  }
                </View>
              )
            : null
        }

        {/* 失败时显示已下载大小 */}
        {
          item.status === 'error' && item.downloaded > 0
            ? <Text style={styles.progressText} size={11} color={theme['c-font-label']}>{t('dl_downloaded', { size: formatSize(item.downloaded) })}</Text>
            : null
        }

        {/* 已完成显示音质和文件名 */}
        {
          isCompleted
            ? (
                <>
                  <Text numberOfLines={1} style={styles.filePathText} size={11} color={theme['c-font-label']}>{t('dl_quality', { quality: QUALITY_NAMES[item.metadata.quality] ? t(QUALITY_NAMES[item.metadata.quality] as Parameters<typeof t>[0]) : item.metadata.quality })}</Text>
                  <Text numberOfLines={1} style={styles.filePathText} size={11} color={theme['c-font-label']}>{item.metadata.fileName}</Text>
                </>
              )
            : null
        }

        {/* 未完成任务显示排序按钮 */}
        {
          isActive && !isCompleted
            ? (
                <View style={styles.sortArea}>
                  <TouchableOpacity onPress={() => { void moveTask(item.id, 'up') }} style={styles.sortBtn}>
                    <Text size={11} color={theme['c-font-label']}>{t('dl_action_move_up')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { void moveTask(item.id, 'down') }} style={styles.sortBtn}>
                    <Text size={11} color={theme['c-font-label']}>{t('dl_action_move_down')}</Text>
                  </TouchableOpacity>
                </View>
              )
            : null
        }
      </View>
    )
  }

  // 构建分组数据
  const sections: SectionData[] = useMemo(() => {
    const result: SectionData[] = []
    if (activeCount > 0) {
      result.push({ title: t('dl_section_active', { num: activeCount }), data: activeList, type: 'active' })
    }
    if (completedCount > 0) {
      result.push({ title: t('dl_section_completed', { num: completedCount }), data: completedList, type: 'completed' })
    }
    return result
  }, [activeList, completedList, activeCount, completedCount, t])

  const renderSectionHeader = (section: SectionData) => (
    <View style={styles.sectionHeader}>
      <Text size={13} color={theme['c-font-label']} style={styles.sectionTitle}>{section.title}</Text>
      {
        section.type === 'active'
          ? (
              <View style={styles.sectionActions}>
                {
                  hasActiveDownloading
                    ? (
                        <TouchableOpacity onPress={() => { void pauseAllDownload() }} style={styles.sectionBtn}>
                          <Text size={12} color={theme['c-primary']}>{t('dl_action_pause_all')}</Text>
                        </TouchableOpacity>
                      )
                    : hasPaused
                      ? (
                          <TouchableOpacity onPress={() => { void resumeAllDownload() }} style={styles.sectionBtn}>
                            <Text size={12} color={theme['c-primary']}>{t('dl_action_resume_all')}</Text>
                          </TouchableOpacity>
                        )
                      : null
                }
              </View>
            )
          : (
              <TouchableOpacity onPress={() => { void clearCompleted() }} style={styles.sectionBtn}>
                <Text size={12} color={theme['c-primary']}>{t('dl_action_clear_completed')}</Text>
              </TouchableOpacity>
            )
        }
    </View>
  )

  const renderFlatList = (data: LX.Download.ListItem[]) => (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
    />
  )

  // 没有任务时整页只有一个提示，正好把下载设置展开铺满（下载相关设置全部收在这里，不再占设置页分组）
  if (!list.length) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.emptyContent} keyboardShouldPersistTaps="handled">
          <DownloadSettings defaultExpanded />
          <View style={styles.empty}>
            <Text size={14} color={theme['c-font-label']}>{t('dl_empty')}</Text>
            <Text size={12} color={theme['c-font-label']} style={styles.emptyTip}>{t('dl_empty_tip')}</Text>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <DownloadSettings />
      {
        activeCount >= 2
          ? (
              <View style={styles.queueRow}>
                <Text numberOfLines={1} size={12} color={theme['c-font-label']}>{queueSummary}</Text>
              </View>
            )
          : null
      }
      {sections.map(section => (
        <View key={section.type}>
          {renderSectionHeader(section)}
          {renderFlatList(section.data)}
        </View>
      ))}
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontWeight: 'bold',
  },
  sectionActions: {
    flexDirection: 'row',
  },
  sectionBtn: {
    marginLeft: 10,
  },
  listContent: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingBottom: 20,
  },
  item: {
    borderRadius: 6,
    marginBottom: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    marginBottom: 2,
  },
  itemSinger: {
    marginBottom: 0,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  itemBtn: {
    marginLeft: 6,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
  },
  queueRow: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 6,
  },
  progressArea: {
    marginTop: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.35)',
    overflow: 'hidden',
  },
  progressInner: {
    height: '100%',
    borderRadius: 3,
  },
  progressPercent: {
    marginLeft: 8,
    minWidth: 34,
    textAlign: 'right',
  },
  progressText: {
    marginTop: 4,
  },
  filePathText: {
    marginTop: 4,
  },
  sortArea: {
    flexDirection: 'row',
    marginTop: 6,
    justifyContent: 'flex-end',
  },
  sortBtn: {
    marginLeft: 12,
  },
  emptyContent: {
    paddingBottom: 40,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 30,
    paddingRight: 30,
  },
  emptyTip: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
})
