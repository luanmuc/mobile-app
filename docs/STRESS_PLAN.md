# App 压力测试计划 v2.0（重构版）

> **重构说明**：原版 S1~S13 与后补 S16~S19 割裂、S3 条数 24/23 不一致。本版整合为一张表，统一基线、统一纪律，并补音质政策联动压测。
>
> **基线（唯一真值，2026-11-23）**：App **v1.9.2-b207**（`8adc5d46`，已推送）；源仓 **v9.3.3**（`ae13b6d`，已推送，产物 **400561 bytes / 7725 行**，错误码 **19** 个）；RNTP **`669d2ab`**（v2 分支；焦点 **67** 条 + 代次簿记 **24** 条为本轮未重跑的历史口径）；telemetry `main`（HEAD `d706359`，代码基线 `5cdfe31`，其余为每日数据提交；公开仓，`ingest` **9/9**）。
>
> **R81 新增压测面（2026-11-23）**：真机引擎 invariant 面 —— 产物可执行代码（去注释）`Date.parse` 与 `new Proxy` 均须为 0、必须含纯算术 `parseYmdToMs`；`parseYmdToMs` 对闰年（2024-02-29）/跨纪元（1969-12-31，负毫秒）/非法输入（2026-13-01、2026-11-32）与 `Date.parse` 逐例等价。守卫脚本 `test/audit/r81-proxy-compat.js`（源仓，6 条），已并入源仓 `npm test`；App 侧以 `MUSIC_SOURCE_GUIDE` v9.3.1 与构建闸门（`SRC_VER` == `豆包定制 vX`）覆盖。

> **R83 新增压测面（2026-11-23）**：①**复核窗口滚动**——`r83-governance` R5 时间注入：`2026-12-08`（旧 14 天集体过期日的次日）必须 `ok:true`，`2027-01-02` 必须报「已超复核窗口 30 天」；R1/R2 断言所有带 `reviewAt` 的项都声明 7~365 整数窗口。②**引擎能力自检**——E2 用「读 `Date["parse"]` 即抛 `proxy: inconsistent get`」的宿主模拟，`probeEngineCapabilities` 必须捕获且不冒泡（真机 wrapper 升级引入新 invariant 的第一道观测）。③**更新完整性**——`check_builtin_sdk_contract` A7 把 `sha256.ts` 编译后与 Node crypto 逐例对照（空串 / `abc` / 中文 / emoji / 孤立代理项 / 10k 长串）；A8 静态锁「先校验后覆盖」与 manifest 缺失 fail-open。④**六平台矩阵**——M1~M6 用真实接口形状样本跑 `handleResult`/`filterData`，缺 `source`/`songmid` 即红（mg 注入缺 `source` 实测 13/1）。⑤**基线回填**：源仓 v9.3.3（产物 **400561 bytes / 7725 行**，错误码仍 **19**；manifest 已由 CI `sign-release` 重签）。
> **R82 新增压测面（2026-11-23）**：①**au 内置 SDK 契约执行级**——`scripts/check_au_source_contract.js` A1~A6 用 `vm.runInNewContext` 抽真实 `filterData` 跑样本（执行级，不是文本猜测），必须 6/0；红向 `AU_CHECK_ROOT=<旧三文件根>` 必须 0/6；A6 专锁「两条 au 结果去重后仍为 2 条」——塌一即整页只显示一首（R82 P0 原症状）。②**多镜像并发取版本最高**——`Source.tsx` 必须 `Promise.all(SOURCE_UPDATE_URLS)` 收集全部合法脚本后用 `compareSourceVersions` 取最高，禁「顺序 for + 首个成功即 break」：jsdelivr `@master` 的旧缓存会把 4 个镜像里最高版本骗成旧版本，误判「已是最新」；最坏耗时应为「并发 15s 窗口」，而非「4×15s 顺序超时」。③**基线回填**：源仓 v9.3.2（产物 **397273 bytes / 7654 行**，R82 仅订正 `35-source-switch` 注释归因 K41/K42 + 登记 K43 治理提醒，**无行为变更**，故错误码仍 **19** 个；manifest 待 CI `sign-release` 重签）。
>
> **R71~R74b 新增压测面（本轮并入）**：①**全仓裸 console 归零**（60 处 / 36 文件 → `logger`，`no-console` 覆盖 `src/**/*.ts(x)`，S24）；②**`logger` 写盘 IO 成本**（`logger.info/error` 对 `tag==='PlaySource'` 强制写盘、每处 4~6 次 RNFS 调用，切源常规路径已把两条降 `debug`，S25）；③**错误码由 18 增至 19**（`UNSUPPORTED_ACTION`，音源未知源 action 归一，S12/S20 须同步）。
>
> **目标**：推送/发布前，用可重复的纯 Node/内存 FS 压力用例，证明大事件量、窗口边界、覆盖不足、隐私、日志目录、状态机、持久化、跨仓契约、**音质政策联动**下「不崩、不越界、不泄露、不把失败伪装成通过」。

## 1. 分组与边界（一表到底）

| # | 检查 | 脚本 | 条数 | 主要边界 | 通过标准 |
|---|---|---:|---|---|---|
| S1 | 诊断压力 | `check_health_diagnostics_stress.js` | 14 | 10000 条事件、5MB 截尾、200 错误码、脱敏 | 14/0 |
| S2 | 诊断深度 | `check_health_diagnostics_deep.js` | 51 | 统计口径、1h/24h/7d 窗口、10 万条聚合 | 51/0 |
| S3 | 诊断视图 | `check_health_diagnostics_view.js` | 25 | 折叠态、四层分组、1 万次构建 | 25/0 |
| S4 | 日志目录 | `check_log_directory.js` | 15 | 公共优先、500 文件回迁、1 万次补齐 | 15/0 |
| S5 | 状态分类重构 | `check_health_status_refactor.js` | 19 | 手动/自动/休眠/播放摘除、288 结构全枚举、**业务否定分流（HS15~HS19，R71d 起）** | 19/0 |
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
| S20 | 口径门禁（含计划唯一/SDK/超时清理） | `check_truth_gates.js` | 14 | 版本/脚本数/依赖 sha/**G21**/**G22**/**G23**/**G27** | 14 断言（**12 个 G 编号**，编号不连续）全一致 |
| S21 | 真机摘要上报 | `check_health_digest.js` | 12 | 5000 事件/24h 窗口、probe 不计播放、失败明细 200 截断、20h 节流、队列 7 条 7 天、Issue 围栏格式、无硬编码凭据、三语键、**单飞锁**、**报告体字段白名单（D1~D3）** | 12/0 |
| S22 | telemetry 入库契约（跨仓） | `lx-telemetry/test/ingest.test.js` | 9 | 合法入库/重复去重/围栏 JSON/非法计数字段拒收/48KB 上限/分桶与时间窗 | 9/0 |
| S24 | **全仓裸 console 归零（R74）** | `check_log_redaction` + `eslint . --ext .js,.jsx,.ts,.tsx`（`no-console` 覆盖 `src/**/*.ts(x)`） | 4 | 唯一合法出口为 `logger.ts:48` 的 `console.warn`（带 `eslint-disable-next-line`）；其余 `src` 下 `console.*` 一律 0；`scripts/` 与 `src` 同一 lint 面，本地只跑 `eslint src` 会漏 | 4/0 + eslint 全仓 rc0 |
| S25 | **`logger` 写盘 IO 成本（R74b）** | `check_log_redaction` 的 G3 + 人工代码走查 | —（走查项，不产断言） | `tag==='PlaySource'` 时 `info/error` 走 `force=true` 绕过 `enableDebugLog`，每次 4~6 次 RNFS 调用；**切源常规路径的 `try toggle to` 必须是 `debug` 不是 `info`** | 走查结论：`music/utils.ts` 两处已为 `debug`；G3（`logger.ts:48` 唯一 `console.warn`）由 S24 的 `check_log_redaction` 4/0 覆盖 |
| S26 | **状态分类 12 reason 全枚举（E14 / R75）** | `check_health_state_enum.js` | 22 | 12 个 reason 逐个可达 + 优先级链（USER_OFF > PLAY_DEAD > 无样本 > rateLimit > open/half-open）+ 4 主状态 tone/key + 288 组合 | 22/0 |
| S27 | **错误码文案全覆盖（E15 / R75）** | `check_error_code_map.js`（跨仓） | 10 | 源仓 19 码 ↔ App `FAIL_CODE_I18N_KEY` ↔ 三语；`UNSUPPORTED_ACTION` 必须有独立文案；历史别名同键；unknown 兜底 | 10/0 |
| S28 | **持久化往返压力（E22 / R75）** | `check_persistence_roundtrip.js` | 8 | 1/5/20 轮 save→restore 等价、指纹缓存不重复写、controls 不混入健康 key、v1/v3 拒收、TTL 6天/8天、超容量 | 8/0 |
| ~~S23~~ | **在线更新链路压力（已下线）** | 三脚本已随「V9.3 在线更新体系整体下线」删除：`check_source_signing.js` / `check_source_update_fetch.js` / `check_source_update_apply.js` 均不存在 | — | 验签（未知 keyId/假签名/篡改）、传输链（404/size/sha256/开关关闭）、落地（就地覆盖/零写入/回滚四态）全部不再适用；「更新音源」回归单文件拉取 + 多镜像兜底 | 不再执行（保留行以免口径断档） |

**合计：S1~S22 + S24 + S26~S28 有效项 14+51+25+15+19+7+12+10+9+8+29+14+17+12+21+9+10+3+3+4+14+12+9+4+22+10+8 = 371 条（其中纯压测口径 371−14=357 条，S20 为口径门禁不重复计入压测，S22 在 telemetry 仓；S23 已下线、S25 为走查项，均不计入合计）。**

## 1b. 待补套件（历史归档：承接原 `STRESS_PLAN_v1.9.2-b118.md`，2026-11-15 删除前承接）

原 b118 草稿按「8 层 22 套」扩展，其中大部分与上表重合（E1~E4/E9~E13 即 S 系列，E17 已由 S17 覆盖）。**仍未覆盖**的是下面这些：

| ID | 套件 | 层 | 目标条数 | 现状 | 主要边界 |
|---|---|---|---:|---|---|
| E14 | 状态全枚举穷举 `check_health_state_enum.js` | L2 映射 | 22 | **已落地 22/0（R75，见 S26）** | 4 主状态 × reason × 手动/自动 × 播放态全组合（对应 G-A02） |
| E15 | 错误码 **19** 全映射 `check_error_code_map.js` | L6 契约 | 10 | **已落地 10/0（R75，见 S27）**；并补 `player_error_unsupported` 三语文案 | **19** 个 `ERROR_CODES`（含 R71d 新增 `UNSUPPORTED_ACTION`）全部有中文文案（与 G-A01 同源） |
| E16 | 三语 × 状态 × tone 渲染矩阵 `check_i18n_matrix.js` | L2 映射 | 12 | 待建 | 1048 键 × 三语 × tone 组合渲染 |
| E18 | 播放所有权运行时 `check_playback_ownership_runtime.js` | L7 运行时 | 21 | **已落地 21/0**（原「未纳入矩阵」已收回） | `fallbackOwner` 所有权交接 |
| E19 | 下载器队列压力 `check_download_queue.js` | L7 运行时 | 12 | 待建 | 并发队列、暂停/恢复、失败重排（对应 G-A03） |
| E20 | 类型与语法全量 | L8 长稳 | 5 | **已被 `preflight` 覆盖**（`tsc --noEmit` + `eslint . --ext .js,.jsx,.ts,.tsx` + `check_ts_syntax`），不再单列 | 三道全绿即达；S24 额外要求 eslint 全仓而非只 `src` |
| E21 | 30 分钟长稳 | L8 长稳 | 6 | 待建 | 30 分钟事件/播放循环内存与句柄不增长 |
| E22 | 持久化往返压力 `check_persistence_roundtrip.js` | L5 文件 | 8 | **已落地 8/0（R75，见 S28）** | 存→读→再存 多轮，v1/v2 迁移不乱 |

## 2. 执行顺序

```bash
# 第一梯队：诊断/状态/契约压力（S1~S13）
node scripts/check_health_diagnostics_stress.js
node scripts/check_health_diagnostics_deep.js
node scripts/check_health_diagnostics_view.js
node scripts/check_log_directory.js
node scripts/check_health_status_refactor.js
node scripts/check_health_state_enum.js
node scripts/check_health_state_v2.js
node scripts/check_health_ui_mapping.js
node scripts/check_health_event_pipeline.js
node scripts/check_health_persistence_v2.js
node scripts/check_health_anomaly_v2.js
node scripts/check_source_config_contract.js
node scripts/check_source_contract.js
node scripts/check_source_health_persistence.js
node scripts/check_health_digest.js
node scripts/check_error_code_map.js
node scripts/check_persistence_roundtrip.js
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
| 音源健康·诊断 | `check_health_diagnostics_stress` + `check_health_diagnostics_deep` + `check_health_diagnostics_view` | **14+51+25=90** | 1 万事件/5MB 截尾/200 错误码/10 万聚合/1 万构建 |
| 音源健康·状态/UI/事件/持久化 | `check_health_status_refactor` + `check_health_state_v2` + `check_health_ui_mapping` + `check_health_event_pipeline` + `check_health_persistence_v2` + `check_health_anomaly_v2` + `check_source_health_persistence` | **19+7+12+10+9+8+17=92** | 状态机/去重/v1 拒绝/容量版本边界/业务否定分流 |
| 音源管理 | `check_source_config_contract` + `check_source_contract` | **29+14=43** | 39 键/数字布尔边界/14 action/envelope |
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

## 4. 实测结果（2026-11-22 · v1.9.2-b199 / `b3ce7440`）

> 本轮口径：用 `check_assertion_ledger` 一次调度跑完 **46 个脚本**（等价于 S1~S22 全量实跑），结果 **46 一致 / 0 漂移 / 0 失败 / 0 未解析 / 0 缺脚本 / 0 环境跳过**，台账 **1230 = 实测 1230**；下表与之逐项对齐。
>
> **源仓路径自动探测（R75）**：`check_cross_repo_linkage` / `check_cross_repo_health_roundtrip` 在未设 `LX_SOURCE_ROOT` 时，按 `../lx-music-source` → `../backend-api` 顺序探测（首个含 `src/legacy.js` 的胜出）。此前默认只认 `../lx-music-source`，本地直接跑 ledger 会报「`check_cross_repo_linkage` 少 C6 / 少 C7 / 少 C8」、实测 1223 ≠ 1230，把环境缺失记成回归。修后**不带环境变量**也 **1230 = 1230**、46 一致；CI 仍走 `LX_SOURCE_ROOT` + `LX_REQUIRE_SOURCE=1`，行为不变。

| 项 | 结果 |
|---|---|
| `npm run preflight`（审计全量，CI 同判据） | **48 通过 / 0 失败 · 124.0s**，`RC=0` |
| S1 诊断压力 | 14/0 |
| S2 诊断深度 | 51/0 |
| S3 诊断视图 | 25/0 |
| S4 日志目录 | 15/0 |
| S5 状态分类重构 | **19/0**（R71d 新增 HS15~HS19） |
| S6 4 主状态+reason | 7/0 |
| S7 UI 映射 | 12/0 |
| S8 事件链路 | 10/0 |
| S9 持久化 v2 | 9/0 |
| S10 异常聚合 | 8/0 |
| S11 配置契约 | 29/0（39 键 + 数字/布尔边界） |
| S12 音源契约 | 14/0（14 action + envelope + fallbackOwner） |
| S13 源健康持久化 | 17/0 |
| S16 请求档矩阵 | 12/0 |
| S17 播放预算 | 21/0 |
| S18 片段/标签/播放服务/下载（分项） | 9/0、10/0、3/0、3/0 |
| S19 跨仓健康态往返 | 4/0（需 `LX_SOURCE_ROOT`） |
| S20 口径门禁 | 全部一致（**14 断言 / 12 个 G 编号**） |
| S21 真机摘要上报 | **12/0** |
| S22 telemetry 入库 | **9/9**（`node test/ingest.test.js` → `# pass 9 / # fail 0`） |
| S24 裸 console 归零 | eslint 全仓 **rc0**（`eslint . --ext .js,.jsx,.ts,.tsx`，122.1s） |
| S25 logger IO 成本 | G3 判据通过；`music/utils.ts` 两处 `try toggle to` 已降为 `debug` |
| `tsc --noEmit` | 0 error（36.4s） |
| 三语 | 各 **1048 键** |
| TS/TSX | **543 文件** 语法 0 错误（`check_ts_syntax`） |
| 文档一致性 | **17 篇**（`check_docs_consistency`） |

> 22 个压力脚本全部 rc=0；本轮 0 红。S3「条数 25 / 通过 24」的历史口径差异已消除，实际 25 通过 / 0 失败，以实跑为准。

## 5. 失败处置与外部阻塞

1. 任一脚本非 0 即记录失败，不以「局部通过」代替。
2. `check_source_ci_gate` 本地 token 无效 → 用 Git 凭据库令牌复跑；CI 仍用自带 token。
3. 真机持久化/RN 桥/分享 Intent 仍无设备级证据；本计划只对纯 Node/内存 FS 结论负责。
4. 音质政策联动（§3）中 X-L1 为已知暂缓缺口，不因「压测绿」而掩盖。

---

## 6. 维护记录（只记基线变更，不堆历史）

| 日期 | 变更 | 实跑证据 |
|---|---|---|
| 2026-11-22 | 基线升到 **v1.9.2-b199 / `b3ce7440`**；S5 **14→19**、S21 **9→12**、S22 **5→9**；新增 **S24（全仓裸 console 归零）** 与 **S25（logger 写盘 IO 成本）**；合计 **310→371 条**（纯压测 **296→357**）；E14/E15/E22 三套从「待建」转「已落地」（S26/S27/S28）；§2b 三处分组条数校正（S3 24→25、S5 10→19、S7 11→12、S11 26→29）；E15 错误码 16→19（并补 `player_error_unsupported` 文案）、E16 键数 1030→1045、E20 标记为已被 `preflight` 覆盖 | `preflight` **51/0 · 41.8s**；`ledger` **49 一致 / 1270 = 1270**；S1~S28 逐项 rc0；telemetry `ingest` **9/9**；`tsc` 0 error；`eslint .` 全仓 rc0 |
| 2026-11-20 | 重构为唯一入口（原 S1~S13 与后补 S16~S19 合并），统一基线 b187 / v9.1.4；合计 310 条；补音质政策联动压测（§3） | `preflight` 47/0；22 个压力脚本 rc=0；ledger 46 一致 / 1221 = 1221 |
