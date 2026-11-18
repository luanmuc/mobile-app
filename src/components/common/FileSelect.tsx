import ChoosePath, { type ReadOptions, type ChoosePathType } from '@/components/common/ChoosePath'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

export interface FileSelectType {
  show: (options: ReadOptions, onSelect: typeof noop) => void
}
const noop = (path: string) => {}
export default forwardRef<FileSelectType, {}>((props, ref) => {
  const [visible, setVisible] = useState(false)
  const choosePathRef = useRef<ChoosePathType>(null)
  const onSelectRef = useRef<typeof noop>(noop)
  // console.log('render import export')

  useImperativeHandle(ref, () => ({
    show(options, onSelect) {
      onSelectRef.current = onSelect ?? noop
      if (visible) {
        choosePathRef.current?.show(options)
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          choosePathRef.current?.show(options)
        })
      }
    },
  }))

  // A09-003：原来把 `onSelectRef.current` 的值在渲染时求值后传进去 —— ChoosePath 是常驻挂载的，
  // 第二次 show() 只更新 ref，已挂载的 ChoosePath 仍持有第一次的回调，选文件结果会回到旧处理函数。
  // 改为传一个每次调用都读最新 ref 的包装函数。
  return (
    visible
      ? <ChoosePath ref={choosePathRef} onConfirm={(path: string) => { onSelectRef.current(path) }} />
      : null
  )
})
