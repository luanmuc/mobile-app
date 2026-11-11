import { memo, useRef, useState, useEffect } from 'react'
import { View } from 'react-native'
import { getLogs, clearLogs, checkLogPermission, getLogsDir, LOG_CATEGORY_LABELS, type LogCategory } from '@/utils/log'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'
import { createStyle, toast } from '@/utils/tools'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import CheckBoxItem from '../components/CheckBoxItem'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'

// 独立「运行日志」页（b66）：
// - 4 类日志各一个查看按钮（全局错误 / 音源日志 / 运行诊断 / 调试日志），点击查看该类
// - 权限检测以真实写测试为准（不再误判"已开权限仍提示去开启"）
// - 无权限：提示条 + 去开启（Android 11+ 跳设置 / Android 10- 弹系统权限框）
export default memo(() => {
  const t = useI18n()
  const alertRef = useRef<ConfirmAlertType>(null)
  const [logText, setLogText] = useState('')
  const [currentCategory, setCurrentCategory] = useState<LogCategory | null>(null)
  const isUnmountedRef = useRef(true)
  const [isEnableUserApiLog, setIsEnableUserApiLog] = useState(global.lx.isEnableUserApiLog)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)

  const getErrorLog = (category: LogCategory) => {
    void getLogs(category).then(log => {
      if (isUnmountedRef.current) return
      setLogText(log)
    })
  }

  const openLogModal = async(category: LogCategory) => {
    const granted = await checkLogPermission()
    if (isUnmountedRef.current) return
    setHasPermission(granted)
    setCurrentCategory(category)
    getErrorLog(category)
    alertRef.current?.setVisible(true)
  }

  const handleCleanLog = () => {
    // 清空当前查看的分类；若当前查看"全部"则清全部
    void clearLogs(currentCategory ?? undefined).then(() => {
      toast(t('setting_other_log_tip_clean_success'))
      if (currentCategory) getErrorLog(currentCategory)
    })
  }

  const handleSetEnableUserApiLog = (enable: boolean) => {
    setIsEnableUserApiLog(enable)
    global.lx.isEnableUserApiLog = enable
  }

  useEffect(() => {
    isUnmountedRef.current = false
    // 页面打开时检查权限状态（真实写测试）
    void checkLogPermission().then(granted => {
      if (!isUnmountedRef.current) setHasPermission(granted)
    })
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  return (
    <Section title={t('setting_log')}>
      <Text size={12} style={styles.desc}>{t('setting_log_desc')}</Text>

      {
        hasPermission === false ? (
          <Text size={12} style={styles.privateTip}>
            {t('setting_log_private_tip') + getLogsDir()}
          </Text>
        ) : null
      }
      <Text size={12} style={styles.dirTip}>
        {hasPermission === false ? '' : t('setting_log_dir') + getLogsDir()}
      </Text>
      <View style={styles.checkBox}>
        <CheckBoxItem check={isEnableUserApiLog} label={t('setting_other_log_user_api_log')} onChange={handleSetEnableUserApiLog} />
      </View>
      {/* 4 类日志各一个查看按钮（公共/私有目录均可查看） */}
      <SubTitle title={t('setting_log_view')}>
        <View style={styles.btnGrid}>
          {
            (Object.keys(LOG_CATEGORY_LABELS) as LogCategory[]).map(category => (
              <View key={category} style={styles.btnItem}>
                <Button onPress={async() => openLogModal(category)}>{LOG_CATEGORY_LABELS[category]}</Button>
              </View>
            ))
          }
        </View>
      </SubTitle>

      <ConfirmAlert
        ref={alertRef}
        cancelText={t('setting_other_log_btn_hide')}
        confirmText={t('setting_other_log_btn_clean')}
        onConfirm={handleCleanLog}
        showConfirm={!!logText}
        reverseBtn={true}
        >
        <View onStartShouldSetResponder={() => true}>
          {
            logText
              ? <Text selectable size={13}>{ logText }</Text>
              : <Text size={13}>{t('setting_other_log_tip_null')}</Text>
          }
        </View>
      </ConfirmAlert>
    </Section>
  )
})

const styles = createStyle({
  checkBox: {
    marginTop: 10,
  },
  btnGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  btnItem: {
    width: '48%',
    marginBottom: 8,
    marginRight: '2%',
  },
  desc: {
    marginTop: 8,
    lineHeight: 20,
  },
  dirTip: {
    marginTop: 8,
    color: '#999',
  },
  privateTip: {
    marginTop: 8,
    lineHeight: 20,
    color: '#999',
  },
})
