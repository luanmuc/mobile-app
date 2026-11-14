import { memo, useEffect, useState } from 'react'
import { View, TouchableOpacity, TextInput, ScrollView } from 'react-native'
import RNFS from 'react-native-fs'
import { AndroidScoped, getExternalStoragePaths } from 'react-native-file-system'

import Text from '@/components/common/Text'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { isExternalStorageManager } from '@/utils/nativeModules/utils'
import { normalizeFileNameTemplate, hasFileNameToken } from '@/utils/fileNameTemplate'

const DEFAULT_DIR = `${RNFS.DownloadDirectoryPath}/lx-music/music`
const PRIVATE_DIR = `${RNFS.DocumentDirectoryPath}/downloads`
const NAME_PRESETS = [
  { value: '{title} - {artist}', labelKey: 'dl_file_name_preset_title_artist' },
  { value: '{title}', labelKey: 'dl_file_name_preset_title' },
  { value: '{artist} - {title}', labelKey: 'dl_file_name_preset_artist_title' },
] as const
const MAX_TASK_LIMIT = 5

// SAF 选择器返回的是 content:// 树 URI，而下载走 RNFS 需要真实文件系统路径。
// 这里把 com.android.externalstorage.documents 的树 URI 还原成 /storage/... 路径；
// 云端/网盘的 provider（如 Drive）没有本地路径，返回 null 让调用方拒绝。
const treeUriToPath = async(uri: string): Promise<string | null> => {
  if (!uri.includes('com.android.externalstorage.documents')) return null
  const matched = uri.match(/\/tree\/([^/]+)$/)
  if (!matched) return null
  const docId = decodeURIComponent(matched[1])
  const sepIndex = docId.indexOf(':')
  if (sepIndex < 0) return null
  const volume = docId.slice(0, sepIndex)
  const relative = docId.slice(sepIndex + 1).replace(/^\/+/, '')
  let base: string | undefined
  if (volume == 'primary') {
    base = RNFS.ExternalStorageDirectoryPath
  } else {
    const paths = await getExternalStoragePaths()
    base = paths.find(p => p.includes(volume)) ?? `/storage/${volume}`
  }
  if (!base) return null
  return relative ? `${base}/${relative}` : base
}

type TFn = ReturnType<typeof useI18n>
const shortDir = (path: string, t: TFn) => {
  if (!path) return t('dl_dir_default_with', { dir: DEFAULT_DIR })
  return path.replace(`${RNFS.ExternalStorageDirectoryPath}/`, '')
}

interface RowProps {
  label: string
  desc?: string
  children: React.ReactNode
}
const Row = ({ label, desc, children }: RowProps) => {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text size={13}>{label}</Text>
        {desc ? <Text size={11} color={theme['c-font-label']} style={styles.rowDesc}>{desc}</Text> : null}
      </View>
      <View style={styles.rowControl}>{children}</View>
    </View>
  )
}

export interface DownloadSettingsProps {
  /** 列表为空时默认展开，有任务时收起成一行摘要 */
  defaultExpanded?: boolean
}
export default memo(({ defaultExpanded = false }: DownloadSettingsProps) => {
  const theme = useTheme()
  const t = useI18n()
  const onlyWifi = useSettingValue('download.onlyWifi')
  const maxTask = useSettingValue('download.maxTask')
  const autoRetry = useSettingValue('download.autoRetry')
  const dir = useSettingValue('download.dir')
  const fileName = useSettingValue('download.fileName')
  const notifyComplete = useSettingValue('download.notifyComplete')

  const presetLabel = (value: string) => {
    const preset = NAME_PRESETS.find(p => p.value === value)
    return preset ? t(preset.labelKey) : value
  }

  const [expanded, setExpanded] = useState(defaultExpanded)
  const [showDirOptions, setShowDirOptions] = useState(false)
  const [showNameOptions, setShowNameOptions] = useState(false)
  const [customDir, setCustomDir] = useState('')
  const [customName, setCustomName] = useState('')

  // 旧版本存的是中文模板；打开设置时一次性迁移为 {title}/{artist}，
  // 之后构建、校验、显示都只认 token。
  useEffect(() => {
    const normalized = normalizeFileNameTemplate(fileName)
    if (normalized !== fileName) updateSetting({ 'download.fileName': normalized })
  }, [fileName])

  const summary = [
    dir ? t('dl_summary_dir_custom') : t('dl_summary_dir_default'),
    t('dl_summary_wifi', { status: onlyWifi ? t('dl_on') : t('dl_off') }),
    t('dl_summary_task', { num: maxTask }),
  ].join(' · ')

  const pickDir = async() => {
    let picked: { path?: string } | null
    try {
      picked = await AndroidScoped.openDocumentTree(true)
    } catch (e) {
      toast(t('dl_toast_picker_failed'))
      return
    }
    if (!picked?.path) return // 用户取消
    const path = await treeUriToPath(picked.path)
    if (!path) {
      toast(t('dl_toast_dir_needs_local'), 'long')
      return
    }
    await applyDir(path)
  }

  const applyDir = async(value: string) => {
    if (value) {
      try {
        await RNFS.mkdir(value)
      } catch (e) {
        if (value.includes('/storage/') && !(await isExternalStorageManager())) {
          toast(t('dl_toast_dir_need_permission'), 'long')
        } else {
          toast(t('dl_toast_dir_invalid'))
        }
        return
      }
      if (!(await RNFS.exists(value))) {
        toast(t('dl_toast_dir_unavailable'))
        return
      }
    }
    updateSetting({ 'download.dir': value })
    setShowDirOptions(false)
    setCustomDir('')
    toast(value ? t('dl_toast_dir_updated') : t('dl_toast_dir_reset'))
  }

  const applyName = (value: string) => {
    const v = value.trim()
    if (!v) {
      toast(t('dl_toast_name_empty'))
      return
    }
    if (!hasFileNameToken(v)) {
      toast(t('dl_toast_name_invalid'))
      return
    }
    updateSetting({ 'download.fileName': normalizeFileNameTemplate(v) })
    setShowNameOptions(false)
    setCustomName('')
    toast(t('dl_toast_name_updated'))
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => { setExpanded(v => !v) }}
        style={{ ...styles.header, backgroundColor: theme['c-content-background'] }}
      >
        <View style={styles.headerLeft}>
          <Text size={14}>{t('dl_settings_title')}</Text>
          {
            expanded
              ? null
              : <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={styles.summary}>{summary}</Text>
          }
        </View>
        <Text size={12} color={theme['c-primary']}>{expanded ? t('dl_settings_collapse') : t('dl_settings_expand')}</Text>
      </TouchableOpacity>

      {
        expanded
          ? (
              <View style={{ ...styles.body, backgroundColor: theme['c-content-background'] }}>
                <Row label={t('dl_only_wifi')} desc={t('dl_only_wifi_desc')}>
                  <CheckBox check={onlyWifi} onChange={(v) => { updateSetting({ 'download.onlyWifi': v }) }} />
                </Row>

                <Row label={t('dl_max_task')} desc={t('dl_max_task_desc')}>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      onPress={() => { updateSetting({ 'download.maxTask': Math.max(1, maxTask - 1) }) }}
                      style={styles.stepBtn}
                    >
                      <Text size={16} color={maxTask <= 1 ? theme['c-400'] : theme['c-primary']}>−</Text>
                    </TouchableOpacity>
                    <Text size={14} style={styles.stepValue}>{maxTask}</Text>
                    <TouchableOpacity
                      onPress={() => { updateSetting({ 'download.maxTask': Math.min(MAX_TASK_LIMIT, maxTask + 1) }) }}
                      style={styles.stepBtn}
                    >
                      <Text size={16} color={maxTask >= MAX_TASK_LIMIT ? theme['c-400'] : theme['c-primary']}>＋</Text>
                    </TouchableOpacity>
                  </View>
                </Row>

                <Row label={t('dl_auto_retry')} desc={t('dl_auto_retry_desc')}>
                  <CheckBox check={autoRetry} onChange={(v) => { updateSetting({ 'download.autoRetry': v }) }} />
                </Row>

                <View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { setShowDirOptions(v => !v) }}
                    style={styles.row}
                  >
                    <View style={styles.rowLabel}>
                      <Text size={13}>{t('dl_dir')}</Text>
                      <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={styles.rowDesc}>{shortDir(dir, t)}</Text>
                    </View>
                    <Text size={12} color={theme['c-primary']}>{showDirOptions ? t('dl_action_collapse') : t('dl_action_change')}</Text>
                  </TouchableOpacity>
                  {
                    showDirOptions
                      ? (
                          <View style={styles.subPanel}>
                            <TouchableOpacity onPress={() => { void applyDir('') }} style={styles.option}>
                              <Text size={12} color={!dir ? theme['c-primary'] : theme['c-font']}>{t('dl_dir_default_option')}</Text>
                              <Text size={10} color={theme['c-font-label']} numberOfLines={1}>{DEFAULT_DIR}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { void applyDir(PRIVATE_DIR) }} style={styles.option}>
                              <Text size={12} color={dir === PRIVATE_DIR ? theme['c-primary'] : theme['c-font']}>{t('dl_dir_private_option')}</Text>
                              <Text size={10} color={theme['c-font-label']} numberOfLines={1}>{PRIVATE_DIR}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { void pickDir() }} style={styles.option}>
                              <Text size={12} color={theme['c-primary']}>{t('dl_dir_pick_option')}</Text>
                              <Text size={10} color={theme['c-font-label']}>{t('dl_dir_pick_desc')}</Text>
                            </TouchableOpacity>
                            <View style={styles.customRow}>
                              <TextInput
                                value={customDir}
                                onChangeText={setCustomDir}
                                placeholder={t('dl_dir_input_placeholder')}
                                placeholderTextColor={theme['c-font-label']}
                                style={{ ...styles.input, color: theme['c-font'], backgroundColor: theme['c-primary-input-background'] }}
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                              <TouchableOpacity onPress={() => { void applyDir(customDir.trim()) }} style={styles.confirmBtn}>
                                <Text size={12} color={theme['c-primary-font']}>{t('dl_save')}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )
                      : null
                  }
                </View>

                <View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { setShowNameOptions(v => !v) }}
                    style={styles.row}
                  >
                    <View style={styles.rowLabel}>
                      <Text size={13}>{t('dl_file_name')}</Text>
                      <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={styles.rowDesc}>{presetLabel(normalizeFileNameTemplate(fileName))}</Text>
                    </View>
                    <Text size={12} color={theme['c-primary']}>{showNameOptions ? t('dl_action_collapse') : t('dl_action_change')}</Text>
                  </TouchableOpacity>
                  {
                    showNameOptions
                      ? (
                          <View style={styles.subPanel}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
                              {
                                NAME_PRESETS.map(preset => (
                                  <TouchableOpacity
                                    key={preset.value}
                                    onPress={() => { applyName(preset.value) }}
                                    style={{ ...styles.preset, borderColor: normalizeFileNameTemplate(fileName) === preset.value ? theme['c-primary'] : theme['c-font-label'] }}
                                  >
                                    <Text size={12} color={normalizeFileNameTemplate(fileName) === preset.value ? theme['c-primary'] : theme['c-font']}>{t(preset.labelKey)}</Text>
                                  </TouchableOpacity>
                                ))
                              }
                            </ScrollView>
                            <View style={styles.customRow}>
                              <TextInput
                                value={customName}
                                onChangeText={setCustomName}
                                placeholder={t('dl_file_name_placeholder')}
                                placeholderTextColor={theme['c-font-label']}
                                style={{ ...styles.input, color: theme['c-font'], backgroundColor: theme['c-primary-input-background'] }}
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                              <TouchableOpacity onPress={() => { applyName(customName) }} style={styles.confirmBtn}>
                                <Text size={12} color={theme['c-primary-font']}>{t('dl_save')}</Text>
                              </TouchableOpacity>
                            </View>
                            <Text size={10} color={theme['c-font-label']}>{t('dl_file_name_tip')}</Text>
                          </View>
                        )
                      : null
                  }
                </View>

                <Row label={t('dl_notify_complete')} desc={t('dl_notify_complete_desc')}>
                  <CheckBox check={notifyComplete} onChange={(v) => { updateSetting({ 'download.notifyComplete': v }) }} />
                </Row>
              </View>
            )
          : null
      }
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 6,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 10,
  },
  summary: {
    marginTop: 2,
  },
  body: {
    marginTop: 2,
    paddingLeft: 12,
    paddingRight: 12,
    paddingBottom: 4,
    borderRadius: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 10,
  },
  rowLabel: {
    flex: 1,
    paddingRight: 10,
  },
  rowDesc: {
    marginTop: 2,
  },
  rowControl: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 22,
    textAlign: 'center',
  },
  subPanel: {
    paddingLeft: 4,
    paddingBottom: 8,
  },
  option: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  presetRow: {
    paddingTop: 4,
    paddingBottom: 6,
  },
  preset: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
    marginRight: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  input: {
    flex: 1,
    height: 36,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 4,
    fontSize: 12,
  },
  confirmBtn: {
    marginLeft: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.18)',
  },
})
