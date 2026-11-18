# 上游基座对照基线（UPSTREAM BASELINE）

> 规则正文见 [`DEV_CONVENTIONS.md` 第八章](DEV_CONVENTIONS.md)。
> 本文档只记录**基线在哪、怎么拿、怎么用**，以及已判定的 B 档（不改）清单。

## 一、基线坐标

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/lyswhut/lx-music-mobile` |
| Tag | `v1.9.2` |
| Commit | `0669d1b`（提交信息「发布 v1.9.2」） |
| 本仓底座升级提交 | `2459ccd7 feat: 底座升级至 v1.9.2` |
| 本仓最后一条上游作者提交 | `fb848072 发布 v1.9.1`（2026-09-19） |

> ⚠️ 本仓的底座升级是**一次性合并、不保留上游提交历史**，所以 `git log` 里查不到上游演进，
> 必须按下面的命令单独拉一份上游源码做对照。

## 二、拉取基线

```bash
cd /tmp && rm -rf upstream-lx
git clone --depth 1 --branch v1.9.2 https://github.com/lyswhut/lx-music-mobile upstream-lx
git -C /tmp/upstream-lx log -1        # 应为 0669d1b 发布 v1.9.2
export LX_UPSTREAM_ROOT=/tmp/upstream-lx
```

`/tmp` 重启会清空，需要时重跑上面三行即可（约 30 秒）。

## 三、日常用法

```bash
# 动手前：查这个文件在基座里是什么状态（定制文件 / 有差异 / 零差异 / 有无留痕）
node scripts/check_upstream_divergence.js --file=src/core/music/local.ts

# 看具体差异
diff -u $LX_UPSTREAM_ROOT/src/core/music/local.ts src/core/music/local.ts

# 文件上游根本没有 → 定制文件，按项目口径维护
ls $LX_UPSTREAM_ROOT/src/<路径>

# 全仓分档审计
node scripts/check_upstream_divergence.js
node scripts/check_upstream_divergence.js --list
```

## 四、已判定为 B 档（上游有意设计，不改）

| 编号 | 文件 | 上游行为 | 为什么不改 |
|---|---|---|---|
| A02-002 | `src/core/music/local.ts` | 8 处 `try { return await handler(result) } catch {}` | 多策略探测链：一个策略失败就试下一个，空 catch 是有意设计。与上游逐字一致（仅多 `import { Buffer }`） |
| A06-008 | `src/screens/Comment/components/CommentImage.tsx` | `getSize(url, cb)` 只有成功回调 | 坏图时 `wh` 保持 `{0,0}` → 组件渲染 `null`（不显示），属可接受的体验取舍。与上游零差异 |
| A11-017 | `android/.../user-api-preload.js` + `AES.java` | `ECB_128_NoPadding: 'AES'`（常量名与实现不一致） | 第三方可观察行为：改成 `NoPadding` 会让第三方音源拿到的密文从 32 字节变 16 字节，而我方音源根本不调用 → 零收益、有破坏。**已完整还原** |
| A02-012 | `src/core/sourceUpdate/plan.ts` | 版本正则只取三段数字 | 比较对象是音源 `@version`（统一 `x.y.z`），不带 `-bN` |
| A08-017 | `src/utils/officialVersion.ts` | `compareOfficialVersion` 不识别 `-bN` | 函数注释明确「官方版本无 b 构建序号」，官方 tag 就是 `v1.9.2` |
| A09-017 | `src/components/common/Image.tsx` | `clearMemoryCache` 空实现 | 全仓零调用方（死代码） |
| A08-009 | `src/utils/request.js` | `formData` 分支误遍历 `options.form` | `src` 内零调用方传 `formData`，属潜伏；修它等于开发 multipart 构造 |
| A10-008 | `src/navigation/components/VersionModal.tsx` | 可空 `newVersion` 用非空断言 | 当前分支组合下不可达（`ignoreBtn.show=false` 或被占位对象填充） |

> 新增 B 档判定请追加到本表，并在 `PROGRESS-通读进度.md` 记一条。

## 五、已判定为 A 档（上游真缺陷，已改并留痕）

摘要（完整列表见提交信息与 `PROGRESS-通读进度.md`）：

- `mg/musicSearch.js` 封面前缀判定检测对象错（A07-024）—— 上游同样写法
- `Tx/lyric.js` 并发去重把 promise 对象当 Map 键（A08-001）
- `SonglistDetail/listAction.ts` 查找用复合键、落库写裸 id（A06-004/005）
- `core/leaderboard.ts` 可选链只保护前半截（A01-011）
- `Wy/songList.js` 先解引用再判空 + 重试错调接口（A08-003/004/007）
- `Backup/actions.ts` `allLists.shift()!.list` 解引用 undefined（A05-003）
- `Comment/Hot+New` 守卫未判 `music[source]` 为空（A06-019）
- `desktopLyric.ts` 两处 `getPosition().then` 缺 catch（A01-020）

---

## 已判定不改 · 全量清单（2026-11-19 定案）

判据：A = 上游真缺陷（已修，代码内有 `A<编号>` 注释）；B = 上游有意设计 / 性能取舍 / 架构选择；
C = 防御性加固 / 日志增强 / 命名规范 / 我方不使用的路径。**只有 A 档才改**。

### B 档（上游有意设计，不得擅改）

| 编号 | 内容 | 判据 |
|---|---|---|
| A02-002 | `core/music/local.ts` 8 处空 catch | 多策略依次尝试，失败链内层原因本就可忽略 |
| A02-006 | `player.ts` 多处裸 `setTimeout` | 定时回调不持有组件生命周期，无需统一封装 |
| A02-012 | `plan.ts` 版本正则只取三段 | 比较对象是音源 `@version`，统一 `x.y.z` |
| A02-014 | `repeatMode` 未知模式回退 `listLoop` | 设置层只产出五种合法值 |
| A02-017 | `sync.ts` 用 `reject(Error('cancel'))` 表示取消 | 取消语义，调用方按约定区分 |
| A03-P2-2 | `mylistToggled` 方法名与 emit 的 `listToggled` 不一致 | 事件名对外一致，监听方正常收到 |
| A03-P2-3 | 多组 store action 改状态后不发事件 | 命令式缓存，事件只在特定路径发 |
| A03-P2-4 | 同步消息加密段被注释 | 功能取舍：当前走 gzip |
| A06-008 | `CommentImage` `getSize` 无失败回调 | 与 A09-010 同类，坏图不显示 |
| A06-016 | `PlayLine` 点击 seek 时间 | `handlePlayLine` 无 `useCallback`，读的是当前渲染值，无陈旧窗口 |
| A06-018 | 歌词滚动两处空 catch | 滚动失败不应中断播放，静默是有意 |
| A06-020 | 横竖屏切换详情页卸载重建 | RN 组件树限制，非缺陷 |
| A07-025 | 各音源内存缓存无上限 | 单曲维度缓存，量级可控 |
| A08-009 | `request.js` formData 分支误遍历 `options.form` | 全仓无调用方传 formData，潜伏 |
| A08-011 | 网易云 `Refere` 拼写 | 代码里都是正确的 `Referer`，findings 误读 |
| A08-015 | `pixelRatio.ts` 尺寸快照 | 屏幕尺寸在进程生命周期内基本不变 |
| A08-016 | `xm.js` 桩返回形状不一致 | 废弃桩源，全部 `Promise.reject` |
| A08-017 | `officialVersion.ts` 不识别 `-bN` | 官方版本无 b 构建序号 |
| A09-009 | `OnlineList` memo 比较器忽略回调 | 性能取舍：主题切换需滚动才刷新 |
| A09-010 | `ScaledImage` `getSize` 无失败回调 | 同 A06-008 |
| A09-015 | `SearchTipList` `heightRef` 为 0 不显示 | 未测量完不显示，避免浮层定位错误 |
| A09-016 | `SourceSelector` 初始 `'kw'` | 占位值，`setSourceList` 立刻覆盖 |
| A09-017 | `Image.clearMemoryCache` 空实现 | 全仓零调用方，死代码 |
| A09-018 | Modal `onHide` 双调 | 仅父组件主动调 ref 才发生 |
| A10-011 | `onModalDismissed` 监听在 id 不匹配时不释放 | 等待自己的目标 modal 关闭，有 cleanup 兜底 |
| A10-014 | `getTheme` 的 `theme.id == 'auto'` 判断 | 正是「用户选了自动主题」的必要条件 |
| A11-017 | `user-api-preload.js` 的 `ECB_128_NoPadding: 'AES'` | 上游自身常量名与实现不一致；本仓音源不调用，改动会改变第三方拿到的密文长度 |
| A11-022 | `LyricView` 继承 `Activity` | 历史架构，未实际 startActivity，不影响运行 |
| A11-011 | Manifest 未声明前台服务/唤醒锁 | rntp 的 manifest 自带 `WAKE_LOCK`/`FOREGROUND_SERVICE`/service，merger 会带上；targetSdk 29 不需要 `MEDIA_PLAYBACK` |
| A11-016 | 网络安全配置全局允许明文 HTTP | 已知取舍（音源/自定义源可能用 http） |
| A13-P2-02 | `docs-audit.js` 恒 `process.exit(0)` | 它是自动修复器，workflow 用 git diff 判断 |
| A13-P2-09 | `package.json` 的 `repository.url` 指向上游 | 元数据，本仓不发布 npm |

### C 档（防御性加固 / 日志 / 规范 / 未触发）

| 编号 | 内容 | 判据 |
|---|---|---|
| A01-004 | 硬编码中文写进持久化 `statusText` | 有 `statusKey` 兜底，显示正确 |
| A01-009 | `playSonglist` 丢弃原始错误 | 日志增强（脱敏门禁限制裸打错误对象） |
| A01-010 | `metadata.ext` 恒 `'mp3'` | `ext` 字段全仓无消费方，死字段 |
| A01-013 | `userApi/request.js` formData 分支同病 | 同 A08-009，无调用方 |
| A01-014 | 桥接请求 `canceleFn` 空实现 | 功能缺失，需产品决策 |
| A01-015 | 排行榜缓存无上限 | 设计问题，量级可控 |
| A01-016 | 热搜失败仅 `console.log` | 日志增强 |
| A01-019 | 内置源导入后直接改写 `state.setting` | 持久化已跟上，事件非必须 |
| A02-004 | 取链判据失败重复记 attempts | 统计精度，不影响决策 |
| A02-005 | 飞去重忽略 `isRefresh` | 设计取舍 |
| A02-008 | 已缓存封面不做可达性校验 | 增加网络请求，得不偿失 |
| A02-010 | 健康持久化按 UTF-16 码元计量 | 上限是软约束，差几倍字节可接受 |
| A02-011 | 在线更新用 `TextDecoder` | 全仓仅此一处，环境支持 |
| A02-013 | `playCount.ts:85` 遗留 tsc 报错 | **该行 tsc 实际通过，findings 过时** |
| A02-015 | `search/music.ts` 非空断言 | 已修（A 档，见代码注释） |
| A02-016 | `getOfficialVersionShown` 在 try 外 | 已修（A 档） |
| A02-018 | `local.ts` 多 `-` 丢第三段 | 已修（A 档） |
| A03-P2-9 | 搜索分页复位不一致 | `MusicList.tsx:75` 有 `list.length` 兜底 |
| A03-P2-11 | 同步两模块 MD5 口径不一致 | 算法不同但都自洽 |
| A04-003 | `ActiveListName` 用 `let` 声明状态 | 纯规范 |
| A04-007 | 排序弹窗不重置 / 不查重名 | UX 细节，非缺陷 |
| A04-013 | 下载页 FlatList ref 覆盖 | 分区按需渲染，实际不并发 |
| A04-015 | 类型名/函数名拼写 | 纯规范 |
| A05-008 | 无 config 仍弹「已保存」 | 提示语义偏差 |
| A05-010 | 「上次检查时间」提前写入 | 统计语义 |
| A05-015 | 仓库残留 `.bak` | **已删除** |
| A05-016 | i18n 键名含空格 | 只影响命名规范 |
| A05-017 | 部分列表用 index 作 key | 列表项无重排 |
| A05-018 | 设置持久化 fire-and-forget | 保存失败由下一次写入覆盖 |
| A05-019 | 音质档位挂载读一次全局 | 音源切换会重新挂载 |
| A06-009 | `TimeoutExitBtn` 死代码副本 | 未挂载 |
| A07-007 | `fs.ts` 路径无平台兜底 | 仅 Android |
| A07-010 | `data.ts` 多键保存非原子 | 底层 storage 已原子化 |
| A07-013 | `dislikeManage` 并发覆盖 | `addDislikeInfo` 无 await，天然串行 |
| A07-014 | `message.ts` 文案硬编码 | 文案被当错误标识符做相等比较，需引入错误码（设计变更） |
| A07-027 | `mg/lyric.js` 返回形状 | 与其它源一致，调用方已适配 |
| A08-010 | 五个 native 桥未判注册 | 五个模块都是我们 android 侧确实注册的 |
| A08-013 | 简繁库 `simplify` 导出缺失 | App 只用 `tranditionalize` |
| A08-019 | 非 JSON 响应解析失败空 catch | 日志增强，与脱敏门禁冲突 |
| A08-021 | 两个提示弹窗文案硬编码 | i18n 增强 |
| A09-011 | 空音质集回退 128k | 极端兜底 |
| A09-014 | `ChoosePath` 模块级 Map 无上限 | 目录缓存，量级可控 |
| A09-019 | 加入歌单 catch 仅 toast | 日志增强，与脱敏门禁冲突 |
| A09-024 | `TextAreaItem` 缺 `onOnlineMatch` 仍渲染按钮 | 唯一调用方同时传两个 |
| A10-002 | 自动暗色回退内置 `black` | 合理回退 |
| A10-004 | `Toast.js` 死 Demo | **已删除** |
| A10-007 | `SavedPlayInfo.listId` 类型 | 类型宽松，运行无碍 |
| A10-009 | `UserApiRequestParams` 重复声明 | interface 合并，字段一致 |
| A10-010 | `SyncModeModal` 空依赖回填 | 重挂载场景需要导航层变更 |
| A10-012 | 导航 hooks 回调入依赖 | 已修（A 档） |
| A10-013 | 主题 `var()` 缺键静默 undefined | 正常配置不会缺键 |
| A10-015 | 弹窗遮罩色硬编码 | 常规做法 |
| A10-016 | App 侧挡不住 native rntp 问题 | rntp 仓已单独处理 |
| A11-012/013/014/028/029 | iOS 相关 | 本仓不发 iOS |
| A11-015 | FileProvider 路径未覆盖私有目录 | 当前用途不需要 |
| A11-018 | ProGuard keep 面不全 | 需真机混淆验证，登记待观察 |
| A11-024 | 缓存统计异常被吞 | 日志增强 |
| A11-026/027 | 死类与未使用 import | **已清理** |
| A11-030 | `resolve(null)` / `IS_PENDING` / `listenerCount` 下限 | 防御性 |
| A11-031 | `AsyncTask` 泛型形参名遮蔽 | 命名规范 |
| A11-032 | preload 定时器取消不通知 native | 空转无害 |
| A11-033 | media3 扩展 `compileOnly` | 构建配置取舍 |
| A12-008/009/010/011/013/014 | 门禁脚本硬编码阈值/锚点/基线 | 登记待设计 |
| A13-P2-01 | `check_source_ci_gate.js` 注释与实现不符 | **已修** |
| A13-P2-03 | `test.js` 硬编码 RSA 密钥对 | 测试用固定密钥，非生产凭证 |
| A13-P2-05~08/10~16 | 发布链/元数据/`.gitignore`/`release.yml` | 发布流程类，登记待设计 |

**统计**：A 档已修 60+ 条（代码内 `A<编号>` 注释可检索）；B 档 33 条；C 档 65 条。
**剩余真正未定案：0 条**（含 A11-018 一条「已登记待真机混淆验证」）。

---

## P1 上游对照结论（2026-11-19）

**方法**：① 71 条 P1 按 `A<编号>` 留痕定位已修文件；② 6 条无留痕逐条追查；③ 63 个上游存在的文件用 difflib 统计删除量，删除 ≥3 行的只有 3 个（`log.ts` / `version.js` / `SonglistDetail-listAction.ts`），逐个 diff 验证；④ 抽样核对上游原行。

**6 条无留痕的真相**

| 编号 | 真相 |
|---|---|
| A05-004 | 手动更新音源未走验签链 → **K29 待设计**，未修（正确） |
| A11-010 | release Flipper 桩包名 → **K32 待设计**，未修（正确） |
| A12-007 | 接线断言整行匹配 → **K33 待设计**，未修（正确） |
| A09-001 | 两列 `getItemLayout` → findings 已标「复核：证伪（误报）」；RN 两列模式下传给 `getItemLayout` 的 index 本身就是行索引，`ITEM_HEIGHT * index` 正确 |
| **A07-001** | `lrcTools.ts` 的 `timeFieldExp` 带 `/g`，循环内 `exec` 后 `lastIndex` 残留 → **真漏修，本轮已补**（两处 exec 前重置） |
| **A07-018** | `kw/lyric.js` 的 `timeExp` 同类问题 → **真漏修，本轮已补** |

**已修 62 条的上游对照：无一条误修**

抽样验证（每条都比对了上游原行）：

| 编号 | 上游真实写法 | 判定 |
|---|---|---|
| A01-011 | `musicSdk[source]?.leaderboard.getBoards()` | 可选链只保护前半截，源无排行榜时 `undefined.getBoards()` → 真缺陷 |
| A07-016 | `albumInfo.replaceAll('{size}', '480')` | `albumInfo` 是接口返回对象，在对象上调字符串方法 → 真缺陷 |
| A08-001 | `promises.set(promise)` + `has/get` 用 `songmid` | 键不一致，并发去重完全失效且 Map 永不释放 → 真缺陷 |
| A06-005 | 整条 await 链无 catch | 拉取/写库失败只进未处理 rejection → 真缺陷 |
| A08-006 | `cdn.jsdelivr.net/gh/<author>/<name>/publish/...` 缺 `@master` | jsdelivr 会把 `master` 当文件路径返回 404 → 真缺陷 |

**定制重写不算误修**：`log.ts`（121→325 行，双通道日志 + 权限降级）、`version.js`（更新源换成本仓发布仓 + npmmirror 通道）属定制改造，上游无对照基准；`log.ts` 的导出面 `init / log / getLogs / clearLogs` 完整保留（`getLogs`/`clearLogs` 另扩了 `category` 参数）。

**结论**：P1 层面发现并补修 **2 条漏修**（A07-001 / A07-018），未发现误修。

---

## 上游文件删除清单（须 A 档论证）

按 8.3 第一条「上游零差异默认不得改」，**删除上游已有文件必须逐条论证**。当前仅 1 条实际删除：

| 文件 | 与上游关系 | 判定 | 论证 |
|---|---|---|---|
| `test.js` | 上游零差异（126 行） | **A 档，已删** | ① L56-79 硬编码 RSA 2048 **私钥明文入库**，任何 clone 者都能取得，是安全审计的明确问题；② 上游 `index.js:6` 的 `import './test'` 本就处于注释状态，全仓无任何引用 → 死代码；③ 随时可从上游 v1.9.2（`0669d1b`）取回，无信息损失 |
| `dependencies-patch.js` | 上游零差异（空壳） | **C 档，不改（误删后已恢复）** | `patchs` 数组为空、`package.json` 无 `postinstall` 调用 → 上游自身的死壳；删它只是清理上游遗留，不产生功能或安全收益，按 8.3 第一条不动 |

> 教训（2026-11-19）：清理上游文件前必须先 `diff -u` 上游版本，确认是否零差异；零差异一律不动，除非能论证到 A 档。本轮一度把 `dependencies-patch.js` 一起删掉，核对后已恢复。
