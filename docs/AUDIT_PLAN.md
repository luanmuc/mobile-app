# App 仓库审计计划 v3.0（重构版 · 活文档）

> **重构说明**：本文件由 v2 重构而来。v1（39 维）→ v2（89 维）→ 后续 O/M/T/Q 组多次叠加，导致同一字母（O、M）出现两次定义、历史修复记录（R1~R15）与当前维度混在一起。本版去掉历史叠加与已销项记录（归档至各轮 `AUDIT_REPORT-*.md`），只保留「当前要审什么、状态如何、缺口在哪」。
>
> **基线（唯一真值，2026-11-20）**：
> - App：`luanmuc/mobile-app` @ `dadef6a1`（**已推送 master**），**v1.9.2-b187**；`npm run preflight` **47 通过 / 0 失败**
> - 源仓：`luanmuc/backend-api`，**v9.1.4**（`297c88e`「巡检链重构：口径单一真相」，CI run 44679475468 全绿）
> - telemetry：`luanmuc/lx-telemetry` @ `2cdb7f6`（**公开仓**；`ingest` 5/5）
> - track-player：`141dca5`（v2 分支，**短打断分级 + 通用性补修 + 代次簿记**：非通话短打断改压低不暂停 / `FOCUS_RECHECK` 兜底与 `RECHECK_DENIED` 长占用降级暂停 / `BECOMING_NOISY` 按当前路由判定 / 淡入不再冒充用户调音量 / `PendingSlots` 让撤销真的能让到点任务失效；焦点断言 37→58→67 条，代次簿记 24 条）
> - 硬数字：三语各 **1044 键**、TS/TSX **542 文件**、`scripts/check_*.js` **50 个**（其中 `check_assertion_ledger` 是校验工具、`check_upstream_divergence` 是比对工具，均不计入断言）、**6b 台账合计 1221 条 = 计数型 542（文件）+ 17（文档）+ 非计数型断言 662 条**（6c 逐 ID 实算），算式 `1221 − 542 − 17 = 662` 自洽
> - **2026-11-20 实跑**：`check_ts_syntax` 542/0；`check_docs_consistency` 17 篇；`check_assertion_ledger` **46 一致 / 0 漂移 / 0 失败 / 0 未解析 / 0 缺脚本**，台账 1221 = 实测 1221；`--gen-ids` 仍报 **44 脚本 / 662 条 ID 全覆盖**
> - **v9 审计面（K36 后收敛）**：`src/core/sourceUpdate/` 整目录（含 `verify.ts`）与 `check_source_signing` 已随「V9.3 在线更新体系整体下线」删除——「更新音源」回归单文件拉取（多镜像兜底），不再有 manifest/验签链；`scripts/lib/source-static.js` 统一拼接「legacy + 全部 core 模块」静态源
> - 本文件对应变更：V9「音源模块化拆包 + ed25519 验签 + 版本区间语义」；**B2（2026-11-19）**：启动期在线自动更新下线（冷启动白屏 20~30 秒的根因，且与手动「更新音源」按钮重复），验签改挂手动更新路径

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
| A-A08 | 三语闭合 | `src/lang/*.json` | 各 1040 键、无重复、无缺占位符 |
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
| 音源健康面板（4 主状态+reason、质量矩阵、趋势数据链、配置、异常、一行 4 按钮 + 导出诊断） | `healthStatus.ts`、`Health.tsx` | `check_health_state_v2` 7/0、`check_health_ui_mapping` 12/0、`check_health_anomaly_v2` 8/0 | ✅ |
| 音源健康本地诊断（采样加权/失败归因/窗口覆盖/证据展开/脱敏） | `healthDiagnostics.ts`、`healthLog.ts` | `check_health_diagnostics` 60/0、`check_health_diagnostics_deep` 51/0、`check_health_diagnostics_view` 25/0 | ✅ |
| 音源健康事件链路（eventId 去重/traceId/脱敏） | `healthLog.ts` | `check_health_event_pipeline` 10/0 | ✅ |
| 音源健康持久化 v2（v1 拒绝/容量版本边界/可回滚） | `sourceHealthPersistence.ts` | `check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0 | ✅ |
| 真机摘要回传（PAT 只存本机 / 24h 聚合 / 20h 节流 / 单飞 / 队列补发 / Issue 格式 / 不含歌名账号） | `healthDigest.ts`、`healthDigestUpload.ts`、`Health.tsx` | `check_health_digest` 12/0（**2026-11-19 已接入 `release.yml` checks 段「健康状态/文案/文档一致性门禁」步**，此前只是本地手动）；telemetry `node --test` 9/9；真机 + 并发实测 | ✅ |
| 音源管理（配置契约 39 键/自定义源导入/更新音源按钮/版本号/action 表） | `sourceConfig.ts`、`sourceContract.ts`、`init/userApi/*` | `check_source_config_contract` 29/0、`check_source_contract` 14/0 | ✅ |
| 下载管理器（下载档一致/文件名模板/失败原因 i18n/目录迁移/长文件名/批量下载） | `downloadManager.ts`、`utils/download*` | `check_download_persistence` 3/0、`check_download_restore_runtime` 3/0、`check_download_error_i18n`、`check_file_name_template_runtime` | ✅ |
| 播放器核心（进度条/批量队列/音频焦点三开关/后台播放/线控） | `player*`、`media*` | `check_player_core_runtime`、`check_player_service_runtime` 10/0、`check_media_body` | ✅ |
| 通知栏定制（播放模式按钮/显示格式/音源名音质不被歌词覆盖/**2026-11-20 去平台化**：艺术家行只留「歌手 · 音源 · 音质」三段） | `android/app/src/main`、`plugins/player/playList.ts`、RNTP `TrackMetadata.java:92-98` | `check_source_platform_label` **L5 反向锁**（禁 `resolvePlayPlatform(source`，要求 `buildSourceLabel('',`）；真机待验 | ✅ / 🧪 |
| 底部播放栏 D3 品牌胶囊（整条悬浮卡片 + 圆角 28 绿圈 / 三实体宽按钮不透明品牌色 / 歌名行下中置 3dp 进度条 / 歌名与音质 4dp 间距） | `components/player/PlayerBar/**`、`components/player/Progress.tsx`、`components/PlayQualityTag.tsx` | `tsc`/`eslint` 0 error；b178→b187 逐版真机视觉验收 | 🧪 |
| 播放页音源标签（实际平台优先/子源名/试听标签） | `sourceLabel.ts`、`PlayInfo.tsx`、`playList.ts` | `check_source_platform_label` 9/9 | ✅ |
| 播放失败原因（错误码中文化/友好摘要/attempts 账本/降级所有权/取链预算） | `utils.ts`、`online.ts`、`playbackBudget.ts` | `check_playback_budget` 21/0、`check_playback_ownership_runtime` 21/0 | ✅ |
| 桥接媒体传输（base64 信封/256KB 分片） | `service.ts`、media envelope | `check_media_body` | ✅ |
| 日志目录与隐私（公共优先/私有回迁/无 URL 歌名歌手） | `utils/log.ts` | `check_log_directory` 15/0 | ✅ |
| 官方上游版本显示 + 更新提醒 + 一键更新顺序 | `apiSource.ts`、`Source.tsx` | 结构走查 | ✅ |
| 听歌统计口径（playCount） | `player/playCount.ts` | 结构走查 | ✅ |
| 内置音源自动升级（构建时统一拉取） | 构建脚本 | `check_release_state_contract`、`check_source_ci_gate` | ✅ |
| 三语国际化（1040 键/失败标点/占位符/原生文案） | `src/lang/*.json` | `check_docs_consistency`、`check_ts_syntax` | ✅ |
| 工程门禁（eslint/tsc/docs-audit/L4 巡检） | `scripts/check_*.js` **50 个**（`npm run preflight` 一键跑完 CI 同判据；`check_source_ci_gate` / `check_source_ci_gate_offline` 两个 API/离线专用脚本由 preflight 跳过并做等价校验。2026-11-21 补齐：`check_health_diagnostics_deep` / `_stress` 已进 `release.yml`；`check_source_ci_gate_offline` 与 `check_upstream_divergence` 按性质保留本地，前者因 CI 有 token、后者自述非阻塞） | preflight 实跑 **47/47 rc0** / 新门禁自带负向自检 | ✅ |

**状态说明**：✅ 有脚本断言且已审；📝 静态走查/待真机；车机版相关项已移出本计划。

---

## 4. 跨仓契约与联动审计面（本轮核心）

> 前几轮联动审计散落在 M 组、T 组、Q 组，本版集中。**字段名对得上 ≠ 语义对得上，字段、枚举、默认值、单位四样都要对。**

| ID | 联动点 | 现状 | 性质 |
|---|---|---|---|
| X-L1 | **第 14 个 action `forceQualityProbe`** | **已闭合并定性为「保留」**：App `SOURCE_ACTIONS` 14 个、`check_source_contract` 14 对齐；源侧 `forceQualityProbe()` 实现完整、`quality-policy-v2` 直接覆盖。App 无 UI 调用方——这是**源能力声明而非死桥接**（删除会造成跨仓契约漂移，且 K07 探路旁路是未来单源复测入口的能力基础，成本为负）。健康页已有 `probe`（全局探测）/`probeSource`（单源复测）覆盖用户可见的复测需求，不再为此新增强制高质入口 | 已闭合（2026-11-16 复核） |
| X-L2 | **能力备档压制起跑档无 App 可见解释** | 音源 `getQualityCeiling` 压制起跑档，App 请求 flac 得 128k，UI 无「因源能力备档跳过」提示 | 体验缺口。**2026-11-19 评估**：修复需新增播放页/音质选择处文案，会新增 i18n 键（三语 1040 键硬数字随之变动并触发多文档连锁），且无真机可验视觉效果 → 暂不动，等产品定文案与位置 | 待产品决策 |
| ~~X-L3~~ **定性为「功能未建」** | 原记「`definitiveFail`/`linkExpired` App 不消费，`Health.tsx` 类型未含」 | **2026-11-19 复核**：类型已含 —— `src/core/healthStatus.ts:105-106` 声明 `definitiveFail`/`linkExpired` 并纳入 `hasSample` 判定（`:139`），`Health.tsx:59-60` 亦在 `byQuality` 类型中声明；但**整个 `byQuality` 质量矩阵从未渲染**（全文件仅类型定义，无 UI）。故不是「类型未含」的数据缺口，而是「质量矩阵 UI 未建」的产品功能缺口 → 不按缺陷修，待产品决策 | 定性完成，不做改动 |
| X-L4 | `qualityConfidence` 三值 | 音源 `exact/estimated/unknown`；App 消费 `default='exact'` 仅旧源兼容 | 已对齐，继续守 |
| X-L5 | 13 action ↔ 音源声明 | 除 `forceQualityProbe` 外 13 个已对齐 | `check_source_contract` 14/0 |
| X-L6 | 音质档位命名 | `SOURCE_QUALITIES` ↔ 音源 `QUALITY_PRIORITY` | 4 档固定 |
| X-L7 | **健康快照版本兼容（源仓 v8.16.1）** | 源侧 `compareSourceVersion` 改数值比较、白名单 `[8.14.1,8.15.1,8.16.0,8.16.1]`；App 侧 `parseSourceVersion`/`sanitizeSourceHealthState` 必须同口径 | `check_cross_repo_health_roundtrip` X1~X3 4/0（回退任一仓即红） |
| X-L9 | **超时定时器不空转**（原称「不泄漏」，2026-11-16 按实测收敛） | `Promise.race` 的超时必须 `clearTimeout` 且延时用具名常量（App N-1168 统一到 `src/core/music/timeout.ts`）。**实测反证**：race 对两路都挂了 `then`，后到的 reject 被吞，**不产生 unhandledRejection**；真实代价是定时器空转占句柄（Node 3s 档 3002ms vs 清理后 24ms）+ 超时副作用对已完成任务再跑一次 | `check_truth_gates` **G27**（542 源文件全扫；注入旧写法实测转红） |
| X-L8 | **计划唯一性** | 每仓只许一份审计计划 + 一份压测计划，归档合并为一份 | `check_truth_gates` **G21**（`AUDIT_PLAN*.md`/`STRESS_PLAN*.md` 各恰 1） |
| X-L10 | **真机摘要契约（App ↔ lx-telemetry）** | App 产出 `lx-health-digest/1`（24h、probe/play/chain 分列、计数≤2000、不含歌名/URL/账号）；telemetry `schema/digest.schema.json` 同结构校验、`additionalProperties:false`、48KB 上限、`device.id+generated_at` 去重 | `check_health_digest` 12/0（含 A9 单飞；2026-11-21 新增 A10~A12 覆盖 `by_quality` / `source.version` / `recent_events.q`）；telemetry `node --test` 9/9；**2026-11-19 起该脚本已接入 CI（此前从未接线，故「改任一侧字段即红」在此日期之前并不成立）** |

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
npm run preflight          # 47 条：tsc + eslint + release.yml checks 段 + 跨仓往返（≈155s）
npm run preflight:all      # 再追加源仓 build-source/self-check/docs-audit/verify:bundle/npm test（条数以实跑输出为准）
```

> `preflight` 直接解析 `.github/workflows/release.yml` 的 `lint:`/`checks:` 段取命令，不手抄清单——手抄必然漂移（b142 那轮就是清单少写 1 个脚本，云端才红）。双仓改动必用 `preflight:all`。

### 6b. 全量脚本台账（50 个 `check_*.js`）

> 本节管**条数**（每条脚本声明多少条断言）；**断言身份**见下方 **6c**（34 个脚本 / 502 条，ID 多重集）。

| 脚本 | 条数 | 守什么 |
|---|---:|---|
| `check_ts_syntax` | 542 文件 | TS/TSX 语法 0 错误 |
| `check_health_diagnostics` | 60 | 健康诊断契约（窗口/归因/证据/脱敏） |
| `check_health_diagnostics_deep` | 51 | 逐分支断言 + 10 万条压力 |
| `check_health_diagnostics_view` | 25 | 视图模型（折叠/分组/格式化） |
| `check_health_diagnostics_stress` | 14 | 1 万事件 / 5MB 截尾 / 200 错误码 |
| `check_log_directory` | 15 | 公共优先/回迁/四类补齐/压力 |
| `check_health_status_refactor` | 14 | 状态优先级与 `offReason`；288 结构 × 2 极性全枚举 |
| `check_health_state_v2` | 7 | 4 主状态 + reason |
| `check_health_ui_mapping` | 12 | 文案/颜色/质量矩阵/趋势数据链 |
| `check_health_event_pipeline` | 10 | eventId 去重 / traceId / 只写本机 |
| `check_health_digest` | 12 | 真机摘要：24h 窗口 / probe 不计播放 / 上限截断 / 20h / 队列 / Issue 格式 / 无凭据 / 三语键 / 单飞锁；**已接入 CI（2026-11-19）** |
| `check_health_persistence_v2` | 9 | v1 拒绝 / 容量与版本边界 |
| `check_health_anomaly_v2` | 8 | 异常分级 / 覆盖不足不宣称 |
| `check_health_real_playback` | 11 | 真播放计数 / 多源失败证据 / 重复 Playing 不膨胀样本（R11） |
| `check_source_health_persistence` | 17 | v2 导出恢复 / 五平台并发 |
| `check_source_config_contract` | 29 | 39 键 / 单位 / 三语 |
| `check_source_contract` | 14 | 14 action / envelope / fallbackOwner |
| `check_source_update_logic` | 44 | 更新逻辑 / 无指纹机制 |
| `check_list_overwrite_rollback` | 4 | 歌单全量覆盖：正常路径基线 / saveListMusics 失败回滚 / saveUserList 失败回滚 / 回滚自身失败时内存仍恢复 |
| `check_flipper_stub` | 4 | release 空桩：import 全限定名 / 桩目录与 package 对齐 / 旧位置无重复类 / flipper 仅 debug 引入 |
| `check_playback_cache_guard` | 8 | **v9.1 新增**：URL 缓存三处命中点（`online.ts:70`、`utils.ts:419`、`utils.ts:209`）必须过 `isPlayableCandidate`；判不过要 `deleteMusicUrl` 清缓存；取链结果也过 `classifyUnusableUrl`；**G7 断言 `PlaybackError` 必须清当前歌曲缓存**（否则「命中死链→失败→缓存还在」无限循环）；含负向自检 |
| `check_log_redaction` | 4 | **v9.1 新增**：禁止裸打错误对象（`console.log(err)` 直出会泄漏带签名 URL）；历史位置冻结在 `scripts/log_redaction_baseline.json`（45 处 / 26 文件），新增即红；含负向自检 |
| `check_source_platform_label` | 9 | 实际平台优先 / 试听标签 |
| `check_quality_request_runtime` | 12 | 请求档双裁剪 / 片段缓存回读 |
| `check_playback_budget` | 21 | 24s 预算 / attempts |
| `check_playback_ownership_runtime` | 21 | 所有权交接 |
| `check_playback_timeout_race` | 1 | 25s 超时后晚到成功不补账；**已接入 CI（2026-11-19）**，同时修复两处脚本自身问题：`require` 无 typescript 回退（依赖路径变化即崩）、未模拟 `./playbackGuard`（`online.ts` 新增该 import 后脚本直接抛「未模拟依赖」） |
| `check_player_core_runtime` | 15 | 播放队列/清理 |
| `check_player_service_runtime` | 10 | 服务运行时 |
| `check_player_hook_runtime` | 7 | hooks 订阅清理 |
| `check_player_utils_runtime` | 7 | 热点工具 |
| `check_player_progress_runtime` | 4 | 进度/除零 |
| `check_media_body` | 6 | 媒体信封 / 能力协商 |
| `check_sync_client_runtime` | 4 | 同步客户端 |
| `check_pitch` | 30 | 音频 DSP：音高/变速（静态接线 + 数值边界） |
| `check_volume_fade` | 40 | 音频 DSP：切歌淡入淡出 / 睡眠渐弱（两层） |
| `check_equalizer` | 51 | 音频 DSP：均衡器（原生模块契约 + JS 接线 + 档位纯函数） |
| `check_upstream_divergence` | 工具（非用例集） | 上游基座分档/留痕校验；需 `/tmp/upstream-lx`，缺失时打印克隆指引并跳过 |
| `check_assertion_ledger` | 工具（非用例集） | 台账声明 vs 实测断言数的逐脚本比对；差异即失败（防「断言被删而门禁仍显示 47/47」） |
| `check_download_persistence` / `_restore_runtime` / `_error_i18n` | 3 / 3 / 7 | 下载持久化/恢复/错误标点 |
| `check_file_name_template_runtime` | 11 | 文件名 token 模板 |
| `check_release_state_contract` | 5 | versionCode / README 同步 |
| `check_docs_consistency` | 17 文档 | 文档真值/死引用 |
| `check_cross_repo_linkage` | 9（C9 只需 App 文件，其余 8 条需双仓；CI 已注入 `LX_SOURCE_ROOT`，9 条全跑） | 双仓静态联动（22s vs 23s）+ 档位短路强制探路的 App 入口 |
| `check_cross_repo_health_roundtrip` | 4 | X1~X3 健康态往返（需双仓） |
| `check_truth_gates` | 14 条断言（G 编号不连续） | 含 **G21 计划唯一** / **G22 compileSdk↔AGP** / **G23 SDK 三件套** / **G27 race 超时清理** |
| `check_source_ci_gate` / `_offline` | 网络 / 离线 | 源仓 CI 闸门（CI 用自带 token） |

### 6c. 断言 ID 台账（44 个脚本 / 662 条，ID 多重集）

> 6b 只比「条数」，抓不到**数量不变但某条断言被换掉**（把 HS3 换成 HS9、把 D5 改名 D5x）。
> 本节要的是身份：每个脚本输出的 `✓ ID` / `✅ [ID]` 必须与下表**逐个 ID、逐个次数**相同。
>
> 口径是**多重集**：同一个 ID 可以挂多条子断言（`H7×6`、`H6×7`、`I05×11` 表示该 ID 被印了这么多次），
> 只比「ID 出现过」抓不到少一条子断言，所以连**次数**一起钉住。
>
> 收录「ID 出现总次数 == 6b 声明数」且**输出稳定**的脚本（44 个 / 662 条）。尚未覆盖的脚本有断言不印 ID，
> 只受 6b 条数约束。
>
> **唯一不入 6c 的两项**（都是计数型，不是断言身份）：`check_ts_syntax`（数文件数 542）、
> `check_docs_consistency`（数文档数 17）。它们只受 6b 条数约束。
>
> 此前一度把 `check_download_restore_runtime` / `check_media_body` / `check_player_progress_runtime` /
> `check_source_contract` / `check_source_health_persistence` 当成「环境依赖型」排除在外。复查发现那是
> **误判**：它们的 ID 本来就是中缀形态（`N2-D1` / `P2-A1` / `N3-P1` / `P0-A1` / `A7b`），当时用的
> 诊断正则认不出，才显得「形态不稳定」。识别规则修正后 5 个脚本全部纳管，连跑多轮稳定。
>
> 编号跳号（`U21`、`S6`）是历史事实，已按现状钉住。
>
> 维护：改了脚本的断言行就重跑 `node scripts/check_assertion_ledger.js --gen-ids --write`，它会**直接写回本节**
> 的表体与标题数字（内容一致则不动文件；基线有漂移/失败/缺脚本时**拒绝写入**，避免把残缺表落盘），
> 写完 `git diff docs/AUDIT_PLAN.md` 复核即可。不带 `--write` 时只打印，不碰文件。
> 跨仓脚本需带 `LX_SOURCE_ROOT=<源仓路径> LX_REQUIRE_SOURCE=1` 才能跑全（否则少 7 条）。

| 脚本 | 断言数 | ID 清单（复用标 ×N） |
|---|---|---|
| `check_health_diagnostics` | 60 | E1 E2 E3 E3b E4 H3 H4×3 H5×5 H6×7 H7×6 H7b H8×6 H8b H9 H10×2 H11 H12 H13 H14 H15 H16 H17 H18 H19 H20 H21 H22 H23 H24 H25 H26 H27 H28 H29 H30 M1 M2 |
| `check_health_diagnostics_deep` | 51 | D1×2 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15 D16 D17 D18 D19 D20 D21 D22 D23 D24 D25 D26 D27 E1 E2 E3 E4 E5 E6 E7 E8 E9 F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 G1 G2 G3 |
| `check_health_diagnostics_view` | 25 | V1 V2 V3 V4 V5 V6 V7 V8 V9 V10 V11 V12 V13 V14 V15 V16 V17 V18 V19 V20 V21 V22 V23 V24 V25 |
| `check_health_diagnostics_stress` | 14 | U1×2 U2 U3 U4 U5 U6 U7×2 U8 U9 U10 U11 U12 |
| `check_log_directory` | 15 | L1 L2 L3 L4 L5 L6 L7 L8 L9 L10 L11 L12 L13 L14 L15 |
| `check_health_status_refactor` | 14 | HS1 HS2 HS3 HS4 HS5 HS6 HS7 HS8 HS9 HS10 HS11 HS12 HS13 HS14 |
| `check_health_state_v2` | 7 | S1 S2 S3 S4 S5 S7 S8 |
| `check_health_ui_mapping` | 12 | U1 U2 U3 U4 U5 U6 U7 U8 U9 U10 U11 U12 |
| `check_health_event_pipeline` | 10 | E1 E2 E3 E4 E5 E6 E7 E8 E9 E10 |
| `check_health_digest` | 12 | A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 |
| `check_health_persistence_v2` | 9 | Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9 |
| `check_health_anomaly_v2` | 8 | A1 A2 A3 A4 A5 A6 A7 A8 |
| `check_health_real_playback` | 11 | R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 |
| `check_source_health_persistence` | 17 | A7×2 A7b A8 A9×3 A9b A10 A11 A12 A13 B1 B2 B3 B4 G5-A1 |
| `check_source_config_contract` | 29 | SC01 SC02 SC03 SC04 SC05 SC06 SC07 SC08 SC09 SC10 SC11 SC12 SC13 SC14 SC15 SC16 SC17 SC18 SC19 SC20 SC21 SC22 SC23 SC24 SC25 SC26 SC27 SC28 SC29 |
| `check_source_contract` | 14 | P0-A1 P0-A2 P0-A3 P0-A4×4 P0-A5 P0-A6 P0-A7 P1-A1 P1-A2 P1-A3 P1-A4 |
| `check_source_update_logic` | 44 | U1 U2 U3 U4 U5 U6 U7 U8 U9 U10 U11 U12 U13 U14 U15 U16 U17 U18 U19 U20 U22 U23 U24 U25 U26 U27 U28 U29 U30 U31 U32 U33 U34 U35 U36 U37 U38 U39 U40 U41 U42 U43 U44 U45 |
| `check_list_overwrite_rollback` | 4 | A1 A2 A3 A4 |
| `check_flipper_stub` | 4 | F1 F2 F3 F4 |
| `check_playback_cache_guard` | 8 | G1 G2 G3 G4 G4b G5 G6 G7 |
| `check_log_redaction` | 4 | G1 G2 G3 G4 |
| `check_source_platform_label` | 9 | L1×2 L2×2 L3 L4×3 L5 |
| `check_quality_request_runtime` | 12 | P0-1 P0-10 P0-2 P0-3 P0-4 P0-5 P0-6 P0-7 P0-8 P0-9 P1×2 |
| `check_playback_budget` | 21 | P1B-A1 P1B-A2×2 P1B-A3 P1B-A4 P1B-A5×3 P1B-A6 P1C-A1 P1C-A1b P1C-A2 P1C-A3 P1D-A1 P1D-A2 P1D-A3 P1D-A4 P1E-A1 P1E-A2 P1E-A3 P1E-A4 |
| `check_playback_ownership_runtime` | 21 | P1F-A1 P1F-A2 P1F-A3 P1F-A4 P1F-A6 P1U-E1 P1U-E2 P1U-E3 P1U-E4 P1U-L1 P1U-Q1 P1U-Q2 P1U-Q3 P1U-Y1 P1U-Y2 P1U-Y3 P1U-Y4 P1U-Y5 P1U-Y6 P1U-Y7 P1U-Y8 |
| `check_playback_timeout_race` | 1 | T1 |
| `check_player_core_runtime` | 15 | N2×15 |
| `check_player_service_runtime` | 10 | N2×10 |
| `check_player_hook_runtime` | 7 | N2×7 |
| `check_player_utils_runtime` | 7 | N2×7 |
| `check_player_progress_runtime` | 4 | N3-P1 N3-P2 N3-P3 N3-P4 |
| `check_media_body` | 6 | P2-A1 P2-A2 P2-A3 P2-A4 P2-A5 P2-A6 |
| `check_sync_client_runtime` | 4 | N2×4 |
| `check_pitch` | 30 | PT01 PT02 PT03 PT04 PT05 PT06 PT07 PT08 PT09 PT10 PT11 PT12 PT13 PT14 PT15 PT16 PT17 PT18 PT19 PT20 PT21 PT22 PT23 PT24 PT25 PT26 PT27 PT28 PT29 PT30 |
| `check_volume_fade` | 40 | VF01 VF02 VF03 VF04 VF05 VF06 VF07 VF08 VF09 VF10 VF11 VF12 VF13 VF14 VF15 VF16 VF17 VF18 VF19 VF20 VF21 VF22 VF23 VF24 VF25 VF26 VF27 VF28 VF29 VF30 VF31 VF32 VF33 VF34 VF35 VF36 VF37 VF38 VF39 VF40 |
| `check_equalizer` | 51 | EQ01 EQ02 EQ03 EQ04 EQ05 EQ06 EQ07 EQ08 EQ09 EQ10 EQ11 EQ12 EQ13 EQ14 EQ15 EQ16 EQ17 EQ18 EQ19 EQ20 EQ21 EQ22 EQ23 EQ24 EQ25 EQ26 EQ27 EQ28 EQ29 EQ30 EQ31 EQ32 EQ33 EQ34 EQ35 EQ36 EQ37 EQ38 EQ39 EQ40 EQ41 EQ42 EQ43 EQ44 EQ45 EQ46 EQ47 EQ48 EQ49 EQ50 EQ51 |
| `check_download_persistence` | 3 | D1 D2 D3 |
| `check_download_restore_runtime` | 3 | N2-D1 N2-D2 N2-D3 |
| `check_download_error_i18n` | 7 | I07-1 I07-2 I07-3 I07-4 I07-5 I07-6 I07-7 |
| `check_file_name_template_runtime` | 11 | I05-1 I05-10 I05-11 I05-2 I05-3 I05-4 I05-5 I05-6 I05-7 I05-8 I05-9 |
| `check_release_state_contract` | 5 | R-01-S1 R-01-S2 R-01-W1 R-01-W2 R-01-W3 |
| `check_cross_repo_linkage` | 9 | C1 C2 C3 C4 C5 C6 C7 C8 C9 |
| `check_cross_repo_health_roundtrip` | 4 | X1 X1b X2 X3 |
| `check_truth_gates` | 14 | G6 G7×2 G8 G10×2 G11 G12 G18 G20 G21 G22 G23 G27 |

## 7. 缺口清单（当前未覆盖）

| ID | 缺口 | 验证方法 | 验收 |
|---|---|---|---|
| S1~S5 | 设备级：首装/升级、权限流、横竖屏、批量下载、长文件名 | 真机 | 标 🧪，待实机 |
| X-L1~L3 | 音质政策 App 消费面（见 §4） | App 侧跟进 | 见 §4 处置 |
| 真机音质矩阵 | 10 首矩阵、A/B 延迟 | 真机 | blocked |
| ~~健康诊断·①~~ **已闭环** | 原记「同歌多次 Playing 每次成功回传会抬高样本数」 | `recordPlayResult` 只在 `getMusicUrl` 三处（缓存命中/取链成功/取链失败）写；`playerPlaying` 只走 `recordPlaybackStart`，而 `consumePendingPlayback` 一次性置空 | **2026-11-19 实测闭环**：新增 R11 —— 同歌 3 次 Playing 只产生 1 条 `play_result` + 1 条 `playback_start`，`playWindows`/`playbackWindows` 均不放大；真实重播才记第 2 条。变异 M5（不清空 pending）/M6（去掉 null 守卫）均被 R7+R11 抓住 |
| ~~健康诊断·②~~ **已闭环** | 原记「`probeSource` 只读语义」未确认 | `src/core/init/userApi/index.ts:294-295` 已明确「默认只读（apply=false）」，`apply: options?.apply === true` | 全仓无 `probeSource(` 调用方 → 无副作用面；将来 `apply:true` 只能由调用方显式传入，语义已锁在注释与实现里 |
| 健康诊断·③ **实现已闭环，缺护栏** | 原记「自动关闭 TTL 6h 重启复验」 | 源侧 `src/core/17-health-check.js:463-464` 冷启动豁免自动关闭（`!isColdStart` 才 autoOff）、`:447-451` 探测成功即自动恢复并清 `autoOff/autoOffReason/autoOffAt` | 重启复验语义已实现；「TTL 6h」在两侧代码中均未落地，且恢复依赖探测成功而非时间，**不必要**。缺口转为测试：`test/audit/e-extra.js` O 段只断言冷启动预热上限，未断言「冷启动豁免自动关闭」 |
| 健康诊断·④ **仍 blocked** | 真机桥透传 `err.detail[0].source` 能否穿过 RN 桥 | 真机 | 无 adb / 无设备，保持 blocked；失败归因已有 `errAny?.sourceId ?? errAny?.detail?.[0]?.source` 双路兜底（`src/core/music/online.ts`），桥层实测缺位 |
| ~~G-A01~~ **已核销** | 原记「错误码文案缺 4 键、界面显示英文常量」 | **2026-11-15 复核不成立**：`src/core/music/utils.ts` 已重构为 `FAIL_CODE_I18N_KEY`，源侧 16 个码全覆盖（含 `TRUNCATED_MEDIA`/`BAD_ENVELOPE`/`CONTRACT_ERROR`/`CANCELED`）；4 个 `player_error_*` key 在 `src/lang/{zh-cn,zh-tw,en-us}.json` 979~982 行均有三语翻译；表注释已改为「共 16 个（v8.13）」 | 已修复，无需处理 |
| ~~G-A02~~ **已核销** | 原记「4 主状态映射 144 种组合仅 10 条断言覆盖」 | **2026-11-19 已补齐**：`check_health_status_refactor.js` 由 10 条扩到 **14 条**（HS11~HS14），判定面由 144 组合扩到 **288 结构 × 2 极性 = 576 次判定**（补入 `resolveDead` 维度），含「与显式优先级表逐条对照 / 关闭信号不被降级 / 12 reason 可达性 / 纯函数」四类不变式；4 个变异体（优先级错位、删 DEGRADED 分支、QUALITY_OPEN 判成可用、复活旧 `sleeping` 推断）全部被抓住，实跑 14/0 | 已补齐，无需再处理 |
| ~~G-A03~~ **不成立** | 原记「下载器 922 行无 `check_download*` 专项」 | **2026-11-15 复核不成立**：已有 `check_download_error_i18n.js` / `check_download_persistence.js` / `check_download_restore_runtime.js` | 已覆盖；仅队列压力未做（E19） |
| ~~G-A04~~ **不成立** | 原记「诊断错误码分组只认 12 个码」 | **2026-11-15 复核不成立**：`src/core/healthDiagnostics.ts` 无任何码白名单，统计一律动态取 `String(e.code)`（232 / 401 / 410 / 445 行），未知码落 `UNKNOWN`，新错误码判定也基于动态 `Set` | 已覆盖，任意码可用 |
| G-A05 | 无 jest / testing-library，纯函数无系统单测 | `package.json` | 仍成立（全仓 node 脚本形态） |
| ~~G-A06~~ **不成立** | 原记 `Health.tsx` 有 4 处硬编码中文 | **2026-11-15 复核不成立**：`src/screens/Home/Views/Setting/settings/Health.tsx` 的字符串字面量中文全部出现在 `//` 注释行（42/66/69/197），无 JSX 文本中文、无模板字符串中文 | 已覆盖，界面文案全走 i18n |
| ~~G-A07~~ **已建档+已消除 14 处** | 原记「`as any` / `@ts-ignore` 未量化建档（实测 22 处）」 | **2026-11-19 两轮完成**：口径修正为实际 37 处（22 次 `as any` 里 5 处是注释 → 17 处代码；21 次 `@ts-ignore` 里 1 处被再注释 → 20 处）；逐条建档见附录 B；**已把 14 处 `as any` 换成精确类型 → 剩 3 处**（`Backup/actions.ts` ×2 依赖上游 `any[]` 签名、`userApi:93` 畸形数据兜底，均判定不动）+ 20 处 `@ts-ignore` = **23 处**；`tsc --noEmit` 0 error、3 个变异全被抓红 | 剩余 23 处均已在附录 B 标注归类与不动理由 |
| G-A08 | 真机验收 blocked | 无 `adb` / 无 `/dev/kvm` / `ANDROID_HOME` 未设 | blocked |
| G-A09 | tx 完整曲目 blocked（上游约 60 秒试听，只能判 `PREVIEW_FRAGMENT`） | 上游限制 | blocked |

> G-A01~G-A09 来源：原 `AUDIT_PLAN_v1.9.2-b118.md`（b118 期全覆盖草稿）§2「实锤缺口总表」。**2026-11-15 已逐条对当前代码复核，无「待复核」项**：G-A01/G-A03/G-A04/G-A06 四条**不成立**（b118 之后已修或本就误判），G-A02/G-A05/G-A07 **仍成立**（待补项），G-A08/G-A09 为**环境 blocked**。即 b118 草稿的高危缺口已全部消失，剩余仅是待补测试与真机限制。

---

## 8. 失败处置与外部阻塞

1. `check_source_ci_gate` 曾在本机恒 403（记为「需要有效凭据/额度」）。**K16 定案**：额度实际充足（认证配额 5000 / used 20），真因是请求走**未认证** `api.github.com`，吃按出口 IP 的 60 次/小时。已修：脚本在无 `GITHUB_TOKEN` 时自动从 `~/.config/gh/hosts.yml` 读 `oauth_token` 兜底，本机直跑即通过；CI runner 仍用自带 `GITHUB_TOKEN`。
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
| `src/lang/*.json` | `health_copy_report` / `health_copy_done` 以及 17 个 `health_diag_*` 三语；诊断 finding 32 键 + reason 12 键 | `check_docs_consistency` 17 篇、三语各 1040 键 |
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
node scripts/check_ts_syntax.js                   # 542 文件 0 错误
node scripts/check_source_config_contract.js      # 29/0
node scripts/check_source_platform_label.js       # 9/9
node node_modules/typescript/bin/tsc --noEmit     # rc=0
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx  # rc=0
node scripts/check_docs_consistency.js            # 17 文档
node scripts/docs-audit.js --dry-run              # 待处理 0
```

退出标准：上述命令全部 rc=0；健康契约 60/0；深度审计 51/0；诊断压力 14/0；视图 25/0；日志目录 15/0；配置契约 29/0；音源契约 14/0；无新增隐私字段、无新增网络出口、无未解释的文档计数漂移。

## 附录 B：类型逃逸建档（G-A07，2026-11-19）

> 触发：`§7` 原记「`as any` / `@ts-ignore` 未量化建档（当前实测 22 处）」。
> 复核发现 22 这个数把**注释里的示例代码**也算进去了：实际代码是 17 处 `as any` + 20 处 `@ts-ignore`。
> 已分两轮把 14 处 `as any` 换成精确类型，剩余 **3 处 `as any` + 20 处 `@ts-ignore` = 23 处**。

### B.1 口径与统计

| 项 | grep 出现 | 注释中的示例 | 实际代码 | 本轮消除 | 剩余 |
|---|---:|---:|---:|---:|---:|
| `as any` | 22 | 5 | 17 | 14 | **3** |
| `@ts-ignore` / `@ts-expect-error` | 21 | 1 | 20 | 0 | **20** |
| 合计 | 43 | 6 | 37 | 14 | **23** |

> 注释示例位置：`core/init/common.ts:16,20`、`core/init/deeplink/playerAction.ts:31`、`core/music/index.ts:47`、`core/player/player.ts:161`（`as any`）；`store/setting/action.ts:8`（`@ts-expect-error`，整行被注释）。

### B.2 分类定义与处置原则

| 类 | 含义 | 处置原则 |
|---|---|---|
| **A 外部契约** | 全局对象注入、第三方库未声明的字段（RNFS 下载回调 / RN `Platform.constants`）、Node 与 RN 的 timer 差异 | 必须 cast。根治要补 `global.d.ts` 统一声明出口（当前没有，属结构债，单独立项） |
| **B 动态索引** | 用运行时字符串索引对象（`obj[key]`）、动态 i18n key、旧备份结构 | 必须 cast。可逐步替换为 `Record<string, T>` 或在调用侧用 `keyof` 约束 |
| **C 历史值** | 已被类型删除的旧枚举值（`flac32bit`）仍需比较/迁移 | 必须 cast 或用 `String()` 比较；随脏数据淘汰可整段删 |
| **D 可消除** | 类型本可表达，只是没写（懒） | 应消除：换精确类型或直接访问，`tsc` 即为验收 |

### B.3 逐条清单（剩余 33 处）

**`as any`（3 处，均已判定为「不动」）**

| # | 位置 | 用途 | 类 | 不动的理由 |
|---|---|---|---|---|
| 1 | `screens/Home/Views/Setting/settings/Backup/actions.ts:27` | `list.list as any[]`（旧备份结构升级） | B | 上游函数签名 `importOldListData(lists: any[])` 本身就是 `any[]`；单改调用点只会把 `any` 挪到 `.map` 参数（实测触发 TS7006）。真要收口需先重定义旧备份契约，单独立项 |
| 2 | `screens/Home/Views/Setting/settings/Backup/actions.ts:32` | 同上（覆盖写回路径） | B | 同上 |
| 3 | `utils/nativeModules/userApi.ts:93` | `event.data = {} as any`（畸形数据兜底） | C | 此处语义就是「JSON 解析失败、按空对象继续」，`data` 的声明类型来自 `Actions` 映射，任何精确类型都与运行时畸形值不符 → 刻意保留 |

**`@ts-ignore` / `@ts-expect-error`（20 处）**

| # | 位置 | 抑制的代码 | 类 |
|---|---|---|---|
| 1 | `components/common/Icon.tsx:48` | `style={newStyle}`（Image/View 样式类型差异） | D |
| 2 | `config/globalData.ts:10` | `process.versions = { app: versionLabel }`（扩展全局） | A |
| 3 | `config/setting.ts:38` | `originSettingCopy[key] = targetValue`（动态 key） | B |
| 4 | `config/setting.ts:52` | 同上（恢复默认值路径） | B |
| 5 | `core/apiSource.ts:39` | `global.lx.qualityList = ...`（扩展 lx 全局） | A |
| 6 | `core/music/utils.ts:118` | `if (lyricInfo.rawlrcInfo) return lyricInfo`（判断未声明字段） | D |
| 7 | `lang/index.ts:41` | `const messages: Messages = {}`（空对象初始化） | D |
| 8 | `plugins/player/hook.ts:102` | `pollTrackPlayerStates.includes(playerState)`（收窄） | D |
| 9 | `screens/Home/Views/Setting/settings/Basic/Source.tsx:103` | `t(\`setting_basic_source_${s.id}\`)`（动态 i18n key） | B |
| 10 | `screens/Home/Views/SongList/components/Songlist/List.tsx:138` | `source: ''`（空串不满足 `Source` 联合） | D |
| 11 | `store/player/action.ts:39` | `state.musicInfo[key] = val`（动态 key） | B |
| 12 | `utils/index.ts:138` | `_qualitys?.flac32bit` 旧值判断 | C |
| 13 | `utils/index.ts:140` | `_qualitys.flac24bit = _qualitys.flac32bit` | C |
| 14 | `utils/index.ts:142` | `delete _qualitys.flac32bit` | C |
| 15 | `utils/index.ts:146` | `quality.type == 'flac32bit'` | C |
| 16 | `utils/tools.ts:29` | `Platform.constants.Release`（RN 内部字段） | A |
| 17 | `utils/tools.ts:475` | 样式属性名数组字面量 `'fontSize'` | D |
| 18 | `utils/tools.ts:477` | 同上 `'lineHeight'` | D |
| 19 | `utils/tools.ts:528` | `newStyle[p] = setSpText(v)`（动态 key） | B |
| 20 | `utils/tools.ts:541` | `StyleSheet.create(newStyle as StyleSheet.NamedStyles<T>)` | D |

**分类计数**：A 3（`globalData.ts:10`、`apiSource.ts:39`、`tools.ts:29`）· B 7（`setting.ts` ×2、`Basic/Source.tsx:103`、`player/action.ts:39`、`tools.ts:528`、`Backup/actions.ts:27,32`）· C 5（`utils/index.ts:138/140/142/146` + `userApi.ts:93`）· D 8（`Icon.tsx:48`、`music/utils.ts:118`、`lang/index.ts:41`、`player/hook.ts:102`、`List.tsx:138`、`tools.ts:475/477/541`）= **23**。

### B.4 已消除（11 组 14 处，`tsc --noEmit` 为验收）

| 位置 | 原写法 | 改后 | 为什么可消 |
|---|---|---|---|
| `core/downloadManager.ts:227` | `(musicInfo.meta as any)?.picUrl` | `musicInfo.meta?.picUrl` | `picUrl` 已在 `MusicInfoMetaBase` 声明（`string \| null`），cast 纯属多余 |
| `screens/PlayDetail/Vertical/.../PlayInfo.tsx:38` | `(playMusicInfo?.musicInfo as any)?.source` | `as LX.Music.MusicInfo \| undefined` | `PlayMusic = MusicInfo \| Download.ListItem`，只有前者有 `source`；精确到联合成员后字段名仍受校验 |
| `screens/PlayDetail/Horizontal/.../PlayInfo.tsx:40` | 同上 | 同上 | 同上 |
| `utils/index.ts:55` | `(meta.qualitys as any[])` | `as LX.Music.MusicQualityType[] \| undefined` + `String(quality.type)` 比较 | 原 `any[]` 的真实原因不是「懒」，而是要比较**已从类型删除**的 `flac32bit`（直接 `===` 会 TS2367）；`String()` 比较既保留元素类型校验又能覆盖旧值 |

| `screens/Home/Views/Setting/settings/Health.tsx:84,90`（2 处） | `(global as any).lx?.apis` | `global.lx?.apis` | `global.lx` 已由 `app.d.ts` 的 `declare global { var lx: GlobalData }` 声明，`(global as any)` 是纯多余的 |
| `plugins/player/service.ts:62` | `(global.lx.apis as any)?.[platform]?.reportPlayback` | `apis[platform as LX.Source] as (UserApiSourceInfo & { reportPlayback?: ReportPlaybackFn })` | `UserApiSourceInfo` 只声明 `actions` 白名单、方法挂在运行时对象上；交叉 cast 表达该事实，`platform` 索引与字段名仍受校验 |
| `core/init/index.ts:65,66`（2 处） | `(globalThis as any).__lxSourceConfig` | `globalThis.__lxSourceConfig` | 在 `app.d.ts` 补 `var __lxSourceConfig: Record<string, unknown> \| undefined` |
| `core/sourceHealthPersistence.ts:319,341`（2 处） | `delete (health as any).controls` | `delete (health as Partial<typeof health>).controls` | `controls` 是必需属性，TS 禁止 delete 必需成员；`Partial` 精确表达「删除可选化」 |
| `core/music/playbackBudget.ts:80`（2 处） | `(timer as any).unref` | `timer as unknown as { unref?: () => void }` | RN timer 是 number、Node 返回带 `unref` 的对象；只声明用到的那一个可选方法 |
| `core/downloadManager.ts:299,300`（2 处） | `(res as any).totalBytesWritten` / `totalBytesExpectedToWrite` | `res as typeof res & { totalBytesWritten?: number, totalBytesExpectedToWrite?: number }` | 原生侧字段 RNFS 类型未声明；`typeof res &` 交叉保留原有字段校验 |

**变异验证（证明精确类型仍在受校验）**：

| 变异 | 期望 | 实得 |
|---|---|---|
| M1 `meta?.picUrl` → `meta?.picUrlTypo` | TS2339 | **2 处报错** |
| M2 `legacyRes.totalBytesWritten` → `totalBytesWrote` | TS2339 | **1 处报错** |
| M3 `String(quality.type) === 'flac32bit'` 改回 `===` | TS2367 | **1 处报错** |
| 还原 | 0 error | **0 error** |

### B.5 复核命令

```bash
# `as any`：排除「整行被注释」的示例代码
grep -rn "as any" src/ --include=*.ts --include=*.tsx | grep -vc "^[^:]*:[0-9]*: *//"
# `@ts-ignore`：它本身就是注释指令，不能按「以 // 开头」过滤（会全被排除），
# 只能排除「被再注释一层」的（形如 `//     // @ts-expect-error`）
grep -rn "@ts-ignore\|@ts-expect-error" src/ --include=*.ts --include=*.tsx | grep -vc "^[^:]*:[0-9]*: *// *//"
# 类型闸门
npx tsc --noEmit
```

> 实测这两个命令当前分别输出 **3** 与 **20**（合计 23），与 B.1 表一致。

---

## 维护记录（只记基线变更，不堆历史）

| 日期 | 变更 | 实跑证据 |
|---|---|---|
| 2026-11-20 | 基线推进到 **v1.9.2-b187 / `dadef6a1`**（已推送），源仓 **v9.1.4 / `297c88e`**，RNTP 锁到 **`45c384d`**（短打断分级 + 通用性补修，断言 67 条）；头部算式改为 `1221 − 542 − 17 = 662` | `check_ts_syntax` **542/0**；`check_docs_consistency` **17 篇**；`check_assertion_ledger` **46 一致 / 0 漂移 / 0 失败 / 0 未解析 / 0 缺脚本**（台账 1221 = 实测 1221）；`--gen-ids` 仍 **44 脚本 / 662 条 ID 全覆盖** |
| 2026-11-20 | §3b 三处更新：音源健康「趋势」→ **趋势数据链**（趋势弹窗下线，数据仍进诊断包与 `trend_decline` 判定）；通知栏定制 📝→✅（**去平台化**：艺术家行只留「歌手 · 音源 · 音质」）；新增 **底部播放栏 D3 品牌胶囊**维度 | `check_health_ui_mapping` **12/12**（U12 已改写为数据链断言）；`check_source_platform_label` **9/9**（L5 反向锁） |
| 2026-11-20 | §6 执行清单条数校正：`preflight` **36 → 47 条**（≈155s）；`preflight:all` 不再写死条数（源仓并入后随实跑变） | 本次 CI run `44713838456` 四 job 全 success；本地 ledger 46 脚本全跑通 |
| 2026-11-19 | 断言合计口径重算 → **662 条**（6b 台账逐行实算；历史 734/597 均已失效：734 系 B2 删两脚本前口径、597 为旧台账） | 抽验 `check_health_status_refactor`=14、`check_health_real_playback`=11 与台账逐行一致；preflight **47/47** |
| 2026-11-19 | 新增 `scripts/check_assertion_ledger.js`：把 6b 台账逐行 spawn 实跑，比对「声明 vs 实测断言数」，差异即失败。全量 **45 一致 / 0 漂移 / 0 未解析 / 1 环境跳过**（台账 1220 / 实测 1213）；快速档 **43 一致**。上线即抓出 G7 两处 `49` 未随脚本数更新（已修） |
| 2026-11-19 | 台账校验接入：preflight 走 `LX_LEDGER_QUICK=1`（191s，原 155s）、CI Checks 跑全量，与 Android 并行不影响总时长 |
| 2026-11-19 | 新增 **6c 断言 ID 台账**（18 个脚本 / 190 条）：校验器在条数一致后继续比对 `✓ ID` 集合，抓「条数不变但断言被换掉」。变异验证：HS12→HS12x → `⛔ ID 漂移：少 HS12 / 多 HS12x`。只收录 ID 数 == 6b 声明数的脚本，其余脚本部分断言无 ID，仅受条数约束 |
| 2026-11-19 | 6c 升级为 **ID 多重集**：18 脚本 / 190 条 → **35 脚本 / 397 条**。复用 ID（`H7×5`、`I05×11`、`N2×3`）按**次数**钉住，少一条子断言也报。变异：G10 第二分支改 G10x → 条数仍 14，报「少 G10×1（应 2 实 1）/ 多 G10x」 |
| 2026-11-19 | `check_health_diagnostics` 的两处静默 `passed++`（模块加载检查）显式化成 **M1/M2** 断言：自报 60 条、实际只看得见 58 条的错位消除。该脚本随之纳入 6c，覆盖升到 **36 脚本 / 457 条**。变异：H5 改名 H5x → 条数仍 60，报「少 H5×1（应 5 实 4）/ 多 H5x」 |
| 2026-11-19 | **CI 跨仓断言从未真跑**：checks job clone 了源仓到 `_source` 并写着「用 `LX_REQUIRE_SOURCE=1` 禁止跳过」，但从未 export 这组变量 → 两个跨仓脚本一直走 SKIP。差 7 条 = 健康态往返 4 + 联动 3。修复后 6c 覆盖升到 **37 脚本 / 465 条**（linkage 8 条补 C1~C8 ID） |
| 2026-11-19 | 6c 扩充到 **37 脚本 / 595 条**：(a) `RE_ID` 支持中缀形态（`P1B-A1` / `P1F-A1` / `R-01-W1`），3 个**本就有 ID** 的脚本直接纳管、无需改脚本；(b) `check_source_config_contract` 的 `✓` 行加 `SC01~SC29`、(c) `check_volume_fade` 此前**通过时不逐条打印**，加 `VF01~VF40` 后才可纳管。`--gen-ids` 同时补「未列入告警」，避免再像上次那样静默漏脚本。变异 VF→VE / SC→SD 条数不变、报 `少 VF01…/少 SC01…` 双向验证通过 |
| 2026-11-19 | 6c 补齐到 **44 脚本 / 662 条**——**所有非计数型断言全部有了身份**（`1220 − 541 − 17 = 662` 自洽）。两个坑：(a) `RE_ID` 把 `P0-10` 截成 `P0`（模式里 `-\d` 只能做中缀不能做末段）；(b) `readIdLedger` 读不回自己写出的中缀 ID（生成/解析不对称）。改成**同一个 `ID_PATTERN` 常量**两处共用后消失。另修 `--gen-ids` 的循环依赖：原先只收 `state==='ok'`，6c 旧登记导致的 `id-drift` 脚本永远补不进来 |
| 2026-11-19 | 6c 表可自动维护：`--gen-ids --write` 直接写回 6c 段（只动表体 + 两处数字，幂等，基线未全绿/`--only`/`--quick` 一律拒绝写）。实测破坏 6c 标题与一行后跑 `--write`，与完好版 diff 为空 |
| 2026-11-18 | 基线 **v1.9.2-b154 / vc313**（源仓 v9.0.0）；新增 sourceUpdate 四件套 + 三脚本台账；断言合计 597 条；文档 16 篇 | `preflight --fast` 39/0（34.2s）；22 个压力脚本 rc=0；`tsc`/`eslint` 0 error；三语各 1021 键 |
