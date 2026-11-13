# App 仓库审计计划（活文档 · v2 全维度）

> 基线版本：审计起点 **v1.9.2-b99**（HEAD `a6767fa1`，versionCode 258）；当前发布 **v1.9.2-b115**（tag `8f53b502`，Release `442636986`；上一发布 b114；原审计轮为 b74 / `20ac0519`）
> 最近更新：2026-11-13（源仓 v8.13.0 已本地提交 源仓当前单提交；App 本地提交 当前单提交，ahead 1；b115 仍为最近构建且内置 v8.12.5，b116 已发布；TS/TSX 526；全量门禁复跑）
> 前次：2026-11-09（跨仓契约复审 + 一键更新流程整改）、2026-11-07（b74 审计轮）
> **当前真值**：三语各 **893 键**、TS/TSX **525 文件**、`tsc --noEmit` **0 error**、`eslint .` **0 error / 0 warning**、源仓音源 **v8.13.0（已 push；b116 内置 v8.13.0）**、App HEAD **`e41d0d15`（已 push；b116 已发布）**、11 个 action、持久化 **13/0**、行为模块导出函数 **83/83**。
> **历史快照**：A–S 组的状态与计数保留 2026-11-07 审计当时结论（730 键 / b78 / TS 57→14 等）；当前以 `scripts/docs-audit.js`、`docs/SYNC_POINTS.md` 与文末 **T 组** 为准。
> 维护规则：每轮版本迭代更新维度状态；新增功能加维度；发现问题记入对应轮次的审计报告并把状态改为 ⚠️。

---

## 为什么要有 v2

v1 计划的 39 个维度全部标记 ✅，但 b68–b74 之间仍然连续暴露了 6 类运行时缺陷：启动 NPE 崩溃、`initial()` 不可自愈、`Buffer.byteLength` 会崩、`migrateDownloadDir()` 从未执行、下载状态中文落盘、`trimToBytes` 字节截断错误。

**结论：v1 的方法是「读代码确认存在」，只能证明功能写了，不能证明运行时真的会跑。** v2 改为按「可达性 + 运行时后果」审，并新增 12 个 v1 完全没有覆盖的角度（见下方 H–S 组）。

## 证据分级（每一条结论必须标注等级）

| 级别 | 含义 | 手段 | 能证明什么 |
|---|---|---|---|
| L0 | 静态/类型 | `tsc --noEmit`、ESLint（**只看 TS2304/TS2551 这类真错误**，不看风格类） | 有没有未定义符号、属性名是否写错 |
| L1 | 结构契约 | 键对齐脚本、引用完整性、依赖 sha 比对、语言文件重复键检测 | 声明与消费是否闭合 |
| L2 | 运行路径 | 谁调用、何时渲染、异常是否被 catch 吞掉、默认值是否生效 | **这段代码在运行时会不会被走到、走到会怎样** |
| L3 | 产物 | APK 解包（bundle 用 UTF-16LE 查中文、dex 查原生符号） | 改动是否真的进包 |
| L4 | 设备 | 实机安装/权限流/横竖屏/批量下载 | 用户实际看到什么（本轮未做，单列 📝） |

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ | 已按 L0–L3 审计，无问题 |
| ⚠️ | 已审，发现问题（编号见 `AUDIT_REPORT-2026-11-07.md`；**本轮 15 处已于 b75 修复，明细见文末「修复记录」**） |
| 📝 | 待审 |
| 🧪 | 需设备实测，未做 |

---

## A 组：播放核心（v1 已覆盖，v2 复核）

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| A1 | 播放器核心 | ✅ | 播放/暂停/切歌链路正常；`initial()` 已改 try/catch/finally，异常不再卡死 |
| A2 | 音源调用链路 | ⚠️ | **R1**：`core/music/utils.ts:326` 使用未导入的 `getStoreMusicSource`，缓存命中分支会 ReferenceError |
| A3 | 音质协商 | ✅ | 降级链与错误码中文化完整 |
| A4 | 歌词/封面 | ⚠️ | **R11**：`core/music/local.ts:173` 裸用 `Buffer`（Hermes 无全局 Buffer），带 awlrc 标签的本地歌词会崩 |
| A5 | 错误处理 | ✅ | `formatPlayError` + 聚合失败摘要完整 |
| A6 | 网络层封装 | ✅ | `utils/request.js` 统一超时/错误码 |
| A7 | 后台播放 | ✅ | 焦点三开关链路复核通过（见 I 组） |
| A8 | 耳机线控 | ✅ | 由 fork 原生 MediaSession 提供 |

## B 组：音源管理

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| B1 | 健康面板 | ⚠️ | **R5/R6**：`c-font-1`/`c-border-1` 非法主题键；`playDead` 属性恒 undefined |
| B2 | 自定义音源导入 | ⚠️ | **R4**：`importUserApi` 无返回值，`Source.tsx` 读 `.id` 必抛 TypeError，「一键更新」失效 |
| B3 | 音源标签 UI | ✅ | `PlayQualityTag` 渲染正常（但文案硬编码见 L 组 R10） |
| B4 | 音源日志 | ✅ | 竞速打点与失败明细完整 |
| B5 | 预加载脚本一致性 | ✅ | `user-api-preload.js` 11 个 action（含 healthEvents/exportHealthState/restoreHealthState）与 `userApi` switch 同步 |
| B6 | 健康面板新增功能 | ⚠️ | 功能存在，配色缺陷同 R5 |
| B7 | 配置热更新校验 | ✅ | 音源侧白名单校验 |

## C 组：状态与存储

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| C1 | 设置项完整性 | ✅ | L1 脚本：`defaultSetting` 75 键**全部**有真实消费点；"消费但未声明"的 5 个键全部落在注释/迁移代码，非活代码 |
| C2 | 本地存储 | ✅ | `plugins/storage` 本地化，无外传 |
| C3 | 数据迁移 | ⚠️ | K25 已修（迁移可执行）；**R8** 重启恢复未清 `statusKey` |
| C4 | 状态管理 | ✅ | store/download 事件刷新链路完整（`updateItem`→`emit`→`hook`） |

## D 组：UI 与交互

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| D1 | 侧边栏 | ✅ | 入口齐全 |
| D2 | 播放页 | ⚠️ | **R2**：`PlayDetail/Horizontal/Player/PlayInfo.tsx:61` 组件内 `theme` 未定义，横屏播放页渲染即 ReferenceError |
| D3 | 弹窗 | ⚠️ | **R5**：健康面板弹窗配色；**R9** 管理器层弹窗中文硬编码 |
| D4 | 主题适配 | ⚠️ | 除 R5 两个非法键外，其余 `theme[...]` 引用合法 |
| D5 | 多语言 | ✅ | 页面层 + 管理器层 + 定制组件已全部接 i18n（审计当时 730×3；当前 893×3）；`Health.tsx` 参数面板已接三语（37 键，v8.12.1），无遗留 |
| D6 | 组件复用 | ✅ | common/ 公共组件 |

## E 组：文档与工程

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| E1 | 编码规范 | ✅ | 与实际一致 |
| E2 | KNOWN_ISSUES | ✅ | K1–K25 编号化，K25 已修待发布验证 |
| E3 | 音源指南 | ✅ | 协议与实际一致 |
| E4 | 发布 SOP | ✅ | bN/versionCode 规则与 CI 一致 |
| E5 | AGENTS 协作规范 | ✅ | TS 文件数已纠正为 514 |
| E6 | 变更日志 | ✅ | b74 已记入 |

## F 组：原生与性能

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| F1 | Android 原生层 | ✅ | Manifest/Service/Receiver/资源齐全 |
| F2 | CI 编译 | ✅ | `buildNumber` 由 CI 覆盖写入，本地为空 |
| F3 | 启动速度 | ✅ | 初始化顺序合理 |
| F4 | 包体积 | ✅ | 与官方版相当（用户已确认关闭） |
| F5 | 内存与性能 | 📝 | 未实测（用户已知情并接受） |

## G 组：安全与合规

| # | 维度 | 状态 | v2 复核结论 |
|---|---|---|---|
| G1 | 权限申请 | ⚠️ | 时机正确；**R13/R15**：自定义目录仅 `mkdir` 不验可写；SAF 选目录仍需「所有文件访问」 |
| G2 | 数据隐私 | ✅ | 全部本地存储 |
| G3 | 第三方 SDK | ✅ | 无冷门 SDK；`@craftzdog/react-native-buffer` 仅作 metro alias，未注入全局（见 R11） |

---

## H 组：定制代码自身正确性（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| H1 | 符号/导入完整性 | ⚠️ | 以 `tsc` 的 TS2304 为线索反查：**R1**（utils.ts）、**R2**（PlayInfo.tsx） |
| H2 | 属性名正确性 | ⚠️ | 以 TS2551 为线索：**R3**（`temporaryDirectoryPath` 拼错 ×3）、**R5**（非法主题键） |
| H3 | 静默失败 | ⚠️ | `catch(e){}` 集中在 `unlink/stopDownload`（可接受）；`migrateDownloadDir` 外层空 catch 曾吞掉 ReferenceError（K25 已修），**建议补日志** |
| H4 | 空值/undefined 字面量 | ✅ | 文件名模板已加 `?? ''`；未再发现 `undefined` 落盘 |
| H5 | 返回值契约 | ⚠️ | **R4**：`importUserApi` 声明 void，消费方当有返回值用 |

## I 组：桥接与原生契约（v1 仅"目录存在"级）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| I1 | JS↔Java 符号一致 | ✅ | `handleAudioFocus/autoResumeAfterInterrupt/duckOnTransientDuck` 三键在 `setupPlayer` 与 `MusicManager` 一一对应 |
| I2 | 初始化时序与判空 | ✅ | b69/b70 的 `MetadataManager` 四处判空 + `setNotificationRepeatMode` 启动同步包 `isInitialized()` 均有效 |
| I3 | 通知栏能力 | ✅ | 5 个实际按钮与图标密度齐全（v1 结论复核） |
| I4 | 音频焦点实现 | ✅ | media3 内置焦点恒关；`requestAudioFocus/abandonAudioFocus` 均有 `handleAudioFocus` 早退；子开关在主开关关闭时被强制 false |
| I5 | Duck 音量还原 | ✅ | `volumeBeforeDuck` 记录再还原，不再写死 1.0 |

## J 组：依赖与运行时兼容（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| J1 | fork sha 锁定一致性 | ✅ | `package.json`×1 + `package-lock.json`×2 共 3 处一致，当前为 `a0b2a87`（审计当时 `eceacb5`，更早 `5bff17b`；b75 升级为拿到 quality/subSource 类型，b78 升级为取审计修复） |
| J2 | Hermes 兼容（Node API） | ⚠️ | **R11**：`Buffer` 裸引用 2 个文件；`Buffer.byteLength` 类问题已在 b73 消除 |
| J3 | JSON 解析健壮性 | ✅ | `officialVersion` 等解析点均有 try/catch |
| J4 | 产物一致性 | ✅ | 每版 APK 解包校验键/中文值 |

## K 组：权限与路径安全（v1 只审"有没有申请"）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| K1 | 路径拼接 | ✅ | 下载路径统一 `dir/fileName`，文件名经非法字符替换 + 100 字节截断 |
| K2 | URI→路径还原 | ⚠️ | **R15**：只认 `com.android.externalstorage.documents`，且还原成裸路径后仍需「所有文件访问」 |
| K3 | 权限判定健壮性 | ⚠️ | **R14**：权限错误靠中文子串 `includes('权限')` 分类，i18n 化后会失效 |
| K4 | 可写性验证 | ⚠️ | **R13**：`getDownloadDir` 对自定义目录只 `mkdir`，不验证可写 |
| K5 | 空间与上限 | ✅ | 下载前 `checkFreeSpace`，日志 512KB 上限 |

## L 组：i18n 全链路（v1 只查"键数对齐"）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| L1 | 键对齐/重复键/占位符 | ✅ | **730×3** 对齐、无重复键；占位符脚本核对 0 缺失（1 处为检查器误报，已人工确认） |
| L2 | 页面层覆盖 | ✅ | 下载页 65 处 + 状态 9 键已接 |
| L3 | 管理器层覆盖 | ✅ | **已修**：权限/覆盖确认弹窗、toast、异常文案全部接 i18n（新增 9 键） |
| L4 | 其他定制组件覆盖 | ✅ | **已修**：4 个组件 + 音源更新流程全部接 i18n；Health 参数面板已接三语（37 键，v8.12.1），无遗留 |
| L5 | 原生层文案 | ✅ | 通知栏文案来自 JS，无原生硬编码 |

## M 组：状态机与持久化（v1 只查"字段有没有"）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| M1 | 状态字段组合一致性 | ✅ | **已修**：13 处 `status` 变更全部补齐 `statusKey`（等待/暂停/失败/重试），重启恢复同时清 `error`/`speed` |
| M2 | 重启恢复 | ⚠️ | 同 R8；另启动即 `void startNext()`，无权限时可能开机就弹权限框（观察项） |
| M3 | 幂等性 | ✅ | `migrateDownloadDir` 幂等（已迁移文件不再搬） |
| M4 | 原子写 | ✅ | `.part` 临时文件 → 完成后移动，正式目录不留半成品 |

## N 组：并发与竞态（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| N1 | 并发上限 | ✅ | `MAX_TASK_LIMIT` 限制同时任务数，`startNext` 串行取任务 |
| N2 | 暂停/恢复/重试竞态 | ✅ | 进度回调对 `pause` 有守卫；`activeJobs` 按 jobId 管理 |
| N3 | 缓存命中分支 | ⚠️ | **R1** 正是这条分支的缺陷 |

## O 组：主题与视觉可达性（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| O1 | 主题键合法性 | ✅ | **已修**：`c-font-1 → c-font`（3 处）、`c-border-1 → c-border-background` |
| O2 | 对比度/暗色可读性 | ⚠️ | 同 R5；进度条对比度已在 b74 提升（6px + 轨道 35%） |
| O3 | 窄屏/长文案 | 🧪 | 英文/繁体长标签排版未实机验证 |
| O4 | 小图标辨识 | ✅ | 模式图标矢量化已判定收益不足并关闭（用户确认） |

## P 组：破坏性操作与数据丢失（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| P1 | 文案与行为一致性 | ✅ | **已修**：改为只清列表、不删文件（删文件走 `removeDownload`） |
| P2 | 覆盖/替换 | ✅ | 覆盖前弹确认，支持「跳过/替换/全部替换」 |
| P3 | 迁移搬文件 | 🧪 | K25 修复后首次真迁移，需实机确认文件归位且记录同步 |

## Q 组：启动与生命周期（v1 未覆盖）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| Q1 | 冷启动链路 | ✅ | b69/b70 加固后启动不再 NPE；`isReady()` 守卫覆盖 13 个封装函数 |
| Q2 | 双通道日志 | ✅ | **已修**：3 处改为 `RNFS.TemporaryDirectoryPath`，私有通道恢复可用 |
| Q3 | 进程被杀后的任务恢复 | ⚠️ | 同 R8 |
| Q4 | 批量下载完成通知 | ✅ | 通知开关与 toast 逻辑完整（管理器层中文见 R9） |

## R 组：文档与基线一致性（v2 自动化）

| # | 维度 | 状态 | 结论 |
|---|---|---|---|
| R1 | 镜像基线（键数/TS 数/底座版本） | ✅ | `node scripts/docs-audit.js` 三项全绿（730 键 / b78 / `a0b2a87`） |
| R2 | CI 触发条件认知 | ✅ | docs-audit 仅 schedule + dispatch，push 不跑（本轮已记录） |
| R3 | 审计报告归档 | ✅ | 每轮结论写入 `docs/AUDIT_REPORT-YYYY-MM-DD.md` |

## S 组：设备级验收（唯一未做的层级）

| # | 维度 | 状态 | 说明 |
|---|---|---|---|
| S1 | 首次安装 vs 覆盖升级 | 🧪 | 未做 |
| S2 | 权限流（拒绝/授予/撤销） | 🧪 | 未做 |
| S3 | 横竖屏切换 | 🧪 | R2 修复后需实测横屏播放页 |
| S4 | 批量下载/暂停/恢复/清空 | 🧪 | 未做 |
| S5 | 长中文名/emoji 文件名 | 🧪 | 逻辑已复算，未实机 |

---

## 覆盖矩阵：v1 的 39 维 → v2

| v1 组 | v1 维度数 | v2 状态 | 新增覆盖 |
|---|---|---|---|
| A 播放核心 | 8 | 复核，2 处 ⚠️ | 无（v2 加深到运行路径） |
| B 音源管理 | 7 | 复核，3 处 ⚠️ | 返回值契约 |
| C 状态与存储 | 4 | 复核，1 处 ⚠️ | 状态字段组合一致性 |
| D UI 与交互 | 6 | 复核，4 处 ⚠️ | 主题键合法性、i18n 管理器层 |
| E 文档工程 | 6 | ✅ | 自动化基线镜像 |
| F 原生性能 | 5 | ✅ / 1 📝 | — |
| G 安全合规 | 3 | 复核，2 处 ⚠️ | 路径/URI/可写性 |
| **H 定制代码正确性** | 新增 5 | ⚠️ 3 | 符号导入、属性名、返回值 |
| **I 桥接契约** | 新增 5 | ✅ | 符号/时序/焦点/音量 |
| **J 依赖与兼容** | 新增 4 | ⚠️ 1 | Hermes Node API |
| **K 权限与路径** | 新增 5 | ⚠️ 3 | 可写性/URI/判定健壮性 |
| **L i18n 全链路** | 新增 5 | ⚠️ 2 | 管理器层/定制组件 |
| **M 状态机与持久化** | 新增 4 | ⚠️ 1 | 重启恢复、原子写 |
| **N 并发与竞态** | 新增 3 | ⚠️ 1 | 缓存命中分支 |
| **O 视觉可达性** | 新增 4 | ⚠️ 2 | 主题键、对比度 |
| **P 破坏性操作** | 新增 3 | ⚠️ 1 | 文案≠行为 |
| **Q 启动与生命周期** | 新增 4 | ⚠️ 2 | 日志双通道 |
| **R 文档自动化** | 新增 3 | ✅ | 脚本巡检 |
| **S 设备验收** | 新增 5 | 🧪 | 待实机 |

**统计**：v1 39 维 + v2 新增 12 组 **50 维** = **89 维**；本轮发现 ⚠️ **15 处**（R1–R15），**已全部修复**（TS 错误 57→14，键数 697→730），🧪 设备级 5 维待实测。

## 版本迭代更新规则

1. 新增功能 → 在对应组新增维度，标记 📝，并写明「消费点在哪、异常如何兜底」。
2. 修问题 → 维度改 ✅，并在审计报告标注「已修 + 版本号」。
3. 任何"只读代码确认存在"的结论，必须补一句**运行时可达性判断**（谁调用/何时渲染/异常是否被吞），否则不算审过。
4. 发版前 → 更新顶部基线（版本 + 代码 commit + 文档 commit）。

---

## 修复记录（2026-11-07 · b75）

| 编号 | 修复内容 | 文件 |
|---|---|---|
| R1 | 补 `getStoreMusicSource` 导入 | `core/music/utils.ts` |
| R2 | 默认导出组件补 `const theme = useTheme()` | `PlayDetail/Horizontal/Player/PlayInfo.tsx` |
| R3 | `RNFS.temporaryDirectoryPath` → `TemporaryDirectoryPath`（3 处） | `utils/logger.ts`、`utils/log.ts` |
| R4 | `importUserApi` 补 `return info`（类型变为 `Promise<UserApiInfo>`） | `core/userApi.ts` |
| R5 | 非法主题键改合法键 | `Setting/settings/Health.tsx` |
| R6 | `HealthItem` 补 `playDead`/`rateLimited` 字段（音源快照确实提供） | 同上 |
| R7 | 「清空已完成」改为只清列表 | `core/downloadManager.ts` |
| R8 | 13 处状态变更补齐 `statusKey`，重启恢复清 `error`/`speed` | 同上 |
| R9 | 权限/覆盖弹窗、toast、异常文案接 i18n（新增 9 键） | 同上 |
| R10 | 4 个组件 + 音源更新流程接 i18n（新增 13 键） | `QualitySelect`/`MultipleModeBar`/`ListMenu`/`DrawerNav`/`Basic/Source.tsx` |
| R11 | 显式 `import { Buffer } from 'buffer'` | `core/music/local.ts`、`plugins/sync/client/auth.ts` |
| R12 | 封面下载加 10s 超时并 `stopDownload` | `core/downloadManager.ts` |
| R13 | 自定义下载目录写探针验证可写 | 同上 |
| R14 | 改用错误码分类（`makeError`），不再依赖中文子串 | 同上 |
| R15 | 目录选择说明补充「仍需所有文件访问」 | `lang/*` |

### 本轮顺带修掉的类型契约缺口（审计时新增发现）

- `Health.tsx`：`getQuerier` 的 action 联合类型补 `'trend'`（音源 v8.0 已实现该 action，App 侧只漏了类型）；趋势历史显式声明类型，消除 3 处隐式 any；补 3 个图例样式（此前只引用未定义）；`Button` 移除无效的 `size`/`type` 属性
- `types/user_api.d.ts`：`UserApiSourceInfoActions` 补 `health|toggle|probe|config|trend`
- `types/app_setting.d.ts`：补 `common.enableDebugLog`（`defaultSetting` 有、声明缺失）
- `core/init/index.ts`、`utils/nativeModules/userApi.ts`：`logger.warn` 第三参数被签名丢弃 → 改成模板串，保留失败原因


## O 组：语义契约与展示层一致性（2026-11-08 新增）

> 来源：第二轮全覆盖审查（听歌统计缺陷暴露）。本组不是新增"领域"，而是给已有 L 组（i18n 全链路）
> 与 M 组（状态机与持久化）补上**可操作判据**——原判据过宽，执行时退化成"键数对齐"。

### 触发案例（2026-11-08）

听歌统计：侧边栏文案是「今日 {today} 次 · 时长 {time}」，实际传的是累计 `playTime`。
类型全对（都是 number）、40 条文档规则全绿、`check_ts_syntax` 0 错误——**功能是错的**。

### 根因：判据太宽，执行时被简化

原计划里的 i18n / 状态机 / 持久化 组，执行时被落成"键数对不对""字段有没有"，没有落到
"文案说的意思 **vs** 数据实际的意思"。这类缺陷在单文件纵向读时处处自洽，只有横向穿才看得见。

### 三条硬判据（改动 UI 展示 / 统计 / 配置时必须过）

1. **文案 ↔ 字段横向穿**：每个带参 `t()` 填五行表
   `文案键 → 占位符 → 传入表达式 → 字段定义 → 写入点`，任一处语义不符即缺陷。
   易错语义词：今日/累计/剩余/总数/上次/平均/速度/已下载/本次/总时长。
2. **类型正确不算通过**：`playTime` 与 `dayTime` 都是 number，编译器不会警告；
   必须人工确认"这个数字语义上是不是文案要的那一个"。
3. **"改过"不等于"审过"**：注释里的"已修正"只证明被碰过一次，不证明展示层被审查过。

### 三类假阳性（写报告前必须过滤，否则制造假缺陷）

| 假阳性 | 成因 | 过滤方法 |
|---|---|---|
| 文案占位符"缺参" | 脚本不认 ES6 属性简写 `{ name }` | 回读源码确认调用形态 |
| "设置项没人读" | 正则漏 `useSettingValue('...')` / 动态 key | 用短名全仓 grep 复核 |
| "导出零引用=没接线" | 可能是有意保留的上游死代码 | `git log -S '<符号>'` 回查引入提交再定性 |

### 一条跨仓新判据

**依赖版本"落后"不等于"有问题"**：App 锁定 fork sha 落后 9 个提交，需先看这 9 个提交的性质
（本例全为 docs/hooks，零代码变更 → 无风险），不能只比较 sha 差异就判缺陷。

### 本轮实跑结果（作为基线）

- 带参 `t()` 共 **73 处**，逐条横向穿 → 0 个 🔴；2 个 ⚪（`ScriptImportOnline.tsx:100` 硬编码英文、`Comment/Header.tsx:35` 冗余传参）
- 12 处「文案缺参」脚本告警 → **全部假阳性**（ES6 短写）
- 设置项 75 个：默认值 ↔ 类型声明双向差集为空；7 个"无人读"候选全为假阳性
- 定时器 12 处：1 个 🟡（`DrawerNav.tsx:84` / `About.tsx:34` 30s 刷新 < core 10s 结算）→ **已修复为 10s 同频**

### 复核命令

```bash
# 带参 t() 全表（脚本见本轮审查记录；核心是抓 t('key', {...}) 并解第一层 kv）
grep -rn "t('[a-z_]*', {" src --include=*.tsx | wc -l
# 文案占位符来源
python3 -c "import json;print(json.load(open('src/lang/zh-cn.json'))['drawer_stats_today'])"
# 设置项三处一致
grep -c "':" src/config/defaultSetting.ts; grep -c "':" src/types/app_setting.d.ts
```

---

## M 组：与音源仓契约（2026-11-09 新增，跨仓复审）

前五轮审计都在音源仓内部做，App 侧只在 `AUDIT_REPORT-2026-11-07.md` 里审过一次，且那次之后音源仓改了三轮（v8.11.0 验真闸门、v8.11.1 D-20/D-21、面板 rateLimitActive）。**音源侧改了，App 侧有没有跟上，之前没人查过。**

### 审计范围（三处，不是全仓 514 文件）

| 面 | 入口 | 判据 |
|---|---|---|
| 健康快照字段 | `Health.tsx` 的 `HealthItem` | App 读的每个字段音源必须提供；无幻读 |
| action 契约 | `core/init/userApi/index.ts` 的 `case health/toggle/probe/config/trend` | 与音源 `actions` 声明一致，参数名一致 |
| 一键更新流程 | `Basic/Source.tsx` L152–175 | 顺序、失败回退、异常吞并 |

### 结果

| 项 | 结论 | 证据级别 |
|---|---|---|
| 字段对照 | 音源给 18 字段，App 声明 13，**差集为空** | L1 结构 + L2 运行 |
| `playDead` 幻读（R6） | 已消除，音源现提供该字段 | L1 |
| `healthScore < 0` 判据 | **实测 -4.5 可成立**，非死判据 | L2 实测 |
| `trend` 上限注释 | 写「60 条」，音源已改 144 → **D-23** | L1 |
| 一键更新顺序 | 「导入新 → 删旧 → 切新」，切源失败时旧源已删 → **D-24** | L2 走查 |
| `await setApiSource(...)` | `setApiSource` 是同步函数，await 无效 → **D-25** | L0 类型 |
| R1/R4/R5/R6 | 回代码核实，四条都真修 | L0/L1 |
| 错误码映射 | 音源抛 12 码，App 只映射 6 个，且 `NETWORK_TIMEOUT`/`RATE_LIMIT` 两个码名对不上 → **D-27**（英文码直接给用户） | L1 |

### 一条硬判据（跨仓场景通用）

**字段名对得上 ≠ 语义对得上，枚举值集合也要对。**

> 2026-11-09 补：D-27 就是这一条的另一半。字段（`HealthItem`）对上了，但音源抛的 12 个
> `ERROR_CODES` 里 App 只认 6 个，且 `NETWORK_TIMEOUT` / `RATE_LIMIT` 连码名都不同——
> `FAIL_CODE_ZH[code] || code` 把英文码直接显示给用户。**核对跨仓契约时，字段、枚举、默认值、单位，四样都要对。**
 本轮 `healthScore` 从 0~1 改 0~10 分制，App 用 `< 0` 判异常——如果只核对"字段存在"，会认为没问题；如果只按"0~10 分制"推断，会认为判据恒假。**两个推断都错**，必须实测取值范围。

### 复核命令

```bash
# 字段对照
grep -n "interface HealthItem" -A 20 src/screens/Home/Views/Setting/settings/Health.tsx
grep -n "rateLimitActive:" -B 30 ../lx-music-source/lx-source.js | grep -oE "^\s+[a-zA-Z_]+:" | tr -d ' :'
# action 契约
grep -n "case 'health'\|case 'toggle'\|case 'probe'\|case 'config'\|case 'trend'" src/core/init/userApi/index.ts
# 限流优先级
grep -n "rateLimitActive" src/screens/Home/Views/Setting/settings/Health.tsx
```

### 已知限制

App 仓无测试基建（上游项目状态），本组结论全部是 **L0/L1/L2 代码走查 + 局部实测**，没有 APK 产物级（L3）和设备级（L4）证据。不因为"审过了"而升级证据级别。

---

## T 组：v8.12.x 跨平台标签与工程质量门禁（2026-11-11 新增）

> 本轮不是新增业务领域，而是补两类此前没有进入审计面的东西：
> ①跨平台兜底后「实际交付平台」在 App 侧的透传与展示；②tsc/eslint/跨仓版本这三道新门禁是否真的守得住。
> 判据一律按「消费端能观测到什么」写，不按「代码里有没有这个字段」写。

| # | 维度 | 判据（消费端可观测） | 落地检查 | 证据级 |
|---|---|---|---|---|
| T1 | `sourcePlatform` 全链路透传 | 源仓返回 `sourcePlatform=tx` 时，preload → userApi → music/utils → online → player store → 播放页/通知栏，任一环丢失即缺陷 | `node scripts/check_source_platform_label.js` L1~L3 | L1/L2 |
| T2 | 实际平台优先于主平台 | 跨平台交付时标签显示 `QQ音乐 · Juhe`，不得显示主平台「酷我音乐」；旧音源无字段时回退主平台 | 同上 L4/L5 行为矩阵 | L2 |
| T3 | 标签拼装与未知平台回退 | `buildSourceLabel` 对空平台/空子源/平台=子源/未知平台四种输入都不产生 `undefined`、双分隔符或空串标签 | 同上 L4/L5 行为矩阵 | L1 |
| T4 | 全链路枚举闭合 | 7 个已知平台（all/bd/kg/kw/mg/tx/wy）都有 i18n key；`local` 不显示平台；未知值回退原 id 而不是空串 | `getPlatformNameKey` / `resolvePlatformName` 断言 | L1 |
| T5 | 成功缓存保留实际平台 | 二次播放命中缓存时 `sourcePlatform` 不丢，标签不退回主平台 | 同上 L2 链路 + 源仓 U5 | L2 |
| T6 | 关闭目标源后的标签一致性 | 目标源被关闭后不得继续用其旧缓存显示该平台；重开后可恢复 | 源仓 U10 + App 侧只消费返回值 | L2 |
| T7 | 跨仓版本一致 | `docs/MUSIC_SOURCE_GUIDE.md` 的当前工作区版本（v8.13.0）与构建时实际拉到的 `builtin_source.js @version` 必须相等，否则构建失败；源仓未推送时 Release 拉到远端 v8.12.5，会按设计阻断 | `release.yml`「Download latest music source」 | L3 |
| T8 | tsc 门禁 | 全仓 `tsc --noEmit` 0 error，且 step 位于 Setup 后、契约门禁前，失败即阻断构建 | `release.yml` + 本地 `tsc` | L0 |
| T9 | eslint 门禁 | 全仓 `eslint . --ext .js,.jsx,.ts,.tsx` 0/0；CI 生成物 `builtin_source.js` 必须被忽略，不得回扫 3000+ 风格错误 | `release.yml` + `.eslintrc.cjs` | L0 |
| T10 | 版本号持久化 | `buildNumber`/`versionCode` 由 CI 注入并回写 `publish/build-state.json`；同版本不重复 bN，Release 回写 `version.json` | Build `42991043602`：b100 / 259 | L3 |
| T11 | 新增文案三语闭合 | 跨平台总开关、实际平台标签相关键在 zh-cn/zh-tw/en-us 各 893 键，无空串、无重复键、无占位符缺失 | `check_source_config_contract` + `docs-audit` | L1 |
| T12 | 文档时效 | 计划基线、CHANGELOG、RELEASE_SOP、AGENTS 与当前 HEAD/版本/门禁一致；`docs-audit --dry-run` 待处理 0 | `node scripts/docs-audit.js --dry-run` | L1 |

### T 组执行清单（本轮必须逐条跑，不接受"上次绿过"）

```bash
node scripts/check_source_platform_label.js        # 9/9
node scripts/check_source_config_contract.js       # 25/0
node scripts/check_playback_ownership_runtime.js  # 19/0
node scripts/check_health_diagnostics.js           # 51/0
node scripts/check_health_diagnostics_stress.js    # 14/0
node scripts/check_health_diagnostics_view.js      # 22/0
node scripts/check_log_directory.js                # 15/0
node scripts/check_ts_syntax.js                    # 526/0
node scripts/check_docs_consistency.js             # 17 文档
node scripts/docs-audit.js --dry-run               # 待处理 0
node node_modules/typescript/bin/tsc --noEmit      # 0 error
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx   # 0/0
```

### T 组压力测试口径

| 压测 | 做法 | 通过标准 |
|---|---|---|
| 标签矩阵穷举 | `buildSourceLabel` × 平台（7 已知 + local + 未知 + 空，10 种）× 子源（有/无/同平台名/空，4 种） | 40 组合无 `undefined`/空串/双分隔符/悬挂分隔符；实际平台优先 |
| 健康诊断压力 | `check_health_diagnostics_stress.js` 10000 条事件、5MB 日志、200 错误码 | 14/14，不崩、不越界、证据包脱敏 |
| 健康诊断深度审计 | `check_health_diagnostics_deep.js` 51 条：统计/窗口/异常/隐私/多字节/10 万条 | 51/51，详见 [AUDIT_PLAN_HEALTH_DIAGNOSTICS.md](./AUDIT_PLAN_HEALTH_DIAGNOSTICS.md) |
| 诊断窗口视图模型 | `check_health_diagnostics_view.js` 22 条：折叠态/覆盖/四格统计/缓存命中/错误码分组/空态/1 万次构建 | 22/22 |
| 跨仓版本反证 | 故意把 `MUSIC_SOURCE_GUIDE` 版本写成 8.11.7，跑构建前校验 | 必须报「文档音源版本 ≠ 本次内置」而非放行 |
| CI 生成物反证 | 在本地生成一个含分号的 `builtin_source.js`，跑 `eslint .` | 必须 0 错误（证明忽略规则生效，不是恰好没有该文件） |

> 说明：T7~T10 的最终证据以 Build `43177750140` 的 step 日志为准；本地只做同构复核，不把本地绿替代 CI 绿。

### T 组本轮实跑结果（2026-11-12）

| 检查 | 实跑结果 | 退出码 |
|---|---|---|
| `check_source_platform_label.js` | **9/9** | 0 |
| `check_source_config_contract.js` | **25/0** | 0 |
| `check_playback_ownership_runtime.js` | **19/0** | 0 |
| `check_health_diagnostics.js` | **51/0** | 0 |
| `check_health_diagnostics_stress.js` | **14/0**（U6 200 错误码 findings=6） | 0 |
| `check_health_diagnostics_view.js` | **22/0** | 0 |
| `check_log_directory.js` | **15/0**（公共优先/私有回迁/四类补齐/并发/压力） | 0 |
| `check_ts_syntax.js` | **526 文件 0 错误** | 0 |
| `check_docs_consistency.js` | **17 文档无过时引用** | 0 |
| `tsc --noEmit` | **0 error** | 0 |
| `eslint . --ext .js,.jsx,.ts,.tsx` | **0 errors / 0 warnings** | 0 |
| `docs-audit --dry-run` | **待处理 0**（报告 20 项） | 0 |
| Build `43177750140` | Android success / Release success / 跨仓版本 v8.12.5 一致（b115 / `8f53b502`） | — |

> 结论：T 组 12 维中 T1~T6、T11~T12 有本次本地实跑证据；T7~T10 以 Build `43177750140` 为产物级证据。S 组设备级（真机横竖屏/通知栏/批量下载）仍未做，按用户要求不列入本轮待办。

---

## 2026-11-13 发布前复核口径（b116 之前）

> 本节只记录当前本地提交的复核结果；b115/Build `43177750140` 的产物级证据仍是历史基线，不能替代 b116。

| 检查 | 当前结果 | 说明 |
|---|---|---|
| `tsc --noEmit` | 0 error | 全仓 |
| `eslint . --ext .js,.jsx,.ts,.tsx` | 0 error / 0 warning | 全仓 |
| `check_source_contract.js` | 14/0 | 11 action；preload 两 case |
| `check_source_health_persistence.js` | 17/0 | canonical key、旧键迁移、v2 拆分、G5 动态源/版本 |
| `check_health_persistence_v2.js` | 9/0 | control 独立 key、v1 兼容、v1→v2 迁移、TTL/64KB |
| `check_health_event_pipeline.js` | 10/0 | 事件白名单、去重、sourceEvents 脱敏、三块隔离 |
| `check_source_platform_label.js` | 9/9 | 实际平台标签 |
| `check_source_config_contract.js` | 25/0 | 配置键/三语 |
| `check_playback_budget.js` | 20/0 | 24s 预算 |
| `check_playback_ownership_runtime.js` | 19/0 | fallbackOwner |
| `check_media_body.js` | 6/0 | `__lxMedia:2` |
| `check_ts_syntax.js` | 526/0 | TS/TSX |
| `check_docs_consistency.js` | **18 文档 0 过时** | 本轮实跑 |
| `docs-audit --dry-run` | **待处理 0**（报告 20 项） | 本轮实跑 |

**G5 关闭**：`KNOWN_SOURCE_IDS`/固定 `HEALTH_STATE_SOURCE_VERSION` 已删除；写入取快照 `sourceVersion`，源 ID 按 `sources` 实际键校验；新源新版本往返 13/0。

**G7/G8 边界**：wy 原生链成立；tx 只有 60 秒试听（vkeys `quality=6` 503，直连 `200` 但 ffprobe `60.029s`），源侧 5/5 `NOT_FOUND`，不算完整原生交付。G8 官方 API 本地仍可能 403；新增 `scripts/check_source_ci_gate_offline.js` 离线复核 Actions 页面内嵌 JSON，rc0 可作为本地补充证据；构建 runner 仍用 `check_source_ci_gate.js` + `GITHUB_TOKEN`。

