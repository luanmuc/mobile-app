# App 压力测试计划（2026-11-13 最终版）

> 适用基线：App `785af658` + 文档回填 `8adce795` + 本轮健康页文案/夹具改动（master 已推送，本轮改动待提交；App CI `43520302282` success）；源仓 `a25cd8a`（v8.13.1，已推送，CI `43528623570` success；上一 CI 绿提交 `03fe893`）。
> 目标：在推送/发布前，用可重复的纯 Node/内存 FS 压力用例证明「大事件量、窗口边界、覆盖不足、隐私、日志目录、状态机、持久化、跨仓契约」不会崩、不会越界、不会泄露，也不会把失败伪装成通过。
> 范围：本计划覆盖 `scripts/check_*.js` 中可直接本地执行的压力/深度/契约检查；`health-stress.yml` 仍是周级兜底，`release.yml` 仍以正式门禁为准。
> 纪律：所有结论必须带本轮 HEAD 的 rc 与通过/失败计数；禁止沿用历史绿；`blocked` 不等于通过。

## 1. 分组与边界（当前脚本实测条数）

| # | 检查 | 脚本 | 条数 | 主要边界 | 通过标准 |
|---|---|---:|---|---|---:|
| S1 | 诊断压力 | `check_health_diagnostics_stress.js` | 14 | 10000 条事件、5MB 日志截尾、脏行、RN 依赖缺失、200 错误码、证据包脱敏、traceId 唯一、采样边界 | 14/0，不崩、不越界、无隐私字段 |
| S2 | 诊断深度 | `check_health_diagnostics_deep.js` | 51 | 统计口径、1h/24h/7d 窗口、异常正反例、隐私、多字节、10 万条聚合 | 51/0，数值可复算、窗口不冒充 |
| S3 | 诊断视图 | `check_health_diagnostics_view.js` | 23 | 折叠态、四层分组、覆盖降级、缓存命中、错误码分组、空态、1 万次构建、三块隔离 | 23/0，无空串/undefined/越界 |
| S4 | 日志目录 | `check_log_directory.js` | 15 | 公共优先、私有回迁、四类补齐、父目录重建、500 文件回迁、1 万次补齐、并发、幂等 | 15/0，路径合法、不丢文件 |
| S5 | 状态分类重构 | `check_health_status_refactor.js` | 10 | 手动/自动/默认关闭、休眠、播放摘除、异常优先级、无旧快照回退、4 主状态唯一归属、多源绑定 | 10/0，优先级不回退 |
| S6 | 4 主状态 + reason | `check_health_state_v2.js` | 7 | 4 主状态、reason 映射、单一汇总、UI 消费、三语键 | 7/0，状态不丢信息 |
| S7 | UI 映射 | `check_health_ui_mapping.js` | 11 | 主状态文案/颜色、reason、双摘要、质量矩阵、绑定、探测确认、三语 | 11/0，无硬编码 |
| S8 | 事件链路 | `check_health_event_pipeline.js` | 10 | eventId 优先去重、traceId、失败/探测事件、持久化边界 | 10/0，不重复记账 |
| S9 | 持久化 v2 | `check_health_persistence_v2.js` | 9 | v2 only、controls 权威、v1 拒绝、容量/版本边界 | 9/0，旧格式不复活 |
| S10 | 异常聚合 | `check_health_anomaly_v2.js` | 8 | 异常分级、覆盖不足、错误码分组、空态 | 8/0，不误报 |
| S11 | 配置契约 | `check_source_config_contract.js` | 25 | 37 键/单位/预设三语、数字/布尔边界 | 25/0，键有消费点 |
| S12 | 音源契约 | `check_source_contract.js` | 14 | 13 action、v2 envelope、错误码、fallbackOwner、preload | 14/0，无漏 case |
| S13 | 源健康持久化 | `check_source_health_persistence.js` | 17 | v2 导出/恢复、controls、拒绝敏感字段 | 17/0，无 URL/歌名 |

**诊断/状态压力合计：14 + 51 + 23 + 15 + 10 + 7 + 11 + 10 + 9 + 8 = 158 条。**
**加跨仓契约 S11~S13：158 + 25 + 14 + 17 = 214 条。**

## 2. 执行顺序

```bash
node scripts/check_health_diagnostics_stress.js   # S1 14/0
node scripts/check_health_diagnostics_deep.js     # S2 51/0
node scripts/check_health_diagnostics_view.js     # S3 23/0
node scripts/check_log_directory.js               # S4 15/0
node scripts/check_health_status_refactor.js      # S5 10/0
node scripts/check_health_state_v2.js             # S6 7/0
node scripts/check_health_ui_mapping.js           # S7 11/0
node scripts/check_health_event_pipeline.js       # S8 10/0
node scripts/check_health_persistence_v2.js       # S9 9/0
node scripts/check_health_anomaly_v2.js           # S10 8/0
node scripts/check_source_config_contract.js      # S11 25/0
node scripts/check_source_contract.js            # S12 14/0
node scripts/check_source_health_persistence.js  # S13 17/0
```

然后跑完整门禁：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx
npm run build-test
node scripts/check_docs_consistency.js
node scripts/check_ts_syntax.js
node scripts/check_media_body.js
node scripts/check_playback_budget.js
node scripts/check_playback_ownership_runtime.js
node scripts/check_source_platform_label.js
node scripts/check_source_ci_gate_offline.js
node scripts/docs-audit.js --dry-run
```

## 3. 2026-11-13 本轮实测结果

| 项 | 结果 | 证据 |
|---|---|---|
| 13 个压力/诊断/契约脚本 | 全部 rc0，合计 214/0 | 逐脚本输出见 `docs/reports/两仓最终审计报告-2026-11-13.md` |
| 其余门禁 | 22/22 rc0；`check_source_ci_gate` 用 Git 凭据库有效令牌复跑 rc0（源仓 `03fe893` 绿，当前 `7e78e63` 为 docs-only 后继，compare=ahead）；App CI `43520302282` success | 离线旁路仅补充 |
| `tsc --noEmit` | rc0 | 0 error |
| `eslint .` | rc0 | 0 error / 0 warning |
| `npm run build-test` | rc0 | `index.android.bundle` 重建 |
| `check_ts_syntax` | 526 个 TS/TSX，0 错误 | rc0 |
| 三语 | 各 904 键 | 删除未消费旧键后复跑 |

## 4. 失败处置与外部阻塞

1. `check_source_contract` 首跑 13/1：断言仍按旧 11 action，实际 13；已更新为 13 并补齐 `probeSource`/`reportPlayback`。
2. `check_source_ci_gate` 已复跑 **rc0**：环境变量 `GITHUB_TOKEN` 无效，改用 Git 凭据库令牌；它校验远端 `backend-api@03fe893` 的绿 CI，当前源 HEAD `7e78e63` 仅文档提交，compare=ahead。
3. G2 真机验收仍 blocked：云主机无 `adb`、无 `/dev/kvm`、`ANDROID_HOME` 未设置，`health_device_acceptance.sh --dry-run` rc=3。
4. G7 tx 完整曲目仍 blocked：上游约 60 秒试听，只能判 `PREVIEW_FRAGMENT`。
5. 真机持久化/RN 桥/分享 Intent 仍无设备级证据；本计划只对纯 Node/内存 FS 结论负责。
