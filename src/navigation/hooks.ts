import { useEffect, useRef } from 'react'
import { type EmitterSubscription } from 'react-native'
import { Navigation } from 'react-native-navigation'

export const useNavigationCommandComplete = (callback = () => {}) => {
  // A10-012：原来把 callback 放进依赖数组 —— 调用方传内联箭头函数时，每次渲染都会
  // 注销并重新注册一次监听。用 ref 存最新回调，依赖保持为空。
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    // Register the listener to all events related to our component
    let commandCompletedListener: EmitterSubscription | null = Navigation.events().registerCommandCompletedListener(({ commandId }) => {
      callbackRef.current()
      if (!commandCompletedListener) return
      commandCompletedListener.remove()
      commandCompletedListener = null
    })
    return () => {
      // Make sure to unregister the listener during cleanup
      if (!commandCompletedListener) return
      commandCompletedListener.remove()
      commandCompletedListener = null
    }
  }, [])
}
export const useNavigationComponentDidAppear = (componentId: string, callback = () => {}) => {
  // A10-012：同 useNavigationCommandComplete，callback 走 ref，避免每渲染重注册监听。
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    const listener = {
      componentDidAppear: () => {
        callbackRef.current()
      },
    }
    // Register the listener to all events related to our component
    const unsubscribe = Navigation.events().registerComponentListener(listener, componentId)
    return () => {
      // Make sure to unregister the listener during cleanup
      unsubscribe.remove()
    }
  }, [componentId])
}

export const onNavigationComponentDidDisappearEvent = (componentId: string, callback = () => {}) => {
  const listener = {
    componentDidDisappear: () => {
      callback()
    },
  }
  const unsubscribe = Navigation.events().registerComponentListener(listener, componentId)
  return unsubscribe
}

export const useNavigationComponentDidDisappear = (componentId: string, callback = () => {}) => {
  // A10-012：同 useNavigationComponentDidAppear。
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    const unsubscribe = onNavigationComponentDidDisappearEvent(componentId, () => { callbackRef.current() })
    return () => {
      // Make sure to unregister the listener during cleanup
      unsubscribe.remove()
    }
  }, [componentId])
}
