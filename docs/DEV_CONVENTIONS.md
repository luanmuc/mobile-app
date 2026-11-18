# 多账号开发规范（DEV CONVENTIONS）

本仓库由多个豆包账号共同开发。本文档定义分工、提交规范、评审与冲突裁决规则。

## 一、仓库与分工

| 仓库 | 归属 | 分工 |
|---|---|---|
| `luanmuc/mobile-app`（本仓库） | 主账号 | App 逻辑、UI、CI、文档、发布 |
| `luanmuc/backend-api` | 音源账号 | 聚合音源脚本（`builtin_source.js`），CI 构建时自动拉取 |
| `luanmuc/react-native-track-player` | 播放器账号 | track-player fork（通知栏按钮等定制），版本升级需同步 fork |

> 音源脚本**不要**在本仓库改（`assets/builtin_source.js` 由每次构建从 `luanmuc/backend-api` 拉取最新生成，本仓库不内置副本）；track-player fork 升级后需更新 `package.json` 中依赖的 commit hash。

> 🔗 **跨仓库同步检查**：音源每次发新版本后，照 `docs/SYNC_POINTS.md` 总表逐行核对（actions / 健康分 / trend / lang / subSource / 音质），避免"音源改了、App 没跟上"。

## 二、分支策略

- 当前**单分支（master）直推**模式：直接 push 即触发云编译发版
- 不引入 dev/PR 流程的原因：协作账号少、云编译发版是核心闭环、Review 通过文档规范+推送后验证清单保证
- 若后续协作账号 >3 或频繁互相覆盖，评估引入 `dev` 分支 + PR 评审（届时更新本文档）

## 三、提交信息规范

统一 `Conventional Commits` 风格 + 中文描述（与现有提交保持一致）：

```
<type>(<scope>): <中文描述>

示例：
feat(download): 新增断点续传功能
fix(player): 修复点击歌曲播放错歌的问题
refactor(setting): 清理冗余迁移代码
docs: 完善 MERGE_GUIDE
chore(release): 更新版本信息 v1.9.2-b23
```

规则：

- type：`feat` / `fix` / `refactor` / `docs` / `chore` / `merge` / `Revert`
- scope 小写，用模块名（download/player/setting/source/ci/...）
- **一次提交一个主题**；不要混入无关改动
- 不要提交临时文件、node_modules、构建产物
- CI 的"更新版本信息"与 merge 提交由自动流程产生，无需手写

## 四、推送前 checklist（每条都要过）

1. 语法检查 0 错误（见 [DEV_SETUP.md](./DEV_SETUP.md) 第五节）
2. 是否动了「高冲突区」文件（见 [MERGE_GUIDE.md](MERGE_GUIDE.md)）——若是，合并上游时按该文档处理
3. 是否改了默认值——若改，必须走「设置迁移规则」（见 MERGE_GUIDE）
4. `CUSTOM_CHANGELOG.md` 顶部已补记本次变更（发布说明引用真实变更）
5. `git diff` 自查：没有调试残留、没有令牌/密钥、没有无关文件
6. **推送前 `git fetch origin` 检查远端**（多账号防覆盖）：若远端领先有其他账号新提交，先 `git pull --rebase origin master` 并重跑语法+文档一致性检查，确认无冲突再推；推送被拒立即 rebase，**禁止 force push**

## 五、评审与冲突裁决

- 无 PR 流程，评审靠**推送前自查 + 推送后 Actions 验证 + 群内同步**
- 冲突裁决规则：
  - 高冲突区文件：以本仓库为准（人工评估原版新功能是否移植）
  - 播放器核心：以原版为准（本仓库只做最小适配）
  - UI 风格：保持原版风格，只保留功能性改动
- 两个账号同时改同一模块时，后推送者负责解决冲突，并在提交信息注明

## 六、文档维护规则

| 场景 | 动作 |
|---|---|
| 新增/变更功能 | 更新 `CUSTOM_CHANGELOG.md` 顶部段落 |
| 修改默认值 | 走迁移规则 + 更新 README「默认设置差异」表 |
| 修改 CI/发布 | 更新 [RELEASE_SOP.md](./RELEASE_SOP.md) |
| 修改权限/下载逻辑 | 更新 [DOWNLOAD_DESIGN.md](./DOWNLOAD_DESIGN.md) |
| 修改音源机制 | 更新 [MUSIC_SOURCE_GUIDE.md](./MUSIC_SOURCE_GUIDE.md) |
| 合并上游 | 按 MERGE_GUIDE 流程 + 更新高冲突区清单 |
| 版本号/依赖锁定变更 | 更新 RELEASE_SOP / UPSTREAM_LIFECYCLE / KNOWN_ISSUES 对应条目 |

**文档及时同步（强制）**：文档是交付物的一部分，代码/版本/CI 变更后必须主动同步更新文档并随提交入库，不得等用户提醒（详见 [AGENTS.md](AGENTS.md)「文档同步规范」）。推送前必跑一致性检查，过时引用清零才可推送：

```bash
node scripts/check_docs_consistency.js
```

## 七、账号权限矩阵

| 操作 | 主账号 | 音源账号 | 播放器账号 |
|---|---|---|---|
| 本仓库推送 | ✅ | ✅（经评审） | ✅（经评审） |
| Actions 触发/查看 | ✅ | ✅ | ✅ |
| backend-api 推送 | 只读 | ✅ | 只读 |
| track-player fork | 只读 | 只读 | ✅ |
| npm 发布（NPM_TOKEN） | ✅（secret 管理） | — | — |
| GitHub secrets 管理 | ✅ | — | — |

> 原则：能 push 不等于能乱 push；任何对外可见的发布（Release/npm）都由主账号把关。

## 版本号批量替换是本仓最危险的文档操作（2026-11-18 教训）

`5e107e10`（V9.3）里做过一次全局替换，把 `1.9.2-b` 统一改成 `1.9.3-b`，结果连**历史发布记录**（真实 tag `v1.9.2-b114`…`b148`）一起改掉了，造成「文档写 1.9.3、远端 tag 实际是 1.9.2」的长期错位；`RELEASE_SOP` 的版本口径表也被带偏，反过来又成了后续升版的"依据"。等到 b153 才查出根因：远端 `v1.9.2-b*` tag 有 102 个、`v1.9.3-b*` 只有 1 个。

**规则**
1. 底座版本**只跟随洛雪官方**（当前 `1.9.2`）。我们自己的改动只递增 `bN`，绝不因为"改动大"就抬底座主/次版本号——官方没发 1.9.3，我们就不能自称 1.9.3。
2. 版本号替换**只能改「当前口径」位置**：`RELEASE_SOP` 版本表、`README` 底座行、`AGENTS` 发版命令、`package.json` / `build-state.json` / `version.json`。**历史 CHANGELOG 条目一律不动**。
3. 改完必须两件事对账：`git tag | grep '^v<底座>-b' | wc -l` 与远端 `git ls-remote --tags` 计数一致；`check_release_state_contract` + `check_docs_consistency` 双门禁清零。
4. 底座回退时 `bN` 继续递增（不回绕到旧号），`versionCode` 永远单调递增，保证覆盖安装。

## 八、上游基座对照规则（强制，v1.9.2 起）

本仓库基于 `lyswhut/lx-music-mobile` **v1.9.2**（commit `0669d1b`）定制。
**任何"这里是不是问题"的判定，以上游原码为准，不得凭"代码看起来不合理"动手。**
教训来源：A11-017（AES 加密模式）曾按"常量名才是意图"改掉上游行为，核实后发现我方音源根本不调用、
改动零收益却会改变第三方音源拿到的密文长度 → 已完整还原。

### 8.1 动手前三步（顺序不可跳）

1. **定位**：先在上游源码里找对应代码（路径见 [`UPSTREAM_BASELINE.md`](UPSTREAM_BASELINE.md)）。
   - 查询命令：`node scripts/check_upstream_divergence.js --file=src/<路径>`
   - 看差异：`diff -u $LX_UPSTREAM_ROOT/src/<路径> src/<路径>`
2. **判定**：按 8.2 的 A/B/C 三档定性。
3. **执行**：**只有 A 档才改**，且代码内必须留编号注释。

### 8.2 三档判据

| 档 | 判据 | 动作 |
|---|---|---|
| **A 上游真缺陷** | 上游原码在**合法输入**下会产生错误结果 / 崩溃 / 数据丢失 / 契约不符 | 可改。代码内补 `// A<两位>-<编号>：上游原样<缺/错> xxx —— <后果>` |
| **B 上游有意设计** | 多策略探测链、体验取舍（如坏图不显示）、精度取舍、按业务约定留空 | **不改**。只登记，不回滚上游原样 |
| **C 我们的口径不同** | 上游逻辑没错，但本项目要求不同（缓存上限、原子写入等） | 需写明影响面。**若第三方可观察（第三方音源拿到的密文/返回结构、用户脚本 API）→ 不得擅改** |

### 8.3 硬红线

- **上游存在且零差异的文件**：默认不得改动。确需改动必须属 A 档并留注释。
- **"看起来不合理"≠ 缺陷**：空 catch 可能是探测链设计；缺兜底可能是体验取舍。
- **改了第三方可观察行为**：必须先论证「我方收益 > 对外破坏」，否则不动（A11-017 教训）。
- **不许把 B 档当 A 档修**：给上游探测链加日志、给坏图加占位，都是零收益改动。

### 8.4 留痕要求

改动上游存在的文件，代码内必须有二选一的留痕：

```js
// 方式一（缺陷修复，推荐）：编号 + 上游原样描述 + 后果
// A07-024：前缀判定原本检测 data.img3，与真正选中的 img 不一致 —— img3 为空而
// img2/img1 已是绝对 URL 时会被错误拼上域名（封面裂图）。改为检测 img。
if (img && !/https?:/.test(img)) img = ...

// 方式二（功能改造，非缺陷）：标明这是定制改造
// LX 定制：通知栏「词」按钮状态同步（原生 setLyricButtonActive）
```

### 8.5 审计脚本

```bash
node scripts/check_upstream_divergence.js            # 全仓分档统计
node scripts/check_upstream_divergence.js --list     # 列出全部「有差异但无留痕」
node scripts/check_upstream_divergence.js --file=src/xxx.ts  # 单文件基座状态查询
node scripts/check_upstream_divergence.js --strict   # 存在无留痕改动时退 1（可选接入 CI）
```

输出四档：定制文件（上游无）/ 已改动有留痕 / 已改动无留痕（待复核）/ 零差异。
脚本是**审计工具**：日常不阻塞，复核阶段用。
