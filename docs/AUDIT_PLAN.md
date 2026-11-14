# App 仓库审计计划 v3.0（重构版 · 活文档）

> **重构说明**：本文件由 v2 重构而来。v1（39 维）→ v2（89 维）→ 后续 O/M/T/Q 组多次叠加，导致同一字母（O、M）出现两次定义、历史修复记录（R1~R15）与当前维度混在一起。本版去掉历史叠加与已销项记录（归档至各轮 `AUDIT_REPORT-*.md`），只保留「当前要审什么、状态如何、缺口在哪」。
>
> **基线（唯一真值，2026-11-15）**：
> - App：`luanmuc/mobile-app` @ `59ab63bd`（已推送），v1.9.2-b126 / versionCode 285（Build `43619278134` success）
> - 源仓：`luanmuc/backend-api` @ `f3a3e75`（已推送），v8.14.0（5707 行 / 297753 bytes）
> - track-player：`88b062b`（v2 分支）
> - 硬数字：三语各 **999 键**、TS/TSX **527 文件**、`scripts/check_*.js` **34 个**（release.yml 引 30，另 4 个在 health-stress.yml 或离线）
>
> **对应变更**：`ff9647cc`「按源能力请求音质并回填真实交付档」+ 源仓 `f3a3e75`「v8.14.0 音质优先与 CI 编排」；跨仓 QP-L1/L2/L3 已由 App `85d316ce` 补齐。

---

## 0. 目标与边界

**目标**：按当前 HEAD 审代码正确性、运行逻辑、全仓完成度、跨仓契约、**定制功能间联动**。每条链路从 UI 入口追到数据落点。

**边界**（blocked，不写成通过）：
1. 真机 UI 安装/播放（无 adb/KVM）
2. tx 完整曲目（上游约 60 秒试听）
3. 设备级横竖屏/通知栏/批量下载

**纪律**：结论带「命令 + rc + 计数」；失败先修或明确夹具漂移；反向修改必须能让断言变红；不沿用历史绿。

---

## 1. 证据分级

| 级别 | 手段 | 能证明什么 |
|---|---|---|
| L0 | `tsc --noEmit`、`eslint`、`node --check` | 语法/类型/未定义符号 |
| L1 | 契约脚本、键对齐、文档一致性 | 声明与消费闭合 |
| L2 | 纯 Node 行为脚本 + mock 宿主 | 状态机、边界、并发、隐私 |
| L3 | 构建产物/包体 | 改动是否真进包 |
| L4 | 真机/真上游 | 用户实际看到什么（本轮未做） |

---

## 2. 审计矩阵（App 侧一表）

| ID | 检查面 | 关键位置 | 验收 |
|---|---|---|---|
| A-A01 | 13 action 权威表 | `sourceContract.ts`、`index.ts`、`user-api-preload.js` | `check_source_contract` 14/0；每个 action 有 case |
| A-A02 | 健康 4 主状态 | `healthStatus.ts`、`Health.tsx` | `check_health_state_v2` 7/0 |
| A-A03 | 诊断窗口/覆盖 | `healthDiagnostics.ts`、`Health.tsx` | `check_health_diagnostics` 54/0 |
| A-A04 | 诊断视图 | `healthDiagnosticsView.ts` | `check_health_diagnostics_view` 24/0 |
| A-A05 | 事件链路/去重 | `healthLog.ts` | `check_health_event_pipeline` 10/0 |
| A-A06 | 持久化 v2 | `sourceHealthPersistence.ts` | `check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0 |
| A-A07 | 配置契约 | `sourceConfig.ts` | `check_source_config_contract` 25/0；37 键三语 |
| A-A08 | 三语闭合 | `src/lang/*.json` | 各 999 键、无重复、无缺占位符 |
| A-A09 | 播放/媒体/预算 | `playback*`、`media*` | 20/0、20/0、6/0 |
| A-A10 | 日志目录/隐私 | `check_log_directory` | 15/0；无 URL/歌名/歌手 |
| A-A11 | 仓库完成度 | 全仓 TODO/占位/半成品 | 逐条定性 |
| A-A12 | 文档真值 | 本文件、`STRESS_PLAN.md`、`SYNC_POINTS.md` | 版本/键数/action/HEAD 与代码一致 |

---

## 3. 定制功能维度总表（合并 89 维，按域归类）

| 域 | 覆盖点（合并后） | 关键脚本 | 状态 |
|---|---|---|---|
| 播放核心 | 播放/暂停/切歌、音源调用、音质协商、歌词封面、错误处理、网络封装、后台播放、线控 | `player_core_runtime` 等 | ✅ |
| 音源管理 | 健康面板、自定义源导入、音源标签、日志、预加载一致性、配置热更新 | `source_config_contract` | ✅ |
| 状态与存储 | 设置项完整性、本地存储、数据迁移、状态管理 | `download_restore_runtime` | ✅ |
| UI 与交互 | 侧边栏、播放页、弹窗、主题适配、多语言、组件复用 | `health_ui_mapping` | ✅ |
| 文档与工程 | 编码规范、KNOWN_ISSUES、音源指南、发布 SOP、AGENTS、变更日志 | `docs-audit` | ✅ |
| 原生与性能 | Android 原生层、CI 编译、启动速度、包体积、内存 | — | ✅ / 内存📝 |
| 安全合规 | 权限申请、数据隐私、第三方 SDK | — | ✅ |
| 定制代码正确性 | 符号导入、属性名、静默失败、空值、返回值契约 | `tsc`/`eslint` | ✅ |
| 桥接与原生契约 | JS↔Java 符号、初始化时序、通知栏、音频焦点、Duck 音量 | `player_service_runtime` | ✅ |
| 依赖与兼容 | fork sha 锁定、Hermes Node API、JSON 健壮性、产物一致性 | `docs-audit` | ✅ |
| 权限与路径 | 路径拼接、URI 还原、权限判定、可写性、空间上限 | `download_persistence` | ✅ |
| i18n 全链路 | 键对齐/重复/占位、页面/管理器/组件覆盖、原生文案 | `check_docs_consistency` | ✅ |
| 状态机与持久化 | 状态字段组合、重启恢复、幂等、原子写 | `download_restore_runtime` | ✅ |
| 并发与竞态 | 并发上限、暂停/恢复竞态、缓存命中分支 | `player_progress_runtime` | ✅ |
| 主题与视觉 | 主题键合法、对比度、窄屏、图标 | — | ✅ / 设备🧪 |
| 破坏性操作 | 文案与行为一致、覆盖替换、迁移搬文件 | — | ✅ / 迁移🧪 |
| 启动与生命周期 | 冷启动、双通道日志、进程杀后恢复、批量下载通知 | — | ✅ |
| 语义契约 | 文案↔字段横向穿、类型对≠语义对 | 带参 `t()` 全表 | ✅ |
| 跨平台标签 | `sourcePlatform` 全链路、实际平台优先、标签拼装 | `check_source_platform_label` | ✅ |

**状态说明**：✅ 已审无问题；⚠️ 已审发现问题；📝 待审；🧪 需设备实测。

---

## 3b. 定制功能逐项明细（排除车机版）

> 每个定制功能单列一行：功能 → 关键位置 → 守的脚本/断言 → 状态。**车机版（横屏排行榜、车机布局、车机通知栏竖排按钮）不在本计划范围**；通知栏的常规定制（播放模式按钮/显示格式）仍保留。

| 定制功能 | 关键位置 | 守的脚本/断言 | 状态 |
|---|---|---|---|
| 音质优先播放（请求档/真实标签/下载档/缓存版本/置信度/片段语义） | `core/music/utils.ts`、`online.ts`、`downloadManager.ts`、`utils/data.ts` | `check_quality_request_runtime` 12/0 | ✅ |
| 音源健康面板（4 主状态+reason、质量矩阵、趋势、配置、异常） | `healthStatus.ts`、`Health.tsx` | `check_health_state_v2` 7/0、`check_health_ui_mapping` 11/0、`check_health_anomaly_v2` 8/0 | ✅ |
| 音源健康本地诊断（采样加权/失败归因/窗口覆盖/证据展开/脱敏） | `healthDiagnostics.ts`、`healthLog.ts` | `check_health_diagnostics` 54/0、`check_health_diagnostics_deep` 51/0、`check_health_diagnostics_view` 24/0 | ✅ |
| 音源健康事件链路（eventId 去重/traceId/脱敏） | `healthLog.ts` | `check_health_event_pipeline` 10/0 | ✅ |
| 音源健康持久化 v2（v1 拒绝/容量版本边界/可回滚） | `sourceHealthPersistence.ts` | `check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0 | ✅ |
| 音源管理（配置契约 37 键/自定义源导入/更新音源按钮/版本号/action 表） | `sourceConfig.ts`、`sourceContract.ts`、`init/userApi/*` | `check_source_config_contract` 25/0、`check_source_contract` 14/0 | ✅ |
| 下载管理器（下载档一致/文件名模板/失败原因 i18n/目录迁移/长文件名/批量下载） | `downloadManager.ts`、`utils/download*` | `check_download_persistence` 3/0、`check_download_restore_runtime` 3/0、`check_download_error_i18n`、`check_file_name_template_runtime` | ✅ |
| 播放器核心（进度条/批量队列/音频焦点三开关/后台播放/线控） | `player*`、`media*` | `check_player_core_runtime`、`check_player_service_runtime` 10/0、`check_media_body` | ✅ |
| 通知栏定制（播放模式按钮/显示格式/音源名音质不被歌词覆盖） | `android/app/src/main` | 静态走查；真机 blocked | 📝 |
| 播放页音源标签（实际平台优先/子源名/试听标签） | `sourceLabel.ts`、`PlayInfo.tsx`、`playList.ts` | `check_source_platform_label` 9/9 | ✅ |
| 播放失败原因（错误码中文化/友好摘要/attempts 账本/降级所有权/取链预算） | `utils.ts`、`online.ts`、`playbackBudget.ts` | `check_playback_budget` 21/0、`check_playback_ownership_runtime` 21/0 | ✅ |
| 桥接媒体传输（base64 信封/256KB 分片） | `service.ts`、media envelope | `check_media_body` | ✅ |
| 日志目录与隐私（公共优先/私有回迁/无 URL 歌名歌手） | `utils/log.ts` | `check_log_directory` 15/0 | ✅ |
| 官方上游版本显示 + 更新提醒 + 一键更新顺序 | `apiSource.ts`、`Source.tsx` | 结构走查 | ✅ |
| 听歌统计口径（playCount） | `player/playCount.ts` | 结构走查 | ✅ |
| 内置音源自动升级（构建时统一拉取） | 构建脚本 | `check_release_state_contract`、`check_source_ci_gate` | ✅ |
| 三语国际化（999 键/失败标点/占位符/原生文案） | `src/lang/*.json` | `check_docs_consistency`、`check_ts_syntax` | ✅ |
| 工程门禁（eslint/tsc/docs-audit/L4 巡检） | `scripts/check_*.js` 34 个 | 全部门禁 rc0 | ✅ |

**状态说明**：✅ 有脚本断言且已审；📝 静态走查/待真机；车机版相关项已移出本计划。

---

## 4. 跨仓契约与联动审计面（本轮核心）

> 前几轮联动审计散落在 M 组、T 组、Q 组，本版集中。**字段名对得上 ≠ 语义对得上，字段、枚举、默认值、单位四样都要对。**

| ID | 联动点 | 现状 | 性质 |
|---|---|---|---|
| X-L1 | **第 14 个 action `forceQualityProbe` 未进 App 契约** | 音源已实现；App `SOURCE_ACTIONS` 仍 13、`check_source_contract` 硬断言 `length===13`、`SYNC_POINTS.md` 写「13 action」 | 契约漂移（P2 暂缓，接 App 时先改断言否则 CI 拒绝） |
| X-L2 | **能力备档压制起跑档无 App 可见解释** | 音源 `getQualityCeiling` 压制起跑档，App 请求 flac 得 128k，UI 无「因源能力备档跳过」提示 | 体验缺口 |
| X-L3 | **`definitiveFail`/`linkExpired` App 不消费** | 音源 byQuality 新增两字段，App `Health.tsx` 类型未含 | 源有数据 App 不展示（无害） |
| X-L4 | `qualityConfidence` 三值 | 音源 `exact/estimated/unknown`；App 消费 `default='exact'` 仅旧源兼容 | 已对齐，继续守 |
| X-L5 | 13 action ↔ 音源声明 | 除 `forceQualityProbe` 外 13 个已对齐 | `check_source_contract` 14/0 |
| X-L6 | 音质档位命名 | `SOURCE_QUALITIES` ↔ 音源 `QUALITY_PRIORITY` | 4 档固定 |

**联动铁律**：音源新增 action/字段/枚举时，反查 App 的 `sourceContract.ts`、`Health.tsx`、`SYNC_POINTS.md`、`check_source_contract.js` 是否同步。这条正是本次 QP-L1 发现的教训。

---

## 5. 音质优先改动专项（`ff9647cc`，Q-A1~A8）

| ID | 检查面 | 关键位置 | 验收 |
|---|---|---|---|
| Q-A1 | 自定义源请求档 | `utils.ts` `isCustomSource/getAvailableQualitys/getPlayQuality` | 自定义源不被 `meta._qualitys` 裁剪；内置源双裁剪；12/0 |
| Q-A2 | 下载档位一致 | `downloadManager.ts`、`QualitySelect.tsx`、`ListItem.tsx`、`PlayHighQuality.tsx` | 默认档跟随设置；`onQuality` 回填实际档 |
| Q-A3 | 实际交付档与 attempts | `online.ts`、`index.ts`、`playbackBudget.ts`、`healthLog.ts` | 成功路径 attempts 带 requested/delivered |
| Q-A4 | 片段语义 | `sourceLabel.ts`、`PlayInfo.tsx`×2、`playList.ts`、`downloadManager.ts`、`service.ts` | 播放页/通知栏「试听」；下载 `[试听]`；片段不回报成功 |
| Q-A5 | 置信度 | `index.ts`、`utils.ts`、`online.ts` | `exact/estimated/unknown` 透传；片段固定 unknown |
| Q-A6 | 缓存/旧数据 | `config/constant.ts`、`getStoreMusicUrl` | v2 前缀；缓存命中不把片段当完整 |
| Q-A7 | 回归面 | 播放预算/所有权/下载/三语/标签/docs | 相关门禁全绿 |
| Q-A8 | 缓存片段语义 | `utils/data.ts`、`online.ts` | `fragment` 真实回读；二次命中仍「试听」 |

---

## 6. 执行清单（本轮必跑，不接受「上次绿过」）

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx
node scripts/check_ts_syntax.js                 # 527 文件
node scripts/check_source_contract.js           # 14/0
node scripts/check_source_config_contract.js    # 25/0
node scripts/check_quality_request_runtime.js   # 12/0
node scripts/check_playback_budget.js           # 21/0
node scripts/check_playback_ownership_runtime.js # 21/0
node scripts/check_source_platform_label.js     # 9/9
node scripts/check_player_service_runtime.js    # 10/0
node scripts/check_player_utils_runtime.js      # 7/0
node scripts/check_player_progress_runtime.js   # 4/0
node scripts/check_download_persistence.js      # 3/0
node scripts/check_download_restore_runtime.js  # 3/0
node scripts/check_docs_consistency.js          # 18 文档
node scripts/docs-audit.js --dry-run            # 待处理 0
```

通过标准：全部 rc0；`tsc` 0 error；`eslint` 0/0。

---

## 7. 缺口清单（当前未覆盖）

| ID | 缺口 | 验证方法 | 验收 |
|---|---|---|---|
| S1~S5 | 设备级：首装/升级、权限流、横竖屏、批量下载、长文件名 | 真机 | 标 🧪，待实机 |
| X-L1~L3 | 音质政策 App 消费面（见 §4） | App 侧跟进 | 见 §4 处置 |
| 真机音质矩阵 | 10 首矩阵、A/B 延迟 | 真机 | blocked |
| 健康诊断·未闭环 4 项 | ①真实播放回传去重（同歌多次 Playing 每次成功回传会抬高样本数）②`probeSource` 只读语义 ③自动关闭 TTL 6h 重启复验 ④真机桥透传 `err.detail[0].source` 能否穿过 RN 桥 | 真机 / 宿主模拟 | 见 `AUDIT_PLAN_HEALTH_DIAGNOSTICS.md` §6；未闭环前不宣称「健康判定完全正确」 |
| ~~G-A01~~ **已核销** | 原记「错误码文案缺 4 键、界面显示英文常量」 | **2026-11-15 复核不成立**：`src/core/music/utils.ts` 已重构为 `FAIL_CODE_I18N_KEY`，源侧 16 个码全覆盖（含 `TRUNCATED_MEDIA`/`BAD_ENVELOPE`/`CONTRACT_ERROR`/`CANCELED`）；4 个 `player_error_*` key 在 `src/lang/{zh-cn,zh-tw,en-us}.json` 979~982 行均有三语翻译；表注释已改为「共 16 个（v8.13）」 | 已修复，无需处理 |
| G-A02 | 4 主状态映射 144 种组合仅 10 条断言覆盖 | `check_health_status_refactor.js` 实跑 10/0；无状态全枚举套件 | 待补（对应压测 E14） |
| ~~G-A03~~ **不成立** | 原记「下载器 922 行无 `check_download*` 专项」 | **2026-11-15 复核不成立**：已有 `check_download_error_i18n.js` / `check_download_persistence.js` / `check_download_restore_runtime.js` | 已覆盖；仅队列压力未做（E19） |
| G-A04 | 诊断错误码分组只认 12 个码 | 未复核到证据（`FAIL_CODE_I18N_KEY` 已按 16 码建表） | 待复核，可能随 G-A01 一并解决 |
| G-A05 | 无 jest / testing-library，纯函数无系统单测 | `package.json` | 仍成立（全仓 node 脚本形态） |
| G-A06 | 原记 `Health.tsx` 有 4 处硬编码中文 | 文件已移至 `src/screens/Home/Views/Setting/settings/Health.tsx`；77 行含中文，抽样均为 `//` 注释 | 待复核，倾向不成立 |
| G-A07 | `as any` / `@ts-ignore` 未量化建档 | 当前实测 22 处 | 仍成立（有数量、无明细建档） |
| G-A08 | 真机验收 blocked | 无 `adb` / 无 `/dev/kvm` / `ANDROID_HOME` 未设 | blocked |
| G-A09 | tx 完整曲目 blocked（上游约 60 秒试听，只能判 `PREVIEW_FRAGMENT`） | 上游限制 | blocked |

> G-A01~G-A09 来源：原 `AUDIT_PLAN_v1.9.2-b118.md`（b118 期全覆盖草稿）§2「实锤缺口总表」。**2026-11-15 承接时已对当前代码逐条复核**：G-A01 已修复、G-A03 不成立（均为 b118 之后修掉），其余标注为「待补 / 待复核 / 仍成立」。凡标「待复核」者未经实测定论，不得当作待修缺陷计入交付。

---

## 8. 失败处置与外部阻塞

1. `check_source_ci_gate` 本地 `GITHUB_TOKEN` 无效 → 用 `git credential fill` 取有效令牌复跑；CI runner 仍用自带 `GITHUB_TOKEN`。
2. G2 真机、G7 tx 完整链 blocked，不写成通过。
3. 本计划只对纯 Node/内存 FS 结论负责。
