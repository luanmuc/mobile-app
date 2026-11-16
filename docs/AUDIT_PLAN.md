# App 仓库审计计划 v3.0（重构版 · 活文档）

> **重构说明**：本文件由 v2 重构而来。v1（39 维）→ v2（89 维）→ 后续 O/M/T/Q 组多次叠加，导致同一字母（O、M）出现两次定义、历史修复记录（R1~R15）与当前维度混在一起。本版去掉历史叠加与已销项记录（归档至各轮 `AUDIT_REPORT-*.md`），只保留「当前要审什么、状态如何、缺口在哪」。
>
> **基线（唯一真值，2026-11-16）**：
> - App：`luanmuc/mobile-app` @ `54249f8b`（已推送），v1.9.2-**b143** / versionCode **302**（Build `43849852397` success，5 APK）
> - 源仓：`luanmuc/backend-api` @ `c2f1ba0`（已推送），v8.16.1（5881 行 / 307085 bytes）
> - track-player：`88b062b`（v2 分支）
> - 硬数字：三语各 **1009 键**、TS/TSX **528 文件**、`scripts/check_*.js` **40 个**（`npm run preflight` 逐条跑；`check_source_ci_gate` 需网络，CI 用自带 token）、**check 断言合计 531 条**、文档 **17 篇**
> - 本文件对应变更：b143「preflight 一条命令跑完 CI 同判据」+ 计划唯一性收口（G21）；源仓 v8.16.1「旧版本健康快照按数值比较接受」→ App `check_cross_repo_health_roundtrip` X1~X3 4/0

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
| A-A03 | 诊断窗口/覆盖 | `healthDiagnostics.ts`、`Health.tsx` | `check_health_diagnostics` 60/0 |
| A-A04 | 诊断视图 | `healthDiagnosticsView.ts` | `check_health_diagnostics_view` 25/0 |
| A-A05 | 事件链路/去重 | `healthLog.ts` | `check_health_event_pipeline` 10/0 |
| A-A06 | 持久化 v2 | `sourceHealthPersistence.ts` | `check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0 |
| A-A07 | 配置契约 | `sourceConfig.ts` | `check_source_config_contract` 29/0；39 键三语 |
| A-A08 | 三语闭合 | `src/lang/*.json` | 各 1009 键、无重复、无缺占位符 |
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

> 健康诊断这一域的逐分支断言见 **附录 A**（本文件内，原独立子纲已并入）。

> 每个定制功能单列一行：功能 → 关键位置 → 守的脚本/断言 → 状态。**车机版（横屏排行榜、车机布局、车机通知栏竖排按钮）不在本计划范围**；通知栏的常规定制（播放模式按钮/显示格式）仍保留。

| 定制功能 | 关键位置 | 守的脚本/断言 | 状态 |
|---|---|---|---|
| 音质优先播放（请求档/真实标签/下载档/缓存版本/置信度/片段语义） | `core/music/utils.ts`、`online.ts`、`downloadManager.ts`、`utils/data.ts` | `check_quality_request_runtime` 12/0 | ✅ |
| 音源健康面板（4 主状态+reason、质量矩阵、趋势、配置、异常） | `healthStatus.ts`、`Health.tsx` | `check_health_state_v2` 7/0、`check_health_ui_mapping` 12/0、`check_health_anomaly_v2` 8/0 | ✅ |
| 音源健康本地诊断（采样加权/失败归因/窗口覆盖/证据展开/脱敏） | `healthDiagnostics.ts`、`healthLog.ts` | `check_health_diagnostics` 60/0、`check_health_diagnostics_deep` 51/0、`check_health_diagnostics_view` 25/0 | ✅ |
| 音源健康事件链路（eventId 去重/traceId/脱敏） | `healthLog.ts` | `check_health_event_pipeline` 10/0 | ✅ |
| 音源健康持久化 v2（v1 拒绝/容量版本边界/可回滚） | `sourceHealthPersistence.ts` | `check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0 | ✅ |
| 音源管理（配置契约 39 键/自定义源导入/更新音源按钮/版本号/action 表） | `sourceConfig.ts`、`sourceContract.ts`、`init/userApi/*` | `check_source_config_contract` 29/0、`check_source_contract` 14/0 | ✅ |
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
| 三语国际化（1009 键/失败标点/占位符/原生文案） | `src/lang/*.json` | `check_docs_consistency`、`check_ts_syntax` | ✅ |
| 工程门禁（eslint/tsc/docs-audit/L4 巡检） | `scripts/check_*.js` **40 个**（`npm run preflight` 一键跑完 CI 同判据） | 40 脚本 rc0 / 531 条断言 | ✅ |

**状态说明**：✅ 有脚本断言且已审；📝 静态走查/待真机；车机版相关项已移出本计划。

---

## 4. 跨仓契约与联动审计面（本轮核心）

> 前几轮联动审计散落在 M 组、T 组、Q 组，本版集中。**字段名对得上 ≠ 语义对得上，字段、枚举、默认值、单位四样都要对。**

| ID | 联动点 | 现状 | 性质 |
|---|---|---|---|
| X-L1 | **第 14 个 action `forceQualityProbe`** | **已闭合并定性为「保留」**：App `SOURCE_ACTIONS` 14 个、`check_source_contract` 14 对齐；源侧 `forceQualityProbe()` 实现完整、`quality-policy-v2` 直接覆盖。App 无 UI 调用方——这是**源能力声明而非死桥接**（删除会造成跨仓契约漂移，且 K07 探路旁路是未来单源复测入口的能力基础，成本为负）。健康页已有 `probe`（全局探测）/`probeSource`（单源复测）覆盖用户可见的复测需求，不再为此新增强制高质入口 | 已闭合（2026-11-16 复核） |
| X-L2 | **能力备档压制起跑档无 App 可见解释** | 音源 `getQualityCeiling` 压制起跑档，App 请求 flac 得 128k，UI 无「因源能力备档跳过」提示 | 体验缺口 |
| X-L3 | **`definitiveFail`/`linkExpired` App 不消费** | 音源 byQuality 新增两字段，App `Health.tsx` 类型未含 | 源有数据 App 不展示（无害） |
| X-L4 | `qualityConfidence` 三值 | 音源 `exact/estimated/unknown`；App 消费 `default='exact'` 仅旧源兼容 | 已对齐，继续守 |
| X-L5 | 13 action ↔ 音源声明 | 除 `forceQualityProbe` 外 13 个已对齐 | `check_source_contract` 14/0 |
| X-L6 | 音质档位命名 | `SOURCE_QUALITIES` ↔ 音源 `QUALITY_PRIORITY` | 4 档固定 |
| X-L7 | **健康快照版本兼容（源仓 v8.16.1）** | 源侧 `compareSourceVersion` 改数值比较、白名单 `[8.14.1,8.15.1,8.16.0,8.16.1]`；App 侧 `parseSourceVersion`/`sanitizeSourceHealthState` 必须同口径 | `check_cross_repo_health_roundtrip` X1~X3 4/0（回退任一仓即红） |
| X-L8 | **计划唯一性** | 每仓只许一份审计计划 + 一份压测计划，归档合并为一份 | `check_truth_gates` **G21**（`AUDIT_PLAN*.md`/`STRESS_PLAN*.md` 各恰 1） |

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
npm run preflight          # 36 条：tsc + eslint + release.yml checks 段 + 跨仓往返（≈202s）
npm run preflight:all      # 41 条：再追加源仓 build-source/self-check/docs-audit/verify:bundle/npm test（≈387s；源仓 npm test 已并入 CI 全量审计清单后变长）
```

> `preflight` 直接解析 `.github/workflows/release.yml` 的 `lint:`/`checks:` 段取命令，不手抄清单——手抄必然漂移（b142 那轮就是清单少写 1 个脚本，云端才红）。双仓改动必用 `preflight:all`。

### 6b. 全量脚本台账（40 个 `check_*.js`，531 条断言）

| 脚本 | 条数 | 守什么 |
|---|---:|---|
| `check_ts_syntax` | 528 文件 | TS/TSX 语法 0 错误 |
| `check_health_diagnostics` | 60 | 健康诊断契约（窗口/归因/证据/脱敏） |
| `check_health_diagnostics_deep` | 51 | 逐分支断言 + 10 万条压力 |
| `check_health_diagnostics_view` | 25 | 视图模型（折叠/分组/格式化） |
| `check_health_diagnostics_stress` | 14 | 1 万事件 / 5MB 截尾 / 200 错误码 |
| `check_log_directory` | 15 | 公共优先/回迁/四类补齐/压力 |
| `check_health_status_refactor` | 10 | 状态优先级与 `offReason` |
| `check_health_state_v2` | 7 | 4 主状态 + reason |
| `check_health_ui_mapping` | 12 | 文案/颜色/质量矩阵/趋势弹窗 |
| `check_health_event_pipeline` | 10 | eventId 去重 / traceId / 只写本机 |
| `check_health_persistence_v2` | 9 | v1 拒绝 / 容量与版本边界 |
| `check_health_anomaly_v2` | 8 | 异常分级 / 覆盖不足不宣称 |
| `check_health_real_playback` | 10 | 真播放计数 / 多源失败证据 |
| `check_source_health_persistence` | 17 | v2 导出恢复 / 五平台并发 |
| `check_source_config_contract` | 29 | 39 键 / 单位 / 三语 |
| `check_source_contract` | 14 | 14 action / envelope / fallbackOwner |
| `check_source_update_logic` | 44 | 更新逻辑 / 无指纹机制 |
| `check_source_platform_label` | 9 | 实际平台优先 / 试听标签 |
| `check_quality_request_runtime` | 12 | 请求档双裁剪 / 片段缓存回读 |
| `check_playback_budget` | 21 | 24s 预算 / attempts |
| `check_playback_ownership_runtime` | 21 | 所有权交接 |
| `check_playback_timeout_race` | 1 | 25s 超时后晚到成功不补账 |
| `check_player_core_runtime` | 15 | 播放队列/清理 |
| `check_player_service_runtime` | 10 | 服务运行时 |
| `check_player_hook_runtime` | 7 | hooks 订阅清理 |
| `check_player_utils_runtime` | 7 | 热点工具 |
| `check_player_progress_runtime` | 4 | 进度/除零 |
| `check_media_body` | 6 | 媒体信封 / 能力协商 |
| `check_sync_client_runtime` | 4 | 同步客户端 |
| `check_download_persistence` / `_restore_runtime` / `_error_i18n` | 3 / 3 / 7 | 下载持久化/恢复/错误标点 |
| `check_file_name_template_runtime` | 11 | 文件名 token 模板 |
| `check_release_state_contract` | 5 | versionCode / README 同步 |
| `check_docs_consistency` | 17 文档 | 文档真值/死引用 |
| `check_cross_repo_linkage` | 8 | 双仓静态联动（22s vs 23s） |
| `check_cross_repo_health_roundtrip` | 4 | X1~X3 健康态往返（需双仓） |
| `check_truth_gates` | 21 门禁 | 含 **G21 计划唯一** |
| `check_source_ci_gate` / `_offline` | 网络 / 离线 | 源仓 CI 闸门（CI 用自带 token） |

## 7. 缺口清单（当前未覆盖）

| ID | 缺口 | 验证方法 | 验收 |
|---|---|---|---|
| S1~S5 | 设备级：首装/升级、权限流、横竖屏、批量下载、长文件名 | 真机 | 标 🧪，待实机 |
| X-L1~L3 | 音质政策 App 消费面（见 §4） | App 侧跟进 | 见 §4 处置 |
| 真机音质矩阵 | 10 首矩阵、A/B 延迟 | 真机 | blocked |
| 健康诊断·未闭环 4 项 | ①真实播放回传去重（同歌多次 Playing 每次成功回传会抬高样本数）②`probeSource` 只读语义 ③自动关闭 TTL 6h 重启复验 ④真机桥透传 `err.detail[0].source` 能否穿过 RN 桥 | 真机 / 宿主模拟 | 见附录 A §6；未闭环前不宣称「健康判定完全正确」 |
| ~~G-A01~~ **已核销** | 原记「错误码文案缺 4 键、界面显示英文常量」 | **2026-11-15 复核不成立**：`src/core/music/utils.ts` 已重构为 `FAIL_CODE_I18N_KEY`，源侧 16 个码全覆盖（含 `TRUNCATED_MEDIA`/`BAD_ENVELOPE`/`CONTRACT_ERROR`/`CANCELED`）；4 个 `player_error_*` key 在 `src/lang/{zh-cn,zh-tw,en-us}.json` 979~982 行均有三语翻译；表注释已改为「共 16 个（v8.13）」 | 已修复，无需处理 |
| G-A02 | 4 主状态映射 144 种组合仅 10 条断言覆盖 | `check_health_status_refactor.js` 实跑 10/0；无状态全枚举套件 | 待补（对应压测 E14） |
| ~~G-A03~~ **不成立** | 原记「下载器 922 行无 `check_download*` 专项」 | **2026-11-15 复核不成立**：已有 `check_download_error_i18n.js` / `check_download_persistence.js` / `check_download_restore_runtime.js` | 已覆盖；仅队列压力未做（E19） |
| ~~G-A04~~ **不成立** | 原记「诊断错误码分组只认 12 个码」 | **2026-11-15 复核不成立**：`src/core/healthDiagnostics.ts` 无任何码白名单，统计一律动态取 `String(e.code)`（232 / 401 / 410 / 445 行），未知码落 `UNKNOWN`，新错误码判定也基于动态 `Set` | 已覆盖，任意码可用 |
| G-A05 | 无 jest / testing-library，纯函数无系统单测 | `package.json` | 仍成立（全仓 node 脚本形态） |
| ~~G-A06~~ **不成立** | 原记 `Health.tsx` 有 4 处硬编码中文 | **2026-11-15 复核不成立**：`src/screens/Home/Views/Setting/settings/Health.tsx` 的字符串字面量中文全部出现在 `//` 注释行（42/66/69/197），无 JSX 文本中文、无模板字符串中文 | 已覆盖，界面文案全走 i18n |
| G-A07 | `as any` / `@ts-ignore` 未量化建档 | 当前实测 22 处 | 仍成立（有数量、无明细建档） |
| G-A08 | 真机验收 blocked | 无 `adb` / 无 `/dev/kvm` / `ANDROID_HOME` 未设 | blocked |
| G-A09 | tx 完整曲目 blocked（上游约 60 秒试听，只能判 `PREVIEW_FRAGMENT`） | 上游限制 | blocked |

> G-A01~G-A09 来源：原 `AUDIT_PLAN_v1.9.2-b118.md`（b118 期全覆盖草稿）§2「实锤缺口总表」。**2026-11-15 已逐条对当前代码复核，无「待复核」项**：G-A01/G-A03/G-A04/G-A06 四条**不成立**（b118 之后已修或本就误判），G-A02/G-A05/G-A07 **仍成立**（待补项），G-A08/G-A09 为**环境 blocked**。即 b118 草稿的高危缺口已全部消失，剩余仅是待补测试与真机限制。

---

## 8. 失败处置与外部阻塞

1. `check_source_ci_gate` 本地 `GITHUB_TOKEN` 无效 → 用 `git credential fill` 取有效令牌复跑；CI runner 仍用自带 `GITHUB_TOKEN`。
2. G2 真机、G7 tx 完整链 blocked，不写成通过。
3. 本计划只对纯 Node/内存 FS 结论负责。

> 已知取舍：`targetSdkVersion = 29` 保持不动（自签名直发、不走 Play 商店；升到 33+ 会引入 `POST_NOTIFICATIONS` 运行时权限与前台服务类型约束，需真机回归）。

---

## 附录 A：音源健康 · 本地诊断逐分支断言（原 `AUDIT_PLAN_HEALTH_DIAGNOSTICS.md`）

> **合并说明（2026-11-16）**：本仓审计计划保持**唯一**——原同目录的 `AUDIT_PLAN_HEALTH_DIAGNOSTICS.md` 已并入本节，不再作为并列计划存在。它原本就是 §3b「音源健康本地诊断」这一行的深度子纲，独立成文会让“审什么”和“怎么验”分到两个文件里，容易各自漂移。断言条数以本节为准。

> **定位**：本节是主计划 §3b「音源健康本地诊断」一行的**深度展开**（当前 91 条断言口径：深度 51 / 视图 25 / 日志目录 15），不是并列的第二份审计计划。主计划管「审什么 / 缺口在哪」，本文件管「健康诊断这一域的逐分支断言怎么验」。
>
> 审计对象：App 仓 `lx-music-mobile`，本地诊断闭环（`healthLog.ts` / `healthDiagnostics.ts` / `online.ts` 失败归因 / `Health.tsx` / 三语文案 / 文档与 workflow）。
> 本轮基线：历史起点 `a02db1af`；2026-11-15 HDM-3 本地基线：App `check_health_diagnostics` 60/0、`check_health_real_playback` 10/0（新增 R7/R8）、`check_health_persistence_v2` 9/0（Q5 改为 controls 永久）；源仓 `health-persistence-v2` P1~P9 全绿（P7 未知源跳过、P9 controls-only 去 TTL）。历史基线 `785af658` + `8adce795` 为 54/0 / 51/0 / 14/0 / 23/0 / 15/0。
>
> **2026-11-15 HDM-3 口径变更**：健康数据分 L0/L1/L2。L0 用户控制意图永久、无 TTL、跨 sourceVersion；L1 健康元数据 7 天 TTL 且绑 sourceVersion；L2 事件 7 天滚动。事件新增 `context`（`user/preload/refresh/download/probe/legacy`）与 `playback_start`。`chain_result` 是 URL 获取尝试，`play_result` 是播放请求/URL 就绪，`playback_start` 是播放器真实起播；`cache_hit` 单列，`probe_result` 独立。用户取链/播放请求/实际起播/预加载/legacy 分块统计，异常只吃 `user` 取链；旧无 context 的 `chain_result` 只计数、不参与异常。v1 不迁移、不兼容。
> 原则：不是「跑一遍不崩」，而是逐分支验证统计口径、窗口语义、异常规则、隐私边界和大数据行为。

> **2026-11-13 v8.14 健康整功能重构补审**：新增 `scripts/check_health_status_refactor.js`（HS1~HS8）专审状态优先级与 `offReason`，已 8/0。覆盖：用户关闭 > 自动关闭 > 默认关闭 > 休眠 > 待采样 > 播放摘除 > 异常；旧快照无 `offReason` 回退不回归；4 主状态只落一态。新增待审缺口：真实播放回传去重（同一首歌多次 Playing 目前每次成功回传，会抬高样本数）、`probeSource` 只读语义、自动关闭 TTL 6h 重启复验；这三项需真机或宿主模拟补证，未闭环前不得宣称“健康状态完全正确”。


### 1. 审计目标

本地诊断回答的是「这个音源到底坏没坏」。它必须同时满足：

1. **数值可信**：成功 1/1 全量落盘（历史 1/5 样本仍按权重还原），聚合必须还原真实成功率；任何派生的趋势/异常比较也不得回到原始条数。
2. **归因正确**：失败必须绑定真实 `sourceId`；没有归因证据时宁可少报，不得把 `platform` 冒充成源。
3. **窗口诚实**：`1h/24h/7d` 是否覆盖由全量事件最早时间戳判定；覆盖不足必须降级文案，不能把 2 小时说成 7 天。
4. **异常可复核**：每条 finding 有 evidence、traceId、最多 5 条 samples，且总条数有上限。
5. **隐私不回退**：证据包、日志尾部、嵌套 `sourceEvents` 都不出现 URL、歌名、歌手、搜索词。
6. **规模可控**：10 万条事件、2 万条证据包、5MB 日志不崩、不越界、不无限增长。
7. **UI 有兜底**：分享失败回退复制摘要；异常可展开；空报告仍给操作引导。

### 2. 代码清单与分支映射

#### 2.1 `src/core/healthDiagnostics.ts`

| 代码单元 | 分支/边界 | 审计 ID |
| --- | --- | --- |
| `weightOf` | 合法正数 / 0 / 负数 / NaN / Infinity / 字符串 | D1、D2 |
| `statsOf` | 空列表 / 加权 total/ok/failed / p95 原始样本 / covered 透传 | D1~D5 |
| `coversWindow` | 空 / 最早事件恰好边界 / 早于边界 / 仅窗口内样本 | D6、D7、D10 |
| `aggregateHealthEvents` | 三窗口 / 非法 event 过滤 / topCodes / breakdown 分组与截断 | D1、D15~D17、D27 |
| `sourceOf` | `sourceId` 优先 / `platform` 回退 / 双空 → unknown | D15、D18、D19 |
| `pct` / `trimTrace` | null / 百分比 / 去重截 6 | D13、D20 |
| `samplesOf` | 空 / 最多 5 条 / latency 取整 / 缺字段 | D18、D25 |
| `detectHealthAnomalies` | `local_zero` / `rate_drop` / `p95_spike` / `new_code` / `recent_failure` / `trend_decline` / 上限 12 | D18~D26 |
| `spanText` | 分钟 / 小时 / 天 / 0 | D9、D12 |
| `buildHealthReport` | 空 / 全失败 / 非法事件 / 未来时间 / truncated / 建议去重 | D8~D14 |
| `redactDiagnosticText` | 小写 http / 大写 HTTPS / ftp / file / 歌名 / 歌手 / 搜索词 / 幂等 | E5、E6 |
| `redactValue` | 字符串 / 数组 / 对象 / 深度上限 / 数组长度上限 | E7、E8、G3 |
| `buildEvidencePackage` | attempts 展开 / 坏行 / 50 条上限 / 版本字段 / events 克隆 | E1~E4、E9、G3 |

#### 2.2 `src/core/healthLog.ts`

| 代码单元 | 分支/边界 | 审计 ID |
| --- | --- | --- |
| `trimJsonlTail` | ASCII / 多字节 UTF-8 / CRLF / 恰好上限 / 单行超限 | F1、F2、F9 |
| `buildPlayResultEntry` | 空串省略 / NaN 省略 / 负权重省略 / 延迟取整 / 权重 1 | F3、F4 |
| `parseHealthLines` | 坏 JSON / 数组 / null / event 非字符串 / CRLF | F5 |
| `isExpiredHealthFileName` | 非法文件名 / 7 天边界 / 8 天前 | F6 |
| `shouldSampleSuccess` | 0 / 0.19 / 0.999 均 true（1/1） | F7 |
| `createHealthTraceId` | 格式 / 2000 次唯一性 | F8 |
| `healthFileName` / `buildExportFileName` | 日期、时分秒、无设备/账号 | F10 |
| `trimTailByBytes` | 纯中文 / 代理对 / 超字节上限 | F11 |
| `appendHealthEvent` / `readRecentHealthEvents` | 5MB 截尾 / 多日合并 / RN 依赖缺失；父目录整体删除后逐级重建 | 既有压力 U2、U3、U5；契约 H28 |
| `ensureHealthLogsDir` | 打开诊断页确保目录存在，不依赖下一次播放 | H28 |
| `recordPlayResult` | 失败 100% / 成功 1/1 / 失败抓 sourceEvents；App attempts 落顶层 `chain_result`；缓存命中单独 `cache_hit`；真实缓存播放记 `play_result` 但 `recordChain:false` | 契约 H11、H15 + 压力 U9~U12 + R1~R6 |

#### 2.3 其它改动面

| 文件 | 代码/契约 | 验证 |
| --- | --- | --- |
| `src/core/music/online.ts` | 失败分支 `sourceId = err.sourceId ?? err.detail[0].source` | H15 源码切片 + 本计划 §6 未覆盖项 |
| `Health.tsx` | 20000 读取上限、truncated、复制摘要、分享失败回退、样本展开；最近异常窗口按“可信度→总体→错误码→其他线索”分层并默认折叠，展示逻辑收敛到 `healthDiagnosticsView`；finding/reason 走本地化 | H14/H18/H19/H27/H29 + 视图 25 条 |
| `src/lang/*.json` | `health_copy_report` / `health_copy_done` 以及 17 个 `health_diag_*` 三语；诊断 finding 32 键 + reason 12 键 | `check_docs_consistency` 17 篇、三语各 1009 键 |
| `docs/AGENTS.md` 等 | 31→41 条（H22/H23 锁趋势单一来源/日志死 API，H24~H26 锁无基线不报新码/同码不重复/未加权样本提示，H27 锁窗口分层与折叠，H28 锁公共目录优先/私有日志回迁/目录逐级重建/任一分类写日志时补齐四类固定日志，H29 锁缓存命中独立计数）、采样/覆盖/证据口径 | `check_docs_consistency`、`docs-audit --dry-run` |

### 3. 断言矩阵（51 条）

运行入口：`node scripts/check_health_diagnostics_deep.js`。分组与阈值如下，全部要求 rc=0。

| ID | 断言 | 期望 |
| --- | --- | --- |
| D1 | 950×20 成功 + 1000 失败 | total 20000 / ok 19000 / rate 95%；三窗口同值 |
| D2 | 0、负数、NaN、Infinity、字符串权重 | 全部按 1，不得放大/抹掉 |
| D3 | P95 与权重 | 权重不改变 p95，仍取原始延迟 |
| D4 | 空事件 | total 0、rate/p95 null、covered false |
| D5 | 历史无权重 | total=长度 |
| D6 | 1h 窗口内 2 条 + 2h 基准 | total 2、covered true |
| D7 | 3h 数据 / 30min 数据 | 3h 覆盖 1h 不覆盖 24h；30min 不覆盖 1h |
| D8 | 空报告 | coverage 空、findings 0、summary 引导 |
| D9 | 30min + truncated | d7 false；summary 含“仅覆盖最近”和“1/1” |
| D10 | 恰好 7 天前基准 | d7 covered true、total 20（权重 20） |
| D11 | 全失败 | rate 0、有 findings/recommendations |
| D12 | 非法事件 | 不抛，只保留合法 ts |
| D13 | 建议/traceId | 去重、≤6 |
| D14 | 未来时间戳 | 不进窗口，coverage 可见 |
| D15 | 分组 | source\|platform\|quality 正确，权重正确 |
| D16 | 15 组 | breakdown 截 10，total 降序 |
| D17 | total 相同 | sourceKey 字典序稳定 |
| D18 | local_zero 正例 | 3 败 + 快照 90% 必报，samples≤5 |
| D19 | local_zero 反例 | 只有 platform 不得冒充 sourceId |
| D20 | rate_drop 加权 | 99.5%→66.7% 必报 33pp，evidence 含“约” |
| D21 | p95_spike | 100ms→1000ms 必报 |
| D22 | new_code 正例 | 有前 24h 基线时，前 7d 未见的新码必报 |
| D23 | new_code 反例 | 旧码再次出现不得报新码 |
| D24 | trend_decline | 连续降必报；抖动降不报 |
| D25 | 上限 | findings≤12，每条 samples≤5 |
| D26 | source_events | 不得当 outcome 参与异常规则 |
| D27 | topCodes | 只统计失败 outcome、降序、≤8 |
| E1 | attempts | source_events 展开，上限 50 |
| E2 | attempts 坏行 | null/字符串跳过，source 可回退 sourceId |
| E3 | 版本字段 | 有值写入 appVersion/sourceVersion |
| E4 | 版本空值 | 不得写 undefined 键 |
| E5 | 脱敏 | 大写 HTTPS、FTP、file、歌名/歌手/搜索词全覆盖 |
| E6 | 脱敏幂等 | 二次处理不再变化 |
| E7 | 嵌套脱敏 | events/sourceEvents 的 reason 也必须无 URL/歌名 |
| E8 | 不改原对象 | 脱敏是复制，不回写调用方事件 |
| E9 | 证据包克隆 | 改包不回写原事件 |
| F1 | 多字节截尾 | UTF-8 字节≤上限，首尾完整 |
| F2 | CRLF | 归一为 LF，行完整 |
| F3 | 空字段 | 空串/NaN/负权重全部省略 |
| F4 | 延迟/权重 | 延迟四舍五入，失败权重 1 保留 |
| F5 | 脏行 | 数组/null/无 event 跳过，合法行保留 |
| F6 | 文件名过期 | 非法名不判过期，7 天边界准确 |
| F7 | 记录边界 | 0/0.19/0.2/0.999 全部记录 |
| F8 | traceId | 2000 个唯一且格式稳定 |
| F9 | 恰好上限 | 完整行不被丢弃 |
| F10 | 文件名 | 日期/时分秒正确，无账号设备 |
| F11 | 诊断日志尾 | UTF-8 字节≤上限、不切断中文、无替换符 |
| G1 | 10 万条聚合 | ≤2000ms，结果有限 |
| G2 | 10 万条报告 | ≤3000ms，findings≤12 |
| G3 | 2 万条证据包 | ≤4000ms，可 JSON 序列化 |

#### 3.1 视图模型审计（20 条）

运行入口：`node scripts/check_health_diagnostics_view.js`。纯函数 `buildHealthDiagnosticsView(report)` 负责折叠态摘要、覆盖状态、24h 四格、1h 空态、未加权样本提示、错误码/其他线索分组。

| ID | 关注点 | 断言 |
| --- | --- | --- |
| V1 | 百分比 | null/undefined → `-`，0 → `0%`，22.1% → `22%`，1 → `100%` |
| V2 | 空报告 | 空态、无错误码/其他线索、覆盖率 `-`、跨度 `0 小时` |
| V3 | 低成功率 | 22% 判低，60% 不判低 |
| V4 | 覆盖 7 天 | `full=true`，不显示截断，跨度 `7 天` |
| V5 | 覆盖 8 小时 | `full=false`、`truncated=true`，跨度 `8 小时` |
| V6 | 1 小时 | 0 条为空态；非 0 保留 total/ok |
| V7 | 错误码分组 | 只收 `new_code`/`recent_failure`，其他线索不混入 |
| V8 | 顺序/只读 | 分组保持原顺序，不改写原 `findings` |
| V9 | 线索数 | `findingCount` 包含全部；空态仅由 findings 决定 |
| V10 | 未加权样本 | 2 条时 `hasUnweighted=true` |
| V11 | 无未加权样本 | `hasUnweighted=false` |
| V12 | 折叠态 | ok/total/rate/findingCount 与报告一致 |
| V13 | 12 条线索 | 全量保留，不截断 |
| V14 | 0 跨度 | 不产生负值/NaN |
| V15 | 0% 成功率 | 可展示且判低 |
| V16 | d7 未覆盖 | `full=false` 且 h24 统计不丢 |
| V17 | 引用 | 分组保留原 finding 引用，不改原报告 |
| V18 | 构建压力 | 10000 次 ≤300ms |
| V19 | 格式化压力 | 100000 次 ≤200ms |
| V20 | 无副作用 | 连续两次构建结果一致 |

#### 3.2 日志目录审计（13 条）

运行入口：`node scripts/check_log_directory.js`。用内存 RNFS 加载真实 `log.ts` / `healthLog.ts`，覆盖公共优先、私有降级、回迁合并、同名冲突、幂等、四类文件补齐与压力。

| ID | 关注点 | 断言 |
| --- | --- | --- |
| L1 | 公共优先 | 公共可写时 `getLogsDir()` 为公共目录 |
| L2 | 私有降级 | 公共不可写时切私有，日志页仍可读 |
| L3 | JSONL 合并 | 同名健康 JSONL 追加，行不丢 |
| L4 | JSON 冲突 | 公共同名不覆盖，私有改名保留 |
| L5 | 幂等 | 重复检查权限不重复追加 |
| L6 | 四类补齐 | 写 error 后 error/source/diagnose/debug 都存在 |
| L7 | 内容保留 | 已有其他日志不被清空 |
| L8 | 私有清空 | 私有降级时 `clearLogs` 有效 |
| L9 | 父目录重建 | `lx-music` 与 `logs` 都被逐级补回 |
| L10 | 健康事件 | 写健康事件同时补齐四类固定日志 |
| L11 | 并发 | 并发检查权限只迁移一次 |
| L12 | 回迁压力 | 500 个私有文件回迁 < 300ms |
| L13 | 补齐压力 | 10000 次补齐四类文件 < 400ms |

### 4. 压力维度与阈值

| 维度 | 规模 | 阈值 | 证据 |
| --- | --- | --- | --- |
| 聚合吞吐 | 100000 条 source_result | ≤2000ms | G1，实测约 145ms |
| 报告生成 | 100000 条 | ≤3000ms | G2，实测约 322ms |
| 证据包 | 20000 条 + 64KB logTail | ≤4000ms，可序列化 | G3，实测约 68ms / 3.1MB |
| 日志截尾 | 5MB ASCII / 多字节日志 | ≤2MB / 指定上限，完整行 | 既有 U2、F1 |
| 异常上限 | 200 个错误码 / 30 源 | findings≤12，samples≤5 | U6、D25 |
| 采样还原 | 95×5+25 | total 500 / rate 95% | U11、D1 |
| 截断降级 | 只覆盖 30min | d7 false + 文案 | U12、D9 |
| 脏数据 | 坏 JSON / 数组 / null / NaN ts / 未来 ts | 不抛、不误计 | U4、D12、D14 |
| 隐私 | URL（大小写/协议）、歌名、嵌套 sourceEvents | 零残留 | E5~E7、U7 |

### 5. 审计发现（本轮真实修复）

| ID | 级别 | 现象 | 根因 | 修复 | 复验 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 高 | 多字节日志按字符数截尾，2000 字节上限实际写出 4619 字节 | `trimJsonlTail` 用 `line.length` 而非 UTF-8 字节 | 新增 `utf8Bytes`，按 UTF-8 累计，代理对按 4 字节 | F1 复验 `bytes=1959 ≤ 2000` |
| F-02 | 中 | 大写 `HTTPS://`、`FTP://`、`file://` 不被脱敏 | URL 正则只匹配小写 `http(s)` | 改为 `(?:https?\|ftp\|file)://` + `gi` | E5 复验全部 `[url]` |
| F-03 | 高 | 证据包 `events.sourceEvents[].reason` 可带 URL/歌名原样导出 | 只脱敏 `logTail`，events 仅浅拷贝 | 新增递归 `redactValue`，深度/数组双上限，导出前清洗 events | E7 复验无 URL/歌名，E8/E9 确认不改原对象 |

> 审计夹具自纠：D6/D7/D10 首轮失败不是实现问题，而是夹具把“窗口内最早事件”误当成覆盖基准。修正后明确：`covered` 看全量最早事件，不看窗口内样本。

### 6. 未覆盖与残余风险

1. **真机桥透传**：`err.detail[0].source` 能否真正从 `lx-source.js` 穿过 RN 桥到 `online.ts`，仍需设备实测；本轮只有源码切片（H15）与源仓对象形态证据。
2. **RN 运行时 I/O**：`appendHealthEvent` / `readRecentHealthEvents` 的真实文件系统、并发追加、分享 Intent 无法在 Node 中执行；本轮验证的是纯函数、截尾算法与依赖缺失降级。
3. **UI 运行时**：`Health.tsx` 的展开/复制/分享回退只做静态契约，未做真机点击。
4. **设备级 S 组**：按用户既定口径不列入本轮待办（真机横竖屏、通知栏、批量下载等）。

### 7. 执行命令与退出标准

```bash
# 深度审计压力（51 条）
node scripts/check_health_diagnostics_deep.js

# 既有契约/压力回归
node scripts/check_health_diagnostics.js          # 60/0
node scripts/check_health_diagnostics_stress.js   # 14/0
node scripts/check_health_diagnostics_view.js     # 25/0
node scripts/check_log_directory.js               # 15/0

# 仓库门禁
node scripts/check_ts_syntax.js                   # 528 文件 0 错误
node scripts/check_source_config_contract.js      # 29/0
node scripts/check_source_platform_label.js       # 9/9
node node_modules/typescript/bin/tsc --noEmit     # rc=0
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx  # rc=0
node scripts/check_docs_consistency.js            # 17 文档
node scripts/docs-audit.js --dry-run              # 待处理 0
```

退出标准：上述命令全部 rc=0；健康契约 60/0；深度审计 51/0；诊断压力 14/0；视图 25/0；日志目录 15/0；配置契约 29/0；音源契约 14/0；无新增隐私字段、无新增网络出口、无未解释的文档计数漂移。
