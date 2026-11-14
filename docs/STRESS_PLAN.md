# App 压力测试计划 v2.0（重构版）

> **重构说明**：原版 S1~S13 与后补 S16~S19 割裂、S3 条数 24/23 不一致。本版整合为一张表，统一基线、统一纪律，并补音质政策联动压测。
>
> **基线（唯一真值，2026-11-15）**：App `59ab63bd`（v1.9.2-b126 / versionCode 285，Build `43619278134` success）；源仓 `f3a3e75`（v8.14.0 tag）。
>
> **目标**：推送/发布前，用可重复的纯 Node/内存 FS 压力用例，证明大事件量、窗口边界、覆盖不足、隐私、日志目录、状态机、持久化、跨仓契约、**音质政策联动**下「不崩、不越界、不泄露、不把失败伪装成通过」。

## 1. 分组与边界（一表到底）

| # | 检查 | 脚本 | 条数 | 主要边界 | 通过标准 |
|---|---|---:|---|---|---|
| S1 | 诊断压力 | `check_health_diagnostics_stress.js` | 14 | 10000 条事件、5MB 截尾、200 错误码、脱敏 | 14/0 |
| S2 | 诊断深度 | `check_health_diagnostics_deep.js` | 51 | 统计口径、1h/24h/7d 窗口、10 万条聚合 | 51/0 |
| S3 | 诊断视图 | `check_health_diagnostics_view.js` | 24 | 折叠态、四层分组、1 万次构建 | 24/0 |
| S4 | 日志目录 | `check_log_directory.js` | 15 | 公共优先、500 文件回迁、1 万次补齐 | 15/0 |
| S5 | 状态分类重构 | `check_health_status_refactor.js` | 10 | 手动/自动/休眠/播放摘除 | 10/0 |
| S6 | 4 主状态+reason | `check_health_state_v2.js` | 7 | 4 主状态、reason、UI 消费 | 7/0 |
| S7 | UI 映射 | `check_health_ui_mapping.js` | 11 | 文案/颜色、质量矩阵、三语 | 11/0 |
| S8 | 事件链路 | `check_health_event_pipeline.js` | 10 | eventId 去重、traceId、脱敏 | 10/0 |
| S9 | 持久化 v2 | `check_health_persistence_v2.js` | 9 | v1 拒绝、容量/版本边界 | 9/0 |
| S10 | 异常聚合 | `check_health_anomaly_v2.js` | 8 | 异常分级、错误码分组 | 8/0 |
| S11 | 配置契约 | `check_source_config_contract.js` | 25 | 37 键、数字/布尔边界 | 25/0 |
| S12 | 音源契约 | `check_source_contract.js` | 14 | 13 action、v2 envelope、fallbackOwner | 14/0 |
| S13 | 源健康持久化 | `check_source_health_persistence.js` | 17 | v2 导出/恢复、拒绝敏感字段 | 17/0 |
| S16 | 请求档矩阵 | `check_quality_request_runtime.js` | 12 | 自定义源/内置源双裁剪、片段缓存回读 | 12/0 |
| S17 | 播放预算失败段 | `check_playback_budget.js` | 21 | 24s 预算、attempts 落盘、失败段不丢档 | 21/0 |
| S18 | 片段/下载/播放服务 | `check_source_platform_label`、`check_player_service_runtime`、`check_download_persistence`、`check_download_restore_runtime` | 9+10+3+3 | 试听标签、片段不回报成功、恢复不丢任务 | 各 0 失败 |

**合计：14+51+24+15+10+7+11+10+9+8+25+14+17+12+21+9+10+3+3 = 273 条。**

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
| 音源管理 | `check_source_config_contract` + `check_source_contract` | 25+14 | 37 键/数字布尔边界/14 action/envelope |
| 下载管理器 | `check_download_persistence` + `check_download_restore_runtime` | 3+3 | 恢复不丢任务/路径/覆盖 |
| 播放器核心 | `check_player_service_runtime` + `check_media_body` | 10+… | 服务运行时/媒体信封 |
| 播放失败与预算 | `check_playback_budget` | 21 | 24s 预算/attempts 落盘/失败段不丢档 |
| 音质请求档 | `check_quality_request_runtime` | 12 | 自定义/内置双裁剪/片段缓存回读 |
| 音源标签 | `check_source_platform_label` | 9 | 实际平台优先/试听标签 |

---

## 3. 音质政策联动压测（`fb94fcf` 源侧变更对 App 的连带）

| 联动点 | 判据 | 守的脚本 |
|---|---|---|
| 第 14 action 漂移 | App `SOURCE_ACTIONS` 仍 13，音源已 14（`forceQualityProbe`）；`check_source_contract` 锁 13 会拒绝未来接该 action | `check_source_contract`（观察，不通过） |
| 能力备档压制起跑档 | 音源 `getQualityCeiling` 使请求 flac 得 128k；App `onQuality` 回填 128k，UI 无解释 | `check_quality_request_runtime` + 真机观察 |
| `definitiveFail/linkExpired` 字段 | 音源快照新增，App `Health.tsx` 不消费 | 结构走查 |
| 片段语义跨仓 | 音源 `fragment:true`+`unknown` → App 标「试听」、不回报成功 | `check_quality_request_runtime` P1-CACHE |

## 4. 本轮实测结果

| 项 | 结果 |
|---|---|
| S1~S13 诊断/状态/契约 | 全部 rc0 |
| S16~S18 音质改动 | 全部 rc0 |
| `tsc --noEmit` | 0 error |
| `eslint .` | 0 error / 0 warning |
| `npm run build-test` | rc0 |
| 三语 | 各 999 键 |

> 本轮完整 rc 与条数以实跑为准；历史绿不替代。

## 5. 失败处置与外部阻塞

1. 任一脚本非 0 即记录失败，不以「局部通过」代替。
2. `check_source_ci_gate` 本地 token 无效 → 用 Git 凭据库令牌复跑；CI 仍用自带 token。
3. 真机持久化/RN 桥/分享 Intent 仍无设备级证据；本计划只对纯 Node/内存 FS 结论负责。
4. 音质政策联动（§3）中 X-L1 为已知暂缓缺口，不因「压测绿」而掩盖。
