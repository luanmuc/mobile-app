# 上游合并指南（Upstream Merge Guide）

本仓库 `luanmuc/mobile-app` 是 [lyswhut/lx-music-mobile](https://github.com/lyswhut/lx-music-mobile) 的定制 fork。
本文档说明如何把原版（上游）后续更新合并进来，以及冲突处理策略。

> 面向用户的定制功能清单与默认设置差异见 [README.md](../README.md)；多账号分工与提交规范见 [docs/DEV_CONVENTIONS.md](DEV_CONVENTIONS.md)；版本号与发布流程见 [docs/RELEASE_SOP.md](RELEASE_SOP.md)。

## 仓库关系

- 上游：`https://github.com/lyswhut/lx-music-mobile.git`（remote 名 `upstream`）
- 分叉点：`fb848072`（原版 v1.9.1）
- 上游进度：已合并至 **v1.9.2**（`0669d1b6`，2026-11-01 合入；实质变更见 [CUSTOM_CHANGELOG.md](./CUSTOM_CHANGELOG.md) v1.9.2-b1 条目），此后新差异从 v1.9.2 起累积
- 定制基线：分叉点之上持续增长，**不写死数字**——用 `git rev-list --count fb848072..HEAD` 实时查询（写死的数下次提交就过期），内容包括下载管理器重写、内置音源、共存包、权限适配、默认设置预设、底座升级 v1.9.2 等，详见 README 定制功能一览

## 合并流程

```bash
# 1. 拉取上游最新代码
git fetch upstream master

# 2. 合并到本地 master
git merge upstream/master

# 3. 解决冲突（见下方策略），提交
git add .
git commit -m "merge: 合并上游更新"

# 4. 全量语法检查
# 519 个 TS/TSX 文件语法检查（无 node_modules 时用 typescript transpileModule 逐文件检查）

# 5. 推送触发云编译
git push origin master
```

## 高冲突区（本仓库深度定制的文件）

以下文件与原版差异大，合并时大概率冲突，**冲突时以本仓库为准**：

| 文件 | 说明 | 冲突处理 |
|---|---|---|
| `src/core/downloadManager.ts` | 本仓库全新编写（原版无下载管理器） | 以本仓库为准；原版新功能人工评估后手动移植 |
| `src/screens/Home/Views/Download/index.tsx` | 原版为半成品 `index.js`，本仓库重写 | 以本仓库为准 |
| `src/store/download/{state,action,hook}.ts` | 本仓库新建 | 以本仓库为准 |
| `src/components/OnlineList/QualitySelect.tsx` | 本仓库新建（完整音质选择） | 以本仓库为准 |
| `src/core/init/userApi/index.ts` | 内置音源自动导入（QuickJS 引擎 + assets 兜底） | 以本仓库为准 |
| `src/app.ts` | 启动权限分版本引导 | 以本仓库为准 |
| `src/utils/tools.ts` | 权限返回值语义（GRANTED→true / NEVER_ASK_AGAIN→null / 其他→false） | 以本仓库为准 |
| `src/config/constant.ts` | FileProvider authority、底部菜单含下载页、默认首页排行榜 | 以本仓库为准 |
| `src/config/defaultSetting.ts` | 定制默认值 + 设置迁移版本号 | 以本仓库为准 |
| `src/config/migrateSetting.ts` | 设置迁移块（v1→v2 结构迁移） | 以本仓库为准 |
| `src/screens/PlayDetail/components/PlayListModal.tsx` | 本仓库新建（播放列表弹窗） | 以本仓库为准 |
| `src/plugins/player/playList.ts` | 通知栏标题与艺术家行拼接（歌名 / `歌手 · 音源 · 音质`），歌词换行刷新时也要带后缀 | 以本仓库为准；上游若重构 track 构建，需手动补回两处后缀注入（`buildTracks` 与 `updateNowPlayingMetadata`） |
| `src/plugins/player/service.ts` | 通知栏自定义按钮事件监听（词按钮、播放模式按钮） | 以本仓库为准；上游加新事件时逐个核对，别把定制监听覆盖掉 |
| `src/core/player/repeatMode.ts` | 本仓库新建（播放模式 ↔ 原生图标映射） | 以本仓库为准 |
| `src/core/init/player/player.ts` | 启动期播放器初始化流程（含通知栏模式同步，未初始化时不下发原生） | 以本仓库为准；上游若改初始化顺序，保留 `isInitialized()` 守卫 |
| `android/app/src/main/...` | 原生模块（UtilsModule 分享/打开文件）、FileProvider 配置、图标、应用名 | 以本仓库为准，注意 `applicationId` 为 `com.luanmuc.lxmusic` |

---

## 常见冲突点速查（快速定位版）

> 从 v1.9.2 合并经验提炼，每条含：冲突原因 + 标准解法。

| 文件 | 为什么容易冲突 | 标准解法 |
|---|---|---|
| `src/lang/zh-cn.json` / `zh-tw.json` / `en-us.json` | 上游经常加新翻译键，我们也加了定制键（nav_download 等） | 两边都保留：上游新增的键全合入，定制的键保留，最后检查键数一致（三语言 866 键；其中 `dl_*` 前缀 93 键是定制下载页专用（含状态与失败原因键），上游不会有） |
| `src/config/defaultSetting.ts` | 上游改默认值，我们也改默认值（音质 flac24bit、歌词默认开等） | 以我们的定制默认值为准，上游新默认值人工评估是否合入（注意走设置迁移规则） |
| `src/screens/Home/Views/Setting/settings/Health.tsx` | 我们新建的健康面板（v4.0），上游可能动了设置页结构 | 以我们为准；上游改了设置页布局的话，手动把健康面板挪到对应位置 |
| `src/core/player/player.ts` | 上游改播放器核心逻辑，我们加了下载列表播放适配、`playerInitial` 后的通知栏模式 / 「词」按钮状态补同步 | 以原版逻辑为准，我们的适配与两处补同步手动补回去 |
| `package.json` | 上游升版本号、加依赖，我们改了 author/homepage | 版本号跟着上游升，author/homepage 保留我们的 `luanmuc`，依赖看情况合入 |
| `android/app/build.gradle` | 上游改版本号，我们改 applicationId / versionCode | applicationId 保留 `com.luanmuc.lxmusic`，versionCode 跟着上游升 |

## 一般文件冲突策略

- **UI/主题类**（screens 样式、components）：保持原版风格（用户明确要求 UI 与原版一致），只保留本仓库的功能性改动
- **播放器核心**（`src/core/player/*`）：功能逻辑以原版为准，冲突时逐个人工判断；本仓库仅在 `playInfo.ts` 有下载列表播放适配
- **音乐 SDK**（`src/utils/musicSdk/*`）：原版更新直接合入（未定制；v1.9.2 已合入 `kg/songList.js` 歌单修复 `e6be258c`）
- **语言文件**：合入原版新增键，保留本仓库的 `nav_download` 等定制键

## 合并后必查清单

1. 全量语法检查 0 错误（519 个 TS/TSX）
2. `APP_PROVIDER_NAME`（constant.ts）与 AndroidManifest 的 `${applicationId}.provider`、原生 shareFile/openFile 传参一致
3. 内置音源兜底逻辑仍在（`has_imported_builtin_source` 标记 + 名称含「豆包定制」检测）
4. 权限三分支（<30 / 30-32 / >=33）未被上游覆盖
5. 下载列表播放（`getList('download')` 返回已完成任务）未被上游覆盖
6. package.json 的 author/homepage/bugs 仍指向 `luanmuc`
7. `CUSTOM_CHANGELOG.md` 顶部已补记本次合并的关键变更（人工维护）

## 已适配的原版更新类型

- **版本升级**：原版发新 tag 时，合并后 bump 版本号，云编译自动发布新 tag（v1.9.2 合并实例：kg 歌单修复 `e6be258c` + 音频卸载默认禁用 `025d7822`/`b3afb18c` + track-player 依赖 `43a3acd8`，见 [CUSTOM_CHANGELOG.md](./CUSTOM_CHANGELOG.md)）
- **音源**：不依赖原版，每次云编译自动从 `luanmuc/backend-api` 拉取最新内置音源
- **依赖升级**：package.json 依赖随原版更新合入，云编译验证

---

## 设置迁移规则（改默认值时必读）

**问题**：改了 `defaultSetting.ts` 的默认值后，老用户本地存的旧设置会覆盖新默认值，导致新功能不生效，必须清数据才行。

**正确流程**（每次改默认值都要做）：

1. 改 `src/config/defaultSetting.ts` 里的默认值
2. 把 `defaultSetting.version` 往上加一位（**当前是 `2.3`**，下次改默认值 → `2.4`）
3. 在 `src/config/setting.ts` 的 `initSetting` 里加版本迁移块（`src/config/migrateSetting.ts` 只做 v1→v2 大版本结构迁移，2.x 的迁移统一放 setting.ts）：
   ```ts
   if (compareVer(setting.version as string, '2.3') < 0) {
     setting['xxx.newSetting'] = true  // 强制覆盖老用户的旧值
   }
   ```
4. 这样老用户升级后自动应用新默认值，不需要清数据

**已发生的迁移**（历史记录）：
- `2.1`：按截图预设默认设置（音质 flac24bit、歌词翻译/罗马音默认开启、进度条不可拖、歌词居中、桌面歌词定位等）
- `2.2`：桌面歌词默认关闭；默认优先音质 flac24bit（用户指定）
- `2.3`：音频卸载默认关闭（`isEnableAudioOffload true→false`，同步上游 v1.9.2；老用户升级自动关闭，可在设置中手动重开）

**注意**：
- 新增的设置项（之前不存在的）不需要迁移，`mergeSetting` 会自动用默认值填充
- 迁移块只执行一次（版本号判断，迁移后版本号更新）
- 不要覆盖用户手动改过的设置——如果是产品行为变更必须强制改，就写进迁移块；如果只是新默认值给新用户用，就不用迁移

---

## 代码地图（快速定位）

| 要改什么 | 去哪里 |
|---|---|
| 新增底部菜单项 | `src/config/constant.ts` → `NAV_MENUS` |
| 修改默认设置 | `src/config/defaultSetting.ts` + 按迁移规则加迁移块 |
| 下载功能逻辑 | `src/core/downloadManager.ts` |
| 下载页面 UI | `src/screens/Home/Views/Download/index.tsx` |
| 扫描下载目录导入 | `src/screens/Home/Views/Mylist/MyList/listAction.ts` → `handleScanDownloadDir` |
| 播放列表弹窗 | `src/screens/PlayDetail/components/PlayListModal.tsx` |
| 播放栏 UI | `src/components/player/PlayerBar/` |
| 播放器核心逻辑 | `src/core/player/player.ts` |
| 在线列表点击行为 | `src/components/OnlineList/List.tsx` → `handlePress` |
| 音质选择弹窗 | `src/components/OnlineList/QualitySelect.tsx` |
| 音源 SDK（酷我等） | `src/utils/musicSdk/{kw,kg,mg,tx,wy,bd,xm}` | |
| 内置音源导入 | `src/core/init/userApi/index.ts` |
| 权限请求 | `src/utils/tools.ts` → `requestStoragePermission` |
| 启动权限引导 | `src/app.ts` |
| 新增设置项 UI | `src/screens/Home/Views/Setting/settings/` |
| 调试日志 | `src/utils/logger.ts`（开关在设置页） |
| 在线更新检查 | `src/core/version.ts` + `src/utils/version.js` |
| 国际化 | `src/lang/{zh-cn,zh-tw,en-us}.json` |
| Android 原生 | `android/app/src/main/` |
| CI 编译配置 | `.github/workflows/release.yml` + `scripts/` |

---

## 多账号协作说明

本仓库由多个豆包账号共同开发。详细分工、提交规范与评审流程见 [docs/DEV_CONVENTIONS.md](DEV_CONVENTIONS.md)，这里是最短上手路径：

1. 先读本文件（`MERGE_GUIDE.md`）+ [docs/DEV_SETUP.md](DEV_SETUP.md) 搭建环境
2. 克隆后看 `git log --oneline -30` 了解最近改了什么
3. 改代码前先确认是否在「高冲突区」列表里
4. 改完默认值必须走「设置迁移规则」流程
5. 推送前更新 `CUSTOM_CHANGELOG.md` 顶部（发版说明会引用真实变更）
6. 推送后去 Actions 页面确认编译成功，再核对发布链路（见 [docs/RELEASE_SOP.md](RELEASE_SOP.md) 发布后验证清单），全部通过再通知用户
