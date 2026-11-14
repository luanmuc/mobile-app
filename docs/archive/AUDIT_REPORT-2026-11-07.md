# 全维度审计报告 · v1.9.2-b74

> 审计日期：2026-11-07
> 基线：代码 `20ac0519`（b74），文档 `c4cb35df`
> 范围：三仓库（App `lx-music-mobile` 为主，fork `rntp` 的原生定制，音源 `lx-music-source` 未改）
> 方法：见 `docs/AUDIT_PLAN.md` 的 L0–L4 分级；本轮做到 L3（产物级），L4（设备级）未做
> 结论：**15 处缺陷**（4 高 / 6 中 / 5 低），**已全部修复于 b75**；另顺带修掉 6 类类型契约缺口（`trend` action、5 个治理 action、`common.enableDebugLog`、隐式 any、缺失样式、无效按钮属性）

---

## 一、高优先级（4 处）

### R1 · `getStoreMusicSource` 未导入，缓存命中分支必抛 ReferenceError

- **位置**：`src/core/music/utils.ts:326`
- **证据**：该文件第 1–12 行的 import 列表只有 `getMusicUrl as getStoreMusicUrl` 与 `getPlayerLyric as getStoreLyric`，**没有 `getStoreMusicSource`**；但 326 行直接调用。`tsc` 报 `TS2304: Cannot find name 'getStoreMusicSource'`。对照 `src/core/music/online.ts:6` 是正确导入的（同一逻辑的另一处实现）。
- **触发路径**：切源/刷新后播放，命中本地缓存地址 → 走 `if (cachedUrl && !isRefresh)` 分支 → 调用未定义符号
- **后果**：ReferenceError；缓存命中即失败，回落到重新解析（若调用方有 try 兜底则是"缓存失效"，没有兜底就是播放失败）
- **等级**：L0 + L2
- **修法**：在 import 列表补 `getStoreMusicSource`（与 `online.ts` 对齐）

### R2 · 横屏播放页 `theme` 未定义，组件渲染即崩

- **位置**：`src/screens/PlayDetail/Horizontal/Player/PlayInfo.tsx:61`
- **证据**：文件里 `useTheme()` 只出现在两层子组件内部（18 行 `PlayTimeCurrent`、24 行 `PlayTimeMax`）；默认导出组件（28 行起）内**没有声明 `theme`**，但 61 行写了 `<Text color={theme['c-500']}> / </Text>`。`tsc` 报 `TS2304`。
- **触发路径**：`PlayDetail/Horizontal/Player/index.tsx:7` 导入了它 → 横屏播放详情页渲染时执行到 61 行
- **后果**：React 渲染期抛 ReferenceError，横屏播放页白屏/崩溃（竖屏不受影响，所以日常容易漏掉）
- **等级**：L0 + L2
- **修法**：在默认导出组件顶部补 `const theme = useTheme()`

### R3 · `RNFS.temporaryDirectoryPath` 拼错，私有日志通道从未生效

- **位置**：`src/utils/logger.ts:12`、`:30`；`src/utils/log.ts:18`
- **证据**：`react-native-fs` 只导出 `TemporaryDirectoryPath`（首字母大写，`node_modules/react-native-fs/index.d.ts:291`），小写属性不存在。`tsc` 报 3 处 `TS2551: Property 'temporaryDirectoryPath' does not exist ... Did you mean 'TemporaryDirectoryPath'?`
- **触发路径**：b71 的日志双通道——公共目录不可用时降级到 `RNFS.temporaryDirectoryPath + '/lx-music'/logs`
- **后果**：路径实际是字符串 `"undefined/lx-music/logs/..."`，`mkdir` 必然失败 → **无存储权限时日志全丢**，恰好是 b71「零权限也永不丢日志」想解决的那个场景
- **等级**：L0 + L2
- **修法**：三处改为 `RNFS.TemporaryDirectoryPath`

### R4 · 「一键更新音源」读 void 返回值，流程必然失败

- **位置**：`src/screens/Home/Views/Setting/settings/Basic/Source.tsx:159`（`newApiInfo.id`）、`:166`（同）  
  被调方：`src/core/userApi.ts:30` `export const importUserApi = async(script: string) => { const info = await addUserApi(script); action.addUserApi(info) }` —— **没有 return**
- **证据**：`tsc` 报两处 `TS2339: Property 'id' does not exist on type 'void'`
- **触发路径**：音源更新提示 → 点「确认更新」
- **后果**：`importUserApi` 已经把新音源写进去了，随后读 `undefined.id` 抛 TypeError → `catch` 里 toast「更新失败：Cannot read property 'id' of undefined」→ **旧音源不删、不自动切换**。用户看到"失败"，但实际已经装入了新音源，状态变成半完成
- **等级**：L0 + L2
- **修法**：`importUserApi` 补 `return info`（类型随之变 `Promise<UserApiInfo>`）
- **后续（2026-11-09，D-24）**：R4 只修了「拿到 id」，没修「顺序」。当时流程仍是「导新 → **删旧** → 切新」，新源加载失败且无备用时旧源已被删、回退不了。已改为「导新 → 切新并等 init（8s 上限）→ 成功才删旧」，见 `CUSTOM_CHANGELOG.md` v1.9.2-b84。**R4 的「流程闭环」结论不等于流程安全，两件事。**

---

## 二、中优先级（6 处）

### R5 · 健康面板用了不存在的主题色键

- **位置**：`src/screens/Home/Views/Setting/settings/Health.tsx:531`、`:545`（两处）、`:605`
- **证据**：`theme['c-font-1']`（3 处）、`theme['c-border-1']`（1 处）；在 `src/theme/themes/` 全部主题定义里都搜不到这两个键。`tsc` 报 3 处 `TS2551`，建议值是 `c-font`。
- **后果**：颜色拿到 `undefined` → RN 回退默认色；暗色主题下弹窗标题、输入框文字接近黑色，可读性明显下降
- **等级**：L0 + L2
- **修法**：`c-font-1 → c-font`、`c-border-1 → c-border`（或主题里补齐这两个键，但不建议，主题是上游资产）

### R6 · `playDead` 字段不存在

- **位置**：`src/screens/Home/Views/Setting/settings/Health.tsx:473`
- **证据**：`tsc` 报 `TS2339: Property 'playDead' does not exist on type 'HealthItem'`
- **后果**：该判断恒为 `undefined`（假），相关展示分支实际是死代码；如果本意是"播放死链数"，字段名写错导致统计永远不显示
- **等级**：L0
- **修法**：核对 `HealthItem` 真实字段（可能需要 `deadCount` / `playable` 之类）后改正，或删掉该分支

### R7 · 「清空已完成」会删掉已下载的文件，但文案没这么说

- **位置**：`src/core/downloadManager.ts` `clearCompleted()`（`for (const task of downloadState.list) { if (task.isComplate && task.metadata.filePath) await unlink(...) }`）
- **证据**：入口文案 `dl_action_clear_completed = 清空已完成`，toast `toast_cleared_finished = 已清空已完成任务`，均未提示会删除文件
- **后果**：用户以为只是清列表，实际把歌删了 —— **数据丢失**
- **等级**：L2（行为与语义不一致）
- **修法**（二选一，需产品决定）：
  - A. 只清列表、不删文件（更安全，符合文案）
  - B. 保留删文件，但文案/二次确认改成「清空并删除已下载文件（共 N 个）」

### R8 · 重启恢复只改 `status` 不清 `statusKey`

- **位置**：`src/core/downloadManager.ts` `initDownloadList()`（`...t, status:'waiting', statusText:'等待中', progress:0, downloaded:0`）
- **后果**：b73 起 UI **优先读 `statusKey`**，若崩溃/杀进程前任务停在 `dl_status_fetching` 或 `dl_status_retrying`，重启后 UI 仍显示「获取歌曲信息…」或「等待重试 1/3」，实际状态是等待中 → 看起来永远卡住。另外 `statusText` 硬编码中文，未走 i18n
- **等级**：L2
- **修法**：恢复时显式 `statusKey: 'dl_status_waiting'`（并删除 `speed`）

### R9 · 管理器层的用户可见文案仍硬编码中文

- **位置**：`src/core/downloadManager.ts`
  - `getDownloadDir()`：Alert 标题「需要开启所有文件访问权限」、正文一段长中文、按钮「取消」「去开启」
  - `confirmReplaceFile()`：Alert「文件已存在」、`《${name}》已下载过，是否替换？`、按钮「跳过」「全部替换」「替换」
  - 完成/跳过提示：`toast('已存在：${name}')`
  - 异常文案：`throw new Error('未获得存储权限，无法下载')`、`'存储空间不足'`、`'获取下载链接失败'`、`'缺少下载地址'`
- **后果**：英文/繁体界面下，权限引导、重复文件确认这些**必须理解的弹窗**仍是中文；异常文案虽只在 `unknown` 时展示，但仍会进 `error` 字段
- **等级**：L1（键覆盖缺口）
- **修法**：Alert 与 toast 全部接 `global.i18n.t`，新增约 10 个键；异常文案保持中文但只在日志用，UI 侧继续走 `errorCode`

### R10 · 其他定制组件的硬编码中文

- **位置**：
  - `src/components/OnlineList/QualitySelect.tsx:11-12`（`Hi-Res 无损`/`无损`）、`:66`（`选择下载音质`）、`:72`（说明长句）
  - `src/components/OnlineList/MultipleModeBar.tsx:133`（`下载选中`）
  - `src/components/OnlineList/ListMenu.tsx:62`（`下载`）
  - `src/screens/Home/Vertical/DrawerNav.tsx`（`累计播放 N 次`、`累计时长`）
- **后果**：英文界面混中文；与 b72/b74 已做的下载页 i18n 不一致
- **等级**：L1
- **修法**：逐个接 `useI18n()`，音质名可复用 `quality_*` 现有键（若已有）

---

## 三、低优先级（5 处）

| 编号 | 位置 | 问题 | 建议 |
|---|---|---|---|
| R11 | `src/core/music/local.ts:173`、`src/plugins/sync/client/auth.ts:44,63` | 裸用 `Buffer`。Hermes 无全局 `Buffer`（`metro.config.js` 只把 `buffer` 模块别名到 polyfill，没有任何地方 `global.Buffer = ...`，全仓搜索仅 jest 环境注入）。带 `[awlrc:...]` 标签的本地歌词、同步登录会 ReferenceError | 改 `import { Buffer } from 'buffer'`，或在入口 `global.Buffer = Buffer` |
| R12 | `src/core/downloadManager.ts` `writeAudioTagAsync` | 封面下载 `RNFS.downloadFile` 没有超时，`await job.promise` 可能长时间挂住，拖慢"已完成"的落地 | 加超时（`Promise.race`，10s） |
| R13 | `getDownloadDir()` 自定义目录分支 | 只 `RNFS.mkdir(customDir)`，不验证可写；只读目录要到真正下载时才失败，提示不精确 | mkdir 后写个 `.probe` 再删，失败即报"目录不可写" |
| R14 | `downloadManager` 失败分类 | 权限错误靠 `errorMsg.includes('权限') / includes('访问')` 中文子串判定 | 改成抛带 `code` 的错误对象（`{ code: 'PERMISSION' }`） |
| R15 | `Download/Settings.tsx` `treeUriToPath` + `applyDir` | SAF 选择器给的是 URI 授权，还原成裸 `/storage/...` 后写入仍需「所有文件访问」；用户以为"选完就能用" | 选项文案写明「需同时开启所有文件访问」，或在 applyDir 成功后再提示一次 |

---

## 四、确认无问题（本轮复核通过）

| 项目 | 结论 | 证据等级 |
|---|---|---|
| 音频焦点三开关 | 主开关 → `setupPlayer.handleAudioFocus` → 原生 `MusicManager` 三处 `return`；子开关在主开关关闭时被强制 `false` | L0+L2 |
| Duck 音量还原 | `volumeBeforeDuck` 记录再还原，不再写死 1.0 | L2 |
| 设置项契约 | `defaultSetting` 75 键**全部**有真实消费点；"消费但未声明"的 5 个键全部在注释/迁移代码（`download.savePath`、`player.isPlayHighQuality` 均为注释） | L1 |
| i18n 键 | 三语各 **730**（b75 后）、无重复键、占位符 0 缺失（1 处脚本误报已人工确认） | L1 |
| 依赖锁定 | 当前 `a0b2a87`（审计当时 `eceacb5`，更早 `5bff17b`）；三者均为 `package.json`×1 + `package-lock.json`×2 共 3 处一致 | L1 |
| 主题键 | 除 `c-font-1`/`c-border-1` 外，其余 `theme[...]` 引用合法 | L1 |
| 升级/解析健壮性 | `officialVersion.parseOfficialVersion` 有 try/catch | L0 |
| 下载状态 i18n | UI 优先 `statusKey`，`error` 只在 `unknown` 时附原始报错 | L1 |
| 通知栏按钮 | 5 个实际按钮 + 图标密度齐全 | L1 |
| 构建号 | `src/config/buildNumber.ts` 为空，由 CI 覆盖写入 | L1 |

---

## 五、本轮方法（可复跑）

```bash
cd lx-music-mobile
# L0：只看真错误（TS2304 未定义符号 / TS2551 属性名写错）
node_modules/.bin/tsc --noEmit 2>&1 | grep -E "error TS(2304|2551)"
# L1：设置项契约 / i18n / 依赖 / 主题键
python3 脚本核对 defaultSetting→d.ts→消费点、697×3 键、占位符、重复键、sha 三处
# L2：可达性——每个报错点追问"谁调用/何时渲染/异常是否被 catch"
grep -rn "getStoreMusicSource" src/core/music/
grep -rn "Player/PlayInfo" src
grep -rn "temporaryDirectoryPath" src node_modules/react-native-fs/index.d.ts
# L3：产物（每版发布后）
unzip -p apk assets/index.android.bundle | 按 UTF-16LE 查中文、按 ASCII 查键名
```

## 六、本轮未做（设备级 L4）

- 首次安装 / 覆盖升级 / 权限拒绝后撤销 / 横竖屏切换 / 批量下载 / 长中文名与 emoji 文件名
- 这些需要真机，已在 `AUDIT_PLAN.md` S 组标 🧪

---

## 七、修复顺序（已按此序全部执行完毕，落地见 §八）

1. **R1、R2、R3、R4**（一行级修复，但都是崩溃/功能失效）→ 一轮修完
2. **R7、R8**（数据丢失与状态卡住）→ 需要产品决定 R7 走 A 还是 B 方案
3. **R5、R6、R9、R10**（体验与 i18n）
4. **R11–R15**（防御性，可与上面合并）

---

## 八、修复落地（b75）

| 编号 | 修法 | 结果 |
|---|---|---|
| R1 | `core/music/utils.ts` 补 `getStoreMusicSource` 导入 | TS2304 消除，缓存命中分支可用 |
| R2 | `PlayInfo.tsx` 补 `const theme = useTheme()` | TS2304 消除，横屏播放页不再崩 |
| R3 | 3 处改 `RNFS.TemporaryDirectoryPath` | TS2551 消除，私有日志通道恢复 |
| R4 | `importUserApi` 补 `return info` | TS2339 消除，一键更新流程闭环 |
| R5 | `c-font-1 → c-font`、`c-border-1 → c-border-background` | TS2551/TS7053 消除 |
| R6 | `HealthItem` 补 `playDead?`/`rateLimited?` | TS2339 消除，状态分支生效 |
| R7 | `clearCompleted` 只清列表不删文件 | 数据丢失入口收口 |
| R8 | 13 处状态变更补 `statusKey`，恢复时清 `error`/`speed` | 重启后不再卡在旧文案 |
| R9 | 管理器层弹窗/toast/异常接 i18n（9 键） | 英/繁界面不再混中文 |
| R10 | 4 组件 + 音源更新流程接 i18n（13 键） | 同上 |
| R11 | 显式 `import { Buffer } from 'buffer'` | 本地歌词/同步登录路径不再 ReferenceError |
| R12 | 封面下载 10s 超时 + `stopDownload` | 「已完成」不再被封面拖住 |
| R13 | 目录写探针 | 只读目录在选目录时就报错 |
| R14 | `makeError` + code 分类 | 失败分类不随语言失效 |
| R15 | 目录选择说明补充权限要求 | 预期对齐 |

**验证证据（本机执行）**
- `node_modules/.bin/tsc --noEmit`：**57 → 14** 条（剩余均为上游历史类型不一致，运行时无对应缺陷）
- `node scripts/docs-audit.js`：三语言 **730** 键一致、底座 **b78**、track-player **`a0b2a87`** 三项全绿（审计当轮 App 底座 b74、track-player 锁定 `5bff17b`；b75→b77→b78 后复跑现值如上）
- 占位符脚本：新键 0 缺失、0 未引用；三语 JSON 均可解析、无重复键
- ESLint：改动文件只余项目既有风格类问题（`space-before-function-paren` 等），无 `no-unused-vars` / `no-undef`
- 设备级（S 组）仍需实机：横屏播放页、清空已完成、重启恢复、权限流

