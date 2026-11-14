## [I-05 文件名模板结构化 + I-07 失败标点三语 + N2 热点断言 + S-01 源仓 push fail-closed] - 2026-11-14

> 本轮为审计交接单剩余真实问题的代码/文案/测试/CI 收口；I-06（PactModal/About 法律全文翻译）因涉及法律与产品口径，未做机器翻译，等待产品或法务确认。

- **I-05 文件名模板结构化**：新增 `src/utils/fileNameTemplate.ts`，默认 `{title} - {artist}`；旧「歌名/歌手」在打开设置或构建文件名时自动迁移；`hasFileNameToken()` 严格校验原始输入，空模板/无 token 回退默认，避免自定义内容被静默重置。`Download/Settings.tsx` 预设改为 token、显示文案走三语 key，`downloadManager.buildFileName()` 统一走 `formatFileNameTemplate()`。
- **I-05 回归补修**：`formatMusicName()` 仍只替换中文「歌名/歌手」，而默认值已改为 token，导致播放页标题/分享文案原样显示 `{title} - {artist}`；改为复用 `formatFileNameTemplate()`，并补 I05-11 静态断言守住播放页/分享链路。b122 因此作废，最终以 b123 收口。
- **I-07 下载失败标点**：新增三语 `dl_error_status` / `dl_error_status_detail`（英文半角、中文全角）；`failTask()` 与 `Download/index.tsx` 不再用模板字符串拼 `：`/`（）`；`statusText` 走 `dl_status_error`，删除仅存中文的 `FAIL_REASON_TEXT` 兜底。
- **N2 热点行为断言**：新增 `check_file_name_template_runtime.js` 11 条、`check_download_error_i18n.js` 7 条、`check_player_utils_runtime.js` 7 条（未初始化不调原生、临时 trackId、setResource 透传）、`check_sync_client_runtime.js` 4 条（状态广播/未连接 disconnect）；`check_download_restore_runtime.js` 补 `@/utils/fileNameTemplate` stub，恢复 3/0。`release.yml` 新增“热点行为断言”步骤，26 个业务 check 脚本全部阻塞构建。
- **S-01 源仓巡检 push fail-closed**：源仓 `.github/workflows/ci.yml` 的健康表写回由 `git push || { warning }` 改为 `if ! git push ...; then ::error + exit 1; fi`；push 失败不再静默绿，`test/audit/f-repo.js` 增加 Z8 静态断言（53/0）。
- **文案台账**：三语各 997 键，`dl_*` 102 键；本轮新增 5（I-05 3 + I-07 2）。
- **发布**：`v1.9.2-b123` / versionCode 282（tag `b5bd0770`，Build `43566246972`，Android/Release 双绿，5 个 APK；状态回写 `3956d295`）。b122（`e5a49c6d` / 281 / Build `43564774952`）因上述回归作废，不再作为最终版本。
- **验证**：`tsc --noEmit` 0；全仓 ESLint 0 error / 0 warning；26 个 check 脚本全部 rc0（`check_source_ci_gate` 用有效 token 复跑源仓 HEAD `aafeb3c` / CI `43564788961` success）；`check_docs_consistency` 18 文档通过；源仓 `test/audit/f-repo.js` 53/0、`docs-audit` rc0。

## [R-01 发布状态闭环 + 错误/进度/用户可见文案收口] - 2026-11-14

> 最终发布 **v1.9.2-b121 / versionCode 280**（tag `83f80c6d`，Build `43561230482`，5 个 APK）。b120 为同一 App 代码的首次构建，Android 成功但 Release 的 `Commit version info` 因 `publish/changeLog.md` 未入提交、`git rebase` 拒绝 unstaged changes 而失败；修复 workflow 后 b121 的 Android 与 Release 双绿，版本状态已自动回写。

- **R-01 发布状态回写/门禁**：`release.yml` 增加 `target_commitish` 固定 tag 到构建提交（修复 b119 tag 指向 docs 提交 `86018973`）；Release 提交前 `git fetch origin master` + `git rebase --autostash origin/master`，`git add` 纳入 `publish/changeLog.md`；`git push` 去掉 `|| echo`，失败必须 job 红。新增 `check_release_state_contract.js` 5 条断言。
- **N1 错误提示国际化**：删除 `FAIL_CODE_ZH`，改为 `FAIL_CODE_I18N_KEY`（21 源错误码映射 18 个 key，`TIMEOUT`/`TOO_MANY_REQUESTS`/`MISMATCH` 复用别名）；`formatPlayError` 不再拼接源侧 detail，未知码只显示 code。`check_playback_ownership_runtime.js` 扩到 21 条并新增英文界面无中文断言。
- **N3 播放进度分母**：`setProgress` 由 `currentTime` 改为 `totalTime`；`0/0=0`。新增 `check_player_progress_runtime.js` 4 条。
- **I-01 音质名/按钮**：`QualitySelect` 7 个音质 key + 下载取消/开始按钮 key；下载页音质展示同步走 key。
- **I-02 扫描菜单/本地歌单名**：`list_scan_download_dir` 与 `list_local_music` 三语化，本地歌单创建时按当前语言取值。
- **I-03 切源/选目录错误**：源切换失败保留旧源、目录读取失败均走 `t()`，不再暴露英文/中文裸串。
- **I-04 健康页原始错误与听歌统计**：Health 8 处 `String(e.message)` 改为本地化摘要，原始错误只进 `logger.warn`；听歌统计整句与时长格式三语化；`downloadManager` 的 `statusText`（下载中/已完成/获取歌曲信息/非 WiFi 暂停/已暂停/等待中）全部改 `global.i18n.t()`，落盘仍由 `stripStatusText` 剥离。
- **N2 测试覆盖**：新增 `check_download_restore_runtime.js` 3 条（run→waiting、已完成保留、空存储不写），补下载恢复热点。
- **文案台账**：三语各 992 键，`dl_*` 97 键；本轮新增 34（N1 18 + I-01 9 + I-02 2 + I-03 2 + I-04 3）。
- **验证**：b121 CI 的 `tsc`、ESLint、音源/健康/状态三组契约门禁、Build Release APK、Release 全部 success；本地 `check_release_state_contract` 5/0、`check_playback_ownership_runtime` 21/0、`check_player_progress_runtime` 4/0、`check_download_restore_runtime` 3/0、`check_docs_consistency` 18 文档 0 过时。

## [审计交接单 P1–P5 + 同类扫描修复] - 2026-11-14

> 本轮为代码/文案/测试/CI/文档修复；临时审计交接单已删除，构建由收口后的 push 触发。

- **发布**：App `v1.9.2-b119` / versionCode 278（tag `86018973`，Build `43554924635` success，5 个 APK）。
- **P1 错误码文案**：`FAIL_CODE_ZH` 由 15 键扩到 21 键，覆盖源仓 16 个 `ERROR_CODES` 实际值（含 `SONG_MISMATCH`、`TRUNCATED_MEDIA`、`BAD_ENVELOPE`、`CONTRACT_ERROR`、`CANCELED`），并补 App 自有 `BUDGET_EXHAUSTED`；`source init failed` 走 `player__source_init_failed`；预算/取消不再拼接内部中文明细。
- **P2 下载落盘**：新增 `stripStatusText`，`save()` 与 `migrateDownloadDir()` 二次保存都在落盘前剥离旧 `statusText`；显示层未知状态回退 `dl_status_error`，不再回退存储中文。
- **P3 假阳性留档**：源仓当前 HEAD `4f47868` 复跑 `test/audit/f-repo.js` 为 52/0；`docs/STRESS_PLAN_v8.13.1.md` 在所有分支/历史不存在，不改门禁。
- **P4 源仓变异测试**：`ci.yml` 的 `mutation` job 补 `npm ci`；`test/mutation/run.js` 缺 esbuild 直接退出 2、单门禁超时 180s、strict 对 `SURVIVED/UNCERTAIN/BUILD_FAILED/SKIPPED` 全部判失败，消除“0 killed / 0 survived”假绿。
- **N1 诊断 finding 三语化**：8 类 finding 全部补 `i18n` 元数据，`localizeHealthFinding` 统一格式化；页面与复制摘要共用，原始中文保留给日志。
- **N2 reason 本地化**：胶囊第二行显示 12 个 `health_reason_*` 短标签，raw code 保留在无障碍标签与诊断导出/快照。
- **N3 硬编码 UI 文案**：通知歌词帮助、下载完成/入队 toast、诊断包分享标题、路径选择权限/打开/创建失败、同步连接共 9 处接三语。
- **B2 CI 覆盖**：`release.yml` 接入 anomaly/event/persistence/state/status/ui/download/docs 8 个检查；`check_source_ci_gate_offline` 仍保留离线/手动。
- **B4 台账回填**：三语各 958 键；`AUDIT_PLAN`/`AGENTS`/`STRESS_PLAN`/`RELEASE_SOP`/`SYNC_POINTS`/`MUSIC_SOURCE_GUIDE` 计数与 reason 口径同步。
- 验证：`tsc --noEmit` 0；`check_health_diagnostics` 54/0、`check_health_diagnostics_view` 24/0、`check_health_ui_mapping` 11/0、`check_health_state_v2` 7/0、`check_playback_ownership_runtime` 20/0、`check_download_persistence` 3/0、`check_docs_consistency` 18 文档。

## [音源健康文案适配 4 主状态 + 源 v8.13.1 版本同步] - 2026-11-14

> 已随本轮 App 提交 `bffaf281`；旧健康页文案不再保留，三语同步适配新版 4 主状态 + 逐档质量矩阵。

- **发布**：App `v1.9.2-b118` / versionCode 277（tag `ae823b88`，Build `43531794187` success，5 个 APK）；内置源 `8.13.1`。

- `health_desc` 改为“4 主状态（可用/降级/暂停/已关闭）+ 逐档质量矩阵（请求/成功/失败/均时/熔断/限流）”。
- `health_footnote` 删除“旧 11 态/9 桶”尾注，明确待采样归入可用、降级/暂停/已关闭的 reason 清单与摘要口径。
- `health_main_off` 由“手动关闭”改为“已关闭/已關閉/Off”，同时覆盖 USER_OFF 与 DEFAULT_OFF。
- 趋势弹窗标题改“健康分趋势”，图例改“≥3 分 / −5～3 分 / <−5 分 / 无样本”，避免与 4 主状态混淆。
- `playDeadReviveMs` 配置名/说明改“暂停源恢复试探”，去掉“已摘除/被摘除”旧术语；质量矩阵提示补“限流”。
- `Health.tsx` 列表排序由旧五级分区改为 4 主状态（可用→降级→暂停→已关闭，可用内使用中优先）。
- 三语各 904 键保持不变；`check_health_ui_mapping` 11/0，并新增断言用户文案不得再出现旧 11 态/9 桶。
- `check_source_health_persistence.js`、`check_health_persistence_v2.js` 的 sourceVersion 夹具同步 8.13.1。

## [音源健康：F06/F07/F12/F17/F32 缺口补齐] - 2026-11-13

> 本地提交，未推送；承接 v2 审计第八节，单一路径继续收口。

- F06：`sourceConfig` 新增 `healthCheckJitterRatio`（0~0.5，默认 0.1）与 `healthCheckPauseRetryMs`（1s~5min，默认 60s），三语配置名/说明齐全；三语各 903 键，`doc-sync-map` 基线同步 903。
- F07：`Health.tsx` 趋势弹窗新增 1h/24h/7d 窗口切换，按时间戳过滤，数据不足显示空态；弹窗顶部补播放/探测 24h 分块；源仓历史上限同步到 1008（约 7d）。
- F12：`healthDiagnostics` 的 `new_code` 详情改为“此前基线（实际跨度）未见”，不再写死“前 7 天”；覆盖不足时 UI 直接隐藏错误码结论，改为提示先看其他线索。
- F17：消费源快照新增的 `offCount/blockedCount/degradedCount/totalCount`，不再把 off/blocked 混为 dead。
- F32：`healthLog` 优先按源事件 `eventId` 去重，旧源回退复合键。
- 验证：`tsc` 0、`lint` 0、`build-test` rc0、`check_source_config_contract` 25/0、11 个健康脚本全绿、`check_docs_consistency` 18/0。

## [音源健康：单一路径收口（删除旧 11 态/9 桶与 v1 持久化）] - 2026-11-13

> 本地提交，未推送；按用户要求删除新旧双轨，正常运行时只保留新架构。

- `healthStatus.ts` 只保留 4 主状态 + reason；删除旧 `classifyHealthState`、`HealthBucket`、`summarizeHealthItems`、`buildHealthSummaryV2` 与旧 11/9 类型。
- `Health.tsx` 摘要只渲染 4 主状态，删除“旧状态明细”9 桶展开及 `health_main_detail` 入口。
- 三语删除 22 个旧键（11 个 `health_state_*` + 9 个 `health_sum_*` + `health_main_detail`），各语言 902 键；`health_footnote` 改为 4 主状态 + reason 口径。
- `sourceHealthPersistence.ts` 只接受 v2；`restoreSourceHealth` 强制从健康态剥离 controls，控制意图只从独立 control key 恢复；删除 v1 合并态恢复路径。
- 审计：`check_health_status_refactor` 10/0、`check_health_state_v2` 7/0、`check_source_config_contract` 25/0、`check_health_persistence_v2` 9/0、`check_source_health_persistence` 17/0、`check_health_ui_mapping` 11/0、`check_health_diagnostics` 54/0、`check_health_diagnostics_deep` 51/0、`check_health_diagnostics_view` 23/0、`check_health_anomaly_v2` 8/0、`check_health_event_pipeline` 10/0；tsc 0。

## [音源健康：源快照只读资格字段同步] - 2026-11-13

> 本地提交，未推送；源仓 `b3d6275` 新增快照字段，App 文档同步。

- `getHealthSnapshot` 每源新增 `eligible/eligibilityReason/eligibilityCode/eligibilityUntilMs`，与 `computeEligibility` 同源；快照只读不写状态。
- 源仓新增 `health-state-machine-v2.js`（M1~M10 10/0）与 `health-probe-fidelity.js`（F1~F10 10/0），`npm test` 14 脚本 rc0；方案 6.3 源仓缺失脚本清零。
- App 4 主状态 + reason 继续消费旧字段兼容；`check_health_state_v2` 8/0、`check_health_ui_mapping` 10/0。

## [音源健康：方案 6.3 UI 映射审计 + 质量矩阵三语化] - 2026-11-13

> 本地提交，未推送；补齐方案 6.3 App 侧最后一个健康审计脚本。

- 新增 `scripts/check_health_ui_mapping.js`（U1~U10 10/0）：4 主状态文案/颜色/reason 两行、主状态摘要与旧 9 桶展开、质量矩阵七项字段、多源绑定与质量提示、全局/单源探测应用确认、reason 枚举、三语键数一致。
- 修复审计发现的 UI 偏差：质量矩阵单元格原先把“次/成/败/业务/限流”硬编码为中文，英文/繁体界面会中英混排；改用 `health_q_req`/`health_q_ok`/`health_q_fail`/`health_q_biz`/`health_q_limited` 五键（三语各 913 键）。
- 验证：`check_health_ui_mapping` 10/0、`check_health_state_v2` 8/0、`tsc` 0、目标 eslint 0、`build-test` rc=0（产物已清理）、docs 18/0。

## [音源健康：F15/F51/F52 4 主状态 + reason / 旧 9 桶可展开] - 2026-11-13

> 本地提交，未推送；对应方案 3.1 状态映射与 F52 汇总 v2。

- `healthStatus.ts` 新增 `HealthMainState`（available/degraded/paused/off）、`HEALTH_MAIN_STATES`、`classifyHealthMainState` 与 `buildHealthSummaryV2`；旧 `classifyHealthState` 11 态/9 桶原样保留，作为 reason 与明细来源。
- 映射：正常→可用 `ELIGIBLE`；待采样→可用 `PENDING_SAMPLE`；异常→降级 `DEGRADED`；熔断/半开/限流→降级 `QUALITY_OPEN`/`QUALITY_HALF_OPEN`/`RATE_LIMITED`；已摘除→暂停 `PLAYBACK_FAILED`/`RESOLVE_FAILED`；休眠→暂停 `SOURCE_SLEEPING`；自动关闭→暂停 `AUTO_OFF_PROBE`；手动/默认关闭→手动关闭 `USER_OFF`/`DEFAULT_OFF`。
- `Health.tsx` 摘要改为主状态 4 计数，新增“旧状态明细”展开 9 桶；表格胶囊改为主状态 + reason 两行显示。三语新增 5 键（各 908 键）。
- 新增 `scripts/check_health_state_v2.js`（S1~S8 8/0）：4 主状态枚举、12 条映射、旧 11 态不丢信息、双汇总合计、UI 消费、三语键。
- 验证：`check_health_state_v2` 8/0、`check_health_status_refactor` 10/0、`check_source_health_persistence` 17/0、`check_health_persistence_v2` 9/0、`check_health_event_pipeline` 10/0、`tsc` 0、目标 eslint 0、`build-test` rc=0（产物已清理）、docs 18/0。

## [音源健康：方案 6.3 事件流水线审计 + sourceEvents 落盘脱敏] - 2026-11-13

> 本地提交，未推送；对应方案 F32/F33/F56 与 6.3 必跑命令。

- 新增 `scripts/check_health_event_pipeline.js`（E1~E10 10/0）：白名单入库、eventId 去重、失败抓同 trace 源事件、1/5 成功采样权重、chain/play/probe 三块隔离、cache_hit 单列、报告摘要、source_events 不计样本、本地-only 契约。
- 修复 `healthLog`：`recordPlayResult` 拉回的 `sourceEvents` 不再原样落盘，新增 `sanitizeSourceEvents` 按源事件白名单裁剪（ts/seq/traceId/event/sourceId/platform/quality/ok/code/latencyMs/reason/from/to），URL/歌名/账号等字段在写入前丢弃。
- `tsc` 0、目标 eslint 0、`check_health_event_pipeline` 10/0、`build-test` rc=0（产物已清理）、docs 18/0。

## [音源健康：方案 6.3 持久化 v2 审计脚本补齐] - 2026-11-13

> 本地提交，未推送；对应方案 6.3 必跑命令清单。

- 源仓新增 `test/audit/health-persistence-v2.js`（P1~P8 8/0）：v2 结构、v1 兼容、controls-only 不绑 sourceVersion、controls-only 不恢复健康元数据、autoOff 6h 复验、`healthV2Enabled=false` 回 v1、版本/未知源/容量/禁止字段、导出无 URL。
- App 新增 `scripts/check_health_persistence_v2.js`（Q1~Q9 9/0）：v2 常量与独立 control key、save 拆分、control 独立恢复、v1 合并态兼容、TTL/64KB、v1→v2 迁移、健康缺失仍返回 controlsRestored、control 校验不读 sourceVersion、源仓回滚开关存在。
- 源仓 `package.json` 的 `test` 接入 `health-persistence-v2.js`；整仓 `npm test` 现为 10 个脚本。
- 验证：源仓 `health-persistence-v2` 8/0、`aa-p3-persist` 10/0、`npm test` rc=0、`docs-audit` rc=0；App `check_health_persistence_v2` 9/0、`tsc` 0、目标 eslint 0、`build-test` rc=0（产物已清理）、docs 18/0。

## [音源健康：F36/F57 持久化 v2（control 独立 / v1 兼容 / 可回滚）] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- 源侧 `exportHealthState` 升 `schema v2`；`controls` 与健康元数据分离；`restoreHealthState` 仍接受 v1；新增 controls-only 恢复（`sources:{}` + `controls`），控制态不绑 `sourceVersion`，只按 7 天 TTL/64KB 校验；`healthV2Enabled=false` 回旧 v1 导出。
- App `HEALTH_STATE_VERSION=2`，仍接受 v1；新增 `HEALTH_CONTROL_VERSION=2` 与独立 key `@___SOURCE_CONTROL___global`、`sanitizeSourceHealthControls`、`read/writeSourceHealthControls`。
- `saveSourceHealth` 把 `controls` 从健康态剥离，单独写 control key；`restoreSourceHealth` 先恢复 control 再恢复健康元数据，控制恢复数计入 `controlsRestored`。
- v1 旧合并态仍可整包恢复；健康 `sourceVersion` 不匹配只丢健康元数据，不丢用户开关意图。
- 验证：源仓 `aa-p3-persist` 10/0、整仓 `npm test` rc=0、`docs-audit` rc=0；App `check_source_health_persistence` 17/0、`tsc` 0、目标 eslint 0、`build-test` rc=0（产物已清理）、docs 18/0。

## [音源健康：F19/F60 健康页 API 绑定] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- 新增 `src/core/healthSourceBinding.ts`：`bindHealthSource` 按显式 sourceId → provider `platforms` → 首个声明 action 的顺序绑定，返回 `matched` 来源。
- `Health.tsx` 的 `getQuerier` 不再直接 `find` 第一个 API；行内 `toggle` / `probeSource` 传入当前源 `platforms`，多源时不会打到不相干 API。
- 音质展开区显示「绑定 API：<id>」，三语新增 `health_source_binding`（各 903 键）。
- 验证：`check_health_status_refactor` HS10 10/0；`tsc` 0；目标 eslint 0；`build-test` rc=0（产物已清理）；docs 18/0。

## [音源健康：F54 异常检测 v2 分块] - 2026-11-13

- `detectHealthAnomalies` 的取链规则只消费 `source_result`，播放/探测不再混入取链成功率、P95 与错误码聚合。
- 播放失败单列 `play_failure`，探测非 `UNKNOWN` 失败单列 `probe_failure`；探测 `UNKNOWN`（本地断网）不算异常，`cache_hit` 始终不算异常。
- 新增 `scripts/check_health_anomaly_v2.js` A1~A8 8/0：缓存零异常、取链/播放/探测分流、UNKNOWN 不误报、混合数据取链窗口不被污染、覆盖不足不宣称 7 天结论。
- 修正 `check_health_diagnostics` H12/H19 夹具为 `source_result`，与 F53/F54 分块口径一致。
- 验证：`check_health_diagnostics` 54/0、deep 51/0、stress 14/0、view 23/0、anomaly 8/0，`tsc` 0，目标 eslint 0，docs 18/0。

## [音源健康：Batch 1 开关权威拆分跨仓同步] - 2026-11-13

- 源快照新增 `offAt`，App `HealthStatusItem` 同步可选字段；`offReason` 与 `offAt` 同源，默认关闭不伪造时间。
- App 控制态新增 `manualOffAt` 透传/校验，旧 v2 控制态缺省 0；源侧重启恢复后手动关闭的 offAt 保留。
- 验证：`check_source_health_persistence` 17/0、`check_health_persistence_v2` 9/0、`tsc` 0、目标 eslint 0、docs 18/0。

## [音源健康：F53 三块诊断 UI 收口] - 2026-11-13

- `healthDiagnosticsView` 新增 `blocks.chain/play/probe` 三块视图模型，分别透出近 1h/24h 总数、成功、失败与成功率；缺失 `playWindows/probeWindows` 的旧报告按 0 降级，不抛错。
- 健康页诊断展开区新增“取链 / 播放 / 探测”三行，各自显示 24h 次数、成功数与成功率；取链旧字段 `stats/h1/codes/others` 保留，避免旧 UI 与导出失效。
- 三语新增 `health_diag_chain/play/probe/block`，各 917 键；`check_health_ui_mapping` U11 校验 UI 实际消费播放/探测块且三语键齐全。
- 验证：`check_health_diagnostics_view` 23/0（新增 V23）、`check_health_ui_mapping` 11/0（新增 U11）、状态/绑定/持久化/事件 8/0、10/0、17/0、9/0、10/0，`tsc` 0，目标 eslint 0，`build-test` rc=0（产物已清理），docs 18/0。

## [音源健康：F53/F10 取链/播放/探测三块分算] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- `aggregateHealthEvents` 新增 `kinds.chain/play/probe` 三块独立聚合；`windows/topCodes/breakdown` 固定为取链块，播放/探测各带自己的窗口、错误码与分组。
- `buildHealthReport` 新增 `playWindows/probeWindows/playBreakdown/probeBreakdown`；摘要分别写“取链 / 播放 / 探测”近 24h 次数与成功率，不再把播放成功混进取链成功率。
- 缓存命中仍单独计数；`play_result` 只进播放块，`probe_result` 只进探测块。
- 验证：`check_health_diagnostics` 54/0（新增 H7b，修正 H29）；deep 51/0；stress 14/0；view 22/0；`tsc` 0；目标 eslint 0；`build-test` rc=0（产物已清理）。

## [音源健康：F08/F58 证据包 v2 manifest/上限/脱敏] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- `HealthEvidencePackage` 升到 `schema: 2`，新增 `manifest`：`format/version/generatedAt`、`appVersion/sourceVersion`、`redacted/localOnly`、`counts`、`limits`、`truncated`、`estimatedBytes`。
- 事件只保留最近 1000 条，趋势最近 200 条，日志尾部按 UTF-8 真实字节截到 64KB；总量超 2MB 时优先丢弃事件/attempts/趋势，报告与 manifest 保留。
- 快照改为递归脱敏后再入包，避免源快照里的 URL/歌名随证据导出；日志仍按 URL/歌名/搜索词脱敏。
- 导出仍只写本机并手动分享，不自动上传、不自动关源。
- 验证：`check_health_diagnostics` 53/0（新增 H8b 上限断言）；deep 51/0；stress 14/0；view 22/0；`tsc` 0；目标 eslint 0；`build-test` rc=0（产物已清理）。

## [音源健康：F16 质量档矩阵逐档可见] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- 源快照 `byQuality` 增加 `fail`，App `HealthStatusItem` 同步接收逐档 `req/success/fail/businessFail/rate/avgTime/state/rateLimited`。
- `healthStatus.ts` 新增 `HEALTH_QUALITIES` 与 `buildQualityMatrixRows`：固定 128k/320k/flac/flac24bit 四档顺序，无样本档显式 `hasSample=false`，不把缺失样本算成 0% 失败。
- 健康页表格的“音质”列变为可展开入口（`FLAC ▸/▾`）；展开后逐档显示请求数/成功/失败/业务失败/平均耗时/熔断/半开/限流，避免 flac 坏但 128k 好被源级平均值掩盖。
- 三语新增 `health_quality_matrix_tip`，各 902 键对齐。
- 验证：`check_health_status_refactor` HS9 通过，9/0；`npm run build-test` rc=0（产物已清理）；目标 eslint 0。

## [音源健康整功能重构：开关原因/真实播放回传/单源只读探测] - 2026-11-13

> 本地提交，未推送；与源仓健康重构配套。

- **状态分类**：`healthStatus.ts` 新增 `USER_OFF/AUTO_OFF_PROBE` 两个状态键；优先级改为手动关闭 → 探测自动关闭 → 休眠/默认关闭 → 待采样 → 播放摘除 → 异常 → 限流 → 熔断/半开/正常。修两个旧缺陷：自动关闭被显示成“异常/已摘除”、休眠把“已关闭”盖掉。旧 11 态信息降为 `offReason`，不删除。
- **reason 透传**：`HealthStatusItem` 接收 `userEnabled/autoOff/offReason`；旧快照无字段时回退 `enabled/sleeping`，不改变旧行为。`DEFAULT_OFF` 与 `USER_OFF` 分开，观察源默认关闭不再冒充用户关闭。
- **单源探测**：`Health.tsx` 每行名称下新增“探测”，先以 `probeSource apply:false` 只读探测；结果返回后弹确认，用户确认才 `apply:true` 落账（失败可能触发该源自动关闭）。全局“手动探测”仍走整轮 `probe`，但 App 先确认“会应用结果：通过可能解除自动关闭，失败可能触发自动关闭”，取消则不发起。
- **F43 质量档短路可见**：健康快照新增 `qualityShortCircuit: {128k,320k,flac,flac24bit}`；健康页行内在源名下方显示“档位短路：FLAC/320K”，不再只把短路藏在链构建内部。
- **F61/F64 链资格**：源仓链项携带 `eligibility`；`wrapExecute` 发请求前重取一次结构资格，建链后用户关源/自动关闭/休眠/摘除的旧链项会被拦截。
- **真实播放回传**：新增 `reportPlayback` API 与源 action 白名单；播放器 `PlaybackError` 回传失败、`PlaybackState.Playing` 回传成功，`playDead` 不再由取链失败触发；同一曲/源/档/结果只回传一次，防重复 Playing 放大成功样本。
- **探测进本地时间线**：`health` 刷新后拉取源侧 `healthEvents`，仅把 `probe_result/health_transition` 去重写入 `source_health_*.jsonl`，不落歌名/URL。
- **配置与契约**：`SOURCE_ACTIONS` 增 `probeSource/reportPlayback`，`user_api.d.ts` 同步；三语补 `health_state_user_off/auto_off`、`health_probe_failed`、`health_probe_all_apply_tip`、`health_quality_short_circuit` 键，三语各 901 键对齐。
- **验证**：`tsc --noEmit` 0；全仓 `npm run lint` 0；`npm run build-test` 成功（产物已清理）；健康脚本 13/52/51/22/14 + HS8 全 0 失败（`check_health_diagnostics` 新增 H10）。

## [P3：宿主持久化 canonical key + 跨平台目标收敛 + 契约白名单修复] - 2026-11-13

> 已推送；b116 已发布（5 个 APK，内置源 v8.13.0）。

- 2026-11-13 发布前收口：新增 `docs/STRESS_PLAN.md`（压力/深度/视图/日志四组 102 条）；`scripts/check_source_ci_gate_offline.js` 作为本地 403 限流时的 CI 闸门旁路复核；`AUDIT_PLAN`/`RELEASE_SOP`/`AGENTS`/`AUDIT_PLAN_HEALTH_DIAGNOSTICS` 同步当前 HEAD、G5/G7/G8 边界；四组压力实跑 14/51/22/15 = 102/0，T 组审计与 tsc/eslint/docs 全 rc=0。
- 源仓 `69b07ee`：新增 `exportHealthState/restoreHealthState`（schema v1、源版本 8.13.0、7 天 TTL、256KB 白名单），只恢复 `breaker/byQuality/playDead/qualityShortCircuit`，不恢复 success URL/歌名/账号；跨平台目标收敛为 `tx→wy→kw`；mg/kg 不再作为跨平台目标，直连仍保留但 `suyinKuwo` 实际交付酷我 CDN 时 `sourcePlatform` 回填 `kw`。
- App 仓本轮 P3 提交：新增 `src/core/sourceHealthPersistence.ts`，健康快照统一写单一 canonical key `@___SOURCE_HEALTH___global`（状态内部仍按 provider id）；旧平台键只在首次读取时迁移并清理；`userApi` 首请求前等待 restore，`getHealth` 后异步 save。
- 审计补漏（本轮新增）：`SOURCE_ACTIONS` 仍为 9 个，导致 `exportHealthState/restoreHealthState` 在 `normalizeSourceInfo` 被过滤；preload `handleRequest` 也没有这两个 case。已补为 11 个 action + 两个 preload 分支，契约测试 13→14 条，并加 `P0-A7` 回归。
- 审计补漏（二次复核）：App 的 `source` 是平台键 `kw/wy/tx/mg/kg`，而健康快照 `state.sources` 的键是 provider id `suyinKuwo/...`；原 `sanitize` 强制要求 `state.sources[sourceId]`，导致真实 App 的 `kw/wy` 槽位保存/恢复全部因“缺少源 kw”失败。已移除该错误前提，并新增平台键 `A7b/A9b` 回归，持久化自检 6→8 条；本轮再补 canonical key A12/A13，最终 12/0。
- G5 关闭：`KNOWN_SOURCE_IDS` 12 源硬编码已删除，`HEALTH_STATE_SOURCE_VERSION` 固定版本已删除；写入以源快照自带 `sourceVersion` 为准，源 ID 按 `sources` 实际键校验形态；新增 G5-A1（新源 `newProvider` + 新版本 `9.1.0` 无需改常量即可往返），持久化 13/0。
- 验证：源仓 `aa-p3-persist` 6/0、`u-cross-platform` 15/15、审计 403/0、冒烟 67/0、压测 12/14/133、变异 22 killed/0 survived、verify-bundle 8/0；App `tsc` 0、目标 eslint 0、语法 525/0、契约 14/0、配置 25/0、持久化自检 13/0、docs-consistency 17 文档 0 过时。
- 边界：APK b115 仍内置 v8.12.5；P3 恢复/保存只有静态与纯模块断言，尚未真机验证。

## [App TS 行为覆盖补证：83/83] - 2026-11-12

> 只补测试与文档，不改 App 生产代码；目标是把“门禁加载了但没真正执行”的纯函数覆盖补上。

- `check_source_platform_label.js`：新增 `resolvePlayPlatform` 实际平台优先/主平台回退/空值 5 个断言。
- `check_source_config_contract.js`：新增 `configLabelKey`/`configDescKey`/`msToDisplay` 前缀与单位换算断言；契约 24→25/0。
- `check_playback_ownership_runtime.js`：新增播放/歌词/封面 14 条真实行为断言（`buildLyricInfo`、`getCachedLyricInfo`、本地取链/歌词/封面、在线封面/歌词主备链路等）；运行时 5→19/0。
- `check_health_diagnostics.js`：新增 `trimTailByBytes`（UTF-8 不切多字节）、`buildCacheHitEntry`、`parseHealthLines`（坏行跳过）、`createHealthTraceId` 四条纯函数断言，并用内存 FS 真实执行 `readRecentHealthEvents`/`readDiagnoseLogTail`/`recordCacheHit`/`recordPlayResult`/`exportDiagnostics`/`exportAndShareDiagnostics` 六条运行时断言；健康契约 41→51/0。
- `check_log_directory.js`：新增 `init` 公共可用/私有降级两条状态断言，覆盖 `getActiveLogsDir`/`isLogPermissionGranted`/`isUsingPublicDir`；日志目录 13→15/0。
- 复测口径不变：9 个行为门禁加载的 11 个 TS 模块，V8 coverage 按导出函数名匹配，**51/83=61.45% → 83/83=100.00%**；新增真实执行 32 个函数，11 个模块导出函数全部执行，剩余 0。
- 边界不变：仍不代表 524 个 TS 文件全量行覆盖；无生产代码改动，APK 行为与 b115 一致。
- 验证：`tsc --noEmit` 0、变更脚本 eslint 0、语法 524/0、契约 13/0、配置 25/0、标签 9/9、预算 20/0、运行时 19/0、桥媒体 6/0、健康 51/0、视图 22/0、日志 15/0、深度 51/0、诊断压力 14/0、docs-consistency 17、docs-audit 20 项 0 ❌。
- 本提交只改测试/文档，使用 `[skip ci]`，不生成 b116；最新 APK 仍为 b115（内置 v8.12.5）。

## [内置音源 v8.12.5：死代码清理版 APK] - 2026-11-12

> 源仓 `v8.12.5` 只删未调用死代码（行为不变）；本次构建用于把该版本真正打进 APK，并验证源仓 HEAD 闸门绿路径。

- 源仓：`1bec334`（删除 `getFailCached` 包装与 `safeConsole.error`；`lx-source.js` 4511→4509 行）；push CI `43175425887` success；tag/Release `v8.12.5`，资产 SHA-256 `f9980213e211e7a4ba14fdd2f00751b9c62344da98ad69553ca29c0b7ba1a028`。
- App：`8f53b502` 同步 `MUSIC_SOURCE_GUIDE`/`AUDIT_PLAN` 到 `v8.12.5`；手动 dispatch Build `43177750140`，`源仓 HEAD CI 闸门` step **success**，Android/Release 两 job success。
- 跨仓：APK 内 `assets/builtin_source.js` 290638 字节，SHA-256 与源仓 Release 资产完全一致，`@version 8.12.5`。
- 发布：`v1.9.2-b115`（release id `442636986`）；5 APK：arm64 14,258,237 / armeabi-v7a 13,251,346 / universal 29,256,828 / x86 14,702,226 / x86_64 14,582,397；arm64 MD5 `717b7cfe58eff566fe573f71a2ba78f4`。
- 边界：本次未改 App 生产代码；`v8.12.5` 的行为等价性由源仓 24 个入口全量回归与死代码静态核查保证（2026-11-12 复跑为 25 个测试入口，结论不变）。

## [P1 运行时收口：外呼计数 + 候选竞速] - 2026-11-12

> 报告 P1-A1~A4 要求 App 运行时 mock 外呼计数，P1-A6 要求首成功取消其余候选；此前只有静态断言/顺序候选。

- 新增 `scripts/check_playback_ownership_runtime.js`：加载真实 `utils.ts`，只替换 musicSdk/data/setting/log 边界。P1F-A1 主源成功时 `findMusic=0`；P1F-A2 host 失败时 `findMusic=1`、主源/候选各 1 次 URL 请求；P1F-A3 source 失败时 App 搜索=0；P1F-A4 重复平台候选只请求 1 次；P1F-A6 延迟 mock 下先成功者胜出。
- `playbackBudget.ts` 新增 `racePlaybackCandidates()`：首个成功胜出并逻辑取消其余候选；`utils.ts` 的候选阶段改为并发竞速，winner 才 `onToggleSource`，晚到候选在 `isCancelled()` 处丢弃，不写 attempts。
- RED：旧顺序实现 P1F-A6 返回慢候选 `kw`，不是 40ms 先成功的 `wy`；实现后 harness 5/0。
- 边界：源 SDK 只返回 Promise、无 abort 契约，“取消”为逻辑取消（抑制晚到 attempts/缓存写入），不保证中断真实 HTTP；8MiB 真机端到端仍未实测。
- 验证：播放所有权运行时 5/0、播放预算 20/0、`tsc` 0、语法 524/0、全仓 eslint 0、契约 13/0、桥媒体 6/0、配置 24/0、标签 9/9、健康 41/0、深度 51/0、压力 14/0、视图 22/0、日志目录 13/0。
- 发布：`9b2414c7` → CI `43143871294` Android/Release success（日志确认 P1 运行时所有权 5/0、播放预算 20/0、语法 524/0、跨仓版本 v8.12.4）→ `v1.9.2-b114`（release id `442440318`）；5 APK：arm64 14,258,128 / armeabi-v7a 13,251,222 / universal 29,256,709 / x86 14,702,103 / x86_64 14,582,285。

## [验收收口：P2 错误码 + P1 owner 归因] - 2026-11-12

> 报告验收表字面缺口：P2-A2/A3 缺 `TRUNCATED_MEDIA`/`BAD_ENVELOPE`；P1-A7 的 `attempts[]` 缺 `owner`。

- 源仓 `8.12.4`：`decodeMediaEnvelope` 旁增加 `mediaEnvelopeErrorCode()`；分片数不足/空片返回 `TRUNCATED_MEDIA`，`byteLength` 或 base64 结构不符返回 `BAD_ENVELOPE`；`toBytes` 仍返回 null，`probeAudioDelivery` 与 `admit` 在无字节时优先取信封错误码，不再落回 `NOT_AUDIO`。
- App `playbackBudget.ts`：新增 `PlaybackOwner='host'|'source'` 与 `resolvePlaybackOwner()`；`PlaybackAttempt.owner` 必填。主源按 `fallbackOwners` 解析，候选固定 `host`；`healthLog` 白名单保留合法 owner，非法值丢弃。
- P1-A4 不新增机制：候选 `source` 即平台，`retryedSource` 已完成同 trace 同平台去重，补源码级断言锁定（非运行时外呼计数）。
- 测试：源 `x-media-envelope` 8→11（X5 改 `BAD_ENVELOPE`、X9 缺片、X10 1B/1KB、X11 admit）；App `check_playback_budget` 16→20（P1E-A1~A4）；首跑 RED 源 8/2、App 16/4，实现后 GREEN 源 11/0、App 20/0。
- 验证：App `tsc` 0、语法 524/0、全仓 eslint 0；源全量审计 a~x 全绿、`self-check` 8.12.4、docs-audit 0。
- 发布：源仓 `1da2f56`（v8.12.4）→ App `1cf35f67` → CI `43137739681` Android/Release success（日志确认跨仓版本一致 v8.12.4、播放预算 20/0、桥媒体 6/0、语法 524/0）→ `v1.9.2-b113`（release id `442405852`）；5 APK：arm64 14,257,181 / armeabi-v7a 13,250,270 / universal 29,255,755 / x86 14,701,165 / x86_64 14,581,343。

## [P1-A8：getOtherSource 缓存 TTL / 负缓存 / 容量] - 2026-11-12

> 问题：候选搜索缓存按对象引用命中、无 TTL、空结果永久缓存；超过 10 条直接 `clear()`，热门歌重播会反复触发 12s 搜索。

- 新增 `src/core/music/otherSourceCache.ts`：正向 TTL 5min、负缓存 60s、容量 50，命中刷新 recency，超限只淘汰最旧；`read/write` 注入 `now`，可用假时钟验证边界。
- `src/core/music/utils.ts` 的 `getOtherSource` 改为稳定 key（`source_id` / `local_id`）缓存；`isRefresh=true` 跳过读缓存但仍写回；空数组按负缓存 TTL 落盘，60s 内不再重搜。
- `scripts/check_playback_budget.js` 从 12 条扩到 16 条，新增 P1D-A1~A4；首跑 RED 12/4（模块缺失、utils 未接线），实现后 GREEN 16/0。
- 验证：播放预算 16/0、健康 41/0、深度 51/0、压力 14/0、视图 22/0、`tsc --noEmit` 0、变更文件 eslint 0、docs-audit rc=0。
- 发布：`88076d95` → CI `43134049562` Android/Release success → `v1.9.2-b112`（release id `442382357`）；5 APK：arm64 14,256,250 / armeabi-v7a 13,249,359 / universal 29,254,843 / x86 14,700,232 / x86_64 14,580,422。

## [P1 收口：play_result 结构化 attempts] - 2026-11-12

> 问题：取链失败时 `attempts[]` 只拼进诊断日志字符串，`play_result` 落盘没有账本；从本地诊断报告只能看到最终错误码，无法按源定位真正失败点。

- `src/core/healthLog.ts`：新增 `PlayAttempt` 与 `normalizePlayAttempts()`，`PlayResultInput`/`HealthLogEntry` 增加 `attempts?: PlayAttempt[]`；只保留 `source/stage/ok/code/latencyMs` 五个字段，单条最多 20 个 attempt，`latencyMs` 取整，URL/歌名等敏感字段不落盘。
- `src/core/music/online.ts`：失败 `recordPlayResult` 透传 `err.attempts`；失败码优先取 `err.code`，其次 `CODE:` 前缀，`BUDGET_EXHAUSTED` 不再被改写成 `PLAY_FAIL`。
- `scripts/check_playback_budget.js` 从 9 条扩到 12 条，新增 P1C-A1~A3；首跑 RED 9/3（attempts 未落盘、未接线），实现后 GREEN 12/0。
- 验证：播放预算 12/0、健康 41/0、深度 51/0、压力 14/0、视图 22/0、`tsc --noEmit` 0、变更文件 eslint 0、docs-audit rc=0。
- 发布：`7afbe4b6` → CI `43132044437` Android/Release success → `v1.9.2-b111`（release id `442370713`）；5 APK：arm64 14,255,579 / armeabi-v7a 13,248,688 / universal 29,254,169 / x86 14,699,578 / x86_64 14,579,747。

## [P2 桥媒体传输：base64 信封与 256KB 分片] - 2026-11-12

> 问题：App 原生桥对 binary 响应做 `JSON.stringify(Buffer)`，1MiB 变 3,743,141 字节（3.57x）、`JSON.parse` 87.29ms；到达源侧是 `{type:"Buffer",data:[...]}` 普通对象。源侧 `toBytes` 虽已兼容该形状，但新加 base64 信封时若不同步扩源侧，会引入新的 `kindOf=unknown` 假阴性。

- 新增 `src/core/init/userApi/mediaBody.ts`：`MEDIA_ENVELOPE_VERSION=2`、`MEDIA_CHUNK_BYTES=262_144`、`encodeMediaBody(bytes, chunkBytes)`；≤256KB 用单体 `body`，>256KB 用 `chunks`（`ceil(total/262144)` 片），0 字节保留 `byteLength:0`。
- `src/core/init/userApi/request.js`：binary 分支不再把 Buffer 直接交给桥；仅在脚本声明 `inited.mediaEnvelope=2` 时调用 `encodeMediaBody`，否则保留旧 Buffer，避免旧源协议回退。
- 能力协商：`src/types/user_api.d.ts` 增加 `mediaEnvelope?: number`；`src/core/init/userApi/index.ts` 写 `global.lx.mediaEnvelopes[info.id]`；`user-api-preload.js` 的 request 事件带 `sourceId`；`src/types/app.d.ts` / `src/config/globalData.ts` 增加映射与初值（缺省 `{}`）。
- 源仓 `lx-source.js`：`inited` 声明 `mediaEnvelope:2`；`toBytes` 在对象分支前识别 `__lxMedia===2`，支持 `body` 与 `chunks`，分片逐片解码（base64 分片各自带 `=` 填充，拼成大串后中间 `=` 非法），`byteLength` 不符返回 null，0 字节返回零长 `Uint8Array`；旧 `{type:"Buffer",data}` 继续兼容；0 字节信封回归补齐（源仓 `5088182`）。版本 `8.12.2→8.12.3`。
- 新增 `scripts/check_media_body.js`（App）：首跑 RED 0/5（模块缺失、request.js 未接线），补能力协商后 GREEN 6/0（1MiB 体积 <1.6x / 64B SHA / 8MiB 32 片 / 0 字节 / 能力分流 / 协商链路）。
- 新增 `test/audit/x-media-envelope.js`（源仓）：首跑 RED 2/4（信封不识别、64B `kindOf=unknown`、1MiB/8MiB 还原失败），实现后 GREEN 8/0（含 `inited.mediaEnvelope=2`、0 字节零长）。
- CI `release.yml` 在「音源标签/配置/语法/action 契约门禁」增加 `node scripts/check_media_body.js`；TS 语法计数 522 → 523。
- 验证：App 契约 13/0、播放预算 9/0、桥媒体 6/0、健康 41/0、视图 22/0、日志 13/0、配置 24/0、标签 9/9、语法 523/0、`tsc` 0、全量 eslint 0、docs-audit rc=0；源仓 W 2/2、X 8/0、R 23/23、U 10/10、V 13/13、self-check 8.12.3。
- 发布：源仓 `5088182`（v8.12.3，含 0 字节零长修复）→ App `6ee9bbf1` → CI `43129233402` Android/Release success（日志确认语法 523/0、桥媒体 6/0、跨仓版本一致 v8.12.3）→ `v1.9.2-b110`（release id `442356718`）；5 APK：arm64 14,255,078 / armeabi 13,248,188 / universal 29,253,668 / x86 14,699,073 / x86_64 14,579,246。
- 边界：信封只覆盖 binary 响应；源侧 `toBytes` 仍保留旧 Buffer 形状兼容；尚未做真机端到端 8MiB 响应实测。

## [P1 第二刀：播放取链预算与 attempts 账本] - 2026-11-12

> 极端预算：初始化 15s + 源内 12s = 27s，已超过 App 外层 25s `Promise.race`；最终被改写成 `URL获取超时(25s)`，真正失败源归不到。

- 新增 `src/core/music/playbackBudget.ts`：`PLAYBACK_BUDGET_MS=24_000`、`createPlaybackBudget`、`remainingBudgetMs`、`isBudgetExhausted`、`classifyPlaybackErrorCode`、`createBudgetExhaustedError`、`raceWithBudget`。
- `handleGetOnlineMusicUrl` 与 `getOnlineOtherSourceMusicUrl` 接受可选 `budget/attempts`；主源与候选请求都受 24s 预算 race 约束，预算先于外层 25s 触发，抛 `BUDGET_EXHAUSTED`（`retryable=true`）。
- attempts 账本记录 `{source, stage:'primary'|'fallback', ok, code, latencyMs}`；候选循环在每次取链前与失败后检查预算，耗尽即停并带账本抛出。
- `online.ts` 失败诊断日志增加 `attempts=...`；`recordPlayResult` 口径与 P0/P1 一致，不新增事件。
- 新增 `scripts/check_playback_budget.js`：首跑 RED 0/7（模块缺失、主/候选未接线、日志无 attempts），GREEN 9/0（含两条预算 race 行为用例）。
- CI `release.yml` 在「音源标签/配置/语法/action 契约门禁」增加 `node scripts/check_playback_budget.js`；TS 语法计数 521 → 522。
- 边界：本刀只做预算与 attempts；并发竞速、首成功取消、`play_result.attempts[]` 结构化落盘仍留待后续。lyric/pic/local 路径未加 owner gate 的问题仍在。
- 发布：App `c368a1ff` → CI `43119984613` Android/Release success（日志确认语法 522/0、契约 13/0、播放预算 9/0、内置源 v8.12.2）→ `v1.9.2-b108`（release id `442304517`，5 APK uploaded）。

## [P1 降级所有权（Fallback Owner）] - 2026-11-12

- `src/core/init/userApi/sourceContract.ts`：新增 `FallbackOwner`、`normalizeFallbackOwner`（仅 `source` 保留，其余归 `host`）、`shouldHostFallback`；`normalizeSourceInfo` 输出 `fallbackOwner`。
- `user-api-preload.js`：`sourceInfo.sources[source]` 透传 `fallbackOwner`；缺省不伪造。
- `src/core/init/userApi/index.ts`：init 时写 `global.lx.fallbackOwners`；`src/types/app.d.ts` / `src/config/globalData.ts` 增加映射与初值。
- `src/core/music/utils.ts`：`handleGetOnlineMusicUrl` 的 App 换源前加 gate；源声明 `source` 时不再重复搜索其他平台，未声明源行为不变。
- `scripts/check_source_contract.js`：新增 P1-A1~A4，契约 9 → 13 条；首跑 RED 9/4，GREEN 13/0。
- 源仓 `lx-source.js`：`sourceConfig[platform]` 5 个平台声明 `fallbackOwner:"source"`，聚合源版本 8.12.1 → 8.12.2；新增 `test/audit/w-fallback-owner.js`（RED 1/2 → GREEN 2/2）。
- 边界：P1 第一刀只做 owner 能力与 URL 换源 gate；预算切片、`attempts[]`、首成功取消、`BUDGET_EXHAUSTED` 留到 P1 第二刀；lyric/pic/local 路径未加 owner gate。
- 验证：App 契约 13/0、健康 41/0、`tsc` 0、全量 eslint 0、配置 24/0、标签 9/9、视图 22/0、日志 13/0、语法 521/0、docs-audit rc=0；源仓 W 2/2、U 10/10、V 13/13、self-check 8.12.2 通过。
- 发布：源仓 `2905a77`（v8.12.2）→ App `b09115c6` → CI `43115586478` Android/Release success（日志确认内置 `@version 8.12.2`）→ `v1.9.2-b107`（release id `442281635`，5 APK uploaded）。

## [P0 音源契约统一（Source Contract v2）] - 2026-11-12

> App 侧 `supportActions`、preload 白名单、`init/userApi` switch、TS 联合类型四处各自维护 action；源侧 `kw` 只声明 8 个（无 `lyric`），App 却声明 9 个，靠源内 handler 兜住。新增 action 至少要改 5 处，且未知 action 会被静默裁掉。

- 新增 `src/core/init/userApi/sourceContract.ts`：`SOURCE_ACTIONS` 作为 App 唯一 action 权威表（9 个）；`normalizeSourceInfo` 过滤非 `music` 源、未知 action、非法音质；`unwrapSourceResult` 兼容旧 raw 与 v2 `{ok,data}` / `{ok,false,error}` envelope；`SOURCE_ERROR_CODES` 固定 8 个，`retryable` 按 code 派生（`NETWORK`/`TIMEOUT`/`RATE_LIMITED` 为 true）。
- `android/app/src/main/assets/script/user-api-preload.js`：删除按 source 的 `supportActions` 白名单，init 直接透传 `userSource.actions`；保留 `handleRequest` 的 9 个 action 透传 case。
- `src/core/init/userApi/index.ts`：init 循环改用 `normalizeSourceInfo`；`musicUrl`/`lyric`/`pic`/`health`/`toggle`/`probe`/`config`/`trend`/`healthEvents` 结果统一走 `unwrapSourceResult`。
- 新增 `scripts/check_source_contract.js`：P0-A1~A6 共 9 条，覆盖 App 侧 envelope 与 preload 解包；RED 实测 0/8（缺模块 + preload 仍有白名单），补 preload envelope 用例后 8/9，GREEN 9/0。
- `scripts/check_health_diagnostics.js`：H10 改为看护“preload 无白名单 + 直接透传 `userSource.actions` + `sourceContract` 含 `healthEvents`”，契约 41/0。
- 文档：`MUSIC_SOURCE_GUIDE` 更新 action 权威表、v2 envelope、preload 透传说明；`AGENTS`/`MERGE_GUIDE` TS 计数随 docs-audit 更新为 521。
- 验证：契约 9/0、健康 41/0、`tsc` rc=0、相关 eslint rc=0、docs-audit rc=0。

## [本地诊断缓存命中计数 + 成功采样 1/5] - 2026-11-11

> 真机上听了多首歌，本地诊断仍显示 0：缓存播放不走联网取链、不记录；成功又只按 1/20 采样，几首歌很可能一条都没采到。窗口看起来像坏了，实际是口径太稀疏。

- `src/core/healthLog.ts`：`SUCCESS_SAMPLE_RATE` 20 → 5；新增 `buildCacheHitEntry()` / `recordCacheHit()`，缓存命中记 `event=cache_hit`，不带 `ok`，不参与成功率。
- `src/core/music/online.ts`：本地 URL 缓存命中分支写入 `cache_hit`（平台/音质/子源），不阻塞播放。
- `src/core/healthDiagnostics.ts`：报告新增 `cacheHits.h1/h24/d7`；缓存命中不计入 `windows` 成功率，只解释“有播放但无取链”；空取链摘要改为“播放一首未缓存的歌，或点一次探测”。
- `src/core/healthDiagnosticsView.ts` / `Health.tsx`：折叠态在无取链但有缓存命中时显示“缓存命中 N 次 · 0 项线索”；展开态增加“24h 缓存命中 N 次（不计入取链）”。
- `src/lang/{zh-cn,zh-tw,en-us}.json`：新增 `health_diag_cache_hits` / `health_diag_cache_collapsed`，三语 891 → 893；采样说明改 1/5。
- `scripts/check_health_diagnostics.js`：H5/H11/H17 改 1/5 口径，新增 H29 锁“缓存命中不进成功率”，契约 40 → 41。
- `scripts/check_health_diagnostics_view.js`：新增 V21/V22（缓存命中透出/旧报告缺字段回退），视图 20 → 22。
- 文档：`README`/`AGENTS`/`AUDIT_PLAN`/`AUDIT_PLAN_HEALTH_DIAGNOSTICS`/`MUSIC_SOURCE_GUIDE`/`RELEASE_SOP`/三语键数相关文档同步。
- 验证：契约 41/0、深度 51/0、压力 14/0、视图 22/0、日志目录 13/0、语法 520/0、docs 17。

## [日志公共优先 + 私有日志回迁] - 2026-11-11

> 公共日志目录被整体删除后，健康诊断只 `mkdir(logs)`、父目录不存在时静默失败；同时无权限期间写在私有目录的日志，在权限恢复后不会回到公共目录。

- `src/utils/log.ts`：公共目录可用时优先写 `Download/lx-music/logs`；新增 `migratePrivateLogsToPublic()`，在 `checkLogPermission()` 成功分支把私有目录全部日志迁回公共目录——文本/JSONL 追加合并，JSON 等同名冲突改名保留，迁移后删除私有源文件；「运行日志」页与清空操作在私有降级时也直接读写私有目录，不再返回空。
- `src/utils/log.ts`：新增 `ensureAllLogFiles()`，任一分类开始写日志时先补齐同目录下 `error.log` / `source.log` / `diagnose.log` / `lx_debug_log.txt` 四个固定文件，缺哪个建哪个。
- `src/core/healthLog.ts`：`ensureDir` 改为逐级创建父目录，父目录被整体删除后也能恢复；新增 `ensureHealthLogsDir()`；健康事件写入时也补齐四类固定日志。
- `Health.tsx`：打开本地诊断页先确保日志目录存在，不再依赖下一次播放事件。
- `scripts/check_health_diagnostics.js`：新增 H28，契约 39 → 40 条。
- 文档：`AGENTS`/`AUDIT_PLAN`/`AUDIT_PLAN_HEALTH_DIAGNOSTICS`/`RELEASE_SOP`/`release.yml` 同步 40 条。
- `scripts/check_log_directory.js`：新增 L1~L13 行为审计/压力（公共优先、私有降级、回迁合并、同名冲突、幂等、四类补齐、父目录重建、并发、500 文件回迁、1 万次补齐），接入 release 与 health-stress 门禁。
- 验证：契约 40/0、深度 51/0、压力 14/0、视图 20/0、日志目录 13/0、`tsc`/全量 eslint rc=0。

## [本地诊断窗口重排 + 折叠] - 2026-11-11

> 原来的窗口把“汇总一段话 + 最多 5 条 finding”平铺在一起，用户看到的只是“有事”，看不出“这份结论可不可信、总体怎么样、哪个错误码在涨”。重排为四层，并默认折叠，点标题展开。

- `src/screens/Home/Views/Setting/settings/Health.tsx`：最近异常窗口改为可折叠卡片；折叠态显示 `24h 成功/取链 · 本地成功率 · 线索数`，展开态依次显示可信度徽标（已覆盖 7 天 / 仅覆盖最近 N 小时 / 已达读取上限）、24h 取链/成功/失败/成功率四格、1h 记录与采样口径、错误码、其他线索；错误码与线索仍可点开 `samples`。
- `src/core/healthDiagnostics.ts`：`HealthCoverage` 增加 `unweightedSuccesses`，`buildHealthReport` 直接写入覆盖对象，页面不再解析汇总长文本；`spanText` 改为导出，供页面显示实际覆盖时长。
- `src/lang/{zh-cn,zh-tw,en-us}.json`：新增 15 个 `health_diag_*` 键，三语 876 → 891。
- `src/core/healthDiagnosticsView.ts`：新增纯函数视图模型，收敛折叠态摘要、覆盖状态、24h 四格、1h 空态、未加权提示和错误码/其他线索分组；`Health.tsx` 不再直接拼这些分支。
- `scripts/check_health_diagnostics.js`：新增 H27（窗口必须包含可信度/总体/错误码/其他线索分层与 `diagnosticsExpanded`），H26 追加 `coverage.unweightedSuccesses === 2`；契约 38 → 39 条。
- `scripts/check_health_diagnostics_view.js`：新增 V1~V20（含 1 万次构建 / 10 万次格式化压力）；接入 release 与 health-stress 门禁。
- 文档：`AGENTS`/`AUDIT_PLAN`/`AUDIT_PLAN_HEALTH_DIAGNOSTICS`/`RELEASE_SOP`/`release.yml` 同步 39 条；`DOWNLOAD_DESIGN`/`MERGE_GUIDE`/`SYNC_POINTS`/`doc-sync-map` 同步 891 键；`MUSIC_SOURCE_GUIDE` 四b 节补充窗口分层与折叠。
- 验证：契约 39/0、深度 51/0、压力 14/0、视图 20/0、`tsc` 与改动文件 eslint rc=0。

## [本地诊断误报修复：新错误码基线、同码去重、未加权样本提示] - 2026-11-11

> 真机截图暴露：本地日志只覆盖 8 小时时，1~7 天前是空窗，`new_code` 仍把 `NETWORK_TIMEOUT` 判成“前 7d 未见”；同一批 7 次失败又触发 `recent_failure`，同一错误码出现两条。另外升级前的成功事件没有 `sampleWeight`，汇总 22% 混入了未加权样本。

- `src/core/healthDiagnostics.ts`：`new_code` 增加前 24h 基线前提——`baseline.length === 0` 时不判新码；证据文案从“前 7d 未见”改为实际基线跨度“此前 N 天/小时未见”；`recent_failure` 跳过已经由 `new_code` 露出的错误码，避免同码重复。
- `buildHealthReport`：统计未加权成功样本（`ok === true && weightOf === 1`），汇总显式提示“其中 N 条成功为升级前未加权样本，成功率仅供参考”。
- `scripts/check_health_diagnostics.js`：新增 H24/H25/H26，35→38 条；先 RED 后改码，三条均先因旧逻辑失败再转绿。
- 文档：`AGENTS`/`AUDIT_PLAN`/`AUDIT_PLAN_HEALTH_DIAGNOSTICS`/`RELEASE_SOP`/`release.yml` 计数同步 38；`MUSIC_SOURCE_GUIDE` 四b 节补充“新错误码需基线、同码不重复、未加权样本提示”。
- 验证：契约 38/0、深度 51/0、压力 14/0、`tsc`/全量 `eslint` rc=0、`check_docs_consistency` 17 文档、`docs-audit --dry-run` 待处理 0。

## [日志/诊断去重：趋势预警单一来源、清理死 API、日志尾按字节] - 2026-11-11

> 推送前做的一次去重：趋势预警原本在页面上按“3 次健康分 -5”独立算一遍，报告里又按“4 次成功率 -15pp”算一遍，同一份 `trendData` 可能给出两个结论；日志侧还有三个零调用的导出 API。

- `Health.tsx`：删除 `decliningSources` 状态与 3 次健康分判定，顶部预警直接读报告 `trend_decline` finding；保留 `health_decline_hint`，文案改为“最近 4 次探测成功率持续下降”。
- `src/utils/logger.ts`：删除零调用的 `getLog/clearLog/getLogPath`；`lx_debug_log.txt` 仍由 `writeLog` 与日志页统一读取。
- `src/core/healthLog.ts`：新增 `trimTailByBytes`，`readDiagnoseLogTail` 按 UTF-8 字节裁剪并保留完整字符，不再用字符数冒充字节数；深度审计 F11 看护。
- `src/lang/*.json`：`health_col_success` 改为“源内成功率 / Source rate”，与本地播放成功率区分；键数仍为 876。
- `scripts/check_health_diagnostics.js`：新增 H22/H23，33→35 条，锁住“趋势预警单一来源”和“日志死 API 清零/日志页仍可读”。
- 验证：深度审计 51/0、契约 35/0、压力 14/0、`tsc`/全量 `eslint` rc=0、`check_docs_consistency` 17 文档、`docs-audit --dry-run` 待处理 0。

## [音源健康本地诊断：采样加权 / 失败归因 / 窗口覆盖 / 证据展开 + 深度审计修复] - 2026-11-11

> 修三处会让报告结论失真的统计口径：成功率被 1/20 采样系统性压低、失败只记 `platform` 导致快照对照漏报、只读最近 500/800 条却标 7 天。改法对齐 OpenTelemetry probability sampling 的 adjusted count，但不引入 SDK、不上传。

- `src/core/healthLog.ts`：新增 `SUCCESS_SAMPLE_RATE=20` 与 `sampleWeight`；失败 100% 落盘权重 1，成功 1/20 落盘权重 20；新增 `REPORT_EVENT_LIMIT=20000`。
- `src/core/healthDiagnostics.ts`：`statsOf` 按权重聚合（`total/ok/failed/successRate`），`p95` 仍按原始延迟样本；**前后 24h 成功率趋势同样加权**，避免采样比例变化误报下跌；新增 `coverage`（事件数/首末时间/覆盖时长/截断）与 `covered`；新增按源/平台/音质 `breakdown`；证据包新增 `attempts` 展开 `source_events` + `sourceVersion`；异常条目新增 `samples`（时间/源/错误码/耗时/traceId）；音源快照趋势最近 4 次连续下降 ≥15pp 生成 `trend_decline`，避免「本地样本太少就看不到下滑」；摘要明确「成功按 1/20 采样加权」并在 7 天未覆盖时提示实际覆盖时长。
- `src/core/music/online.ts`：失败落盘提取 `err.sourceId` → `err.detail[0].source` → 都不存在才省略，避免同一源拆成两个身份。
- `Health.tsx`：诊断读取上限 500/800 提到 20000，并把截断状态传给报告；新增「复制诊断摘要」，分享失败时回退复制；异常标题可点开查看单条样本；导出透传 `appVersion` / `sourceVersion`。
- `src/lang/*.json`：新增 `health_copy_report` / `health_copy_done`，三语 874→876 键。
- `scripts/check_health_diagnostics.js`：新增 H11~H21，22→33 条；`check_health_diagnostics_stress.js` 新增 U11/U12，12→14 条；实跑 33/0、14/0。
- 深度审计（`check_health_diagnostics_deep.js`，50 条）修三处真实缺陷：`trimJsonlTail` 多字节按字符数截尾导致超字节上限；脱敏不覆盖大写 `HTTPS://` / `FTP://` / `file://`；证据包 `events.sourceEvents[].reason` 未脱敏可带出 URL/歌名。
- 验证：`tsc --noEmit` rc=0；`check_health_diagnostics` 33/0；`check_health_diagnostics_stress` 14/0；深度审计 50/0。

## [docs-audit 规则 9：去掉 MUSIC_SOURCE_GUIDE 假警告] - 2026-11-11

> 指南正文已改成「以下为当前结构；」，旧写法「以下为当前（vX）」不存在；`fixAll()` 却把「模式未命中」当警告刷，导致每次巡检都有 `⚠️ … 未命中，跳过`。版本实际已由「注」规则（`` `v8.12.1` 为音源本体当前版本 ``）覆盖。

- `scripts/docs-audit.js`：规则 9 先判断旧写法是否存在，存在才 `fixAll`；不存在则输出一条 🟢 说明，不复用 `fixAll` 的未命中分支。
- 验证：`docs-audit --dry-run` 输出 `🟢 [docs/MUSIC_SOURCE_GUIDE.md] 无「以下为当前（vX）」旧写法，正文版本由「注」规则覆盖`，汇总 `待处理 0 项 · 报告 20 项`；`eslint scripts/docs-audit.js` rc=0；`check_docs_consistency` 16 文档无过时引用。

## [审计计划刷新：补 v8.12.x 跨平台标签与工程门禁维度] - 2026-11-11

> 原 `docs/AUDIT_PLAN.md` 的 A–S 组停留在 2026-11-07 快照（730 键 / b78 / TS 57→14），且没有覆盖 v8.12.x 的 `sourcePlatform` 标签链路、tsc/eslint 双门禁、跨仓版本一致。本轮只改计划与验证记录，不改业务代码。

- `docs/AUDIT_PLAN.md`：顶部基线改为 `v1.9.2-b99` / HEAD `a6767fa1` / 三语 874 键 / 519 TS/TSX / tsc 0 / eslint 0；新增 **T 组（T1~T12）**：`sourcePlatform` 全链路透传、实际平台优先、标签拼装回退、7 平台枚举闭合、成功缓存保留平台、关源后标签一致性、跨仓版本一致、tsc 门禁、eslint 门禁、版本号持久化、新增文案三语闭合、文档时效；附 9 条执行命令与 4 条反证口径。
- `scripts/check_source_platform_label.js`：标签行为矩阵扩为 **40 组合**（7 已知平台 + local + 未知 + 空 × 4 种子源名），锁住 `undefined`/双分隔符/悬挂分隔符；断言组数不变（9 组）。
- 构建闭环：Build `42991043602` success（Android/Release 双绿，跨仓版本 v8.12.1），Release 自动回写 **v1.9.2-b100 / versionCode 259**；计划基线同步区分「审计起点 b99」与「当前发布 b100」。
- 验证：`check_source_platform_label` 9/9；配置契约 24/0；健康诊断 22/0；诊断压测 12/0；`check_ts_syntax` 519/0；文档一致性 16 文档；`tsc --noEmit` rc=0；全仓 eslint 0/0；`docs-audit --dry-run` 待处理 0。

## [修复 eslint 门禁误扫构建产物] - 2026-11-11

> 首次带 eslint 门禁的 Build 在「ESLint 全仓检查」失败：CI 会在构建前把音源仓 `lx-source.js` 下载为 `android/app/src/main/assets/builtin_source.js`，该生成文件被 `eslint .` 扫到并报 3396 条风格错误。该文件不属于 App 仓源码，已加入 eslint 忽略。

- `.eslintrc.cjs`：`ignorePatterns` 增加 `android/app/src/main/assets/builtin_source.js`
- 验证：本地 `eslint . --ext .js,.jsx,.ts,.tsx` 仍为 0 errors / 0 warnings；`tsc --noEmit` rc=0
## [App eslint 纳入发版门禁] - 2026-11-11

> 全仓 eslint 已清零（0 errors / 0 warnings），具备入 CI 条件；本轮只加门禁与文档，不改业务代码。

- `.github/workflows/release.yml`：`Setup Env` 后、契约门禁前新增「ESLint 全仓检查」，命令 `node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx`
- `docs/RELEASE_SOP.md`：流水线树、底部阻塞说明、发布前清单第 1 条补 eslint；`docs/AGENTS.md`：L0 验证链与发布额外阻塞说明补 eslint
- 验证：全仓 eslint **0 errors / 0 warnings**（rc=0）；`tsc --noEmit` rc=0；`check_docs_consistency` 16 文档通过；`docs-audit --dry-run` 待处理 0；release.yml YAML 解析通过
## [App eslint 全仓 0 errors / 0 warnings] - 2026-11-11

> 收尾上一条：全仓最后 3 条 warning 清零，`eslint . --ext .js,.jsx,.ts,.tsx` 现为 **0 errors / 0 warnings**（rc=0）。

- `src/config/globalData.ts`：`version` / `buildNumber` 的模板插值改为 `String(...)` 显式转字符串，消除 `restrict-template-expressions` 的 `never` 告警；构建版本串逻辑不变
- `src/components/OnlineList/MultipleModeBar.tsx`：`useMemo` 依赖补 `onDownloadSelected`，消除 `react-hooks/exhaustive-deps`；按钮显隐与回调不变
- 验证：`tsc --noEmit` rc=0；`check_ts_syntax` 519/0；标签 9/9；配置契约 24/0；健康诊断 22/0；诊断压测 12/0；文档一致性 16 文档通过；`docs-audit --dry-run` 待处理 0；全仓 eslint **0 errors / 0 warnings**

## [全仓 eslint 清零（scripts / android 预加载）] - 2026-11-11

> 承上一提交 `a876fdec`（`src` 清零）：本轮清掉 `src` 之外的 **471 errors**，全仓 `eslint . --ext .js,.jsx,.ts,.tsx` 当时为 **0 errors / 3 warnings**。3 条 warning 为 `src/config/globalData.ts` 等原有基线，未新增、未改规则；已由下一条提交清零。

- `scripts/**`：466 → 0。`eslint scripts --fix` 自动修 461 条（主要是 411 条 `semi`、对象换行/空格/引号等纯格式），剩余 5 条人工处理：
  - 4 个自检脚本的 `new Function(...)`（用于加载转译后的本仓 TS 模块）加定向 `eslint-disable-next-line no-new-func` 与原因注释，不改加载方式；
  - `check_health_diagnostics.js` 删除未使用的 `DAY` 常量。
- `android/app/src/main/assets/script/user-api-preload.js`：5 条 `no-case-declarations`，给 `case 'musicUrl'` 加块级作用域 `{}`，变量声明与逻辑不变。
- 未改动任何业务判断、字符串内容或门禁断言；`scripts/*.js` 与预加载脚本全部通过 `node --check`。
- 验证：`tsc --noEmit` rc=0；`check_ts_syntax` 519/0；`check_source_platform_label` 9/9；`check_source_config_contract` 24/0；`check_health_diagnostics` 22/0；`check_health_diagnostics_stress` 12/0；`check_docs_consistency` 16 文档无过时引用；`docs-audit --dry-run` 待处理 0；全仓 eslint 当时 **0 errors / 3 warnings**（已由下一条提交清零）。

## [App src 目录 eslint 清零] - 2026-11-11

> 工程债务治理：`src` 从 **213 errors + 3 warnings** 清到 **0 errors**，3 条 warning 为原有基线（未新增、未改规则）。全仓 `eslint .` 当时仍有 **471 errors / 3 warnings**（`src` 之外的历史债务）；eslint 当时未纳入 CI，已由后续 `5986fe88` 纳入 `release.yml`。不得把该提交表述为“全仓 lint 清零”。

- 改动面：33 个 `src/**` 文件，+281/−238；先跑 `eslint src --fix`（23 文件），再逐文件人工治理
- 类型收敛：`downloadManager.ts` 用局部强类型 `updateItem(item: LX.Download.ListItem)` 包装替代 20+ 处 `as any`；`getData<T>()` 泛型替代断言；`healthLog.ts` 声明 `HealthFs` 接口替代 `any`；`Health.tsx` 增加 `tt(key: string)` 动态 i18n 辅助与统一 rejection 处理
- 语义保护：`item.rateLimitActive || item.rateLimited` 保留“布尔短路”语义（显式 `=== true`），不改 `??`；`t(...) || fallback || id` 保留“i18n 空串即缺失”的回退链；`download.notifyComplete` 保留“缺省开启”语义（`?? true`）
- 验证：`eslint src` **0 error**（3 warning）；`tsc --noEmit` rc=0 **0 error**；`check_ts_syntax` 519/0、`check_source_platform_label` 9/9、`check_source_config_contract` 24/0、`check_health_diagnostics` 22/0、`check_health_diagnostics_stress` 12/0、`check_docs_consistency` 16 文档无过时引用；`docs-audit --dry-run` 待处理 0
- 截至该提交，全仓复测：`eslint . --ext .js,.jsx,.ts,.tsx` = **471 errors / 3 warnings**（剩余在 scripts/tools/test 等 `src` 外目录；已由下一条提交清零）

## [CI 增加全仓 TypeScript 类型检查] - 2026-11-11

> 发版流水线在 `Setup Env` 后新增 `tsc --noEmit` 阻塞步骤；只加门禁，不改业务代码。

- `.github/workflows/release.yml`：新增「TypeScript 类型检查」步骤，命令 `node node_modules/typescript/bin/tsc --noEmit`，与语法检查、配置契约、标签契约、健康诊断契约共同在构建前阻塞
- `docs/RELEASE_SOP.md`：流水线树与发布前清单补 `tsc --noEmit`；`docs/AGENTS.md`：L0 验证链与发布额外阻塞说明补类型检查
- 验证：`tsc --noEmit` **0 error**（rc=0）；`check_ts_syntax` 519/0；`check_docs_consistency` 16 文档通过

## [App 本轮触达文件 tsc / lint 清零] - 2026-11-11

> G 项收尾：只修本轮触达文件的类型与 lint，不改业务行为，不升 App 版本。该提交时全仓 `eslint .` 仍有 **684 errors / 3 warnings** 历史债务（本轮未处理，当时未纳入 CI）；后续 `src` 清零后全仓为 **471 errors / 3 warnings**（见上条），仍不得表述为“全仓 lint 清零”。

- `src/core/player/playCount.ts`：`getTrackKey` 对下载列表项读 `metadata.musicInfo.source`，修 `PlayMusic` 联合类型下 `info.source` 的 TS2339；移除未使用的 `appStateSub` 引用（监听副作用保留）
- `src/core/init/userApi/index.ts`：`||` → `??`（2 处）、`void` 箭头加花括号、去掉 `builtinApi!.id` 多余断言
- `src/core/music/online.ts` / `utils.ts`：`Promise` 构造器参数统一为 `_resolve`/`reject`，`setTimeout(() => reject(...))` 改块语句
- `src/utils/data.ts`：`getData<string>()` 泛型替代 `as string` 断言
- 验证：`tsc --noEmit` **0 error**（rc=0）；上述 5 文件 eslint **0 error**；`check_ts_syntax` 519/0、`check_source_platform_label` 9/9、`check_source_config_contract` 24/0、`check_health_diagnostics` 22/0、`check_health_diagnostics_stress` 12/0、`check_docs_consistency` 16 文档无过时引用

## [音源 v8.12.1 配置面板与缓存失效] - 2026-11-11

> 配套音源仓 v8.12.1：健康面板新增跨平台兜底总开关；关闭/开启子源时同步清跨平台缓存，避免「关了还出旧源」。

### 配置契约
- `src/core/sourceConfig.ts`：`BOOL_CONFIG_KEYS` 8→9，新增 `crossPlatformEnabled`，默认 `true`；文件头版本对齐 v8.12.1
- 三语各新增 `health_cfg_label_crossPlatformEnabled` / `health_cfg_desc_crossPlatformEnabled`，872→874 键
- `scripts/check_source_config_contract.js`：8→9 布尔、36→37 总键、36→37 合法更新、i18n 36→37

### 验证
- `check_source_config_contract.js` 24/0；`check_ts_syntax.js` 519 文件 0 错误；`check_source_platform_label.js` 9/9

## [播放页音源标签显示实际平台] - 2026-11-11

> 背景：音源仓 v8.12.0 跨平台兜底后，`musicUrl` 已返回 `sourcePlatform`，但 App 全链路只认 `subSource/subSourceName`；`kw` 回退到 `tx` 时仍显示「酷我音乐 · Juhe聚合(tx)」。本轮对齐实际交付平台，已本地提交（未 push、未升 App 版本）。

### 透传链路（preload → userApi → utils → online → UI）
- `user-api-preload.js`：`musicUrl` 解析新增 `sourcePlatform`（字符串、截 16 字符、缺省空串），随 `data` 返回；旧音源无字段不受影响
- `src/core/init/userApi/index.ts`：`musicUrl` 返回体新增 `sourcePlatform`
- `src/core/music/utils.ts`：`handleGetOnlineMusicUrl` / `getOnlineOtherSourceMusicUrl` 返回新增 `sourcePlatform`；缓存命中从 `MusicSource.platform` 读，旧缓存无字段回退空串
- `src/core/music/online.ts`：`playSource` 构造补 `platform` 并随缓存双写；`recordPlayResult.platform` 记录实际平台
- 类型：`playSource` / `onSource` / `MusicSource` 统一补可选 `platform?: string`

### 展示层
- 新增 `src/core/music/sourceLabel.ts`：`resolvePlayPlatform` / `resolvePlatformName` / `buildSourceLabel`
- 横屏/竖屏 `PlayInfo.tsx`：优先用 `playSource.platform`，否则回退 `musicInfo.source`；平台名走 `source_real_*` 翻译，未知平台回退平台 id，`local` 不显示
- `src/plugins/player/playList.ts`：通知栏附加信息同口径显示「实际平台 · 子源名」

### 验证
- 新增 `scripts/check_source_platform_label.js`：9 条契约断言（先红 0/9 → 绿 9/9），覆盖标签行为矩阵与全链路静态接线
- `node scripts/check_ts_syntax.js`：519 个 TS/TSX 文件 0 错误
- `tsc --noEmit`：仅既存 `src/core/player/playCount.ts(85,40)` 1 条错误（非本轮引入）
- 文档契约：`MUSIC_SOURCE_GUIDE.md` 返回契约/透传链路更新；`SYNC_POINTS.md` subSource 行补 `sourcePlatform`

## [音源健康 2.4 方案] - 2026-11-11

### 审计补漏（预加载白名单 + 压力测试）
- `user-api-preload.js` 的 `supportActions` 补齐 `healthEvents`（7 个源）并新增分发 case，修「真机收不到 healthEvents」；契约新增 H10，21→22 条
- 新增 `scripts/check_health_diagnostics_stress.js`：10000 条聚合、5MB 截尾、7 天边界、脏行、RN 依赖缺失、200 错误码、证据包脱敏、traceId 唯一性、采样边界，12/0
- `healthLog.ts` 抽出 `parseHealthLines` 并用于读取，坏行不再丢整份日志

> 不标版本号、不改 `package.json`/`buildNumber`；只做端内本地诊断闭环，不做匿名上传。

### 纯诊断模块（`src/core/healthDiagnostics.ts`）
- `aggregateHealthEvents`：1h/24h/7d 成功率、P95、Top 错误码
- `detectHealthAnomalies`：本地 0% 但快照健康、成功率跌 20pp、P95 翻倍、新错误码、近期失败按码聚合
- `buildHealthReport` / `buildEvidencePackage`：人话结论 + 证据 + 建议 + traceId；证据包含 `report/events/snapshot/trend/logTail`
- `redactDiagnosticText`：导出前脱敏 URL、歌名、搜索词

### 本地日志（`src/core/healthLog.ts`、`src/utils/log.ts`）
- `source_health_YYYYMMDD.jsonl` 按天滚动；失败 100% 记、成功 1/20 采样
- 单文件 2MB 封顶保留完整行尾部；保留 7 天，写入/启动时清理
- 失败时通过 `healthEvents` 抓同 `traceId` 源事件落盘；导出 JSON 并调用现有原生分享
- `log.ts` 导出 `getActiveLogsDir()`，复用当前生效的公共/私有日志目录

### traceId 透传（`online.ts`、`music/utils.ts`、`init/userApi/index.ts`、5 个 `musicSdk/*/index.js`）
- 一次播放一个 `traceId`，换源候选复用；`musicUrl.info.traceId` 透传到音源
- 成功 1/20 采样、失败 100% 落盘；`user_api.d.ts` action 联合类型补 `healthEvents`

### 健康页（`Health.tsx`、三语言 JSON）
- 新增「最近异常（本地诊断）」区块与「导出诊断包」按钮；报告只给建议，不自动关源
- 三语言新增导出/异常/建议文案；新增 `scripts/check_health_diagnostics.js` 21 条契约断言

## [未发布] - 2026-11-10

> 背景：上一轮 App 仓实查发现，音源配置与健康状态存在“面板一套键表、启动注入另一套白名单”的漂移：启动注入只认 14 个旧键且要求 `>0`，`verifyDurRatio` / `verifyDurGapSec` 的 0 值会被丢掉；`playDeadReviveMs` 默认写成 30 分钟（音源实际 5 分钟）、`allFailShortTtlMs` 默认写成 5 分钟（音源实际 30 秒），两个预设还存不进音源；摘要只统计 7 类，已摘除/限流源会被算进正常；配置弹窗、趋势图、状态与源名大量中文硬编码，非法输入静默跳过。

### 音源配置契约单一化（`src/core/sourceConfig.ts`、`src/core/init/index.ts`）
- 新增 `src/core/sourceConfig.ts`：28 个数字键 + 8 个布尔键、单位/预设/默认值/上下限、`filterConfigForInjection`、`buildConfigUpdates`、`msToDisplay` / `displayToMs`，App 侧只保留这一份契约
- 启动注入改用 `filterConfigForInjection`：接受完整 36 键，数字允许 0 仅限两个验真键，拒绝死键 `raceOverallTimeoutMs`、非布尔、非数字、负数、超限值；删除旧 14 键 `ALLOWED_KEYS` 与 `typeof v === 'number' && v > 0` 过滤
- 新增 `scripts/check_source_config_contract.js`：TS 现转现跑，覆盖 `contract` / `defaults` / `status` / `validation` / `init` / `i18n` 六个 section，支持 `--only=`，失败退出码 1

### 默认值与预设对齐音源 v8.11.7（`src/core/sourceConfig.ts`、`Health.tsx`）
- `playDeadReviveMs` 默认 30 分钟 → **5 分钟**（300000ms）
- `allFailShortTtlMs` 默认 5 分钟 → **0.5 分钟 / 30 秒**（30000ms）
- 删除 `raceBatchStaggerMs` 的 `0` 预设（音源侧 0 不允许）
- 删除 `allFailShortTtlMs` 的 `15 分钟`预设（超过 10 分钟上限）
- `Health.tsx` 删除本地四份重复表（布尔键/默认值/单位/上下限）与两个换算函数，统一从共享契约读

### 健康状态与摘要统一（`src/core/healthStatus.ts`、`Health.tsx`）
- 新增纯函数 `classifyHealthState` / `summarizeHealthItems`，优先级：已关/休眠 → 待采样 → 异常 → 已摘除 → 限流 → 熔断/半开/正常
- 摘要从 7 桶扩为 9 桶：`ok/bad/open/half/idle/sleep/off/removed/rate`，表格胶囊与底部摘要共用同一分类函数；已摘除不再落入正常，9 桶合计等于源数
- 修复“熔断 open 被限流标签降级显示”的旧分支：熔断优先于限流

### 配置面板全量 i18n（`src/lang/zh-cn.json`、`zh-tw.json`、`en-us.json`、`Health.tsx`）
- 三语言新增 36 个 `health_cfg_label_*`、36 个 `health_cfg_desc_*`、8 个单位 key、3 个状态 key（已摘除/限流中/被限流）、2 个摘要桶 key（已摘除/限流）
- 新增弹窗/趋势/告警/按钮/平台名/13 个英文或混排源名 key；`Health.tsx` 删除 `CONFIG_LABELS` / `CONFIG_DESCS` / `SOURCE_NAME_ZH` / `PLATFORM_NAMES` 全部中文本地表，统一走 `t()`
- 底部状态说明补全 11 态与 9 桶口径，去掉源码常量名 `playDeadReviveMs`，改成“摘除后约 5 分钟（默认值，可在配置面板调整）”

### 非法输入逐项反馈（`Health.tsx`、`src/core/sourceConfig.ts`）
- `saveConfig` 改用 `buildConfigUpdates`：空/非数字/负数/非法 0/低于下限/高于上限/源侧没该键/布尔非布尔均产出错误码
- 存在任一错误时整次不提交、不显示“配置已保存”，错误逐项显示在对应输入框/开关下方；修改该项后即时清除该行错误

### 文档（`docs/MUSIC_SOURCE_GUIDE.md`、`docs/CUSTOM_CHANGELOG.md`）
- 音源指南新增「四c、音源配置面板」：36 键清单、单位、默认、上下限、持久化链路、11 态与 9 桶
- 四b 快照字段补 `rateLimitActive`，说明与 `rateLimited` 不合并
- 本轮为单次提交，**未推送、未触发构建、未升版本号**

### 验证
- `node scripts/check_source_config_contract.js`：六个 section 全部通过（24 通过 / 0 失败）
- `node scripts/check_ts_syntax.js`：516 个 TS/TSX 文件 0 错误
- `node scripts/check_docs_consistency.js`：16 个文档无过时引用
- `node scripts/docs-audit.js --dry-run`：待处理 0 项
- `tsc --noEmit`：仅既存 `playCount.ts(85,40)` 1 条错误
- `git diff --check`：无空白错误；未推送

## [v1.9.2-b86] - 2026-11-09

> 背景：推送前做跨仓契约检查时发现，音源抛的 12 个错误码里，App 只给 6 个配了中文，而且其中两个**码名对不上**——音源抛 `NETWORK_TIMEOUT` / `RATE_LIMIT`，App 表里写的是 `TIMEOUT` / `TOO_MANY_REQUESTS`。`FAIL_CODE_ZH[code] || code` 会兜底显示英文码，用户看到的是「LINK_EXPIRED：签名URL已过期」这种。

### 播放失败错误码中文化补全（`src/core/music/utils.ts`）
- 补齐音源 12 个码：`NETWORK_TIMEOUT` / `CONFIG_ERROR` / `RATE_LIMIT` / `SERVER_ERROR` / `MISMATCH` / `LINK_EXPIRED` / `PREVIEW_FRAGMENT` / `NOT_AUDIO` / `STREAM_PLAYLIST`
- 修正两个码名错位：`TIMEOUT` → 同时认 `NETWORK_TIMEOUT`；`TOO_MANY_REQUESTS` → 同时认 `RATE_LIMIT`（旧码名保留，兼容其他源与历史路径）
- 文案对齐音源 `CODE_HINT`：如 `PREVIEW_FRAGMENT` = 「仅提供试听片段」

### 验证
- 逐码核对：音源 12 个 `ERROR_CODES` **全部有中文映射，缺失 0**
- `tsc --noEmit`：仅 `playCount.ts(85,40)` 1 条既存错误

## [v1.9.2-b85] - 2026-11-09

> 版本号 bump（`chore: 更新版本信息`，远端已先行推送），本轮**无独立功能变更**。
> 实际发版内容 = b85 版本号 + 下面 b84 的一键更新整改。

## [v1.9.2-b84] - 2026-11-09

> 背景：音源仓第六轮缺口审计发现，App 的「一键更新内置音源」在失败路径上会把自己逼死——旧源已经删完，新源却没加载起来，回退无处可去。

### 一键更新顺序整改（`Source.tsx` + `apiSource.ts`）
- 旧顺序：导入新源 → **删旧源** → 切到新源。问题：新源加载失败且没别的备用源时，`setApiSource` 内部的兜底 `find(api => !api.disabled)` 找到的就是新源自己（id 相同 → 不递归 → 停住），**此时旧源已在上一行删掉，静音且回退不了**。
- 新顺序：导入新源（失败则什么都没动）→ 切到新源并等 init 结果（`Promise.race` 8s 上限）→ **切换成功后才删旧源**。
- 取舍：宁可留一个重复的内置源，也不删光。失败时抛 `新音源未能加载，已保留旧音源`。

### `setApiSource` 返回真实结果（D-25）
- 签名由 `(apiId: string): void` 改为 `(apiId: string): Promise<boolean>`，尾部 `return global.lx.apiInitPromise[0]`。
- 类型声明 `src/types/app.d.ts:39` 本来就有 `apiInitPromise: [Promise<boolean>, boolean, (success: boolean) => void]`，属**既有声明一直没用**。
- 旧代码 `await setApiSource(newApiInfo.id)` 里的 `await` 是装饰——函数同步返回 void，读起来像「等切源完成」，实际没等。

### 验证
- `tsc --noEmit`：仅 `playCount.ts(85,40)` 1 条**既存**错误（与本次改动无关）
- 未推送

## [v1.9.2-b83] - 2026-11-09

> 背景：音源仓第五轮审计（审断言）收尾时发现，健康面板会把"正在 429 退避、完全不参与竞速"的源显示成**正常**。

### 健康面板「限流中」状态（`Health.tsx`）
- 判断从 `item.rateLimited` 改为 `item.rateLimitActive || item.rateLimited`：正在退避显示「限流中」，历史上被连续拒绝多次显示「被限流」
- 原因：`rateLimited` 需要连续 3 次被上游真实拒绝才置位，但第一次 429 就把该源退避 30 秒，后续请求被本地 `canExecute` 拦下、不构成新证据——串行使用中这个标记几乎永远为 false，面板于是长期显示正常
- 音源快照新增 `rateLimitUntil`（退避截止时间戳）与 `rateLimitActive`（`now < rateLimitUntil`），是派生只读字段，不改任何控制流
- 语义不合并：`rateLimitActive` = "现在这个源不参与竞速"（一次 429 就有），`rateLimited` = "已被风控盯上"（多次被拒）。合并后「被限流」就再也不能表示后者

### 验证
- 音源侧 `FAULT8c` 实测：`rateLimitActive=true` / 剩余 30s / `rateLimited=false`（正是面板该亮的场景）
- 两版注入均能红：`rateLimitActive` 恒 false、改回 `!!rateLimited`
- App 侧 `tsc --noEmit`：仅 `playCount.ts` 1 条**既存**错误（与本次改动无关）

## [v1.9.2-b82] - 2026-11-08

> 背景：三仓第二轮全覆盖审查收尾时补做的遗留项，以及审查结论里的 1 个 🟡 + 2 个 ⚪。

### 统计展示刷新对齐（🟡 修复）
- `DrawerNav.tsx` / `About.tsx` 的统计刷新 `setInterval` **30000 → 10000**，与 `playCount.ts` 的 10 秒结算同频
- 原因：结算 10 秒一次、界面 30 秒刷一次，刚播放完看到的数字还停在 30 秒前，会被再次判定为"统计不准"

### 展示层小修（⚪ 修复）
- `ScriptImportOnline.tsx`：硬编码英文 `'Too large script'` → 复用 `source_update_too_large` 文案（中文界面不再冒出英文）
- `Comment/Header.tsx`：`comment_title` 文案只有 `{name}`，移除多余的 `singer` 传参（i18next 会忽略，无功能影响）

### 验证
- `scripts/check_ts_syntax.js`：514 个 TS/TSX 文件 **0 错误**
- 上述修复已随 `v1.9.2-b82` 编进 APK（b80 之后提交、b82 由手动 dispatch 产出）

## [v1.9.2-b80] - 2026-11-08

> 背景：用户反馈"听歌时间统计不准"。审查结论是**界面显示错了字段**——侧边栏文案写「今日 N 次 · 时长 X」，X 传的却是累计 `playTime`（只涨不跌）；数据层当时根本没有"今日时长"字段，界面想显示也拿不到。不是计时算法的问题。

### 听歌统计口径修正（`src/core/player/playCount.ts`）
- **新增 `dayTime`（今日播放时长）**：与 `playTime` 同步累加，日期变化时归零；侧边栏改显示 `dayTime`，设置页「关于」仍显示累计总时长，两处不再混淆
- **跨天自动归零**：`flush()` 开头调用 `ensureDate()`，跨夜连续播放/单曲循环不再停在昨天（旧版要等切歌或暂停才重置）
- **暂停余数接续**：新增 `carryMs`，暂停时不足 1 秒的零头保留，恢复后接上（旧版每次暂停都把零头丢掉）
- **丢失窗口收窄**：结算周期 30s → 10s，并在 `AppState` 非 active 时立即结算；进程被强杀最多丢 10 秒（原 30 秒）
- **旧存档兼容**：缺失 `dayTime` 按 0 处理，历史累计次数与时长不受影响，不会出现 NaN
- 配套（上一轮修正遗留未提交）：`playStatus.setIsPlay` 接入 `syncPlayState`；`player.ts` 移除废弃的 `addPlayCount()`

### 口径边界（既有设计，本轮核实后保持不变）
- **缓冲/加载不计时**：`service.ts` 已把 `Buffering` 映射为 `app_event.pause()`，卡顿时间不会算进听歌时长
- **同一首暂停后恢复不重复计次**；**倍速播放按真实时间计**（2 倍速听 10 分钟记 10 分钟）

### 验证
- 按源码逐行复刻的模拟脚本 8 项断言全绿：单日 60s（playTime/dayTime 同步）、跨夜（今日时长只算当天 2410s、累计仍连续 3000s）、0.6s+0.6s 正确计为 1s、旧档 `dayTime=0`
- `check_ts_syntax`：514 个 TS/TSX 文件 0 错误；`docs-audit --dry-run`：19 项无红
- `v1.9.2-b80` / versionCode 239 由 CI 真实编译产出

## [v1.9.2-b78] - 2026-11-07

> 背景：播放器 fork（`luanmuc/react-native-track-player`）做了一轮全覆盖审计（9 组 76 维，见该仓库 `docs/AUDIT_PLAN-2026-11-07.md` / `AUDIT_REPORT-2026-11-07.md`），查出 10 处问题并全部修复。本轮把 App 的 fork 锁定 `eceacb5` → `a0b2a87`，取回这些修复。

### 播放器原生层（随 fork 升级生效）
- **焦点续播不再覆盖用户主动暂停**：原先「打断结束后自动续播」的判据是状态 != 播放中，但用户手动暂停后状态同样是 `PAUSED(2)`，500ms 后 `play()` 会把用户刚按的暂停撤销。新增 `userPausedDuringInterrupt` 标记，用户暂停统一走 `MusicManager.pauseByUser()`；通知栏暂停按钮在 `emit` 之前先打标记，堵住 JS 回调延迟窗口
- **点通知开 App 的 PendingIntent 补 `FLAG_IMMUTABLE`**：原先只给歌词/模式两个按钮（requestCode 200/201）补了，开 App 那处（requestCode 0）漏了
- **`MusicService` 挂 signature 级权限 `com.guichaguri.trackplayer.permission.PLAYER_CONTROL`**：服务 `exported=true` 且响应两个自定义 action（歌词切换、循环模式切换），此前任何第三方 App 都能 `startService` 伪造。若后续发现媒体键异常，删掉 `<service>` 上的 `android:permission` 一行即可复原
- **耳机拔出**：先复位被压低的音量再暂停（原先音量停在 0.2）
- 定制归口注释补齐（`TrackMetadata` / `MusicModule` / `MusicBinder`，`lx-music fork:` 覆盖 5 → 8 个文件）

### 构建验证（非真机可验部分）
- `v1.9.2-b78` / versionCode 237 由 App 侧 release CI 真实编译：gradle 直接编译 `node_modules/react-native-track-player/android` 的 Java 源码，等于把 fork 的修复跑了一遍真实编译链路
- 包内实证：`resources.arsc` 含 4 个 `notify_mode_*` + `lyric` / `lyric_inactive` / `default_artwork`；Manifest 含新权限名（b77 命中 0、b78 命中 1，反向对照成立）；Hermes bundle 含 `remote-cycle-repeat` / `remote-toggle-desktop-lyric`
- 看门狗：fork 自带的 `platform-validation.yml` 在 fork 仓库需 owner 手动启用，本轮不依赖它（App 编译链路更真实）

## [审计修复轮 · b75] - 2026-11-07

> 背景：v1 审计计划 39 维度全绿，但 b68–b74 连续出运行时缺陷。改用「编译器真错误码 + 运行时可达性」重审，扩到 89 维度（`docs/AUDIT_PLAN.md` v2），查出 15 处，全部修复。类型错误 57 → 14，三语键 697 → 730。

### 崩溃 / 功能失效（4）
- **R1** `core/music/utils.ts` 调用未导入的 `getStoreMusicSource` → 缓存命中分支 ReferenceError（切源后播放失败）；与 K25 同型
- **R2** 横屏播放页 `PlayInfo.tsx` 默认导出组件用 `theme` 却没声明 → 渲染即崩
- **R3** `RNFS.temporaryDirectoryPath`（应为 `TemporaryDirectoryPath`）×3 → 私有日志目录变成 `undefined/lx-music/logs`，b71「零权限也永不丢日志」实际从未生效
- **R4** `importUserApi` 无返回值，设置页读 `newApiInfo.id` → 「一键更新音源」必然 TypeError：新源已导入、旧源不删、不切换，还提示失败

### 数据安全 / 状态一致性（2）
- **R7** 「清空已完成」原来连文件一起删，文案只说清空任务 → 改为**只清列表**；删文件统一走 `removeDownload`
- **R8** 13 处 `status` 变更补 `statusKey`（等待/暂停/失败/重试）；重启恢复同时清 `error`/`speed`。此前 UI 优先读 `statusKey`，重启后可能永远显示「获取歌曲信息…」

### 视觉 / 国际化（4）
- **R5** 健康面板 `c-font-1`(3)/`c-border-1`(1) 非法主题键 → `c-font` / `c-border-background`
- **R9** 下载管理器层弹窗（权限引导、文件已存在）与 toast、异常文案接 i18n（新增 9 键）
- **R10** `QualitySelect`/`MultipleModeBar`/`ListMenu`/`DrawerNav`/音源更新流程接 i18n（新增 13 键）
- **R6** `HealthItem` 补 `playDead`/`rateLimited`（音源快照确实提供），状态分支恢复生效

### 防御性（5）
- **R11** `core/music/local.ts` / `plugins/sync/client/auth.ts` 显式 `import { Buffer } from 'buffer'`（Hermes 无全局 Buffer）
- **R12** 封面下载加 10s 超时 + `stopDownload`，不再拖住「已完成」
- **R13** 自定义下载目录写探针验证可写，失败即提示换目录
- **R14** 新增 `makeError(msg, code)`，失败分类改按错误码，不再依赖中文子串
- **R15** SAF 选目录说明补充「部分系统仍需所有文件访问」

### 顺带修掉的类型契约缺口
- `getQuerier` 补 `'trend'`、`UserApiSourceInfoActions` 补 5 个治理 action（音源 v8.0 已实现，App 只漏类型）
- 趋势历史显式类型，消除 3 处隐式 any；补 3 个图例样式（此前只引用未定义）；`Button` 移除无效 `size`/`type`
- `app_setting.d.ts` 补 `common.enableDebugLog`
- `MUSIC_SOURCE_GUIDE` 四b 补 `playDead`/`rateLimited` 快照字段说明
- `logger.warn` 第三参数被签名丢弃（2 处）→ 改模板串，保留失败原因

## [v1.9.2-b74] - 2026-11-07

> 背景：用户反馈「下载没有进度提示」。核查后确认进度条/百分比**早已存在**（`Download/index.tsx` 的进度块、`downloadManager` 的 `progress` 回调、store 事件刷新链路都在），问题在于「看不见」而不是「没实现」。本轮只做 UI 层增强，不动下载核心。

### P0 · 让已有的进度条看得见
- 条高 `4px → 6px`、圆角 `2 → 3`、轨道 `rgba(128,128,128,.25) → .35`
- 百分比从条下方小字改为**条的右侧同行**显示；速度与「已下载/总量」单独一行

### P1 · `total` 未知时不再假装 0%
- 音源直链若无 `Content-Length`，`total` 为 0/-1 → 原来画空槽 + 永远 `0%`
- 改为：`total > 0` 才画条与百分比；无长度时只显示 `速度 · 已下载 1.2 MB`（复用 `dl_downloaded` 键）

### P2 · 批量队列汇总
- 下载页顶部新增 `已完成 12/30 · 下载中 2 · 失败 1`，仅 `activeCount ≥ 2` 时出现
- 新增 3 键：`dl_queue_summary` / `dl_queue_running` / `dl_queue_failed`，三语各 **697** 键

### 未做
- 剩余时间（`(total-downloaded)/speed`）：单曲秒级完成时恒显示「约 1 秒」，属噪音，批量场景 P2 已覆盖

## [v1.9.2-b73] 加固轮 - 2026-11-07

> 状态：**已推送并出包**（b73 版本信息提交入库，随后 b74–b78 继续迭代）。查出来的都是定制代码自身的隐性缺陷，不是新功能。

### 1. `migrateDownloadDir()` 一直静默失效（b64 的目录迁移从未真正执行过）

- **缺陷 1**：函数里调用了 `checkStoragePermissions()`，但 `downloadManager.ts` **没有导入这个符号** → 运行时 `ReferenceError` → 被函数最外层 `catch (e) {}` 吞掉，整个迁移静默 return。也就是说 b64 写的「老版本 `Download/lx-music` 根目录文件迁到 `music/` 子目录」在任何设备上都没跑过
- **缺陷 2**：迁移后更新下载记录那一段读的是 `t.filePath`，但 `filePath` 实际在 `t.metadata.filePath` 下 → 即使迁移跑起来，记录也永远匹配不到（`undefined?.startsWith` 恒 false），而且 `{ ...t, filePath }` 会往顶层塞一个不存在的字段
- 修法：补 import，字段改为 `t.metadata?.filePath` 并写回 `metadata.filePath`

### 2. 文件名只按「字数」截断，长中文名 + emoji 会超文件系统上限

- `buildFileName()` 原来是 `.slice(0, 80)`，80 个汉字 = 240 字节，再加 ` [flac].flac` 已接近 255 字节单段名上限；含 emoji（4 字节/字）时直接超限 → 写入报 `ENAMETOOLONG`，表现为「下载失败」但看不出原因
- 改为按 **UTF-8 字节** 截断到 100 字节（`trimToBytes`），并保证不出现空文件名（兜底 `untitled`）
- **注意**：首版实现用了 `Buffer.byteLength`，Hermes 没有 Node 的 `Buffer`，会直接崩；已改手算字节数（`codePointAt` 分段判断）

### 3. `formatMusicName()` 只替换第一处占位符 + 空值漏成字面量

- 旧实现 `format.replace('歌手', singer).replace('歌名', name)`：模板里出现两次同占位符时只替换第一处
- 歌手/歌名为 `undefined` 时会把字面量 `undefined` 写进文件名
- 改为 `/歌手/g`、`/歌名/g` 全局替换 + `?? ''` 兜底

### 4. 下载状态与失败原因的中文写进了存储（b72 i18n 的尾巴）

- b72 只把下载页 UI 接了 i18n，但 `downloadManager` 仍在写中文：`获取歌曲信息...`、`非WiFi环境，已暂停`、`等待重试 (1/3)`、`下载失败：网络错误`，并且这些字符串会**落盘**，切语言后仍然显示简体
- 改为任务上带 `statusKey` + `statusParams`（新增可选字段），UI 优先按当前语言渲染；`failTask` 的 `error` 只存原始报错（HTTP 码/异常文本），原因由 `errorCode` 翻译
- 已知原因时不再把中文原始报错附在括号里（只有 `unknown` 才显示原始报错）
- 新增 9 个键：`dl_status_fetching` / `dl_status_wifi_paused` / `dl_status_retrying` / `dl_fail_{network,cellular,noSource,noWrite,noSpace,unknown}`，三语各 **694** 键

### 自查证据

- `tsc --noEmit`：`downloadManager.ts`、`Download/index.tsx`、`tools.ts` 零错误（仓库其余历史类型错误与本轮无关）
- ESLint：`downloadManager.ts` 38 条（**与改动前基线 38 条完全一致，无新增**）；`Download/index.tsx` 0 条
- 命名逻辑用等价 JS 复算：`歌名 - 歌手`→`晴天 - 周杰伦`；`歌名 - 歌名`→`晴天 - 晴天`（旧实现第二处不替换）；超长中文名按 100 字节截断到 33 字；40 个 emoji 截断到 50 个字符不超限

## [v1.9.2-b72] - 2026-11-07

### 音频焦点主开关文案中性化 + 下载页三语国际化

- **音频焦点主开关文案**：`setting_play_handle_audio_focus` 由「其他应用播放声音时，自动暂停播放」改为「音频焦点控制」（繁「音訊焦點控制」/ 英 `Audio focus control`）。旧文案只描述了「暂停」一种行为，实际这个总开关管的是整条焦点链（暂停 / 被打断后自动续播 / 瞬时降音 / 焦点丢失），文案与实际能力不符
- **下载页国际化**：`Download/index.tsx` 与 `Download/Settings.tsx` 里 65 处硬编码中文全部接 `useI18n()`，新增 `dl_*` 前缀 65 个键，三语（zh-cn / zh-tw / en-us）各 **685** 键完全对齐
  - 覆盖：状态文案（等待中/下载中/已暂停/已完成/下载失败）、操作按钮（播放/分享/打开/删除/重试/继续/暂停/取消/上移/下移）、分组标题（带任务数）、空状态、下载设置卡全部标签与描述、以及 11 条 toast
  - `NAME_PRESETS`（`歌名 - 歌手` 等模板）与占位符校验保持中文原样：这两个词是**写入文件名模板的占位符字面量**，不是界面文案，翻译会让已存的命名规则失效
- 校验：`tsc --noEmit` 对两个改动文件零错误；ESLint 零告警（顺带补了 `sections` useMemo 漏掉的 `t` 依赖）

## [v1.9.2-b71] - 2026-11-07

### 下载设置全部收进「下载」页（不再占设置页分组）
> 起因：下载类 6 个设置项（仅 WiFi / 最大并发 / 失败重试 / 目录 / 文件命名 / 完成通知）后端逻辑齐全但没有界面入口，用户要求全部整合到下载页，而不是新增设置分组。

- **新增 `Download/Settings.tsx`**：下载页顶部「下载设置」折叠卡。没有任务时默认展开（整页不再空白），有任务时收起成一行摘要（`默认目录 · 仅WiFi关 · 并发2`），点击展开
- **六项设置全部接入**：
  - 仅 WiFi 下载（`download.onlyWifi`）
  - 最大同时下载数 1–5 步进（`download.maxTask`）
  - 失败自动重试（`download.autoRetry`）
  - 下载目录（`download.dir`）：默认公共目录 / 应用私有目录（无需权限）/ **系统文件夹选择器**（`AndroidScoped.openDocumentTree`，SAF 树 URI 还原成 `/storage/...` 真实路径）/ 手动输入绝对路径
  - 文件命名（`download.fileName`）：3 个预设模板 + 自定义（必须含「歌名」或「歌手」占位符）
  - 下载完成通知（`download.notifyComplete`），从「基础设置」分组移到这里，避免同一个键两处开关
- **`core/downloadManager.ts` 的 `buildFileName` 真正遵循命名模板**：原先硬编码 `${name} - ${singer}`、设置只影响分享文案，现在走 `formatMusicName()`，默认值 `歌名 - 歌手` 与旧行为完全一致；音质标识仍由下载自动追加
- **`src/types/app_setting.d.ts`**：`download.fileName` 由三选一联合类型放开为 `string`，以支持自定义模板（`formatMusicName` 只做字符串替换，无解析风险）
- **权限兜底**：选择/输入 `/storage/` 下的目录但创建失败时，先探测「所有文件访问」权限并提示去开启，而不是笼统报错

---

## [v1.9.2-b70] - 2026-11-07

### 同类隐患二次排查：播放器未初始化时的其余原生崩溃 / 异常路径
> 起因：b69 修完启动崩溃后，要求把「播放器没初始化就调原生 / 原生没判空就解引用」这一类问题全仓过一遍。

- **原生 `MusicManager.onPause` / `onStop` / `onStateChange`**：`playback.shouldAutoUpdateMetadata()` 未判空。若暂停/停止/状态回调在 playback 为 null 时到达（服务被系统重启、destroy 之后），会崩主线程 → 已加 `playback != null` 判断
- **原生 `ButtonEvents.onSkipToQueueItem`**：`manager.getPlayback().getQueue()` 是原生侧唯一还没判空的 `manager` 链式解引用，媒体会话的「从队列项播放」（蓝牙/车机）触发时若 playback 为 null 会崩 → 已判空
- **App `plugins/player/index.ts` 初始化状态机**：`initial()` 中途任一 `await` 抛异常时 `isIniting` 会永久停在 `true`，之后每次点播放都被 `initial` 直接 return 掉、控件全空 → 表现为「点播放一直卡在缓存中」且无法自愈。改为 `try/catch/finally`，失败时复位 `isInitialized` 并清 `isIniting`
- **App `plugins/player/utils.ts` 统一入口守卫**：`setPlay` / `setPause` / `setStop` / `setCurrentTime` / `setVolume` / `setPlaybackRate` / `setLoop` / `getPosition` / `getDuration` / `isCached` / `getCacheSize` / `clearCache` / `updateNowPlayingTitles` 在 `isInitialized` 为 false 时直接返回。原实现会真的打到原生：`MusicBinder.getPlayback()` 在 playback 为 null 时会**顺手建一个默认 playback 并拉起 MusicService**（空 Bundle → 默认 audioFocus/缓存参数），属于隐性的静默副作用
- **App `plugins/player/hook.ts`**：首页播放条的 `useBufferProgress` 挂载即调 `getBufferedPosition` / `getDuration` / `getState`，冷启动时同样会触发上面那个「默认 playback + 拉服务」副作用 → 未初始化时跳过首次轮询
- **App `core/desktopLyric.ts`**：通知栏「词」按钮状态同步加 `isInitialized` 判断，避免启动期（桌面歌词自动开启时）提前调原生；并在 `playerInitial` 成功后补同步一次（否则桌面歌词开着时图标一直停在灰色）
- **原生音频焦点（b68 遗留）**：`AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` 结束后把音量还原成常量 `1.0`，会把用户在 App 里设的音量（如 60%）直接盖掉，导航播报一过音乐就变 100%。改为压低前记录 `playback.getVolume()`，GAIN / LOSS 分支还原该值
- **依赖**：track-player 升到 `5bff17b`

---

## [v1.9.2-b69] - 2026-11-07

### 修复：关掉音频焦点主开关后 App 启动即崩溃（b68 回归，根因在原生）
- **现象**：把「其他应用播放声音时，自动暂停播放」关掉、重启 App，闪屏过后卡住、随即崩溃。崩溃日志为 `java.lang.NullPointerException: Attempt to invoke virtual method 'int ...t0()' on a null object reference`，栈顶是 `MusicModule.setNotificationRepeatMode` → `MetadataManager.setRepeatMode`
- **根因（与音频焦点开关无直接因果，是既有隐患被踩到）**：启动时 `initPlayer` 第一步就调用 `syncNotificationRepeatMode()`，把播放模式同步给通知栏按钮；此刻播放器还没 `setupPlayer`，原生 `MetadataManager` 里 `manager.getPlayback()` 是 `null`，`setRepeatMode()` 里 `manager.getPlayback().getState()` 直接解引用 → 主线程 NPE。原生 `repeatMode` 默认值是 1（列表循环），所以只有存档模式**不是列表循环**时才会走进该行，表现为「装好第一次能用、之后重启就打不开」
- **同类隐患（一并修）**：`setLyricButtonActive()`、`updateTitles()`、`updateArtwork()` 同样无条件解引用 `manager.getPlayback()`，启动早期或播放器销毁后回调都会崩
- **修复（播放器 fork `c5c4ea6`）**：`MetadataManager` 四处全部加判空；playback 未创建时只记录状态（播放模式 / 歌词按钮），等初始化后随通知一起生效
- **App 侧双保险**：`core/init/player/player.ts` 的启动同步加 `isInitialized()` 判断，未初始化不发原生调用；`handlePlay` 中 `playerInitial` 成功后补同步一次，保证首次启动通知栏按钮图标也正确
- **依赖**：track-player 升到 `c5c4ea6`，`package-lock.json` 同步

---

## [v1.9.2-b68] - 2026-11-07

### 音频焦点拆分为三个开关
- **主开关（沿用）**：设置 → 播放设置 → 「其他应用播放声音时，自动暂停播放」，决定是否接管音频焦点
- **新增子开关 1**：「被打断结束后自动继续播放」——来电、语音消息等临时打断结束后是否自动续播；关闭后保持暂停，需手动点播放
- **新增子开关 2**：「导航播报等要求压低音量时，自动降低本应用音量」——对应 `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`；关闭后忽略压低请求、保持原音量
- 两个子开关**仅在主开关开启时有效**，主开关关闭时自动置灰（`disabled`）
- **原生实现**：`MusicManager` 新增 `autoResumeAfterInterrupt` / `duckOnTransientDuck` 字段，`setupPlayer` 从 options 读取（默认 `true`）；`GAIN` 分支恢复播放、`CAN_DUCK` 分支降音量各自加判断
- **依赖**：track-player 升到 `943bab88`，`package-lock.json` 同步

---

## [v1.9.2-b62] - 2026-11-06

### 通知栏新增播放模式按钮
- **位置**：展开态「词」按钮之后新增一个播放模式按钮。实际可见按钮共 5 个（上一首 / 播放暂停 / 下一首 / 词 / 模式）：`rewindAction` 与 `forwardAction` 因 App 的 `notificationCapabilities` 未声明 Rewind / FastForward，`createAction` 返回 null、`addAction` 直接跳过，不会出现在通知栏
- **图标随模式切换**：顺序播放 / 列表循环 / 单曲循环 / 随机，四种图标各自对应；统一灰态（白色 40% alpha），与「词」按钮关闭态一致，不做白灰二态
- **图标形状**：初版四条都是"横线+小箭头"的变体，24dp 下几乎分不出，单曲循环的数字 1 糊成一团。改为 Material 标准符号，四个轮廓完全不同——顺序=列表线+播放三角、列表循环=环形箭头、单曲循环=环+数字1、随机=交叉箭头
- **一次误判记录（重要）**：b64 装到设备上曾无法启动，一度归因于这批图标并做了回滚。用户清除全部数据后 b64 正常启动，**根因是旧的持久化数据，不是图标**。证据：b63 与 b64 两版 APK 逐文件比对（各 1017 个条目）只有 20 张图标 + 版本号不同，代码完全一致。**教训：遇到启动崩溃，先让用户清数据验证，再怀疑改动**
- **存储读取兜底（防启动崩溃）**：`getData` / `getDataMultiple` 里的 `JSON.parse` 原本没有保护，某个 key 的 JSON 被写坏（异常退出写了一半等）会直接抛 SyntaxError 冒泡到启动流程，导致 App 完全打不开——b64 在设备上真实发生过，清数据后恢复。现在解析失败按空值返回并清掉坏数据，等价于只把那一项重置成默认值；AsyncStorage 读失败也不再抛出。`initSetting` 的版本迁移额外加了字符串类型判断。
- **存储删除路径兜底**：`removeData` / `removeDataMultiple` 解析索引数据同样没有保护，坏数据会让「保存前先删旧值」抛异常，表现为设置或歌单改了不生效、重启后回退。现在解析失败只删主 key 并记日志。
- **音源事件解析兜底**：`userApi` 的 `api-action` 回调里 `JSON.parse` 失败会中断整条事件处理，改为按空对象处理。
- **定时器与下标健壮性**：`hook.ts` 查询初始状态若为缓冲，会再起一个计时器且旧引用丢失（永远清不掉，多一个每秒回调）；`playList.ts` 空队列仍取 `tracks[0].id`；排行榜横/竖屏与歌单切换在接口返回空列表时取 `list[0]`。以上均已加判空/先清理。
- **点击行为**：原生发出 `remote-cycle-repeat` 事件 → App 读当前 `player.togglePlayMethod`，在四个真实模式（列表循环 / 随机 / 顺序 / 单曲循环）之间循环，**跳过 `none` 禁用态** → `updateSetting` 落盘 → 回写原生图标
- **同步机制**：启动时同步一次；运行期统一监听 `player.togglePlayMethod` 的 `configUpdated` 事件回写。横屏与竖屏播放页是两个独立组件，只挂钩子调用点会漏掉竖屏入口，因此改为事件驱动，横屏/竖屏/设置变更/通知栏点击全覆盖
- **原生接口**：新增 `setNotificationRepeatMode(int)`，0=顺序 1=列表循环 2=单曲循环 3=随机
- **依赖**：track-player 升到 `87bf38ba`，`package-lock.json` 同步
- **顺带修复**：通知栏两处自定义按钮（词 / 模式）的 `PendingIntent` 补 `FLAG_IMMUTABLE`，避免将来升 targetSdk 到 31+ 时抛异常

---

## [v1.9.2-b61] - 2026-11-06

### 通知栏显示格式调整 + 修音源名/音质被歌词刷新覆盖
- **显示格式**：标题只显示歌名（如「黄昏」）；音源与音质统一放到艺术家行，按「歌手 · 音源 · 音质」排列（如「周传雄 · 树音 · FLAC」）。缺项自动跳过，不会出现多余的分隔符
- **修覆盖 bug**：`updateMetaInfo` 在歌词每换一行时都会调 `updateNowPlayingMetadata`，但没带 `subSource` / `quality`，把 `buildTracks` 在 add 时拼好的后缀覆盖成无后缀——这是 b54 通知栏看不到音源名的根因
- **修复方式**：抽出 `getNotificationQualityTag` / `getNotificationSubSource` 两个公共取值函数，`buildTracks` 与 `updateMetaInfo` 两处统一带上
- **依赖与锁文件**：track-player 升到 `e9585c96`，`package-lock.json` 同步
- **版本号修正**：从 b54 回退后 `build-state` 是 53，直接编译会再产出 b54 并覆盖历史包，已推进到 60（本次编译后为 b61）

---

# 定制版更新日志（CUSTOM CHANGELOG）

本文件记录本仓库（`luanmuc/mobile-app` 洛雪音乐定制版）**自 v1.9.1-b1 重建以来**的变更历史，供用户与开发者查阅。

- 上游（lyswhut/lx-music-mobile）的更新日志见 [CHANGELOG.md](./CHANGELOG.md)
- 每次云编译的**实时发布说明**由 CI 从 git 提交自动生成（见 [docs/RELEASE_SOP.md](RELEASE_SOP.md)），本文件是人工维护的归档
- 版本号规则：`1.9.2-bN`，N 为底座版本内构建序号；底座（官方原版）升版后从 b1 重新计数（如 1.9.1-b79 → 1.9.2-b1）；versionCode 由 `publish/build-state.json` 状态文件驱动持续递增，保证覆盖安装（见 [docs/RELEASE_SOP.md](RELEASE_SOP.md)）

---

## [v1.9.2-b54] - 2026-11-06

### 通知栏定制真正接通 + 播放卡加载态修复
- **依赖升级**：track-player fork 升到 `01f34b15`（原 `9e3a51b`）
- **修播放卡住**：`requestAudioFocus` 加幂等——原实现每次播放都重复请求，焦点栈累积会触发系统下发 LOSS，`stop()` 把刚开始的播放打断（表现为点播放一直停在加载/缓冲态）；`AUDIOFOCUS_LOSS` 由 `stop()` 改 `pause()`，不再把进度归零，同时复位鸭子音量
- **参数接通**：`buildTracks` 补 `quality` / `subSource`——此前 Java 侧读 bundle 恒为 null，「标题 [FLAC]」「歌手 · helloworld(kw)」两项实际不显示
- **歌词按钮状态**：桌面歌词显隐时调用 `setLyricButtonActive`，通知栏「词」按钮不再恒为置灰
- **锁文件同步**：此前 `package.json`（`9e3a51b`）与 `package-lock.json`（`001e2dd`）指向不同 commit，本次一并更新为 `01f34b15`
- **元数据判空**：`displayTitle` / `displayArtist` 拼接前判 `title` / `artist` 非空，避免 `"null [FLAC]"` / `"null · xxx"`

---

## [v1.9.2-b33] - 2026-11-05

### 更新音源按钮完整修复
- **版本比对**：先拉远端版本号，和本地当前版本对比，一样就提示"已是最新版"，不重复导入
- **先导后删**：先导入新音源，成功了再删旧的——导失败旧的还在，不会全没
- **自动切换**：导入成功后自动切到新音源，不用手动选
- **清理旧音源**：删掉所有"豆包定制"开头的旧音源——解决越点越多的 bug
- **toast 优化**：显示"v8.0 → v8.0"，一眼看出从哪个版本更新到哪个版本

---

## [v1.9.2-b34 ~ b37] - 2026-11-05

### 音源版本号体系同步（b34）
- 音源版本比对改用大版本号体系（v1.0~v8.0，同步音源仓库 2026-11-05 版本重构）

### 更新音源按钮再迭代（b35~b37）
- **b35**：去掉版本号比对，直接拉取 master 最新版
- **b36**：改用脚本指纹比对（SHA 指纹），替代版本号字符串比对——版本号相同但内容不同的情况也能识别
- **b37**：弹窗显示版本号，用户确认后才更新（防误触）

---


---

## [v1.9.2-b38 ~ b44] - 2026-11-05

### 音源结构同步与趋势图优化（b38）
- **MUSIC_SOURCE_GUIDE**：音源结构同步 v8.0（补 helloworld 源、试听片段检测、次要后端说明）
- **趋势图源名显示中文**：健康趋势图源名由 id 映射为中文名（实时快照 id→name）

### 版本编号清理（b39）
- 消除虚构编号残留（v30.0/v30.1 从未是真实版本，全部清除）
- CUSTOM_CHANGELOG 移除提前预警条目编号注记，恢复原文

### 更新音源按钮修复 + 文档同步（b40）
- **更新音源按钮**：提前 return 时重置 updating 状态（避免按钮卡在"更新中"）
- **RELEASE_SOP 版本链修正** + CUSTOM_CHANGELOG 补记
- KNOWN_ISSUES 音源版本统一大版本编号（v26 系列实证 → v7.0）

### 音源指南 action 表补全（b41）
- **MUSIC_SOURCE_GUIDE** action 表补全为 8 个（musicUrl/lyric/pic/health/toggle/probe/config/trend，原仅列 3 个）

### b42
- 无代码变更（仅发布/文档调整）

### 健康趋势弹窗排序（b43）
- **趋势弹窗按最新健康分排序**：异常源排最前（异常 < 一般 < 无样本 < 健康），一眼看到问题源

### 审计计划同步 + 繁体词条补全（b44）
- **zh-tw 补全 24 个缺失词条**：v4/v8 新增的 toast/nav 词条（音源健康/音质/下载队列/悬浮窗权限等）繁体翻译未同步，现三语言 618 条键完全一致
- 审计计划基线更新 b43 + B6 补趋势排序审计结论 + E2 备注 K1~K19 同步 + 统计修正

## [v1.9.2-b45 ~ b48] - 2026-11-05

### 文档同步 Hook（b45）
- **提交时自动提示必同步文档清单**：入库 git hook（`scripts/hooks/` + `scripts/doc-sync-map.js`），改代码即列出本次需同步的文档（含跨仓库提示），与提交一起更新
- **强制校验**：改动含代码（src/）但提交不带文档更新 → 拒绝提交（`--no-verify` 可绕过）；新账号 clone 后 `sh scripts/install-hooks.sh` 安装一次

### L4 文档一致性巡检（b46）
- **`scripts/docs-audit.js`**：低风险项自动对齐——TS/TSX 文件数 ↔ RELEASE_SOP/DEV_SETUP、底座版本 bN ↔ README、track-player 锁定 commit ↔ UPSTREAM_LIFECYCLE；报告项（不修改）——三语言键数一致
- 解决历史欠账型文档漂移（Hook 管当下提交，巡检管存量）

### L4 巡检定时化（b47）
- **GitHub Actions 每周一凌晨自动巡检**（`.github/workflows/docs-audit.yml`，UTC 周日 18:15 = 北京时间周一 02:15）：自动修复 + 自动提交写回，无需人工/账号依赖
- 健壮性修复：退出码恒 0（workflow 以 git diff 判断提交）、execSync cwd 指向仓库根（防外部目录误修）、doc-sync 排除巡检脚本自身

### 发布记录清理与自动发布重建验证（b48）
- **GitHub Releases/tags/编译记录清零**（2026-11-05，历史发布页与安装包归档删除）
- **自动发布机制保留**：手动触发编译重建 Release `v1.9.2-b48` + tag + 5 个 APK（arm64-v8a/armeabi-v7a/universal/x86/x86_64），版本计数由 `build-state.json` 驱动（b47 → b48）

## [v1.9.2-b32] - 2026-11-05

### 更新音源按钮超时控制
- **加 15 秒超时**：网络慢时用户不用一直等，超时直接提示"拉取超时（15秒），请检查网络"

---

## [v1.9.2-b31] - 2026-11-05

### 更新音源按钮修复
- **双重 toast 修复**：之前用 `handleImportScript` 导入，它内部已经有 toast 提示，导致用户看到两个提示（"导入成功" + "音源已更新到 vX.X"）。改成直接用 `importUserApi`，自己处理 toast，只弹一次
- **错误处理修复**：之前 `handleImportScript` 内部 catch 吞掉了错误，导入失败时会错误地弹出"音源已更新"。现在正确处理 try/catch，失败时显示错误信息
- **URL 改成 jsDelivr CDN**：从 `raw.githubusercontent.com` 改成 `cdn.jsdelivr.net/gh/...`，国内手机访问更稳定
- **CI 版本号提取修复**：CI 日志里的音源版本号显示从"豆包定制聚合音源 vX.X"（匹配硬编码 logInfo）改成"@version X.X"（匹配文件头注释），显示准确

---

## [v1.9.2-b30] - 2026-11-05

### 音源管理页面加"更新音源"按钮
- **一键更新音源**：音源管理页面底部加了"更新音源"按钮，点击后自动从 GitHub 拉取最新 lx-source.js，自动导入为自定义音源
- **版本号显示**：导入完成后显示"音源已更新到 vX.X，重启 App 生效"
- **拉取超时 + 错误提示**：拉取失败时显示错误原因，文件过大时拦截（9MB 上限）

---

## [v1.9.2-b24] - 2026-11-04

### 深度审计修复（12 个问题）
- **提前预警显示源名称**：之前显示的是源 id（"gdWy"），现在从健康快照里映射成中文名（"GD 网易"）——和趋势图保持一致
- **提前预警过滤已删除源**：如果源已经被删除/手动关闭，不再显示在提前预警里（之前趋势历史里有源，但当前快照里没有，会显示死链接）
- **配置保存加参数上下限校验**：和音源侧 PARAM_LIMITS 完全一致——healthCheckIntervalMs 最小 1 分钟（防频繁探测），maxConcurrency 最大 5（防触发风控），其他参数都有合理上下限
- 配合音源 v8.0 的 9 个修复（脱敏/上下限/熔断重置/缓存清空/手动探测不存历史/half-open 计数/兜底平台选最优/历史 60 条/精简字段）

---

## [v1.9.2-b23] - 2026-11-04

### 提前预警（主动通知）
- **健康分连续下降预警条**：健康面板加载时自动获取趋势历史数据，判断每个源最近 3 次探测健康分是否连续下降 ≥5 分
- **顶部警告条**：如果检测到连续下降，在健康面板顶部显示橙底警告条（类似平台级降级提示条），提示"xx 健康分连续下降，建议关注或手动切换源"
- **不用用户自己看趋势图**：系统主动提醒，用户打开健康面板就能看到，不用手动点"趋势"按钮发现问题

### 配置界面全面优化（配置参数中文化 + 单位直观化 + 预设按钮）
- **配置参数中文化**：14 个运行参数全部加中文标签（`cacheTtlMs` → "成功缓存有效期"，`breakerThreshold` → "熔断阈值"等），不再全是英文看不懂
- **ms 自动转直观单位**：毫秒值自动转换成人类可读单位显示（比如 21600000ms → 直接显示 "6 小时"，180000ms → "3 分钟"），不用自己算
- **预设按钮**：每个参数下面一排预设小按钮（常用值点一下就好），比如缓存有效期：1小时/6小时/12小时/24小时/7天
- **恢复默认按钮**：底部加"恢复默认"按钮，一键重置所有参数到默认值
- **趋势图改 status page 经典方块时间线**：每个时间点一个小方块（🟢绿=正常 / 🟡黄=降级 / 🔴红=异常 / ⚪灰=无数据），一眼就能看出"最近有没有出过问题"——比之前的圆点/柱状图更直观

---

## [v1.9.2-b21] - 2026-11-04

### 关键 bug 修复
- **JSX 语法错误**：趋势图图例里 `异常(<-5分)` 的 `<` 被 JSX 当成标签开始，导致编译失败（b21 修复：改成"异常(低于-5分)"）

---

## [v1.9.2-b20] - 2026-11-04

### 健康面板新增「配置」「趋势」按钮（v8.0 + v8.0）
- **配置热更新**（v8.0）：健康面板加「配置」按钮，弹出 Modal 编辑 14 个运行参数（缓存 TTL、熔断阈值、并发数、探测间隔等），保存后音源内存热更新即时生效，无需重载音源
- **健康趋势图**（v8.0）：健康面板加「趋势」按钮，弹出 Modal 显示每个源最近 20 次探测的健康分圆点序列（绿/橙/红三色阈值与主面板统一）
- **平台级降级提示**（v8.0）：健康面板顶部加黄底⚠️提示条，当某平台（网易/酷我/QQ/咪咕/酷狗）所有子源都失效时显示「⚠ 网易平台级降级」

### 关键 bug 修复（预加载脚本两层）
- **预加载脚本 supportActions 白名单过滤新 action**：音源侧新增 config/trend action 后，App 端预加载脚本的白名单只有 6 个 action（musicUrl/lyric/pic/health/toggle/probe），把 config/trend 过滤掉了——导致音源传了 8 个 action，App 端只收到 6 个，配置/趋势按钮点了提示"未检测到支持健康查询的音源"（b19 修复：白名单加 config/trend）
- **预加载脚本 handleRequest 缺 config/trend case**：即使白名单放行了，handleRequest 的 switch 也没处理 config/trend——返回 result 是 undefined，App 侧 `.then(res => res.data)` 报错 "Cannot read property 'data' of undefined"（b20 修复：handleRequest 加 config/trend case，统一返回 `{ source, action, data: response }`）
- **弹窗背景透明**：配置/趋势 Modal 的 modalContent 用 `theme['c-bg-1']` 动态背景色，实际渲染透明——改为明确白色背景 + width 100%（b20 修复）

### 其他修复
- **健康面板 error 残留**：首次加载音源未就绪误报"未检测到支持健康查询的音源"，后续静默轮询成功后 error 不自动清除（b18 修复：所有成功路径都 setError('')）
- **静默轮询失败打扰用户**：每 30 秒后台刷新失败就弹错误提示（b18 修复：silent 模式下不 setError、不 setSnapshot(null)）
- **平台降级提示条显示英文 ID**：wy/kw/tx/mg/kg 没翻译成中文（b18 修复：加 PLATFORM_NAMES 映射，显示"网易/酷我/QQ/咪咕/酷狗"）

配套音源：v8.0（config action + trend action + 平台级降级 + juheWy 分组）

---

## [v1.9.2-b12 ~ b14 补记] - 2026-11-04

> 本节为历史补记：b8~b20 的实现过程已合并记录于 b20 条目，此处补上 b20 条目未覆盖的两项过程性修复。

### 健康面板状态显示完善（b12）
- **面板显示已摘除/被限流状态**：被断路器摘除或限流的源在面板上明确标出，不再无差别显示
- **配置输入整数校验 + 上限**：配置弹窗输入非整数/超上限直接拦截
- **启动注入白名单过滤**：启动时注入的配置项按白名单过滤，防越权注入

### 关键修复：userApi 注册漏 action（b14）
- 音源侧 v8.0 已注册 config/trend action，但 App 端 userApi 注册表漏了这两个 action——**配置热更新/趋势图功能实际未实现**（点按钮报"未检测到支持健康查询的音源"）；b14 补 case 'config' / case 'trend' 后功能才真正可用（配合 b19/b20 预加载脚本两层修复，见 b20 条目）

---

## [v1.9.2-b5] - 2026-11-01

### 音源健康分改 10 分制（更直观）
- 音源快照 `healthScore` 由 0~1 改为 **0~10**（一位小数，如 8.5）——内部评分/排序/熔断逻辑不变，仅输出 ×10 换算；负分保留（异常源标红）
- App 健康面板显示同步：一位小数 + 阈值调整（≥3 绿 / ≥−5 默认 / <−5 红）
- 配套音源 v7.0（`luanmuc/backend-api`）

---

## [v1.9.2-b1] - 2026-11-01

### 底座升级：跟随官方原版 v1.9.2（fork 点 fb848072 之后的 6 个上游提交）
- **kg 歌单修复**（同步上游 `e6be258c`）：重启用新接口 `get_other_list_file` + 重写分页逻辑，修复无法打开 kg 歌单 / 部分歌单歌曲丢失的问题（仅合入 `kg/songList.js`，跳过上游 changelog）
- **默认禁用音频卸载**（同步上游 `025d7822` + `b3afb18c`）：`defaultSetting` 默认值 `true→false`，设置版本 `2.2→2.3`，老用户升级自动关闭（设置项保留，可手动重开）
- **track-player fork 升级**（`0f0acb4→001e2dd`）：移除音频卸载参数中的不必要设置（注释 `setIsGaplessSupportRequired(true)`，同步上游 `d76fe8f`，让更多设备/格式可进入卸载模式）
- **版本号体系调整**：底座升 1.9.2 后 bN 从 **b1 重新计数**（1.9.2-b1）；versionCode 改由 `publish/build-state.json` 驱动（159→160）持续递增，老用户可正常覆盖安装
- 上游其余 3 个提交（1.9.2-beta.0 版本号 / 发布 v1.9.2 / CHANGELOG）为纯发布记录，定制版有独立 bN 体系，未合并

---

## [v1.9.1-b79] - 2026-10-30

### 双仓库全面审计 P3 清理项（代码卫生）
- **player.ts 残留调试日志清理**：删除 4 处活动 `console.log`（delay next timeout 计时、取链失败 catch、两处歌词加载失败 catch）——错误链路已由 b70 诊断日志（log.diagnose）+ 状态提示兜底，不再刷控制台
- **VM 桥 updateUrl 校验逻辑修正**（user-api-preload.js）：旧实现 `!regex && length>1024` 三条件同时满足才剔除非法 updateUrl，非法但短于 1024 的 URL 会原样透传原生弹窗；改为非字符串/超长/非法任一命中即剔除
- **VM 桥 randomBytes 加密安全优先**：RN/Hermes 提供 `crypto.getRandomValues` 时使用（第三方音源签名场景防预测），不可用时降级 `Math.random`（能力检测，不引入依赖）
- 配套：音源仓库同日 v7.0（S1 缓存类型/S4 封面/S5 脚本修复，见音源仓库 changelog）

---

## [v1.9.1-b77] - 2026-10-29

### track-player fork 升级：合入上游音频卸载优化（依赖层）
- **播放器仓库重放定制补丁**：通知栏"词"按钮（`22631a5`→`fbdabd0`）+ 移除停止按钮/改汉字词（`e1989e7`→`0f0acb4`）重放到上游 `8f56952`（音频卸载参数优化，10-16）新基线；**已 diff 验证内容与原定制完全一致**
- **mobile 依赖锁定更新**：`package.json` + `package-lock.json` 从 `e1989e7` 升级至 `0f0acb4`（顺带修复 lock 与 package.json hash 不一致的老问题）
- 旧提交 `e1989e7` 保留于 `feat/notification-lyric-toggle` 分支，历史版本构建不受影响（commit 可达性双保险）
- 效果：本版本同时包含**上游音频卸载修复 + 通知栏全部定制**
- 配套文档更新：KNOWN_ISSUES K5 / UPSTREAM_LIFECYCLE 依赖清单同步至 `0f0acb4`

---

## [v1.9.1-b74] - 2026-10-29

### 内置音源：移除静态副本，构建时统一拉取最新（内置 v7.0）
- **移除 `assets/builtin_source.js` 静态副本**（此前仓库内置 v1.0 种子文件，已过时且易误导）：本仓库不再内置音源副本
- **每次云编译自动拉取最新**：`release.yml` 构建第一步通过 GitHub Contents API（`?ref=master`）从 `luanmuc/backend-api` 拉取最新 `lx-source.js` **生成** `assets/builtin_source.js`（curl 前 `mkdir -p` 兜底；拉取失败即构建中断，不会出无音源的包）
- 效果：APK 内置音源 = 音源仓库 master 最新版（本包 = **v7.0** 生态扫描制度化版，含自动摘死源 v7.0、日志增强 v7.0）；音源修复当天即可随新构建生效，无需手动同步
- 仓库扫描不再出现过时的内置音源副本文件

---

## [v1.9.1-b72 ~ b73] - 2026-10-29

### 修复：播放页音源标签不显示子源名（「平台·子源名」真正落地，两轮根因）
- **b72 修复（第一层根因）**：VM 桥 `user-api-preload.js` 的 `handleRequest.musicUrl` 分支组装 `result.data` 时只保留 `{type, url}`，**丢弃音源返回的 `subSource/subSourceName`** → App 侧 `res.data.subSource` 恒为空。此前清数据无效（preload 是 APK 资产）、改 App 逻辑无效（断点在更底层 VM 桥）、音源日志显示「[溯音酷我]解析成功」但 App 拿不到（音源侧日志与 App 侧字段是两条独立链路）——全部由此解释
- **b73 修复（第二层根因）**：`core/music/index.ts` 的 getMusicUrl 在线分支传了 `onQuality` 但**漏传 `onSource`** → online.ts 用默认空函数 → source 构造成功（诊断日志「子源=溯音酷我」）但 `setPlaySource` 永不执行 → UI 恒为 null
- **验证**：运行诊断日志由「子源=无」→「子源=溯音酷我」；装 b73 后播放页显示「酷我音乐 · 溯音酷我」格式
- 诊断打点保留在「运行日志 → 运行诊断」（获取链接开始/成功/失败/子源）

### 修复：全局播放卡死（`Property 'logger' doesn't exist`）+ 日志权限双通道（b71）
- **播放卡死根因**：`core/player/player.ts` 143/159/296 行用 `logger.musicResolve/error/player`，但 b62 起 import 链就断裂（b64 误改成 `log`、b68 删掉 import），`logger` 从未正确导入 → 每次播放抛 ReferenceError → 播放中断、进度条 00:00
- **修复**：`import { logger } from '@/utils/logger'`（原版洛雪正确导入）
- **权限误判根治**：按原版洛雪零权限逻辑改**双通道**——公共目录可用→写公共 `Download/lx-music/logs`（用户偏好）；公共不可用→自动降级应用私有目录（日志永不丢弃）；「运行日志」页移除「去开启权限」强制提示，4 类日志按钮永远可看，只显示当前生效目录说明
- **日志系统重建回顾（b63~b71）**：日志从「清理缓存」拆出「运行日志」独立分组；4 类日志分文件（error 1MB / source 1MB / diagnose 512KB / debug 512KB，超限自动清空）；下载迁移至公共 `Download/lx-music/{music, logs}`；启动缓冲双兜底；迁移时序修复；mkdir 递归修复；真实写测试判定

---

## [v1.9.1-b36 ~ b37] - 2026-10-28

### 新增：播放失败原因友好摘要 + 设置页「音源健康」面板（音源 v4.0 联动）
- **播放失败原因摘要**：底部状态栏显示中文摘要（如「歌曲不可用：酷我官方直连 404…」），替代音源返回的大段英文技术细节；内置源错误原样截断
- **音源健康面板**：设置页新增「音源健康」子页，展示各子源最高音质/成功率/均时/熔断状态/健康分（可刷新）；音源侧需 v4.0 起（health action）
- 桥层 user-api-preload.js 新增 health 动作透传；userApi 按音源声明自动注册 getHealth
- b37 修复：竖屏（手机）设置首页漏注册「音源健康」入口（横屏已注册）

### 修复：音源健康面板「未检测到支持健康查询的音源」（b39 起生效）
- **根因**：App 端 preload 的 `supportActions` 白名单只允许 kw/kg/tx/wy/mg 注册 `musicUrl`，v4.0 音源声明的 `health`（以及 wy/kw 的 `lyric/pic`）在 init 时被白名单过滤，导致 `getHealth` 从未注册——b36~b38 加了请求分支和注册分支，唯独漏了白名单这层
- **修复**：`supportActions` 给全部平台补 `health`，wy 补 `lyric`、kw 补 `pic`（v3.0 歌词/封面功能一并落地）
- **验证**：mock 宿主完整跑通「音源声明 → preload 白名单过滤 → 注册循环」，5 源全部注册 getHealth
- 用户安装 b39 后需确认当前使用的音源是「豆包定制[聚合音源]」（设置-自定义音源中选中它），健康面板即有数据

### 修复：内置音源自动升级失效（b38 起生效）
- App 内置音源升级靠 logInfo 中「聚合音源 vX.Y」版本串对比，音源 v3.0~v4.0 系列只更新了 @version 头，版本串停留在 v2.0，导致新 App 内置了新版音源内容却不触发自动重新导入，健康面板提示「未检测到支持健康查询的音源」
- 音源仓库同步版本串为 v4.0（logInfo + updateAlert）；用户安装 b38 后内置音源自动升级为 v4.0，健康面板即有数据

---

---

---

---

---

---

## [v1.9.1-b43 ~ b44] - 2026-10-28

### 修复：preload handleRequest 补 toggle/probe 透传（b43 面板报 Cannot read property 'data' of undefined）
- 白名单已含 toggle/probe（b43），但 preload 请求分发 handleRequest 的 switch 只有
  musicUrl/lyric/pic/health 四个 case，toggle/probe 进来后 result 为 undefined，
  响应 status:true 但 data 为空 → App 端 res.data 报错（点源级开关/手动探测时触发）
- 补 case 'toggle'（校验 {id, enabled} 对象）与 case 'probe'（校验聚合对象）原样透传
- 教训固化：音源新增 action 需改四处——音源 on(request) 分支 / preload handleRequest /
  preload supportActions 白名单 / App 注册循环

## [v1.9.1-b42 ~ b43] - 2026-10-28

### 修复：preload 白名单补 toggle/probe（源级开关/手动探测真正注册）
- v4.0 音源声明了 toggle/probe，但 preload supportActions 白名单未含这两个 action，init 时被过滤导致开关/探测无法注册（b39 同款坑）
- 白名单全部平台补 toggle/probe；端到端验证 5 源全含 health/toggle/probe，toggle 立即生效

## [v1.9.1-b41 ~ b42] - 2026-10-28

### 音源健康面板：「看」升级为「管」（配套音源 v4.0）
- **30s 自动刷新**：面板停留期间静默轮询健康快照，不再只靠手动点刷新
- **顶部聚合摘要条**：一眼看清 正常/熔断/半开/待采样/休眠/已关 各多少个
- **源级开关**：表格每行状态胶囊可点按启用/停用该子源——音源 v4.0 新增 toggle action，停用带 manualOff 锁定（探测通过也不再自动复活，此前探测每 10 分钟自动启用会让手动关闭失效）；启用清除锁定并立即纳入探测
- **手动探测**：面板按钮触发一轮健康探测（并发 ~6s），显示完成时间与启用/休眠源数；音源 v4.0 新增 probe action
- **休眠状态可见**：快照补 sleeping 字段，连续失败进休眠的源显示「休眠中」
- userApi 注册循环补 toggle/probe 两个 case；i18n 三语言补键

## [v1.9.1-b40 ~ b41] - 2026-10-28

### 修复：音源健康面板状态语义反了
- 音源熔断器语义为 closed=正常放行 / open=熔断 / half-open=半开试探，但面板此前将 closed 显示为红色「熔断」、open 显示为绿色「正常」，导致正常源全被标红、真熔断源被标绿
- 修正状态映射与三语言文案：closed→「正常」(绿)、open→「熔断」(红)、half-open→「半开」(黄，此前缺 key)

## [v1.9.1-b39 ~ b40] - 2026-10-28

### 音源健康面板：数据语义 + 表格自适应（配套音源 v4.0）
- **表格随音源数量自动撑高**：移除内部滚动与 maxHeight 截断，全部子源行直接渲染，整页滚动查看（此前只显示前 10 个源）
- **无样本语义修正**：音源无样本时成功率/均时返回 null，面板显示「-」（此前误导显示 100% / 9999ms）；状态列新增「待采样」（灰）区分无样本与真熔断（红）；健康分无样本显示「-」
- 面板底部加说明文案；音源侧快照补 reqCount/probeCount 样本计数
- 配套音源 v4.0（lx-source.js 已推送）

## [v1.9.1-b34 ~ b35] - 2026-10-28

### 修复：官方版本功能导致启动初始化失败（b32/b33）
- **问题**：b32/b33 安装后启动报 `TypeError: Cannot read property 'toString' of undefined`（初始化失败），发生在组件注册阶段
- **修复①（官方功能）**：官方更新弹窗由「自定义导航 Overlay 弹窗组件」改为 **RN 内置 Alert**（零组件注册、零循环依赖），组件注册表恢复与稳定版一致，彻底排除启动注册期风险
- **修复②（侧边栏遗留）**：`useMyList` 直接修改全局 state 对象 + 过滤后空列表时访问 `_lists[0]` 的隐患，改为返回副本 + 空列表保护
- **修复③（列表恢复）**：`getListPrevSelectId` 赋值 Promise 的隐患，改为直接 await 存储值
- 官方版本显示、弹窗一次去重、设置页静默刷新等功能逻辑不变

---

## [v1.9.1-b30 ~ b31] - 2026-10-28

### 新功能：官方上游版本显示 + 更新提醒（定制版专属）
- 设置 → 软件更新页，在「最新版本/当前版本」下方新增「官方上游」信息行：显示定制版**底座版本**（fork 点 v1.9.1，随上游迭代自动更新）与**官方最新版本**（lyswhut/lx-music-mobile），并标注「已是最新 / 有新版本 ⬆ / 获取失败 / 检测中」
- 官方最新版本检测为**多源并行**（GitHub releases API + jsdelivr 三镜像读官方 package.json），取最高版本；GitHub 不可用时 jsdelivr 兜底，国内可达
- 官方上游发布新版本（官方最新 > 底座版本）时，**启动弹窗提醒一次**：同一官方版本只提醒一次，官方再出新版本才会再次提醒；提醒记录持久化（`@official_version_shown`）
- 官方提醒使用 **RN 内置 Alert 弹窗**（后经 b34 修复确认），仅提示信息，不提供下载（官方包与定制版不同源，不可直接覆盖安装）
- 进入软件更新页会**静默刷新**官方版本（只更新展示，不重复弹窗）
- 多语言同步：zh-CN / zh-TW / en-US

---

## [v1.9.1-b24 ~ b25] - 2026-10-28

### 文档体系完善（第二批）
- 借鉴音源仓库机制：新增 `AGENTS.md`（多账号/多智能体协作入口 + 实证验证链 L0-L4，GitHub AI 工具自动读取）
- `docs/RELEASE_SOP.md` 新增「发布前测试清单」章节（8 项可执行）
- 新增 `docs/KNOWN_ISSUES.md`（已知缺陷/限制编号化 K1-K8）
- 新增 `docs/UPSTREAM_LIFECYCLE.md`（上游依赖增/活/衰/替四阶段管理）
- README 文档索引更新

---

## [v1.9.1-b23] - 2026-10-28

### 设置
- 默认优先音质改为 `flac24bit`（用户指定；其余设置保持默认：缓存 1024 / 音频卸载 / 通知栏歌词 / 通知栏封面开）

---

## [v1.9.1-b15 ~ b22] - 2026-10-27

### 修复
- 修复点击歌曲播放错歌的问题（点击列表歌曲后偶发播放到错误歌曲）
- 修复音源解析问题——回退有问题的改动（音源不可用时不再误报）

---

## [v1.9.1-b12 ~ b14] - 2026-10-27

### 重构
- 深度清理修复：清理冗余迁移代码、补全迁移项、删除冗余代码、补全国际化

### 修复
- 修复 `compareVer` 导入路径错误导致应用打不开
- 桌面歌词默认关闭（需要时手动开启）

---

## [v1.9.1-b9 ~ b11] - 2026-10-27

### 修复
- 修复播放崩溃 bug
- 版本迁移修复
- 来源名称改回原名（显示真实音源名）
- 日志开关 UI（设置页可开关调试日志）

---

## [v1.9.1-b8 ~ b9] - 2026-10-27

### 新增
- 按截图预设默认设置（v2.2 迁移）：优先音质 flac24bit、歌词翻译/罗马音默认开启、允许拖拽歌词调进度、歌词居中、桌面歌词水平/垂直居中
- 新增调试日志收集功能（`common.enableDebugLog`，写文件日志，设置-关于可查看/清空）
- 完善 `MERGE_GUIDE.md`：定制功能清单、设置迁移规则、代码地图、多账号协作说明

---

## [v1.9.1-b5 ~ b7] - 2026-10-27

### 新增
- 设置迁移机制：老用户升级后自动应用新默认值，无需清除数据
- 播放栏加高（封面 60px/按钮 52px）+ 竖屏也显示上一曲按钮
- 进度条拖动默认关闭（设置里可开）
- 播放列表按钮改三横杠样式

### 播放体验
- 点击整列表播放（`list.isClickPlayList` 默认 true）
- 播放列表弹窗（播放页评论按钮改为播放列表，可查看/切换当前列表歌曲）
- 通知栏按钮（移除停止方块按钮、桌面歌词开关按钮改汉字「词」）

### 其他
- 恢复原版设置功能入口（数据同步/备份恢复/其他分组 + 音源/音源名称设置项），随后回退该改动（保持定制版精简设置页）
- 回退"通知栏只停不退出"残留；通知栏歌词默认还原原版行为（默认显示歌词）
- 移除误提交的 node_modules symlink（仓库污染清理）

---

## [v1.9.1-b1] - 2026-10-27 重建定制版（基于原版 fb848072）

按「42 项序号表」一次性合并 28 项功能：

**下载（全新）**
- 完整下载管理器：并行下载（并发可配）、暂停/恢复、失败自动重试、仅 WiFi 下载、自定义下载目录
- 歌曲列表/音质弹窗直接下载（只显示歌曲实际支持的音质），下载完成通知
- 扫描本地下载目录并导入已下载歌曲（自动建「本地音乐」歌单）

**音源**
- 内置豆包定制聚合音源（CI 每次构建自动从 `luanmuc/backend-api` 拉取最新版）
- 自定义音源入口

**播放体验**
- 通知栏显示当前歌词 + 桌面歌词开关按钮
- 听歌统计、定时关闭（侧边栏显示剩余时间）

**界面与设置**
- 设置页改版：竖屏按类型分组，点击进入再展开
- 独立「清理缓存」页：一键/分项清理
- 底部导航新增「下载」页 + 首页默认排行榜
- 协议弹窗、设置迁移机制

**系统与构建**
- 共存包（`com.luanmuc.lxmusic`，可与应用商店版共存）、图标全套
- 在线更新增强：版本多源并行检查、APK 镜像下载、公共下载目录保存、旧包自动清理、完整性校验
- 启动自动更新、屏蔽电池优化、DeepLink 容错、构建版本号（bN）
- 权限三段式引导（<10 普通存储 / 11-12 全文件访问 / ≥13 READ_MEDIA_AUDIO）
- CI 重构、npm 版本信息发布、发布记录与仓库文档

---

## 历史版本

- `v1.9.1`（2026-09-19 及之前）：上游原版版本，变更见 [CHANGELOG.md](./CHANGELOG.md)
