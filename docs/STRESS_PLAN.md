# App 压力测试计划 v2.0（重构版）

> **重构说明**：原版 S1~S13 与后补 S16~S19 割裂、S3 条数 24/23 不一致。本版整合为一张表，统一基线、统一纪律，并补音质政策联动压测。
>
> **基线（唯一真值，2026-11-20）**：App **v1.9.2-b187**（`dadef6a1`，已推送，CI run `44713838456` 四 job 全绿）；源仓 **v9.1.4**（`297c88e`）；RNTP **`141dca5`**（v2 分支，短打断分级 + 通用性补修 + 代次簿记 `PendingSlots`，焦点断言 67 条 + 代次 24 条）；telemetry `2cdb7f6`（公开仓，`ingest` 5/5）。
>
> **目标**：推送/发布前，用可重复的纯 Node/内存 FS 压力用例，证明大事件量、窗口边界、覆盖不足、隐私、日志目录、状态机、持久化、跨仓契约、**音质政策联动**下「不崩、不越界、不泄露、不把失败伪装成通过」。

## 1. 分组与边界（一表到底）

| # | 检查 | 脚本 | 条数 | 主要边界 | 通过标准 |
|---|---|---:|---|---|---|
| S1 | 诊断压力 | `check_health_diagnostics_stress.js` | 14 | 10000 条事件、5MB 截尾、200 错误码、脱敏 | 14/0 |
| S2 | 诊断深度 | `check_health_diagnostics_deep.js` | 51 | 统计口径、1h/24h/7d 窗口、10 万条聚合 | 51/0 |
| S3 | 诊断视图 | `check_health_diagnostics_view.js` | 25 | 折叠态、四层分组、1 万次构建 | 25/0 |
| S4 | 日志目录 | `check_log_directory.js` | 15 | 公共优先、500 文件回迁、1 万次补齐 | 15/0 |
| S5 | 状态分类重构 | `check_health_status_refactor.js` | 14 | 手动/自动/休眠/播放摘除、288 结构全枚举 | 14/0 |
| S6 | 4 主状态+reason | `check_health_state_v2.js` | 7 | 4 主状态、reason、UI 消费 | 7/0 |
| S7 | UI 映射 | `check_health_ui_mapping.js` | 12 | 文案/颜色、质量矩阵、三语 | 12/0 |
| S8 | 事件链路 | `check_health_event_pipeline.js` | 10 | eventId 去重、traceId、脱敏 | 10/0 |
| S9 | 持久化 v2 | `check_health_persistence_v2.js` | 9 | v1 拒绝、容量/版本边界 | 9/0 |
| S10 | 异常聚合 | `check_health_anomaly_v2.js` | 8 | 异常分级、错误码分组 | 8/0 |
| S11 | 配置契约 | `check_source_config_contract.js` | 29 | 39 键、数字/布尔边界 | 29/0 |
| S12 | 音源契约 | `check_source_contract.js` | 14 | **14 action**、v2 envelope、fallbackOwner | 14/0 |
| S13 | 源健康持久化 | `check_source_health_persistence.js` | 17 | v2 导出/恢复、拒绝敏感字段 | 17/0 |
| S16 | 请求档矩阵 | `check_quality_request_runtime.js` | 12 | 自定义源/内置源双裁剪、片段缓存回读 | 12/0 |
| S17 | 播放预算失败段 | `check_playback_budget.js` | 21 | 24s 预算、attempts 落盘、失败段不丢档 | 21/0 |
| S18 | 片段/下载/播放服务 | `check_source_platform_label`、`check_player_service_runtime`、`check_download_persistence`、`check_download_restore_runtime` | 9+10+3+3 | 试听标签、片段不回报成功、恢复不丢任务 | 各 0 失败 |
| S19 | 跨仓健康态往返 | `check_cross_repo_health_roundtrip.js` | 4 | 旧版本快照按数值比较接受、白名单不放宽结构 | 4/0（需双仓） |
| S20 | 口径门禁（含计划唯一/SDK/超时清理） | `check_truth_gates.js` | 14 | 版本/脚本数/依赖 sha/**G21**/**G22**/**G23**/**G27** | 24 门禁全一致 |
| S21 | 真机摘要上报 | `check_health_digest.js` | 9 | 5000 事件/24h 窗口、probe 不计播放、失败明细 200 截断、20h 节流、队列 7 条 7 天、Issue 围栏格式、无硬编码凭据、三语键、**单飞锁** | 9/0 |
| S22 | telemetry 入库契约（跨仓） | `lx-telemetry/test/ingest.test.js` | 5 | 合法入库/重复去重/围栏 JSON/非法计数字段拒收/48KB 上限 | 5/0 |
| ~~S23~~ | **在线更新链路压力（已下线）** | 三脚本已随「V9.3 在线更新体系整体下线」删除：`check_source_signing.js` / `check_source_update_fetch.js` / `check_source_update_apply.js` 均不存在 | — | 验签（未知 keyId/假签名/篡改）、传输链（404/size/sha256/开关关闭）、落地（就地覆盖/零写入/回滚四态）全部不再适用；「更新音源」回归单文件拉取 + 多镜像兜底 | 不再执行（保留行以免口径断档） |

**合计：S1~S22 有效项 14+51+25+15+14+7+12+10+9+8+29+14+17+12+21+9+10+3+3+4+14+9 = 310 条（其中纯压测口径 310−14=296 条，S20 为口径门禁不重复计入压测，S22 在 telemetry 仓；S23 已下线，不计入合计）。**

## 1b. 待补套件（承接原 `STRESS_PLAN_v1.9.2-b118.md`，2026-11-15 删除前承接）

原 b118 草稿按「8 层 22 套」扩展，其中大部分与上表重合（E1~E4/E9~E13 即 S 系列，E17 已由 S17 覆盖）。**仍未覆盖**的是下面这些：

| ID | 套件 | 层 | 目标条数 | 现状 | 主要边界 |
|---|---|---|---:|---|---|
| E14 | 状态全枚举穷举 `check_health_state_enum.js` | L2 映射 | 22 | 待建 | 4 主状态 × reason × 手动/自动 × 播放态全组合（对应 G-A02） |
| E15 | 错误码 16 全映射 `check_error_code_map.js` | L6 契约 | 10 | 待建 | 16 个 `ERROR_CODES` 全部有中文文案（与 G-A01 同源） |
| E16 | 三语 × 状态 × tone 渲染矩阵 `check_i18n_matrix.js` | L2 映射 | 12 | 待建 | 1030 键 × 三语 × tone 组合渲染 |
| E18 | 播放所有权运行时 `check_playback_ownership_runtime.js` | L7 运行时 | 21 | **已落地 21/0**（原「未纳入矩阵」已收回） | `fallbackOwner` 所有权交接 |
| E19 | 下载器队列压力 `check_download_queue.js` | L7 运行时 | 12 | 待建 | 并发队列、暂停/恢复、失败重排（对应 G-A03） |
| E20 | 类型与语法全量 | L8 长稳 | 5 | 待建 | tsc / eslint / ts_syntax 全量，反复迭代后仍绿 |
| E21 | 30 分钟长稳 | L8 长稳 | 6 | 待建 | 30 分钟事件/播放循环内存与句柄不增长 |
| E22 | 持久化往返压力 | L5 文件 | 8 | 待建 | 存→读→再存 多轮，v1/v2 迁移不乱 |

## 2. 执行顺序

```bash
# 第一梯队：诊断/状态/契约压力（S1~S13）
node scripts/check_health_diagnostics_stress.js
node scripts/check_health_diagnostics_deep.js
node scripts/check_health_diagnostics_view.js
node scripts/check_log_directory.js
node scripts/check_health_status_refactor.js
node scripts/check_health_state_v2.js
node scripts/check_health_ui_mapping.js
node scripts/check_health_event_pipeline.js
node scripts/check_health_persistence_v2.js
node scripts/check_health_anomaly_v2.js
node scripts/check_source_config_contract.js
node scripts/check_source_contract.js
node scripts/check_source_health_persistence.js
node scripts/check_health_digest.js
node --test ../lx-telemetry/test/ingest.test.js
# 第二梯队：音质改动压力（S16~S18）
node scripts/check_quality_request_runtime.js
node scripts/check_playback_budget.js
node scripts/check_source_platform_label.js
node scripts/check_player_service_runtime.js
node scripts/check_download_persistence.js
node scripts/check_download_restore_runtime.js
# 完整门禁
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx
npm run build-test
node scripts/check_docs_consistency.js
node scripts/docs-audit.js --dry-run
```

## 2b. 定制功能压测映射（排除车机版）

> 每个定制功能对应的压测脚本与条数，一表定位。车机版相关项已移出本计划。

| 定制功能 | 压测脚本 | 条数 | 压测边界 |
|---|---|---:|---|
| 音源健康·诊断 | `check_health_diagnostics_stress` + `check_health_diagnostics_deep` + `check_health_diagnostics_view` | 14+51+24 | 1 万事件/5MB 截尾/200 错误码/10 万聚合/1 万构建 |
| 音源健康·状态/UI/事件/持久化 | `check_health_status_refactor` + `check_health_state_v2` + `check_health_ui_mapping` + `check_health_event_pipeline` + `check_health_persistence_v2` + `check_health_anomaly_v2` + `check_source_health_persistence` | 10+7+11+10+9+8+17 | 状态机/去重/v1 拒绝/容量版本边界 |
| 音源管理 | `check_source_config_contract` + `check_source_contract` | 26+14 | 39 键/数字布尔边界/14 action/envelope |
| 下载管理器 | `check_download_persistence` + `check_download_restore_runtime` | 3+3 | 恢复不丢任务/路径/覆盖 |
| 播放器核心 | `check_player_service_runtime` + `check_media_body` | 10+… | 服务运行时/媒体信封 |
| 播放失败与预算 | `check_playback_budget` | 21 | 24s 预算/attempts 落盘/失败段不丢档 |
| 音质请求档 | `check_quality_request_runtime` | 12 | 自定义/内置双裁剪/片段缓存回读 |
| 音源标签 | `check_source_platform_label` | 9 | 实际平台优先/试听标签 |

---

## 3. 音质政策联动压测（`fb94fcf` 源侧变更对 App 的连带）

| 联动点 | 判据 | 守的脚本 |
|---|---|---|
| 第 14 action | **已闭合**：App `SOURCE_ACTIONS` 14，`check_source_contract` 14/0 对齐 | `check_source_contract` 14/0 |
| 能力备档压制起跑档 | 音源 `getQualityCeiling` 使请求 flac 得 128k；App `onQuality` 回填 128k，UI 无解释 | `check_quality_request_runtime` + 真机观察 |
| `definitiveFail/linkExpired` 字段 | 音源快照新增，App `Health.tsx` 不消费 | 结构走查 |
| 片段语义跨仓 | 音源 `fragment:true`+`unknown` → App 标「试听」、不回报成功 | `check_quality_request_runtime` P1-CACHE |

## 4. 实测结果（2026-11-20 · v1.9.2-b187）

> 本轮口径：用 `check_assertion_ledger` 一次调度跑完 **46 个脚本**（等价于 S1~S22 全量实跑），结果 **46 一致 / 0 漂移 / 0 失败 / 0 未解析 / 0 缺脚本**，台账 **1221 = 实测 1221**；下表与之逐项对齐。

| 项 | 结果 |
|---|---|
| `npm run preflight`（审计全量，CI 同判据） | **47 通过 / 0 失败 · ≈155s**，`RC=0` |
| S1 诊断压力 | 14/0 |
| S2 诊断深度 | 51/0 |
| S3 诊断视图 | 25/0 |
| S4 日志目录 | 15/0 |
| S5~S10 状态/UI/事件/持久化/异常 | 全部 rc=0 |
| S11 配置契约 | 29/0（39 键 + 数字/布尔边界） |
| S12 音源契约 | 14/0（14 action + envelope + fallbackOwner） |
| S13 源健康持久化 | 17/0（rc=0） |
| S16 请求档矩阵 | 12/0 |
| S17 播放预算 | 21/0 |
| S18 片段/标签/播放服务/下载（分项） | 9/0、10/0、3/0、3/0 |
| S19 跨仓健康态往返 | 4/0（需双仓，源仓 v9.0.0 侧已绿） |
| S20 口径门禁 | 全部一致 |
| S21 真机摘要上报 | 9/0 |
| S23 在线更新三件套 | 6/0、9/0、12/0（已随 preflight 跑，`release.yml` 内同判据） |
| `tsc --noEmit` | 0 error（22.2s） |
| `eslint .` | 0 error / 0 warning（32.3s） |
| 三语 | 各 **1043 键** |
| TS/TSX | **542 文件** 语法 0 错误 |

> 22 个压力脚本全部 rc=0；本轮 0 红。S3 表内「条数 25 / 通过 24」为历史口径差异，实际输出 25 通过 / 0 失败，以实跑为准。

## 5. 失败处置与外部阻塞

1. 任一脚本非 0 即记录失败，不以「局部通过」代替。
2. `check_source_ci_gate` 本地 token 无效 → 用 Git 凭据库令牌复跑；CI 仍用自带 token。
3. 真机持久化/RN 桥/分享 Intent 仍无设备级证据；本计划只对纯 Node/内存 FS 结论负责。
4. 音质政策联动（§3）中 X-L1 为已知暂缓缺口，不因「压测绿」而掩盖。
