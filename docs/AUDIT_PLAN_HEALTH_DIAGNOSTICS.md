# 音源健康 · 本地诊断深度审计计划与压力测试口径

> 审计对象：App 仓 `lx-music-mobile`，本地诊断闭环（`healthLog.ts` / `healthDiagnostics.ts` / `online.ts` 失败归因 / `Health.tsx` / 三语文案 / 文档与 workflow）。
> 本轮基线：历史起点 `a02db1af`；2026-11-13 当前复核提交 `e41d0d15`（已 push；b116 已发布），`check_health_diagnostics` 51/0、`check_health_diagnostics_deep` 51/0、`check_health_diagnostics_stress` 14/0、`check_health_diagnostics_view` 22/0、`check_log_directory` 15/0。
> 原则：不是「跑一遍不崩」，而是逐分支验证统计口径、窗口语义、异常规则、隐私边界和大数据行为。

## 1. 审计目标

本地诊断回答的是「这个音源到底坏没坏」。它必须同时满足：

1. **数值可信**：成功按 1/5 采样落盘，聚合必须还原真实成功率；任何派生的趋势/异常比较也不得回到原始条数。
2. **归因正确**：失败必须绑定真实 `sourceId`；没有归因证据时宁可少报，不得把 `platform` 冒充成源。
3. **窗口诚实**：`1h/24h/7d` 是否覆盖由全量事件最早时间戳判定；覆盖不足必须降级文案，不能把 2 小时说成 7 天。
4. **异常可复核**：每条 finding 有 evidence、traceId、最多 5 条 samples，且总条数有上限。
5. **隐私不回退**：证据包、日志尾部、嵌套 `sourceEvents` 都不出现 URL、歌名、歌手、搜索词。
6. **规模可控**：10 万条事件、2 万条证据包、5MB 日志不崩、不越界、不无限增长。
7. **UI 有兜底**：分享失败回退复制摘要；异常可展开；空报告仍给操作引导。

## 2. 代码清单与分支映射

### 2.1 `src/core/healthDiagnostics.ts`

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

### 2.2 `src/core/healthLog.ts`

| 代码单元 | 分支/边界 | 审计 ID |
| --- | --- | --- |
| `trimJsonlTail` | ASCII / 多字节 UTF-8 / CRLF / 恰好上限 / 单行超限 | F1、F2、F9 |
| `buildPlayResultEntry` | 空串省略 / NaN 省略 / 负权重省略 / 延迟取整 / 权重 1 | F3、F4 |
| `parseHealthLines` | 坏 JSON / 数组 / null / event 非字符串 / CRLF | F5 |
| `isExpiredHealthFileName` | 非法文件名 / 7 天边界 / 8 天前 | F6 |
| `shouldSampleSuccess` | 0 / 0.049 / 0.05 / 0.999 | F7 |
| `createHealthTraceId` | 格式 / 2000 次唯一性 | F8 |
| `healthFileName` / `buildExportFileName` | 日期、时分秒、无设备/账号 | F10 |
| `trimTailByBytes` | 纯中文 / 代理对 / 超字节上限 | F11 |
| `appendHealthEvent` / `readRecentHealthEvents` | 5MB 截尾 / 多日合并 / RN 依赖缺失；父目录整体删除后逐级重建 | 既有压力 U2、U3、U5；契约 H28 |
| `ensureHealthLogsDir` | 打开诊断页确保目录存在，不依赖下一次播放 | H28 |
| `recordPlayResult` | 失败 100% / 成功 1/5 / 失败抓 sourceEvents；缓存命中单独 `cache_hit` | 契约 H11、H15 + 压力 U9~U12 |

### 2.3 其它改动面

| 文件 | 代码/契约 | 验证 |
| --- | --- | --- |
| `src/core/music/online.ts` | 失败分支 `sourceId = err.sourceId ?? err.detail[0].source` | H15 源码切片 + 本计划 §6 未覆盖项 |
| `Health.tsx` | 20000 读取上限、truncated、复制摘要、分享失败回退、样本展开；最近异常窗口按“可信度→总体→错误码→其他线索”分层并默认折叠，展示逻辑收敛到 `healthDiagnosticsView` | H14/H18/H19/H27/H29 + 视图 22 条 |
| `src/lang/*.json` | `health_copy_report` / `health_copy_done` 以及 17 个 `health_diag_*` 三语 | docs-audit 893 键 |
| `docs/AGENTS.md` 等 | 31→41 条（H22/H23 锁趋势单一来源/日志死 API，H24~H26 锁无基线不报新码/同码不重复/未加权样本提示，H27 锁窗口分层与折叠，H28 锁公共目录优先/私有日志回迁/目录逐级重建/任一分类写日志时补齐四类固定日志，H29 锁缓存命中独立计数）、采样/覆盖/证据口径 | `check_docs_consistency`、`docs-audit --dry-run` |

## 3. 断言矩阵（51 条）

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
| D9 | 30min + truncated | d7 false；summary 含“仅覆盖最近”和“1/5” |
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
| F7 | 采样边界 | 0/0.19 采，0.2/0.999 不采 |
| F8 | traceId | 2000 个唯一且格式稳定 |
| F9 | 恰好上限 | 完整行不被丢弃 |
| F10 | 文件名 | 日期/时分秒正确，无账号设备 |
| F11 | 诊断日志尾 | UTF-8 字节≤上限、不切断中文、无替换符 |
| G1 | 10 万条聚合 | ≤2000ms，结果有限 |
| G2 | 10 万条报告 | ≤3000ms，findings≤12 |
| G3 | 2 万条证据包 | ≤4000ms，可 JSON 序列化 |

### 3.1 视图模型审计（20 条）

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

### 3.2 日志目录审计（13 条）

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

## 4. 压力维度与阈值

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

## 5. 审计发现（本轮真实修复）

| ID | 级别 | 现象 | 根因 | 修复 | 复验 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 高 | 多字节日志按字符数截尾，2000 字节上限实际写出 4619 字节 | `trimJsonlTail` 用 `line.length` 而非 UTF-8 字节 | 新增 `utf8Bytes`，按 UTF-8 累计，代理对按 4 字节 | F1 复验 `bytes=1959 ≤ 2000` |
| F-02 | 中 | 大写 `HTTPS://`、`FTP://`、`file://` 不被脱敏 | URL 正则只匹配小写 `http(s)` | 改为 `(?:https?\|ftp\|file)://` + `gi` | E5 复验全部 `[url]` |
| F-03 | 高 | 证据包 `events.sourceEvents[].reason` 可带 URL/歌名原样导出 | 只脱敏 `logTail`，events 仅浅拷贝 | 新增递归 `redactValue`，深度/数组双上限，导出前清洗 events | E7 复验无 URL/歌名，E8/E9 确认不改原对象 |

> 审计夹具自纠：D6/D7/D10 首轮失败不是实现问题，而是夹具把“窗口内最早事件”误当成覆盖基准。修正后明确：`covered` 看全量最早事件，不看窗口内样本。

## 6. 未覆盖与残余风险

1. **真机桥透传**：`err.detail[0].source` 能否真正从 `lx-source.js` 穿过 RN 桥到 `online.ts`，仍需设备实测；本轮只有源码切片（H15）与源仓对象形态证据。
2. **RN 运行时 I/O**：`appendHealthEvent` / `readRecentHealthEvents` 的真实文件系统、并发追加、分享 Intent 无法在 Node 中执行；本轮验证的是纯函数、截尾算法与依赖缺失降级。
3. **UI 运行时**：`Health.tsx` 的展开/复制/分享回退只做静态契约，未做真机点击。
4. **设备级 S 组**：按用户既定口径不列入本轮待办（真机横竖屏、通知栏、批量下载等）。

## 7. 执行命令与退出标准

```bash
# 深度审计压力（51 条）
node scripts/check_health_diagnostics_deep.js

# 既有契约/压力回归
node scripts/check_health_diagnostics.js          # 51/0
node scripts/check_health_diagnostics_stress.js   # 14/0
node scripts/check_health_diagnostics_view.js     # 22/0
node scripts/check_log_directory.js               # 15/0

# 仓库门禁
node scripts/check_ts_syntax.js                   # 525 文件 0 错误
node scripts/check_source_config_contract.js      # 25/0
node scripts/check_source_platform_label.js       # 9/9
node node_modules/typescript/bin/tsc --noEmit     # rc=0
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx  # rc=0
node scripts/check_docs_consistency.js            # 17 文档
node scripts/docs-audit.js --dry-run              # 待处理 0
```

退出标准：上述命令全部 rc=0；健康契约 51/0；深度审计 51/0；诊断压力 14/0；视图 22/0；日志目录 15/0；配置契约 25/0；音源契约 14/0；无新增隐私字段、无新增网络出口、无未解释的文档计数漂移。
