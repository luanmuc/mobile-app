#!/usr/bin/env node
/**
 * 下载列表恢复行为（N2）
 * 真实加载 src/core/downloadManager.ts，mock 存储/Store/RN 边界，
 * 验证重启后 run 任务被重置为 waiting，已完成任务原样保留，空存储不误写。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let ts
try {
  ts = require(path.resolve(ROOT, 'node_modules', 'typescript'))
} catch (e) {
  ts = require('typescript')
}

const loadTs = (rel, stubs) => {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf-8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (id) => {
    if (id in stubs) return stubs[id]
    return require(id)
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', output)
  fn(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

let failures = 0
let checks = 0
const run = async(name, fn) => {
  try { await fn(); checks++; console.log(`  ✓ ${name}`) } catch (e) {
    failures++; console.error(`  ✗ ${name}`)
    console.error(`    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`)
  }
}

const setup = () => {
  const store = { data: null, setListCalls: [] }
  global.i18n = { t: (key, params) => key === 'dl_status_waiting' ? '等待中' : key }
  const module = loadTs('src/core/downloadManager.ts', {
    'react-native': {
      Platform: { OS: 'android', Version: 33 },
      Linking: { openSettings: () => {} },
      Share: { share: async() => ({}) },
      Alert: { alert: () => {} },
      Vibration: { vibrate: () => {} },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DownloadDirectoryPath: '/download',
        TemporaryDirectoryPath: '/tmp',
        mkdir: async() => {},
        writeFile: async() => {},
        unlink: async() => {},
        getFSInfo: async() => ({ freeSpace: 1024 * 1024 * 1024 }),
        downloadFile: () => ({ promise: Promise.resolve({}) }),
      },
    },
    '@/config/constant': { LIST_IDS: { DOWNLOAD: 'download' }, storageDataPrefix: { downloadList: 'downloadList' } },
    '@/plugins/storage': { getData: async() => store.data, saveData: async() => {} },
    '@/store/download/action': {
      __esModule: true,
      default: { setList: (list) => { store.setListCalls.push(list) }, updateItem: () => {}, addItem: () => {} },
    },
    '@/store/download/state': { __esModule: true, default: { list: [] } },
    '@/store/setting/state': { __esModule: true, default: { setting: { 'download.maxTask': 1 } } },
    '@/core/music/online': { getMusicUrl: async() => '' },
    '@/core/music/utils': { getDownloadQuality: () => '128k', FULL_QUALITYS_LIST: ['128k'] },
    '@/utils/tools': {
      toast: () => {},
      requestStoragePermission: async() => true,
      formatMusicName: () => 'song',
      checkStoragePermissions: async() => true,
    },
    '@/utils/fs': { existsFile: async() => true, moveFile: async() => {}, unlink: async() => {} },
    '@/utils/fileNameTemplate': { formatFileNameTemplate: () => 'song' },
    '@/core/player/player': { playList: async() => {} },
    '@/utils/nativeModules/utils': {
      shareFile: async() => {},
      getWIFIIPV4Address: async() => '192.168.0.2',
      openFileInFileManager: async() => {},
      writeAudioTag: async() => {},
      isExternalStorageManager: async() => true,
    },
  })
  return { module, store }
}

console.log('\n[N2 download restore]')
;(async() => {
  await run('N2-D1 run 任务重启后重置为 waiting', async() => {
    const h = setup()
    h.store.data = [{
      id: 'a',
      isComplate: false,
      status: 'run',
      statusText: '下载中',
      statusKey: 'dl_status_running',
      progress: 0.5,
      downloaded: 100,
      speed: '1 MB/s',
      error: 'x',
      errorCode: 'network',
    }]
    return h.module.initDownloadList().then(() => {
      const item = h.store.setListCalls[0][0]
      assert.strictEqual(item.status, 'waiting')
      assert.strictEqual(item.statusKey, 'dl_status_waiting')
      assert.strictEqual(item.progress, 0)
      assert.strictEqual(item.downloaded, 0)
      assert.strictEqual(item.speed, '')
      assert.strictEqual(item.error, '')
      assert.strictEqual(item.errorCode, undefined)
    })
  })

  await run('N2-D2 已完成任务原样保留', async() => {
    const h = setup()
    h.store.data = [{
      id: 'b',
      isComplate: true,
      status: 'complate',
      statusKey: 'dl_status_completed',
      progress: 1,
      downloaded: 200,
      metadata: { fileName: 'song.mp3' },
    }]
    return h.module.initDownloadList().then(() => {
      const item = h.store.setListCalls[0][0]
      assert.strictEqual(item.status, 'complate')
      assert.strictEqual(item.progress, 1)
      assert.strictEqual(item.metadata.fileName, 'song.mp3')
    })
  })

  await run('N2-D3 空存储不调用 setList', async() => {
    const h = setup()
    h.store.data = null
    return h.module.initDownloadList().then(() => {
      assert.strictEqual(h.store.setListCalls.length, 0)
    })
  })

  console.log(`\n===== N2 下载恢复：${checks} 通过 / ${failures} 失败 =====`)
  process.exit(failures ? 1 : 0)
})()
