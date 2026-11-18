import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from 'react'
import { View } from 'react-native'
import { externalStorageDirectoryPath, readDir } from '@/utils/fs'
import { createStyle, toast } from '@/utils/tools'
// import { useTranslation } from '@/plugins/i18n'
import Modal, { type ModalType } from '@/components/common/Modal'

import Header from './components/Header'
import Main from './components/Main'
import Footer from './components/Footer'
import { sizeFormate } from '@/utils'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { type PathItem } from './components/ListItem'
// import { getSelectedManagedFolder } from '@/utils/data'
// let prevPath = externalStorageDirectoryPath

const parentDirInfo = new Map<string, string>()
const caches = new Map<string, PathItem[]>()

// A09-014：这两个 Map 挂在模块级，会话内只增不删 —— 目录浏览越多内存越长（缓存的是整份
// 目录列表）。加容量上限 + 简易 LRU（Map 的迭代顺序就是插入顺序，超限删最早的一条）。
const MAX_DIR_CACHE = 200
const setBounded = <V,>(map: Map<string, V>, key: string, value: V) => {
  if (map.size >= MAX_DIR_CACHE && !map.has(key)) {
    const oldest = map.keys().next().value
    if (oldest != null) map.delete(oldest)
  }
  map.set(key, value)
}

const handleReadDir = async(path: string, dirOnly: boolean, filter?: string[], isRefresh = false) => {
  let filterRxp = filter?.length ? new RegExp(`\\.(${filter.join('|')})$`, 'i') : null
  const cacheKey = `${path}_${dirOnly ? 'true' : 'false'}_${filter ? filter.toString() : 'null'}`
  if (!isRefresh && caches.has(cacheKey)) return caches.get(cacheKey)!
  return readDir(path).then(paths => {
    // console.log('read')
    // prevPath = path
    let list = [] as PathItem[]
    // console.log(paths)
    for (const path of paths) {
      // console.log(path)
      if (filterRxp != null && path.isFile && !filterRxp.test(path.name)) continue

      const isDirectory = path.isDirectory
      if (dirOnly) {
        list.push({
          name: path.name,
          path: path.path,
          mtime: new Date(path.lastModified),
          size: path.size,
          isDir: isDirectory,
          sizeText: isDirectory ? '' : sizeFormate(path.size ?? 0),
          disabled: path.isFile,
        })
      } else {
        list.push({
          name: path.name,
          path: path.path,
          mtime: new Date(path.lastModified),
          size: path.size,
          isDir: isDirectory,
          sizeText: isDirectory ? '' : sizeFormate(path.size ?? 0),
        })
      }
    }

    list.sort((a, b) => a.name.charCodeAt(0) - b.name.charCodeAt(0))
    let fileList = [] as PathItem[]
    list = [...list.filter(i => {
      if (i.isDir) return true
      else {
        fileList.push(i)
        return false
      }
    }), ...fileList]
    setBounded(caches, cacheKey, list)
    return list
  })
}

interface ReadOptions {
  title: string
  dirOnly: boolean
  filter?: string[]
}
const initReadOptions = {}
export interface ListProps {
  onConfirm: (path: string) => void
  onHide?: () => void
}

export interface ListType {
  show: (title: string, dir?: string, dirOnly?: boolean, filter?: string[]) => void
  hide: () => void
}

export default forwardRef<ListType, ListProps>(({
  onConfirm,
  onHide = () => {},
}: ListProps, ref) => {
  const [path, setPath] = useState('')
  const [list, setList] = useState<PathItem[]>([])
  const isUnmountedRef = useRef(true)
  const readOptions = useRef<ReadOptions>(initReadOptions as ReadOptions)
  const [isReading, setIsReading] = useState(false)
  // A09-008：正在进行的读取 Promise。后到的读取请求改为排队等待，而不是被静默丢弃。
  const readingPromiseRef = useRef<Promise<unknown> | null>(null)
  const modalRef = useRef<ModalType>(null)
  const theme = useTheme()
  const t = useI18n()

  useImperativeHandle(ref, () => ({
    show(title, dir = '', dirOnly = false, filter) {
      readOptions.current = {
        title,
        dirOnly,
        filter,
      }
      modalRef.current?.setVisible(true)
      // void getSelectedManagedFolder().then(uri => {
      //   if (!uri) return
      //   void readDir(uri, dirOnly, filter)
      // })
      if (dir) void readDir(dir, dirOnly, filter)
      else void readDir(externalStorageDirectoryPath, dirOnly, filter)
    },
    hide() {
      modalRef.current?.setVisible(false)
    },
  }))

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const readDir = async(newPath: string, dirOnly: boolean, filter?: string[], isRefresh?: boolean, isOpen?: boolean): Promise<PathItem[]> => {
    // A09-008：原来 `if (isReading) return []` 把后到的请求静默丢弃 —— 快速进出目录/连续刷新时
    // 界面停在旧目录也没有任何提示，用户要再手动进一次。改为等前一次读完再执行，保证每次都真读。
    if (readingPromiseRef.current) await readingPromiseRef.current.catch(() => {})
    setIsReading(true)
    const task = handleReadDir(newPath, dirOnly, filter, isRefresh).then(list => {
      if (isUnmountedRef.current) return []
      if (!isOpen && newPath != path && newPath.startsWith(path)) setBounded(parentDirInfo, newPath, path)
      setList(list)
      setPath(newPath)
      return list
    }).catch((err: any) => {
      toast(t('choose_path_read_dir_failed', { msg: String(err?.message ?? '') }), 'long')
      // console.log('prevPath', prevPath)
      // if (isReadingDir.current) return
      // setPath(prevPath)
      return []
    }).finally(() => {
      setIsReading(false)
      if (readingPromiseRef.current === task) readingPromiseRef.current = null
    })
    readingPromiseRef.current = task
    return task
  }

  const onSetPath = (pathInfo: PathItem) => {
    // console.log('onSetPath')
    if (pathInfo.isDir) {
      void readDir(pathInfo.path, readOptions.current.dirOnly, readOptions.current.filter)
    } else {
      onConfirm(pathInfo.path)
      // setPath(pathInfo.path)
    }
  }
  const handleConfirm = () => {
    if (!path) return
    onConfirm(path)
  }

  const toParentDir = () => {
    const parentPath = parentDirInfo.get(path)
    if (parentPath) {
      void readDir(parentPath, readOptions.current.dirOnly, readOptions.current.filter)
    } else {
      toast(global.i18n.t('choose_path_permission_denied'))
    }
  }

  const handleHide = () => {
    modalRef.current?.setVisible(false)
    onHide()
  }

  // const dirList = useMemo(() => [parentDir, ...list], [list, parentDir])

  return (
    <Modal ref={modalRef} bgHide={false} statusBarPadding={false}>
      <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
        <Header
          onRefreshDir={async(path) => readDir(path, readOptions.current.dirOnly, readOptions.current.filter, true)}
          onOpenDir={async(path) => readDir(path, readOptions.current.dirOnly, readOptions.current.filter, false, true)}
          title={readOptions.current.title}
          path={path} />
        <Main list={list} toParentDir={toParentDir} onSetPath={onSetPath} loading={isReading} />
        <Footer onConfirm={handleConfirm} onHide={handleHide} dirOnly={readOptions.current.dirOnly} />
      </View>
    </Modal>
  )
})


const styles = createStyle({
  container: {
    flex: 1,
  },
})

