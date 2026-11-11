import { downloadNewVersion, getVersionInfo } from '@/utils/version'
import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { getIgnoreVersion, getIgnoreVersionFailTipTime, saveIgnoreVersion, saveIgnoreVersionFailTipTime } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'
import { toast } from '@/utils/tools'

// 版本比较（支持构建序号）：如 "1.9.1" 与 "1.9.1-b8" 比较时，主版本相同则比 b 序号
// compareVer 会把 "1.9.1-b8" 的 -b8 当作负值导致误判为更旧，这里专门处理
const compareVerWithBuild = (currentVer: string, targetVer: string): -1 | 0 | 1 => {
  const parse = (s: string) => {
    const [main, build] = s.split('-')
    const nums = (main || '').split('.').map(n => Number.parseInt(n, 10) || 0)
    const buildNum = build ? (Number.parseInt(build.replace(/[^0-9]/g, ''), 10) || 0) : 0
    return { nums, buildNum }
  }
  const c = parse(currentVer)
  const t = parse(targetVer)
  const len = Math.max(c.nums.length, t.nums.length)
  for (let i = 0; i < len; i++) {
    const cn = c.nums[i] || 0
    const tn = t.nums[i] || 0
    if (cn > tn) return 1
    if (cn < tn) return -1
  }
  if (c.buildNum > t.buildNum) return 1
  if (c.buildNum < t.buildNum) return -1
  return 0
}

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

export const checkUpdate = async() => {
  versionActions.setVersionInfo({ status: 'checking' })
  let versionInfo: InitState['versionInfo'] = { ...versionState.versionInfo }
  try {
    // 总超时兜底：30 秒内未完成视为失败，避免网络异常时无限卡在"检查更新中"
    const versionInfoPromise = getVersionInfo()
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error('timeout')) }, 30000)
    })
    const { version, desc, history } = await Promise.race([versionInfoPromise, timeoutPromise])
    versionInfo.newVersion = {
      version,
      desc,
      history,
    }
  } catch (err) {
    versionInfo.newVersion = {
      version: '0.0.0',
      desc: '',
      history: [],
    }
  }
  // const versionInfo = {
  //   version: '1.9.0',
  //   desc: '- 更新xxx\n- 修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达',
  //   history: [{ version: '1.8.0', desc: '- 更新xxx22\n- 修复xxx22' }, { version: '1.7.0', desc: '- 更新xxx22\n- 修复xxx22' }],
  // }
  if (versionInfo.newVersion.version == '0.0.0') {
    versionInfo.isUnknown = true
    versionInfo.status = 'error'
  } else {
    versionInfo.status = 'idle'
    versionInfo.isUnknown = false
    // 用真实构建版本（process.versions.app，含 b 序号）比较，避免 1.9.1 恒小于 1.9.1-bN 导致永远提示更新
    if (compareVerWithBuild(process.versions.app, versionInfo.newVersion.version) != -1) {
      versionInfo.isLatest = true
    }
  }

  versionActions.setVersionInfo(versionInfo)

  if (!versionInfo.isLatest) {
    if (versionInfo.isUnknown) {
      const time = await getIgnoreVersionFailTipTime()
      if (Date.now() - time < 7 * 86400000) return
      saveIgnoreVersionFailTipTime(Date.now())
      toast(global.i18n.t('version_tip_unknown'))
    } else if (versionInfo.newVersion.version != await getIgnoreVersion()) {
      showModal()
    }
  }
  // console.log(compareVer(process.versions.app, versionInfo.version))
  // console.log(process.versions.app, versionInfo.version)
}

export const downloadUpdate = () => {
  versionActions.setVersionInfo({ status: 'downloading' })
  versionActions.setProgress({ total: 0, current: 0 })

  downloadNewVersion(versionState.versionInfo.newVersion!.version, (total: number, current: number) => {
    // console.log(total, current)
    versionActions.setProgress({ total, current })
  }).then(() => {
    versionActions.setVersionInfo({ status: 'downloaded' })
  }).catch((err) => {
    versionActions.setVersionInfo({ status: 'error' })
    console.log('downloadUpdate failed:', err)
  })
}


export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}
