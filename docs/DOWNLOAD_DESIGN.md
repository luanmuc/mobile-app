# 下载管理器技术设计（DOWNLOAD DESIGN）

定制版最大定制块。本文档说明实现原理、边界与扩展点，改下载相关代码前必读。

## 一、职责范围

| 代码 | 职责 |
|---|---|
| `src/core/downloadManager.ts`（916 行） | 下载核心：任务状态机、并发、断点、音质、文件、标签、通知 |
| `src/store/download/{state,action,hook}.ts` | Redux 风格状态管理（任务列表、进度、UI 联动） |
| `src/screens/Home/Views/Download/index.tsx` | 下载页 UI（进行中/已完成/未完成分组） |
| `src/components/OnlineList/QualitySelect.tsx` | 音质选择弹窗（只显示歌曲实际支持音质） |
| `src/utils/fs.ts` → `downloadDirectoryPath` | 下载目录解析（权限矩阵） |
| 原生 `UtilsModule.writeAudioTag` | 写音频标签（title/artist/album/封面） |

## 二、任务状态机

```
waiting ──→ run ──→ completed
   ↑         │
   │         ├─→ pause ──→ (重新开始) ──→ run
   │         └─→ error ──→ (自动重试≤3次) ──→ waiting ──→ run
   └─────────── (重启恢复：run 状态回 waiting)
```

- 状态字段：`status` + `statusKey` + `statusParams`（推荐）+ `statusText`（旧数据兜底）
- **硬规则（b75 起）**：任何改 `status` 的地方必须同时写 `statusKey`。UI 优先读 `statusKey`，只改 `status` 会让界面继续显示上一轮的文案（典型：重启后一直显示「获取歌曲信息…」）
- **i18n（加固轮起）**：界面优先读 `statusKey` + `statusParams`（可选字段），由 UI 按当前语言渲染，避免把中文写进存储后切语言仍显示简体；`statusText` 只在没有 `statusKey` 时使用
- **失败原因**：`errorCode`（`network/cellular/noSource/noWrite/noSpace/unknown`）+ `error`（只存原始报错，如 HTTP 码），原因文案在 UI 侧翻译；只有 `unknown` 才把原始报错附在括号里
- 失败分类：`network / cellular / noSource / noWrite / noSpace / unknown`，失败立即 toast 提示原因

## 三、并发控制

- 全局 `activeDownloadCount` 计数，`download.maxTask`（默认 2）限制并发
- 任务完成/失败/暂停后 `startNext()` 取队列中最早 `waiting` 任务执行
- 重试的任务重新标记 `waiting`，排队等并发位

## 四、原子下载与文件处理

1. 先下载到 `<目标>.part` 缓存文件（`progressDivider: 10KB` 回调，5% 节流更新 UI）
   - 界面：6px 进度条 + 右侧百分比同行；速度与「已下载/总量」在下一行
   - **响应无 `Content-Length` 时 `total` 为 0**：不渲染空进度条（避免「永远 0%」的错觉），只显示「速度 · 已下载 x」
   - **批量汇总**：`activeCount ≥ 2` 时列表顶部显示「已完成 x/y · 下载中 n · 失败 m」
2. 完成后再 `moveFile` 原子移动到正式路径——中断只留残件，正式目录永远完整
3. 文件已存在处理：完整文件 → 替换/跳过/全部替换弹窗；残件 → 自动删除重下
4. 空间检查：剩余 <100MB 拒绝下载（失败原因 `noSpace`）

## 五、音质降级链

- 顺序：`flac24bit → flac → wav → ape → 320k → 192k → 128k`（`core/music/utils.ts` 的 `FULL_QUALITYS_LIST`）
- `getDownloadQuality`：按源实际支持能力降级；`getOnlineMusicUrl` 逐级尝试取播放链接
- 弹窗选择（QualitySelect）只显示歌曲 `meta._qualitys` 实际支持的音质，默认选最高

## 六、权限矩阵（getDownloadDir）

| Android 版本 | 行为 |
|---|---|
| <10 | 申请普通存储权限后直写公共目录（`/sdcard/Music/lx-music` 等） |
| 11~12 | 尝试 `mkdir`，失败弹窗引导开启「所有文件访问」（MANAGE_EXTERNAL_STORAGE） |
| ≥13 | READ_MEDIA_AUDIO 即可，写公共 Music 目录 |

权限语义（`tools.ts requestStoragePermission`）：GRANTED→`true` / NEVER_ASK_AGAIN→`null`（引导去系统设置）/ 其他→`false`。

- **自定义目录（b75）**：`RNFS.mkdir` 后写一个 `.lxwrite` 探针再删，确认真的可写；失败直接报「目录不可写，请换一个目录」，不要把错误拖到下载阶段
- **失败分类（b75）**：抛错统一用 `makeError(msg, code)`（`PERMISSION/NO_SPACE/NO_SOURCE/NO_URL`），分类只认 `code`；中文子串匹配已废弃（切语言后 `includes('权限')` 会失效）

## 七、完成处理

- 写音频标签（title/artist/album/封面，失败不影响下载成功）
- 通知：toast + 安全震动（try/catch 防 Android 12+ SecurityException）
- 文件操作：点击播放（进下载列表）、分享（FileProvider）、打开文件位置、删除

## 八、持久化与重启恢复

- 存储：AsyncStorage `@download_list`（任务列表 + 状态）
- 重启：`run` 状态任务 → `waiting`，**同时把 `statusKey` 改成 `dl_status_waiting` 并清 `error`/`speed`**，重新排队下载；已完成任务直接可用
- 断点续传：**当前未实现**（暂停后重新从头下载），扩展点见下

## 九、扩展点（待实现）

| 扩展 | 方案 | 涉及 |
|---|---|---|
| 断点续传 | 请求加 `Range` 头续下 `.part` 文件，记录已下载字节数 | `downloadManager.ts` + 任务状态字段 |
| 下载优先级 | 任务加 `priority` 字段，`startNext` 按优先级+时间排序 | state + startNext |
| 批量音质选择 | QualitySelect 支持"应用到所有选中" | QualitySelect + action |
| 按歌单批量下载 | 歌单详情页"全部下载" | 歌单页 + action |
| 下载历史/日志 | 复用 `logger.ts` 记录每个任务的关键节点 | downloadManager + logger |

## 十、设置入口（b71）

全部下载相关设置都在**下载页顶部「下载设置」折叠卡**里，不再占用设置页分组：

| 设置项 | 控件 | 落地位置 |
|---|---|---|
| `download.onlyWifi` | 开关 | `Download/Settings.tsx` |
| `download.maxTask` | 步进 1–5 | 同上 |
| `download.autoRetry` | 开关 | 同上 |
| `download.dir` | 默认 / 应用私有 / SAF 目录选择 / 手输路径 | 同上 → `getDownloadDir()` |
| `download.fileName` | 3 预设 + 自定义模板 | 同上 → `buildFileName()`（`formatMusicName` 占位符：歌名 / 歌手） |
| `download.notifyComplete` | 开关（原在基础设置，已迁移） | 同上 |

注意：SAF 选出来的是 `content://` 树 URI，下载走 RNFS 需要真实路径，`treeUriToPath()` 只认 `com.android.externalstorage.documents`（手机存储）；网盘/云端 provider 会被拒绝。写入 `/storage/...` 仍需「所有文件访问」权限，失败时提示去开启。

## 十一、国际化（b72）

下载页、下载设置、下载管理器层（弹窗/toast/异常文案）不再有硬编码中文，全部走 `useI18n()`，键前缀 `dl_`（b75 起三语对齐到 874 键，`dl_*` 共 93 键）。

两类文字刻意保持中文原样，不做翻译：

| 文字 | 位置 | 原因 |
|---|---|---|
| `歌名 - 歌手` / `歌名` / `歌手 - 歌名` 三个预设 | `NAME_PRESETS` | 是写入文件名模板的占位符字面量，翻译后 `formatMusicName()` 匹配不到「歌名」「歌手」，已有命名规则会失效 |
| 占位符校验用的「歌名」「歌手」 | `applyName()` | 同上，校验的是模板内容而非界面文案 |

## 十二、破坏性操作约定（b75）

| 操作 | 行为 | 说明 |
|---|---|---|
| 「清空已完成」`clearCompleted` | **只从列表移除，不删文件** | 入口文案就是「清空已完成」，删文件属于用户预期外的数据丢失；b75 前会连文件一起删 |
| 「删除任务」`removeDownload` | 删除任务 + 删除已下载文件 | 这是唯一会删文件入口，UI 用删除语义 |

## 十三、改代码注意事项

- 保持「正式目录永远完整」的原子性原则，不要在正式路径直接写流
- 新状态/新字段必须同步 `state.ts` 默认值 + `@download_list` 兼容读取（`mergeSetting` 思路）
- 修改权限逻辑时同步更新 [FAQ.md](FAQ.md) 权限章节
