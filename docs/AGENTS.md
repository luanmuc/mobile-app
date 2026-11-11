# AGENTS.md — 多账号/多智能体协作规范

> 本仓库由**多个豆包账号共同开发**。此文件供 GitHub Copilot / 豆包 / 任何智能体读取，避免互相踩踏。
> **核心原则：master 直推即发版，只推已验证的改动；核心逻辑与高冲突区改动先走实证验证链。**

## 项目一句话

洛雪音乐（mobile-app）**定制版** App：fork 自上游 lyswhut 原版 v1.9.1（fork 点 `fb848072`），已合并至上游 v1.9.2（`0669d1b6`）的共存包（`com.luanmuc.lxmusic`），内置豆包定制聚合音源（云编译时从 `luanmuc/backend-api` 自动拉取）。

## 目录结构

```
README.md                   用户视角：定制功能一览/默认设置差异/文档索引
docs/MERGE_GUIDE.md         开发协作：高冲突区/设置迁移规则/代码地图（合并上游前必读）
docs/FAQ.md                 定制版常见问题
docs/CUSTOM_CHANGELOG.md    定制历史（bN 随底座版本重置，v1.9.2 起从 b1 计数）
docs/RELEASE_SOP.md         发布流程/版本号规则/测试清单（push 即发版）
docs/DEV_CONVENTIONS.md     多账号开发规范详情（分工/提交/评审裁决）
docs/DEV_SETUP.md           开发环境搭建
docs/DOWNLOAD_DESIGN.md     下载管理器技术设计（改下载代码前必读）
docs/MUSIC_SOURCE_GUIDE.md  音源体系与 QuickJS 契约
docs/KNOWN_ISSUES.md        已知缺陷/限制（编号化管理）
docs/UPSTREAM_LIFECYCLE.md  上游依赖生命周期管理（增/活/衰/替）
scripts/                    工具（check_ts_syntax.js / gen_change_log.py / check_docs_consistency.js）
publish/                    CI 生成的版本信息（勿手改，构建时自动覆盖）
```

## 常用命令

```bash
# 语法检查（519 个 TS/TSX，每次改动后必跑）
node scripts/check_ts_syntax.js

# 音源标签实际平台契约（9 条：preload→userApi→utils→online→PlayInfo/通知栏 + 拼装矩阵）
node scripts/check_source_platform_label.js

# 音源健康本地诊断契约（35 条，含预加载 action 白名单）
node scripts/check_health_diagnostics.js
# 音源健康本地诊断压力（10000 条聚合/5MB 日志/脏行容错/异常依赖不抛）
node scripts/check_health_diagnostics_stress.js
# 音源健康本地诊断深度审计（51 条：统计口径/窗口覆盖/异常正反例/隐私/多字节/10 万条）
node scripts/check_health_diagnostics_deep.js

# 门禁归属：契约 35 条在 release.yml 构建前阻塞；压力 14 + 深度 51 条在 health-stress.yml（每周/手动）
# 文档一致性检查（推送前必跑：扫描文档中过时版本号/依赖引用，见「文档同步规范」）
node scripts/check_docs_consistency.js
# L4 文档一致性巡检（低风险自动修复：TS 文件数/底座 bN/track-player commit；--dry-run 只报告）
node scripts/docs-audit.js

# 提交 + 推送（push 即触发云编译发版 v1.9.2-bN；push 前必须先 fetch 检查远端，见协作规则第 8 条）
git add <文件> && git commit -m "<type>(<scope>): <中文描述>" && git push origin master
```

## 本地诊断报告口径（`healthDiagnostics.ts`）

- **成功采样加权**：失败 100% 落盘（`sampleWeight=1`）；成功只落 1/20（`sampleWeight=20`）。窗口 `total/ok/failed/successRate` 一律按权重重算，`p95` 仍用原始延迟样本；历史无权重事件按 1 计。异常规则里的前后 24h 成功率也必须用同一加权口径，禁止直接拿落盘条数相除。
- **窗口覆盖 `covered`**：由**全量 outcomes 的最早时间戳**判定（`coversWindow(outcomes, now, ms)`），不是窗口内样本；`coverage` 额外给出事件数、首末时间、`coveredMs`、`truncated`。7 天未被覆盖时摘要必须写“本地日志仅覆盖最近 X，7 天结论仅供参考”。
- **按源拆分 `breakdown`**：按 `sourceKey|platform|quality` 加权聚合，按 `total` 降序截 10 行，用于回答“是哪个源/平台/音质坏了”，不再让 `platform` 单键把同源拆成两个身份。
- **证据包**：`attempts` 把 `source_events` 展开为 `traceId/sourceId/ok/code/latencyMs`（上限 50 条）；并带 `appVersion`、`sourceVersion`；`trend/logTail` 保留但日志尾部经 `redactDiagnosticText` 脱敏。
- **异常条目**：除 `traceIds` 外提供 `samples`（时间/源/错误码/耗时/traceId，最多 5 条），UI 点标题展开；分享不可用时回退复制摘要。快照趋势最近 4 次连续下降且累计 ≥15pp 时生成独立 `trend_decline`，不替代本地 `rate_drop`。


## 版本推进协议（任一账号说「发布」即按此执行）

1. 确认代码改动已完成 + 语法检查 0 错误 + 文档一致性检查通过；
2. push master 即触发云编译发版（`v1.9.2-bN`，bN 自动递增）；
3. 编译完成后 Release 自动创建 APK 附件；
4. 一次发布 = 一次 push = 一个 bN；用户说"重新编译"则直接 push 或 workflow_dispatch。

## 协作规则（多账号直推 master）

1. **小改动**（≤1 个缺陷、风险低、不碰高冲突区）：可直接 master 提交，但必须过语法检查 + 推送前 checklist。
2. **功能改动 / 高冲突区改动**（播放器 / 下载器 / 设置默认值 / 音源体系 / CI）：先本地验证并走实证验证链，确认无回归再直推（仓库无 PR 流程，靠验证链 + 发布后验证兜底）。
3. **提交信息**：Conventional Commits 风格 + 中文描述；一次提交一个主题，不混入无关改动。
4. **每次改动必须更新**：`CUSTOM_CHANGELOG.md` 顶部 + 涉及的功能文档（下载→DOWNLOAD_DESIGN、音源→MUSIC_SOURCE_GUIDE、CI→RELEASE_SOP）。
5. **改默认值必须走设置迁移机制**（见 `MERGE_GUIDE.md`），禁止静默改值，README「默认设置差异」表同步更新。
6. **合并上游**：按 `MERGE_GUIDE.md` 流程；高冲突区文件以本仓库为准人工评估；播放器核心以原版为准最小适配。
7. **禁止**：把令牌/密钥写入提交或文档；提交 node_modules/构建产物；未验证就宣称"应该能用"。
8. **推送前强制检查远端（多账号防覆盖）**：本仓库由多个豆包账号共用同一令牌开发，额度有限时可能中断或只推送了一部分。**每次 `git push` 前必须先 `git fetch origin` 并对比 `origin/master` 与本地 HEAD**：
   - 若远端领先（有其他账号的新提交），**必须先 `git pull --rebase origin master`**，以最新代码为基线；
   - rebase 后重跑语法检查（`node scripts/check_ts_syntax.js`）+ 文档一致性检查（`node scripts/check_docs_consistency.js` + `node scripts/docs-audit.js`），确认自己与对方的改动都存活；
   - 有冲突必须读对方实现再解决，**禁止整块覆盖**他人已实测的功能；
   - 推送被拒绝（non-fast-forward）时，立即 rebase 再推，**禁止 force push（`-f`）**；
   - 若其他账号已完成同一主题（如版本升级、健康分同步），直接复用其结论、合并到自己的文档行，不重复劳动；
   - **额度中断恢复时**：先 fetch 看远端状态，确认上次中断在哪一步（代码已改未推 / 文档未同步 / 自检未跑），从断点继续，不从头重做。

## 实证开发流程（强制）

> **铁律：没有实证依据的改动不进代码；没有走完验证链的改动不进 master。**

### 验证链（从轻到重，逐级通过）

| 层级 | 验证内容 | 方法 | 能发现 |
|---|---|---|---|
| L0 静态 | 语法/类型/lint/结构 | `node scripts/check_ts_syntax.js`（519 文件 0 错误）+ `node node_modules/typescript/bin/tsc --noEmit`（0 error）+ `node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx`（0 error / 0 warning）+ `git diff` 自查 | 语法错误、类型错误、调试残留 |
| L1 逻辑 | 行为/状态流 | 代码走查、必要时补单测 | 逻辑缺陷、状态机错误 |
| L2 接口 | 依赖/音源 | curl/实测（音源接口、上游 API、npm 包） | 接口失效、协议不匹配 |
| L3 真机 | 端到端 | 装包实测（下载/播放/权限/更新） | 宿主差异、集成问题 |
| L4 回归 | 全量 | `docs/RELEASE_SOP.md` 发布前测试清单 | 回归破坏 |

> 发布构建（`release.yml` 的 `Setup Env` 之后）额外阻塞：`tsc --noEmit`（0 error）+ 全仓 `eslint`（0 error / 0 warning）+ 三条只读契约 `check_ts_syntax.js`（519 文件）、`check_source_config_contract.js`（24 条）、`check_source_platform_label.js`（9 条）+ 健康诊断契约 `check_health_diagnostics.js`（35 条）。

### 任务类型分流

- **依据不足** → 标记「调研/实测」，先取证（读代码/读上游/实测），结论留档后再实现；
- **依据充足** → 「实现」，走验证链。

### 禁止项

- 凭"看着没问题 / 别人说能用"合入核心改动；
- 把"上次的经验"当"这次的依据"（上游/接口/依赖会失效）；
- 验证失败后带病合入、或静默降级交付标准。

### 证据链留档（提交说明 + 文档）

- **依据**：实测日期 / 对象 / 结果，或上游提交/文档链接；
- **验证**：跑过 L0-L4 哪些层、结果；
- **结论**：可用 / 不可用 / 降级 + 原因。

## 文档同步 Hook（提交时自动提示，新账号必装）

> 保证"任意账号任意提交，第一时间知道该更新哪些文档，并同提交更新"。机制：入库 git hook（`scripts/hooks/`）+ 映射脚本（`scripts/doc-sync-map.js`，改动文件 → 必同步文档清单）。

1. **新账号 clone 后安装一次**：`sh scripts/install-hooks.sh`（等价 `git config core.hooksPath scripts/hooks`）；
2. **prepare-commit-msg**：每次 `git commit` 自动打印「📋 必同步文档清单」+ 文档巡检红/黄项摘要——照单在同提交内更新文档（含跨仓库 action 提示，如音源能力变更 → 音源仓库侧同步）；
3. **commit-msg 强制校验**：改动含代码（`src/`）但提交不含任何文档更新 → 拒绝提交（确认无需文档时 `git commit --no-verify` 绕过）；
4. **pre-push 闸门**：推送前自动跑 `node scripts/docs-audit.js --dry-run`，存在 🔴（机器修不了的不一致）→ 拒绝推送（`git push --no-verify` 可绕）；
5. 清单中的「action」提示同样要处理：三语言同步、SYNC_POINTS 核对、MERGE_GUIDE 冲突点回填等；
6. 规则表维护：新增映射在 `scripts/doc-sync-map.js` 的 `RULES` 加一行即可（活文档原则）。

## 文档同步规范（强制，无需提醒）


> 原则：**文档是交付物的一部分**。代码 / 版本 / CI 每次变更，必须同步更新相关文档并随变更一起提交（或紧随其后的 docs 提交），**不得等用户提醒**。用户已明确要求"文档要及时自动更新"。

### 1. 触发场景与必同步文档

| 改动类型 | 必同步文档 |
|---|---|
| 底座版本 / 版本号变更 | `docs/RELEASE_SOP.md`（版本规则）、`docs/UPSTREAM_LIFECYCLE.md`（基线+合并记录）、`CUSTOM_CHANGELOG.md`（顶部补记）、`MERGE_GUIDE.md`（分叉点/提交数）、README / AGENTS / FAQ 版本引用 |
| track-player / 依赖升级 | `docs/UPSTREAM_LIFECYCLE.md` 依赖清单、`docs/KNOWN_ISSUES.md` K5、`CUSTOM_CHANGELOG.md` |
| 默认设置 / 设置迁移 | `MERGE_GUIDE.md` 迁移历史、`docs/KNOWN_ISSUES.md`、README「默认设置差异」表 |
| CI / 发布流程改动 | `docs/RELEASE_SOP.md`、AGENTS.md（常用命令 / 发布） |
| 功能新增 / 缺陷修复 | `CUSTOM_CHANGELOG.md` 顶部 + 对应功能文档（DOWNLOAD_DESIGN / MUSIC_SOURCE_GUIDE 等）+ `docs/KNOWN_ISSUES.md` 状态 |
| 内置音源升级（音源仓 `@version` 升版） | `docs/MUSIC_SOURCE_GUIDE.md` §四「聚合源内部结构」（版本号 + 新增特性行）；音源不在本仓迭代、构建时才由 CI 拉取，**最容易漏**——曾滞留 v8.10.1→v8.10.3 才被发现 |
| 上游合并 | 按 `MERGE_GUIDE.md` 合并后必查清单 + 上表版本行 |
| AGENTS.md / 协作规则变更 | `AGENTS.md` 自身（协作规则/命令段/流程改动）+ 紧随提交的 docs 说明 |

### 2. 推送前必跑

```bash
node scripts/check_docs_consistency.js
# L4 文档一致性巡检（低风险自动修复：TS 文件数/底座 bN/track-player commit；--dry-run 只报告）
node scripts/docs-audit.js   # 文档一致性检查：过时引用清零才可推送
```

脚本以 `package.json` 底座版本、track-player 锁定 commit、`publish/build-state.json` 为基准，扫描文档中残留的旧版本号 / 旧依赖引用。新增"易过时引用"时，在脚本 `RULES` 中登记一条即可。

### 3. 执行规则

1. **同提交或紧随提交**：文档改动与代码改动放同一笔提交，或紧随其后独立 docs 提交，不留到"以后"；
2. **文档即代码**：改默认值 / 版本号 / 依赖锁定 / CI 流程时，与代码同步改文档，避免代码先入库文档被遗忘；
3. **历史归档除外**：`CUSTOM_CHANGELOG.md` / `CHANGELOG.md` 的历史版本号记录不改写，只在其顶部补新条目；
4. **检查清单**：推送前跑一次一致性脚本 + 目视核对相关文档，全部清零才算完成。

## 发布

- push master 即触发云编译发版（`v1.9.2-bN`）；`publish/**`、`npm-version-info/**` 不触发。
- 完整流程、发布后验证清单与回滚方法见 `docs/RELEASE_SOP.md`。
- 音源版本独立发布，由 CI 构建时拉取（见 `docs/MUSIC_SOURCE_GUIDE.md`）。
