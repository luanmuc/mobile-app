import { useState, useRef, useEffect } from 'react'
import { View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { confirmDialog, createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { createUserList } from '@/core/list'
import listState from '@/store/list/state'

export default ({ isEdit, onHide }: {
  isEdit: boolean
  onHide: () => void
}) => {
  const [text, setText] = useState('')
  const inputRef = useRef<InputType>(null)
  // A09-004：onBlur 与 onSubmitEditing 会同时触发（键盘提交后紧接失焦），
  // 原来没有幂等守卫，同一次输入可能连续创建两个歌单。用 ref 做一次性提交闸门。
  const submittedRef = useRef(false)
  const t = useI18n()

  useEffect(() => {
    submittedRef.current = false
    if (isEdit) {
      setText('')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isEdit])

  const handleSubmitEditing = async() => {
    if (submittedRef.current) return
    submittedRef.current = true
    onHide()
    const name = text.trim()
    if (!name.length || (listState.userList.some(l => l.name == name) && !(await confirmDialog({
      message: global.i18n.t('list_duplicate_tip'),
    })))) return
    void createUserList(listState.userList.length, [{ id: `userlist_${Date.now()}`, name, locationUpdateTime: null }])
  }

  return isEdit
    ? (
      <View style={styles.imputContainer}>
        <Input
          placeholder={t('list_create_input_placeholder')}
          value={text}
          onChangeText={setText}
          ref={inputRef}
          onBlur={handleSubmitEditing}
          onSubmitEditing={handleSubmitEditing}
          style={styles.input}
        />
      </View>
      )
    : null
}

const styles = createStyle({
  imputContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    paddingBottom: 10,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  input: {
    flex: 1,
    fontSize: 14,
    borderRadius: 4,
    textAlign: 'center',
    height: '100%',
  },
})
