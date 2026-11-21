import { Alert } from 'react-native'
// import { exitApp } from '@/utils/common'
import { setJSExceptionHandler, setNativeExceptionHandler } from 'react-native-exception-handler'
import { log } from '@/utils/log'
import { toast } from './tools'
import { logger } from '@/utils/logger'

const errorHandler = (e: Error, isFatal: boolean) => {
  const excludedErrors = [
    'Failed to construct \'Response\'',
  ]
  if (isFatal) {
    // A07-006：native 桥回传的异常、或自定义 throw 的对象可能没有 message 字段，
    // 原写法 e.message.includes(...) 会让全局异常处理器自己二次抛错（最讽刺的路径）。
    if (excludedErrors.some((excludedError) => (e?.message ?? '').includes(excludedError))) {
      toast(global.i18n.t('toast_app_error'))
    } else {
      Alert.alert(
        '💥Unexpected error occurred💥',
        global.i18n.t('toast_app_error_detail'),
        [{
          text: '关闭 (Close)',
          onPress: () => {
            // exitApp()
          },
        }],
      )
    }
  }
  // A07-006 补充：e 本身为空（native 桥回传 null）时 e.stack 也会二次抛错
  log.error(e?.stack ?? String(e))
}

if (process.env.NODE_ENV !== 'development') {
  setJSExceptionHandler(errorHandler)

  setNativeExceptionHandler((errorString) => {
    log.error(errorString)
    logger.error('ErrorHandler', String(errorString))
  }, false)
}
