# App 压力测试计划（2026-11-13 当前口径）

> 目标：在 b116 之前，用可重复的四组压力/深度检查证明「大数据、窗口边界、隐私、日志目录、视图模型」不会崩、不会越界、不会泄露。
> 归属：`health-stress.yml`（每周一 UTC 周日 18:45 / 手动 `workflow_dispatch`）；**不在 `release.yml` 的发版阻塞链**，但本地推送前必须全部跑完。
> 当前基线：App `e41d0d15`（已推送；b116 已发布）；源仓 `7631325`（v8.13.0，已推送）。

## 1. 四组检查

| # | 检查 | 脚本 | 条数 | 主要边界 | 通过标准 |
|---|---|---:|---|---|---|
| S1 | 健康诊断压力 | `scripts/check_health_diagnostics_stress.js` | 14 | 10000 条事件、5MB 日志截尾、脏行、RN 依赖缺失、200 错误码、证据包脱敏、traceId 唯一、采样边界 | 14/0，不崩、不越界、无隐私字段 |
| S2 | 健康诊断深度审计 | `scripts/check_health_diagnostics_deep.js` | 51 | 统计口径、1h/24h/7d 窗口、异常正反例、隐私、多字节、10 万条聚合 | 51/0，数值可复算、窗口不冒充 |
| S3 | 诊断视图模型 | `scripts/check_health_diagnostics_view.js` | 22 | 折叠态、四层分组、覆盖降级、缓存命中、错误码分组、空态、1 万次构建 | 22/0，无空串/undefined/越界 |
| S4 | 日志目录审计 | `scripts/check_log_directory.js` | 15 | 公共优先、私有回迁、四类补齐、父目录重建、500 文件回迁、1 万次补齐、并发、幂等 | 15/0，路径合法、不丢文件 |

**合计：14 + 51 + 22 + 15 = 102 条。**

## 2. 执行顺序

```bash
node scripts/check_health_diagnostics_stress.js   # S1 14/0
node scripts/check_health_diagnostics_deep.js     # S2 51/0
node scripts/check_health_diagnostics_view.js     # S3 22/0
node scripts/check_log_directory.js               # S4 15/0
```

四组全部 `rc=0` 后，再跑发布门禁：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx
node scripts/check_source_contract.js
node scripts/check_source_health_persistence.js
node scripts/check_source_platform_label.js
node scripts/check_source_config_contract.js
node scripts/check_playback_budget.js
node scripts/check_playback_ownership_runtime.js
node scripts/check_media_body.js
node scripts/check_ts_syntax.js
node scripts/check_docs_consistency.js
node scripts/docs-audit.js --dry-run
node scripts/check_source_ci_gate.js           # runner 正式闸门；本地 403 时用离线旁路
node scripts/check_source_ci_gate_offline.js   # 本地补充证据，不替代正式闸门
```

## 3. 纪律

1. **不接受“上次绿过”**：每次推送前在本轮 HEAD 上重跑，记录退出码。
2. **压测不与变异/计时类测试同跑**：CPU 抢占会让计时断言假红。
3. **失败不降级通过**：先定位实现或夹具，修完重跑；不得把 `blocked` 写成通过。
4. **无隐私字段**：证据包、日志尾部、嵌套 `sourceEvents` 不得出现 URL、歌名、歌手、搜索词。
5. **产物级边界**：本轮只有纯 Node/内存 FS 证据；真机持久化、RN 桥、分享 Intent 仍按 `AUDIT_PLAN_HEALTH_DIAGNOSTICS.md` 的未覆盖项处理。
