#!/usr/bin/env node
/**
 * K30：歌单「全量覆盖导入」的事务式回滚契约。
 *
 * 背景：`list_data_overwrite` 要分三段落库（saveUserList → removeListMusics → saveListMusics）。
 * 任一段失败都会让内存与磁盘错位；最坏组合是「元信息已写入、旧列表歌曲已删、新歌曲没写」，
 * 重启后用户看到的是一个空歌单（数据真丢）。
 *
 * 本门禁真实加载 `src/event/listEvent.ts`（ts.transpileModule + 注入 mock require），
 * 用可控抛错的存储层驱动四条路径：
 *   A1 正常覆盖成功（基线，防止回滚逻辑把成功路径也改了）
 *   A2 saveListMusics 失败 → 内存按快照重建 + 磁盘按快照重写
 *   A3 saveUserList 失败 → 同上
 *   A4 回滚自身也失败 → 内存仍必须恢复（同步段先于磁盘写回）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

let passed = 0
const failures = []
const queue = []
// 串行队列：四个用例共用 global.app_event / console.error，并发会互相污染
const check = (name, fn) => queue.push({ name, fn })
const assert = (c, m) => { if (!c) throw new Error(m) }

/** 加载一个 TS 文件，require 走注入表（'@/xxx' 与 './Event' 均可命中），未命中则回落真实 require */
const loadTs = (rel, mocks, cache) => {
  const file = path.join(ROOT, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  const fakeRequire = id => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id]
    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id]
    throw new Error('未 mock 的依赖: ' + id + '（在 ' + rel + ' 中）')
  }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(mod.exports, fakeRequire, mod, file, path.dirname(file))
  return mod.exports
}

/** 构造一套可控存储层：calls 记录调用，failAt 指定"第 N 次某函数抛错"，persist 保存"磁盘"快照 */
const makeStorage = () => {
  const state = {
    calls: [],
    userListWrites: [],
    musicWrites: [],
    failRules: {}, // { saveUserList: [1], saveListMusics: [1] } —— 第 N 次（1-based）抛错
    counters: {},
  }
  const hit = (fn, arg) => {
    state.counters[fn] = (state.counters[fn] || 0) + 1
    state.calls.push({ fn, n: state.counters[fn], arg })
    const rules = state.failRules[fn] || []
    if (rules.includes(state.counters[fn])) throw new Error('INJECTED_' + fn + '_#' + state.counters[fn])
  }
  return {
    state,
    api: {
      getUserLists: async() => [],
      getListMusics: async() => [],
      saveUserList: async(lists) => {
        hit('saveUserList')
        state.userListWrites.push(lists.map(l => ({ ...l })))
      },
      saveListMusics: async(listData) => {
        hit('saveListMusics')
        state.musicWrites.push(listData.map(d => ({ id: d.id, count: (d.musics || []).length })))
      },
      removeListMusics: async(ids) => { hit('removeListMusics', ids) },
      overwriteListPosition: async() => { hit('overwriteListPosition') },
      overwriteListUpdateInfo: async() => { hit('overwriteListUpdateInfo') },
      removeListPosition: async() => {},
      removeListUpdateInfo: async() => {},
    },
  }
}

/** 一次性装配环境：真实 listManage + 真实 listEvent，其余 mock */
const buildEnv = () => {
  const storage = makeStorage()
  const cache = {}
  const mocks = {
    '@/utils/data': storage.api,
    '@/utils/common': loadTs('src/utils/common.ts', {}, cache),
    '@/config/constant': loadTs('src/config/constant.ts', {}, cache),
    './Event': { __esModule: true, default: class Event { emit() {} } },
    '@/core/list': { setActiveList: () => {}, setUserList: () => {} },
    '@/store/list/state': { __esModule: true, default: { activeListId: '', allList: [] } },
  }
  const listManage = loadTs('src/utils/listManage.ts', mocks, cache)
  mocks['@/utils/listManage'] = listManage
  const listEvent = loadTs('src/event/listEvent.ts', mocks, cache)
  global.app_event = { myListMusicUpdate: () => {} }
  global.lx = {}
  return { storage, listManage, ListEvent: listEvent.ListEvent }
}

/** 造初始数据：旧歌单 OLD + default/love 各有歌 */
const seed = (env) => {
  const { listManage } = env
  listManage.userLists.splice(0, listManage.userLists.length, { id: 'OLD', name: '旧歌单', source: 'local', position: 1, locationUpdateTime: null })
  listManage.allMusicList.clear()
  listManage.allMusicList.set('OLD', [{ id: 's1', name: '旧歌1' }])
  listManage.allMusicList.set('default', [{ id: 's2', name: '默认歌' }])
  listManage.allMusicList.set('love', [{ id: 's3', name: '喜欢歌' }])
}

const payload = () => ({
  defaultList: [{ id: 'n1', name: '新默认' }],
  loveList: [{ id: 'n2', name: '新喜欢' }],
  userList: [{ id: 'NEW', name: '新歌单', list: [{ id: 'n3', name: '新歌1' }] }],
})

const snapshotOf = (env) => ({
  ids: env.listManage.userLists.map(l => l.id),
  musicIds: [...env.listManage.allMusicList.keys()].sort(),
  oldCount: (env.listManage.allMusicList.get('OLD') || []).length,
})

check('A1 正常覆盖成功（基线）', async() => {
  const env = buildEnv()
  seed(env)
  await new env.ListEvent().list_data_overwrite(payload())
  assert(env.listManage.userLists.map(l => l.id).join(',') === 'NEW', 'userLists 未切到新歌单')
  assert((env.listManage.allMusicList.get('NEW') || []).length === 1, '新歌单歌曲未写入内存')
  assert(env.storage.state.counters.saveListMusics >= 1, '未落库歌曲')
  assert(env.storage.state.counters.saveUserList >= 1, '未落库用户列表')
})

check('A2 saveListMusics 失败 → 内存与磁盘按快照重建', async() => {
  const env = buildEnv()
  seed(env)
  const before = snapshotOf(env)
  env.storage.state.failRules.saveListMusics = [1] // 导入路径第一次落库就失败
  let threw = false
  try {
    await new env.ListEvent().list_data_overwrite(payload())
  } catch (e) {
    threw = /INJECTED_saveListMusics/.test(e.message)
  }
  assert(threw, '原错误没有被抛出（回滚吞掉了异常）')
  const after = snapshotOf(env)
  assert(after.ids.join(',') === before.ids.join(','), 'userLists 未回到快照: ' + after.ids.join(','))
  assert(after.musicIds.join(',') === before.musicIds.join(','), 'allMusicList 键未回到快照: ' + after.musicIds.join(','))
  assert(after.oldCount === before.oldCount, '旧歌单歌曲未恢复')
  // 回滚必须真的重写磁盘（第 2 次调用是回滚）
  assert(env.storage.state.counters.saveListMusics >= 2, '回滚未重写磁盘歌曲（saveListMusics 只调了 ' + env.storage.state.counters.saveListMusics + ' 次）')
  assert(env.storage.state.counters.saveUserList >= 2, '回滚未重写磁盘用户列表')
})

check('A3 saveUserList 失败 → 同样回滚', async() => {
  const env = buildEnv()
  seed(env)
  const before = snapshotOf(env)
  env.storage.state.failRules.saveUserList = [1]
  let threw = false
  try {
    await new env.ListEvent().list_data_overwrite(payload())
  } catch (e) {
    threw = /INJECTED_saveUserList/.test(e.message)
  }
  assert(threw, '原错误没有被抛出')
  const after = snapshotOf(env)
  assert(after.ids.join(',') === before.ids.join(','), 'userLists 未回到快照')
  assert(after.musicIds.join(',') === before.musicIds.join(','), 'allMusicList 键未回到快照')
})

check('A4 回滚自身也失败 → 内存仍必须恢复', async() => {
  const env = buildEnv()
  seed(env)
  const before = snapshotOf(env)
  // 第 1 次（导入）与第 2 次（回滚）都失败
  env.storage.state.failRules.saveListMusics = [1, 2]
  const logs = []
  const origErr = console.error
  console.error = (...a) => { logs.push(a.join(' ')) }
  try {
    let threw = false
    try {
      await new env.ListEvent().list_data_overwrite(payload())
    } catch (e) {
      threw = /INJECTED_saveListMusics/.test(e.message)
    }
    assert(threw, '原错误没有被抛出')
    const after = snapshotOf(env)
    assert(after.ids.join(',') === before.ids.join(','), '回滚失败后内存 userLists 仍未恢复')
    assert(after.musicIds.join(',') === before.musicIds.join(','), '回滚失败后内存 allMusicList 仍未恢复')
    assert(logs.some(l => /K30/.test(l)), '回滚失败未记录日志')
  } finally {
    console.error = origErr
  }
})

;(async() => {
  for (const { name, fn } of queue) {
    try {
      await fn()
      passed++
      console.log('✓ ' + name)
    } catch (e) {
      failures.push(name + ' — ' + e.message)
      console.log('✗ ' + name + ' — ' + e.message)
    }
  }
  console.log('\n===== K30 歌单覆盖回滚：' + passed + ' 通过 / ' + failures.length + ' 失败 =====')
  if (failures.length) process.exit(1)
})()
