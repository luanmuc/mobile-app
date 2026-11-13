'use strict'

globalThis.lx_setup = (key, id, name, description, version, author, homepage, rawScript) => {
  delete globalThis.lx_setup
  const _nativeCall = globalThis.__lx_native_call__
  delete globalThis.__lx_native_call__
  const checkLength = (str, length = 1048576) => {
    if (typeof str == 'string' && str.length > length) throw new Error('Input too long')
    return str
  }
  const nativeFuncNames = [
    '__lx_native_call__set_timeout',
    '__lx_native_call__utils_str2b64',
    '__lx_native_call__utils_b642buf',
    '__lx_native_call__utils_str2md5',
    '__lx_native_call__utils_aes_encrypt',
    '__lx_native_call__utils_rsa_encrypt',
  ]
  const nativeFuncs = {}
  for (const name of nativeFuncNames) {
    const nativeFunc = globalThis[name]
    delete globalThis[name]
    nativeFuncs[name.replace('__lx_native_call__', '')] = (...args) => {
      for (const arg of args) checkLength(arg)
      return nativeFunc(...args)
    }
  }
  // const set_timeout = globalThis.__lx_native_call__set_timeout
  // delete globalThis.__lx_native_call__set_timeout
  // const utils_str2b64 = globalThis.__lx_native_call__utils_str2b64
  // delete globalThis.__lx_native_call__utils_str2b64
  // const utils_b642buf = globalThis.__lx_native_call__utils_b642buf
  // delete globalThis.__lx_native_call__utils_b642buf
  // const utils_str2md5 = globalThis.__lx_native_call__utils_str2md5
  // delete globalThis.__lx_native_call__utils_str2md5
  // const utils_aes_encrypt = globalThis.__lx_native_call__utils_aes_encrypt
  // delete globalThis.__lx_native_call__utils_aes_encrypt
  // const utils_rsa_encrypt = globalThis.__lx_native_call__utils_rsa_encrypt
  // delete globalThis.__lx_native_call__utils_rsa_encrypt
  const KEY_PREFIX = {
    publicKeyStart: '-----BEGIN PUBLIC KEY-----',
    publicKeyEnd: '-----END PUBLIC KEY-----',
    privateKeyStart: '-----BEGIN PRIVATE KEY-----',
    privateKeyEnd: '-----END PRIVATE KEY-----',
  }
  const RSA_PADDING = {
    OAEPWithSHA1AndMGF1Padding: 'RSA/ECB/OAEPWithSHA1AndMGF1Padding',
    NoPadding: 'RSA/ECB/NoPadding',
  }
  const AES_MODE = {
    CBC_128_PKCS7Padding: 'AES/CBC/PKCS7Padding',
    ECB_128_NoPadding: 'AES',
  }
  const nativeCall = (action, data) => {
    data = JSON.stringify(data)
    // console.log('nativeCall', action, data)
    checkLength(data, 2097152)
    _nativeCall(key, action, data)
  }

  const callbacks = new Map()
  let timeoutId = 0
  const _setTimeout = (callback, timeout = 0, ...params) => {
    if (typeof callback !== 'function') throw new Error('callback required a function')
    if (typeof timeout !== 'number' || timeout < 0) throw new Error('timeout required a number')
    if (timeoutId > 90000000000) throw new Error('max timeout')
    const id = timeoutId++
    callbacks.set(id, {
      callback(...args) {
        // eslint-disable-next-line n/no-callback-literal
        callback(...args)
      },
      params,
    })
    nativeFuncs.set_timeout(id, parseInt(timeout))
    return id
  }
  const _clearTimeout = (id) => {
    const tagret = callbacks.get(id)
    if (!tagret) return
    callbacks.delete(id)
  }
  const handleSetTimeout = (id) => {
    const tagret = callbacks.get(id)
    if (!tagret) return
    callbacks.delete(id)
    tagret.callback(...tagret.params)
  }

  // 将字节数组解码为字符串（UTF-8）
  function bytesToString(bytes) {
    let result = ''
    let i = 0
    while (i < bytes.length) {
      const byte = bytes[i]
      if (byte < 128) {
        result += String.fromCharCode(byte)
        i++
      } else if (byte >= 192 && byte < 224) {
        result += String.fromCharCode(((byte & 31) << 6) | (bytes[i + 1] & 63))
        i += 2
      } else {
        result += String.fromCharCode(((byte & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63))
        i += 3
      }
    }
    return result
  }
  // 将字符串编码为字节数组（UTF-8）
  function stringToBytes(inputString) {
    const bytes = []
    for (let i = 0; i < inputString.length; i++) {
      const charCode = inputString.charCodeAt(i)
      if (charCode < 128) {
        bytes.push(charCode)
      } else if (charCode < 2048) {
        bytes.push((charCode >> 6) | 192)
        bytes.push((charCode & 63) | 128)
      } else {
        bytes.push((charCode >> 12) | 224)
        bytes.push(((charCode >> 6) & 63) | 128)
        bytes.push((charCode & 63) | 128)
      }
    }
    return bytes
  }

  const NATIVE_EVENTS_NAMES = {
    init: 'init',
    showUpdateAlert: 'showUpdateAlert',
    request: 'request',
    cancelRequest: 'cancelRequest',
    response: 'response',
    // 'utils.crypto.aesEncrypt': 'utils.crypto.aesEncrypt',
    // 'utils.crypto.rsaEncrypt': 'utils.crypto.rsaEncrypt',
    // 'utils.crypto.randomBytes': 'utils.crypto.randomBytes',
    // 'utils.crypto.md5': 'utils.crypto.md5',
    // 'utils.buffer.from': 'utils.buffer.from',
    // 'utils.buffer.bufToString': 'utils.buffer.bufToString',
    // 'utils.zlib.inflate': 'utils.zlib.inflate',
    // 'utils.zlib.deflate': 'utils.zlib.deflate',
  }
  const EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
  }
  const eventNames = Object.values(EVENT_NAMES)
  const events = {
    request: null,
  }
  const allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'local']
  const supportQualitys = {
    kw: ['128k', '320k', 'flac', 'flac24bit'],
    kg: ['128k', '320k', 'flac', 'flac24bit'],
    tx: ['128k', '320k', 'flac', 'flac24bit'],
    wy: ['128k', '320k', 'flac', 'flac24bit'],
    mg: ['128k', '320k', 'flac', 'flac24bit'],
    local: [],
  }
  const verifyLyricInfo = (info) => {
    if (typeof info != 'object' || typeof info.lyric != 'string') throw new Error('failed')
    if (info.lyric.length > 51200) throw new Error('failed')
    return {
      lyric: info.lyric,
      tlyric: (typeof info.tlyric == 'string' && info.tlyric.length < 5120) ? info.tlyric : null,
      rlyric: (typeof info.rlyric == 'string' && info.rlyric.length < 5120) ? info.rlyric : null,
      lxlyric: (typeof info.lxlyric == 'string' && info.lxlyric.length < 8192) ? info.lxlyric : null,
    }
  }

  const requestQueue = new Map()
  let isInitedApi = false
  let isShowedUpdateAlert = false

  const sendNativeRequest = (url, options, callback) => {
    const requestKey = Math.random().toString()
    const requestInfo = {
      aborted: false,
      abort: () => {
        nativeCall(NATIVE_EVENTS_NAMES.cancelRequest, requestKey)
      },
    }
    requestQueue.set(requestKey, {
      callback,
      // timeout: setTimeout(() => {
      //   const req = requestQueue.get(requestKey)
      //   if (req) req.timeout = null
      //   nativeCall(NATIVE_EVENTS_NAMES.cancelRequest, requestKey)
      // }, 30000),
      requestInfo,
    })

    nativeCall(NATIVE_EVENTS_NAMES.request, { requestKey, url, options, sourceId: id })
    return requestInfo
  }
  const handleNativeResponse = ({ requestKey, error, response }) => {
    const targetRequest = requestQueue.get(requestKey)
    if (!targetRequest) return
    requestQueue.delete(requestKey)
    targetRequest.requestInfo.aborted = true
    // if (targetRequest.timeout) clearTimeout(targetRequest.timeout)
    if (error == null) targetRequest.callback(null, response)
    else targetRequest.callback(new Error(error), null)
  }

  // P0：v2 envelope 兼容。旧音源直接返回 raw；新音源返回 {ok:true,data} 或 {ok:false,error}。
  // 必须在 switch 之前解包，否则 musicUrl 分支会因 envelope 没有 url 字段而先失败。
  const unwrapResponse = (response) => {
    if (!response || typeof response != 'object' || typeof response.ok != 'boolean') return response
    if (response.ok) return response.data
    const error = response.error && typeof response.error == 'object' ? response.error : {}
    const code = typeof error.code == 'string' ? error.code : 'INTERNAL'
    const message = typeof error.message == 'string' && error.message ? error.message : 'unknown source error'
    const err = new Error(code + ': ' + message)
    err.code = code
    err.retryable = typeof error.retryable == 'boolean'
      ? error.retryable
      : (code == 'NETWORK' || code == 'TIMEOUT' || code == 'RATE_LIMITED')
    if (typeof error.stage == 'string') err.stage = error.stage
    throw err
  }

  const handleRequest = ({ requestKey, data }) => {
    // console.log(data)
    if (!events.request) return nativeCall(NATIVE_EVENTS_NAMES.response, { requestKey, status: false, errorMessage: 'Request event is not defined' })
    try {
      events.request.call(globalThis.lx, { source: data.source, action: data.action, info: data.info }).then(response => {
        response = unwrapResponse(response)
        let result
        switch (data.action) {
          case 'musicUrl': {
            // 兼容三种返回：字符串 URL（旧音源）；{url, type} 对象（v11.13+ 携带实际交付音质）；
            // {url, type, subSource, subSourceName, sourcePlatform}（v25.8+/b52+ 携带实际子源；v8.12.0 起携带实际平台）
            let musicUrl = response
            let actualType = data.info.type
            let subSource = ''
            let subSourceName = ''
            let sourcePlatform = ''
            if (typeof response === 'object' && response !== null && typeof response.url === 'string') {
              musicUrl = response.url
              if (typeof response.type === 'string') actualType = response.type
              if (typeof response.subSource === 'string') subSource = response.subSource
              if (typeof response.subSourceName === 'string') subSourceName = response.subSourceName
              // v8.12.0 跨平台兜底：实际交付平台（tx/wy/kw），旧音源无该字段时留空
              if (typeof response.sourcePlatform === 'string') sourcePlatform = response.sourcePlatform.slice(0, 16)
            }
            if (typeof musicUrl != 'string' || musicUrl.length > 2048 || !/^https?:/.test(musicUrl)) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: {
                type: actualType,
                url: musicUrl,
                subSource,
                subSourceName,
                sourcePlatform,
              },
            }
            break
          }
          case 'lyric':
            result = {
              source: data.source,
              action: data.action,
              data: verifyLyricInfo(response),
            }
            break
          case 'pic':
            if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'health':
            // v16.3：健康快照透传（聚合对象，App 设置页「音源健康」面板消费）
            if (typeof response != 'object' || response === null) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'toggle':
            // v16.5：源级开关透传（{id, enabled}，App 健康面板行内开关消费）
            if (typeof response != 'object' || response === null || typeof response.id != 'string' || typeof response.enabled != 'boolean') throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'probe':
            // v16.5：手动探测透传（{running, doneAt, round, active, sleeping}，App 健康面板手动探测消费）
            if (typeof response != 'object' || response === null) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'config':
            // v29.3：配置热更新透传（读模式返回当前配置对象；写模式返回 {updated, current}）
            if (typeof response != 'object' || response === null) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'trend':
            // v29.4：健康趋势透传（{history, maxPoints}，App 趋势图 Modal 消费）
            if (typeof response != 'object' || response === null) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'healthEvents':
            // 2.4：只读事件环形缓冲透传（{schema, capacity, dropped, events}，本地诊断消费）
            if (typeof response != 'object' || response === null || !Array.isArray(response.events)) throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'exportHealthState':
            // P3：健康元数据导出（{v, sourceVersion, savedAt, sources, qualityShortCircuit}）
            if (typeof response != 'object' || response === null || response.v !== 1 || typeof response.sources != 'object') throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
          case 'restoreHealthState':
            // P3：健康元数据恢复结果（{ok, reason?}）
            if (typeof response != 'object' || response === null || typeof response.ok != 'boolean') throw new Error('failed')
            result = {
              source: data.source,
              action: data.action,
              data: response,
            }
            break
        }
        nativeCall(NATIVE_EVENTS_NAMES.response, { requestKey, status: true, result })
      }).catch(err => {
        // console.log('handleRequest err', err)
        nativeCall(NATIVE_EVENTS_NAMES.response, { requestKey, status: false, errorMessage: err.message })
      })
    } catch (err) {
      // console.log('handleRequest call err', err)
      nativeCall(NATIVE_EVENTS_NAMES.response, { requestKey, status: false, errorMessage: err.message })
    }
  }

  const jsCall = (action, data) => {
    // console.log('jsCall', action, data)
    switch (action) {
      case '__run_error__':
        if (!isInitedApi) isInitedApi = true
        return
      case '__set_timeout__':
        handleSetTimeout(data)
        return
      case 'request':
        handleRequest(data)
        return
      case 'response':
        handleNativeResponse(data)
        return
    }
    return 'Unknown action: ' + action
  }

  Object.defineProperty(globalThis, '__lx_native__', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: (_key, action, data) => {
      if (key != _key) return 'Invalid key'
      return data == null ? jsCall(action) : jsCall(action, JSON.parse(data))
    },
  })


  /**
   *
   * @param {*} info {
   *                    sources: {
   *                         kw: ['128k', '320k', 'flac', 'flac24bit'],
   *                         kg: ['128k', '320k', 'flac', 'flac24bit'],
   *                         tx: ['128k', '320k', 'flac', 'flac24bit'],
   *                         wy: ['128k', '320k', 'flac', 'flac24bit'],
   *                         mg: ['128k', '320k', 'flac', 'flac24bit'],
   *                     }
   *                 }
   */
  const handleInit = (info) => {
    if (!info) {
      nativeCall(NATIVE_EVENTS_NAMES.init, { info: null, status: false, errorMessage: 'Missing required parameter init info' })
      // sendMessage(NATIVE_EVENTS_NAMES.init, false, null, typeof info.message === 'string' ? info.message.substring(0, 100) : '')
      return
    }
    // if (!info.status) {
    //   nativeCall(NATIVE_EVENTS_NAMES.init, { info: null, status: false, errorMessage: 'Init failed' })
    //   // sendMessage(NATIVE_EVENTS_NAMES.init, false, null, typeof info.message === 'string' ? info.message.substring(0, 100) : '')
    //   return
    // }
    const sourceInfo = {
      sources: {},
    }
    try {
      for (const source of allSources) {
        const userSource = info.sources[source]
        if (!userSource || userSource.type !== 'music') continue
        const qualitys = supportQualitys[source] || []
        if (!Array.isArray(userSource.actions)) throw new Error('actions is required')
        if (!Array.isArray(userSource.qualitys)) throw new Error('qualitys is required')
        sourceInfo.sources[source] = {
          type: 'music',
          actions: userSource.actions,
          qualitys: qualitys.filter(q => userSource.qualitys.includes(q)),
          fallbackOwner: userSource.fallbackOwner,
        }
      }
    } catch (error) {
      // console.log(error)
      nativeCall(NATIVE_EVENTS_NAMES.init, { info: null, status: false, errorMessage: error.message })
      return
    }
    nativeCall(NATIVE_EVENTS_NAMES.init, { info: sourceInfo, status: true })
  }
  const handleShowUpdateAlert = (data, resolve, reject) => {
    if (!data || typeof data != 'object') return reject(new Error('parameter format error.'))
    if (!data.log || typeof data.log != 'string') return reject(new Error('log is required.'))
    // b79：updateUrl 校验修正——旧实现 `!regex.test && length>1024` 三个条件同时满足才删除，
    // 非法但短于 1024 的 URL 会原样保留透传给原生弹窗；现改为非法/非字符串/超长任一命中即剔除
    if (data.updateUrl && (typeof data.updateUrl != 'string' || data.updateUrl.length > 1024 || !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(data.updateUrl))) delete data.updateUrl
    if (data.log.length > 1024) data.log = data.log.substring(0, 1024) + '...'
    nativeCall(NATIVE_EVENTS_NAMES.showUpdateAlert, { log: data.log, updateUrl: data.updateUrl, name })
    resolve()
  }

  const dataToB64 = (data) => {
    if (typeof data === 'string') return nativeFuncs.utils_str2b64(data)
    else if (Array.isArray(data) || ArrayBuffer.isView(data)) return utils.buffer.bufToString(data, 'base64')
    throw new Error('data type error: ' + typeof data + ' raw data: ' + data)
  }
  const utils = {
    crypto: {
      aesEncrypt(buffer, mode, key, iv) {
        // console.log('aesEncrypt', buffer, mode, key, iv)
        switch (mode) {
          case 'aes-128-cbc':
            return utils.buffer.from(nativeFuncs.utils_aes_encrypt(dataToB64(buffer), dataToB64(key), dataToB64(iv), AES_MODE.CBC_128_PKCS7Padding), 'base64')
          case 'aes-128-ecb':
            return utils.buffer.from(nativeFuncs.utils_aes_encrypt(dataToB64(buffer), dataToB64(key), '', AES_MODE.ECB_128_NoPadding), 'base64')
          default:
            throw new Error('Binary encoding is not supported for input strings')
        }
      },
      rsaEncrypt(buffer, key) {
        // console.log('rsaEncrypt', buffer, key)
        if (typeof key !== 'string') throw new Error('Invalid RSA key')
        key = key.replace(KEY_PREFIX.publicKeyStart, '')
          .replace(KEY_PREFIX.publicKeyEnd, '')
        return utils.buffer.from(nativeFuncs.utils_rsa_encrypt(dataToB64(buffer), key, RSA_PADDING.NoPadding), 'base64')
      },
      randomBytes(size) {
        const byteArray = new Uint8Array(size)
        // b79：加密安全随机优先——RN/Hermes 提供 crypto.getRandomValues 时使用（第三方音源签名场景防预测），
        // 不可用时降级 Math.random（原实现；仅做能力检测，不引入额外依赖）
        if (typeof globalThis.crypto === 'object' && globalThis.crypto !== null && typeof globalThis.crypto.getRandomValues === 'function') {
          globalThis.crypto.getRandomValues(byteArray)
        } else {
          for (let i = 0; i < size; i++) {
            byteArray[i] = Math.floor(Math.random() * 256) // 随机生成一个字节的值（0-255）
          }
        }
        return byteArray
      },
      md5(str) {
        if (typeof str !== 'string') throw new Error('param required a string')
        const md5 = nativeFuncs.utils_str2md5(encodeURIComponent(str))
        // console.log('md5', str, md5)
        return md5
      },
    },
    buffer: {
      from(input, encoding) {
        // console.log('buffer.from', input, encoding)
        if (typeof input === 'string') {
          switch (encoding) {
            case 'binary':
              throw new Error('Binary encoding is not supported for input strings')
            case 'base64':
              return new Uint8Array(JSON.parse(nativeFuncs.utils_b642buf(input)))
            case 'hex':
              return new Uint8Array(input.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
            default:
              return new Uint8Array(stringToBytes(input))
          }
        } else if (Array.isArray(input)) {
          return new Uint8Array(input)
        } else {
          throw new Error('Unsupported input type: ' + input + ' encoding: ' + encoding)
        }
      },
      bufToString(buf, format) {
        // console.log('buffer.bufToString', buf, format)
        if (Array.isArray(buf) || ArrayBuffer.isView(buf)) {
          switch (format) {
            case 'binary':
              // return new TextDecoder('latin1').decode(new Uint8Array(buf))
              return buf
            case 'hex':
              return new Uint8Array(buf).reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '')
            case 'base64':
              return nativeFuncs.utils_str2b64(bytesToString(Array.from(buf)))
            case 'utf8':
            case 'utf-8':
            default:
              return bytesToString(Array.from(buf))
          }
        } else {
          throw new Error('Input is not a valid buffer: ' + buf + ' format: ' + format)
        }
      },
    },
    // zlib: {
    //   inflate(buf) {
    //     return new Promise((resolve, reject) => {
    //       zlib.inflate(buf, (err, data) => {
    //         if (err) reject(new Error(err.message))
    //         else resolve(data)
    //       })
    //     })
    //   },
    //   deflate(data) {
    //     return new Promise((resolve, reject) => {
    //       zlib.deflate(data, (err, buf) => {
    //         if (err) reject(new Error(err.message))
    //         else resolve(buf)
    //       })
    //     })
    //   },
    // }),
  }

  globalThis.lx = {
    EVENT_NAMES,
    request(url, { method = 'get', timeout, headers, body, form, formData, binary }, callback) {
      let options = { headers, binary: binary === true }
      // let data
      // if (body) {
      //   data = body
      // } else if (form) {
      //   data = form
      //   // data.content_type = 'application/x-www-form-urlencoded'
      //   options.json = false
      // } else if (formData) {
      //   data = formData
      //   // data.content_type = 'multipart/form-data'
      //   options.json = false
      // }
      if (timeout && typeof timeout == 'number' && timeout > 0) options.timeout = Math.min(timeout, 60_000)

      let request = sendNativeRequest(url, { method, body, form, formData, ...options }, (err, resp) => {
        if (err) {
          callback(err, null, null)
        } else {
          callback(err, {
            statusCode: resp.statusCode,
            statusMessage: resp.statusMessage,
            headers: resp.headers,
            // bytes: resp.bytes,
            // raw: resp.raw,
            body: resp.body,
          }, resp.body)
        }
      })

      return () => {
        if (!request.aborted) request.abort()
        request = null
      }
    },
    send(eventName, data) {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) return reject(new Error('The event is not supported: ' + eventName))
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (isInitedApi) return reject(new Error('Script is inited'))
            isInitedApi = true
            handleInit(data)
            resolve()
            break
          case EVENT_NAMES.updateAlert:
            if (isShowedUpdateAlert) return reject(new Error('The update alert can only be called once.'))
            isShowedUpdateAlert = true
            handleShowUpdateAlert(data, resolve, reject)
            break
          default:
            reject(new Error('Unknown event name: ' + eventName))
        }
      })
    },
    on(eventName, handler) {
      if (!eventNames.includes(eventName)) return Promise.reject(new Error('The event is not supported: ' + eventName))
      switch (eventName) {
        case EVENT_NAMES.request:
          events.request = handler
          break
        default: return Promise.reject(new Error('The event is not supported: ' + eventName))
      }
      return Promise.resolve()
    },
    utils,
    currentScriptInfo: {
      name,
      description,
      version,
      author,
      homepage,
      rawScript,
    },
    version: '2.0.0',
    env: 'mobile',
  }

  globalThis.setTimeout = _setTimeout
  globalThis.clearTimeout = _clearTimeout

  const freezeObject = (obj) => {
    if (typeof obj != 'object') return
    Object.freeze(obj)
    for (const subObj of Object.values(obj)) freezeObject(subObj)
  }
  freezeObject(globalThis.lx)

  const _toString = Function.prototype.toString
  // eslint-disable-next-line no-extend-native
  Function.prototype.toString = function() {
    return Object.getOwnPropertyDescriptors(this).name.configurable
      ? _toString.apply(this)
      : `function ${this.name}() { [native code] }`
  }
  // eslint-disable-next-line no-eval
  globalThis.eval = function() {
    throw new Error('eval is not available')
  }
  const proxyFunctionConstructor = new Proxy(Function.prototype.constructor, {
    apply() {
      throw new Error('Dynamic code execution is not allowed.')
    },
    construct() {
      throw new Error('Dynamic code execution is not allowed.')
    },
  })
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Function.prototype, 'constructor', {
    value: proxyFunctionConstructor,
    writable: false,
    configurable: false,
    enumerable: false,
  })
  globalThis.Function = proxyFunctionConstructor
  // globalThis.Function = function() {
  //   throw new Error('Function is not available')
  // }

  const excludes = [
    Function.prototype.toString,
    Function.prototype.toLocaleString,
    Object.prototype.toString,
  ]
  const freezeObjectProperty = (obj, freezedObj = new Set()) => {
    if (obj == null) return
    switch (typeof obj) {
      case 'object':
      case 'function':
        if (freezedObj.has(obj)) return
        // Object.freeze(obj)
        freezedObj.add(obj)
        for (const [name, { ...config }] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
          if (!excludes.includes(config.value)) {
            if (config.writable) config.writable = false
            if (config.configurable) config.configurable = false
            Object.defineProperty(obj, name, config)
          }
          freezeObjectProperty(config.value, freezedObj)
        }
    }
  }
  freezeObjectProperty(globalThis)

  console.log('Preload finished.')
}
