# 已知缺陷与限制（KNOWN ISSUES）

> 编号化管理已知问题，改代码前先查此表；新增/修复时更新状态。
> 格式借鉴 `backend-api` 的 D 系列缺陷表：**编号 + 影响 + 位置 + 状态**。

| # | 缺陷/限制 | 影响 | 位置 | 状态 |
|---|---|---|---|---|
| K1 | **下载无断点续传**：暂停后重新从头下载，`.part` 残件直接删除 | 大文件/弱网下载体验差 | `core/downloadManager.ts` | ⬜ 待实现（扩展方案见 [DOWNLOAD_DESIGN.md](./DOWNLOAD_DESIGN.md) 第九节） |
| K2 | **进度条默认不可拖**（定制默认值） | 与部分用户习惯不一致 | `config/defaultSetting.ts` | ✅ 默认设计（用户可在设置中开启） |
| K3 | **flac24bit 默认优先**，但多数音源不支持该音质，依赖降级链；自定义源此前还会被内置搜索 `_qualitys` 误裁成 128k | 高音质偏好用户实际拿到 flac/320k | `config/defaultSetting.ts` + `core/music/utils.ts` + 音质链 | ✅ 已修请求档（`getAvailableQualitys` 对自定义源只按 `qualityList`；设置页无源支持 flac24bit 时隐藏该档）；仍受源实际能力限制 |
| K4 | **与上游 lyswhut 分叉**（fork 点 `fb848072`；已合并至 v1.9.2），v1.9.2 之后的新功能/修复未跟踪 | 原版后续改进缺失 | 全仓库 | 🟡 已合并 v1.9.2（v1.9.2-b1），后续差异由 [UPSTREAM_LIFECYCLE.md](./UPSTREAM_LIFECYCLE.md) 管理 |
| K5 | **track-player fork 定制依赖**：通知栏按钮等改动基于 `luanmuc/react-native-track-player` 的 commit `b9ecdab2`（沿 `5bff17b`→`eceacb5` 累积；`eceacb5` 仅追加 `quality`/`subSource` 两个可选类型字段、无运行时改动；`a0b2a87` 为 2026-11-07 全覆盖审计后的修复：焦点续播不再覆盖用户主动暂停、点通知 PendingIntent 补 `FLAG_IMMUTABLE`、`MusicService` 加 signature 级权限、定制注释补齐；当前定制：艺术家行音源/音质拼接、播放模式按钮、音频焦点三开关 + 幂等/音量还原、通知栏状态判空；随 b69/b70 合入） | 上游升级需重新应用定制补丁，升级阻塞 | `package.json` + 原生层 | 🟡 观察中（每次升上游都要重放补丁，见 UPSTREAM_LIFECYCLE） |
| K6 | **内置音源由构建生成**：本仓库不内置 `assets/builtin_source.js` 静态副本（b74 起移除），每次构建 CI 从音源仓库 master 拉取最新生成；本地改同名文件会被覆盖 | 本地调试需手动放置最新脚本 | `assets/builtin_source.js`（构建生成） | ✅ 设计如此（音源唯一权威 = `luanmuc/backend-api`，见 [MUSIC_SOURCE_GUIDE.md](./MUSIC_SOURCE_GUIDE.md)） |
| K7 | **音源依赖第三方接口**：部分平台接口不稳/IP 封禁（酷我 CDN 系、溯音咪咕） | 个别平台播放失败 | 音源仓库 `lx-source.js` | 🟡 跟踪中（音源仓库缺陷表 D 系列 + 健康探测自愈；mg 真源恢复已判否（音源 v7.0 系列实证），走跨平台兜底） |
| K8 | **公共目录写入依赖"所有文件访问"授权**：各 ROM 判定口径不一（部分设备授权后仍判定失败） | 日志/下载公共目录不可写 | `utils/log.ts` + 下载权限矩阵 | ✅ b71 双通道根治：公共目录可用→写公共；不可用→自动降级应用私有目录（日志永不丢弃）；下载仍需公共目录时保留引导弹窗（见 [DOWNLOAD_DESIGN.md](./DOWNLOAD_DESIGN.md) 第六节） |
| K9 | **播放页音源标签不显示子源名**（历史多轮修复未达根因层） | 播放页只显示平台名（「酷我音乐」），不显示「· 溯音酷我」 | `user-api-preload.js`（b72）+ `core/music/index.ts`（b73） | ✅ b72/b73 修复（VM 桥 preload 丢 subSource + index.ts 丢 onSource，两处透传补齐）；回归用例已入音源 v7.0（冒烟覆盖） |
| K10 | **播放卡死**：`Property 'logger' doesn't exist`（logger 导入链断裂） | 所有在线歌点播后播放栏 00:00 卡死 | `core/player/player.ts` | ✅ b71 修复（`import { logger } from '@/utils/logger'`） |
| K11 | **日志权限误判**：系统「所有文件访问」判定与真实写能力不一致 → 反复提示去开启 | 有权限仍提示；无日志可看 | `utils/log.ts` | ✅ b71 双通道根治（真实写测试为准 + 私有目录兜底 + 移除强制提示） |
| K12 | **音频卸载默认关闭**（同步上游 v1.9.2 `025d7822`/`b3afb18c`）：默认值 `true→false`，设置版本 2.2→2.3，老用户升级自动关闭 | 部分设备卸载模式异常（杂音/播放失败）的历史问题缓解；个别省电敏感用户需手动重开 | `config/defaultSetting.ts` + `config/setting.ts`（v2.3 迁移） | ✅ 默认设计（跟随上游方案 A，用户可在设置中手动开启） |
| K13 | **逐字歌词未实现**：App 端无 yrc/ylrc 逐字歌词解析能力，只能显示逐行滚动歌词 | 高音质偏好用户期待逐字歌词体验缺失 | `core/lyric.ts`（仅逐行） | ❌ 已判否（2026-11-04 实测：网易公开 lyric 接口不返回 yrc 字段，仅有 lrc/tlyric；需 VIP 接口或其他源，待触发式探索） |
| K14 | **健康面板 error 残留**：首次加载时音源未就绪误报"未检测到支持健康查询的音源"，后续静默轮询成功后 error 不自动清除 | 有数据但仍显示错误提示，误导用户 | `Health.tsx` loadHealth | ✅ 修复（2026-11-04：所有成功路径都 setError('') 清空） |
| K15 | **静默轮询失败打扰用户**：每 30 秒后台刷新失败就弹错误提示 | 用户正在看页面，突然弹出错误，体验差 | `Health.tsx` loadHealth | ✅ 修复（2026-11-04：silent 模式下不 setError、不 setSnapshot(null)） |
| K16 | **平台降级提示条显示英文 ID**：wy/kw/tx/mg/kg 没翻译成中文，用户看不懂 | 提示条显示"⚠ wy 平台级降级"，不直观 | `Health.tsx` 平台降级条 | ✅ 修复（2026-11-04：加 PLATFORM_NAMES 映射，显示"网易/酷我/QQ/咪咕/酷狗"） |
| K17 | **预加载脚本 supportActions 白名单过滤新 action**：音源侧新增 config/trend action 后，预加载脚本的白名单只有 6 个 action，把新 action 过滤掉了 | 音源传了 8 个 action，App 端只收到 6 个，配置/趋势按钮不生效 | `android/app/src/main/assets/script/user-api-preload.js` supportActions | ✅ 修复（2026-11-04 b19：白名单加 config/trend） |
| K18 | **预加载脚本 handleRequest 缺 config/trend case**：白名单放行后，handleRequest 的 switch 也没处理这两个 action，result 是 undefined | 点配置/趋势按钮报错 "Cannot read property 'data' of undefined" | `android/app/src/main/assets/script/user-api-preload.js` handleRequest switch | ✅ 修复（2026-11-04 b20：加 config/trend case，统一返回 `{ source, action, data: response }`） |
| K19 | **配置/趋势弹窗背景透明**：modalContent 用 `theme['c-bg-1']` 动态背景色，实际渲染透明，能看到后面的健康面板内容 | 弹窗内容叠在健康面板上面，没有白色背景和遮罩 | `Health.tsx` modalContent 样式 | ✅ 修复（2026-11-04 b20：改为明确 `backgroundColor: '#fff'` + `width: '100%'`） |
| K20 | **启动即崩（b68 回归）**：`initPlayer` 在 `setupPlayer` 之前同步通知栏播放模式，原生 `MetadataManager` 直接解引用 `manager.getPlayback()`（此时为 null）→ 主线程 NPE | 存档播放模式不是「列表循环」时，冷启动必崩、App 打不开 | `service/metadata/MetadataManager.java`（`setRepeatMode`/`setLyricButtonActive`/`updateTitles`/`updateArtwork`） | ✅ b69 修复（四处判空 + App 侧 `isInitialized()` 守卫） |
| K21 | **初始化状态卡死**：`plugins/player/index.ts` 的 `initial()` 中途 `await` 抛异常时 `isIniting` 永久为 true，之后每次点播放都被直接 return | 点播放永远「缓存中」、且无法自愈，只能重启 App | `plugins/player/index.ts` | ✅ b70 修复（`try/catch/finally` 复位状态） |
| K22 | **音频焦点压低音量后恢复成 100%**：`CAN_DUCK` 结束用常量 `normalVolume=1.0f` 还原，忽略用户在 App 里设的音量 | 导航播报/来电一过，音乐音量突然跳到最大 | `service/MusicManager.java`（`audioFocusListener`） | ✅ b70 修复（压低前记录 `playback.getVolume()`，GAIN/LOSS 还原该值） |
| K23 | **通知栏「词」按钮状态不同步**：启动期播放器未就绪时同步会被守卫拦掉，之后没人再补 | 桌面歌词开着，通知栏「词」按钮仍是灰色，与实际状态不符 | `core/desktopLyric.ts` + `core/player/player.ts` | ✅ b70 修复（`playerInitial` 成功后补 `syncLyricButtonByState()`） |
| K24 | **下载类 5 个设置项无界面入口**：`download.onlyWifi` / `maxTask` / `autoRetry` / `dir` / `fileName` 在设置页没有对应开关 | 能力存在但用户无法配置（仅默认值生效） | `screens/Home/Views/Download/Settings.tsx`（b71） | ✅ b71 解决（全部并入下载页折叠卡，不新增分组） |
| K25 | **`migrateDownloadDir()` 静默失效**：引用了未导入的 `checkStoragePermissions`（运行时 ReferenceError 被外层 catch 吞掉），且更新记录时读顶层 `filePath`（实际在 `metadata.filePath`） | b64 的目录迁移在任何设备上都没执行过，老用户文件仍留在 `Download/lx-music` 根目录 | `src/core/downloadManager.ts` | ✅ 已修（补 import + 修正字段路径；b73 出包，b74–b78 已随多轮发布） |
| K26 | **JS 侧渐变做不到 60fps**：每次 `TrackPlayer.setVolume` 都是异步跨 bridge 调用，300ms 只能压到 5 帧（60ms/帧） | 淡入淡出听感是阶梯下降而非丝滑；极端弱机可能更粗 | `src/core/player/volumeFade.ts` + `volumeFadeCurve.ts`（`FADE_STEP_MS`） | ✅ 设计取舍（要真平滑必须走原生 AudioProcessor，见 MERGE_GUIDE 高冲突区） |

## 维护规则

- 新发现缺陷：追加编号（K9、K10…），写明影响与位置，状态默认 ⬜；
- 修复后：状态改 ✅，在 `CUSTOM_CHANGELOG.md` 顶部补记，如涉及文档同步更新；
- 长期跟踪项：状态 🟡，链接到对应管理文档（UPSTREAM_LIFECYCLE / MUSIC_SOURCE_GUIDE / DOWNLOAD_DESIGN）。
